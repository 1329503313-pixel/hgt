import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { isSmsDeliveryConfigured, normalizeMainlandPhoneNumber, sendVerificationSms, SmsDeliveryError } from "./sms.js";

export type PhoneChallengePurpose = "register" | "upgrade" | "recover";
type Db = mysql.Pool | mysql.PoolConnection;

const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS_PER_DAY = 10;
const MAX_ATTEMPTS = 5;

export class PhoneAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PhoneAuthError";
  }
}

export function phoneCodeDigest(challengeId: string, code: string, secret = config.emailVerificationSecret) {
  return createHmac("sha256", secret).update(`phone:${challengeId}:${code}`).digest("hex");
}

export function phoneRequestIpDigest(ip: string) {
  return createHmac("sha256", config.emailVerificationSecret).update(`phone-ip:${ip}`).digest("hex");
}

export function opaqueTokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function equalDigest(first: string, second: string) {
  const a = Buffer.from(first, "hex");
  const b = Buffer.from(second, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function mysqlDate(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export async function phoneOwner(db: Db, phone: string) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT user_id FROM user_identities
     WHERE identity_type = 'phone' AND identifier = ? AND verified_at IS NOT NULL LIMIT 1`,
    [phone],
  );
  return row ? String(row.user_id) : null;
}

export async function sendPhoneChallenge(
  pool: mysql.Pool,
  input: { phone: string; purpose: PhoneChallengePurpose; userId?: string | null; ip: string },
) {
  if (!isSmsDeliveryConfigured()) throw new PhoneAuthError(503, "短信服务暂不可用，请稍后再试");
  const phone = normalizeMainlandPhoneNumber(input.phone);
  const ipHash = phoneRequestIpDigest(input.ip);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const challengeId = nanoid();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("INSERT IGNORE INTO phone_verification_send_locks (phone) VALUES (?)", [phone]);
    await connection.query("SELECT phone FROM phone_verification_send_locks WHERE phone = ? FOR UPDATE", [phone]);
    const [[limits]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
         (SELECT MAX(created_at) FROM phone_verification_challenges WHERE phone = ? AND delivery_status <> 'failed') AS latest,
         (SELECT COUNT(*) FROM phone_verification_challenges WHERE phone = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR AND delivery_status <> 'failed') AS phone_count,
         (SELECT COUNT(*) FROM phone_verification_challenges WHERE requester_ip_hash = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR AND delivery_status <> 'failed') AS ip_count`,
      [phone, phone, ipHash],
    );
    if (limits?.latest && Date.now() - new Date(limits.latest).getTime() < RESEND_COOLDOWN_MS) {
      throw new PhoneAuthError(429, "发送过于频繁，请 60 秒后再试");
    }
    if (Number(limits?.phone_count ?? 0) >= MAX_SENDS_PER_DAY || Number(limits?.ip_count ?? 0) >= 30) {
      throw new PhoneAuthError(429, "今日验证码发送次数已达上限，请稍后再试");
    }
    await connection.query(
      `UPDATE phone_verification_challenges SET consumed_at = UTC_TIMESTAMP()
       WHERE phone = ? AND purpose = ? AND user_id <=> ? AND consumed_at IS NULL`,
      [phone, input.purpose, input.userId ?? null],
    );
    await connection.query(
      `INSERT INTO phone_verification_challenges
       (id, phone, purpose, user_id, requester_ip_hash, code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [challengeId, phone, input.purpose, input.userId ?? null, ipHash,
        phoneCodeDigest(challengeId, code), mysqlDate(new Date(Date.now() + CODE_TTL_MS))],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  try {
    await sendVerificationSms({ phoneNumber: phone, code, outId: `${input.purpose}:${challengeId}` });
  } catch (error) {
    const uncertain = error instanceof SmsDeliveryError && error.reason === "transport_error";
    await pool.query(
      "UPDATE phone_verification_challenges SET delivery_status = ? WHERE id = ?",
      [uncertain ? "uncertain" : "failed", challengeId],
    );
    throw new PhoneAuthError(error instanceof SmsDeliveryError && error.reason === "not_configured" ? 503 : 502,
      uncertain ? "短信发送结果暂不确定；如已收到验证码可继续填写，请稍后再试" : "短信发送失败，请稍后再试");
  }
  await pool.query("UPDATE phone_verification_challenges SET delivery_status = 'accepted' WHERE id = ?", [challengeId]);
  return { ok: true, expiresInSeconds: CODE_TTL_MS / 1000, resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

export async function verifyPhoneChallenge(
  connection: mysql.PoolConnection,
  input: { phone: string; purpose: PhoneChallengePurpose; code: string; userId?: string | null },
) {
  const [[challenge]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, code_hash, attempts, expires_at
     FROM phone_verification_challenges
     WHERE phone = ? AND purpose = ? AND user_id <=> ? AND consumed_at IS NULL
       AND delivery_status IN ('accepted','uncertain')
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [input.phone, input.purpose, input.userId ?? null],
  );
  if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now() || Number(challenge.attempts) >= MAX_ATTEMPTS) {
    return { ok: false as const, message: "验证码已失效，请重新获取" };
  }
  if (!equalDigest(phoneCodeDigest(String(challenge.id), input.code), String(challenge.code_hash))) {
    await connection.query(
      `UPDATE phone_verification_challenges
       SET attempts = attempts + 1, consumed_at = CASE WHEN attempts + 1 >= ? THEN UTC_TIMESTAMP() ELSE consumed_at END
       WHERE id = ?`,
      [MAX_ATTEMPTS, challenge.id],
    );
    return { ok: false as const, message: "验证码错误" };
  }
  return { ok: true as const, id: String(challenge.id) };
}

export async function consumePhoneChallenge(connection: mysql.PoolConnection, challengeId: string) {
  await connection.query(
    "UPDATE phone_verification_challenges SET consumed_at = UTC_TIMESTAMP() WHERE id = ? AND consumed_at IS NULL",
    [challengeId],
  );
}
