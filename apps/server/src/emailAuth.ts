import bcrypt from "bcryptjs";
import type { Express, NextFunction, Request, Response } from "express";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual
} from "node:crypto";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "./config.js";
import { awardBeginnerTask } from "./shellCurrency.js";
import { awardInviteEmailBindingWithConnection } from "./inviteRewards.js";
import {
  isEmailDeliveryConfigured,
  sendEmailSecurityNotice,
  sendEmailVerificationCode,
  sendPasswordResetEmail
} from "./mailer.js";

const EMAIL_CODE_TTL_MS = 10 * 60_000;
const RESET_TOKEN_TTL_MS = 20 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const DAILY_SEND_LIMIT = 10;
const MAX_CODE_ATTEMPTS = 5;
const GENERIC_RESET_MESSAGE = "如果该邮箱已绑定账号，我们会发送密码重置邮件";

type AuthenticatedUser = { id: string; tokenVersion: number };
type Pool = mysql.Pool;
type SendError = (res: Response, status: number, message: string) => Response;

type RegisterEmailAuthOptions = {
  pool: Pool;
  requireAuth: (req: Request, res: Response) => Promise<AuthenticatedUser | null>;
  sendError: SendError;
  createRateLimiter: (
    windowMs: number,
    maxRequests: number,
    keyFor: (req: Request) => string
  ) => (req: Request, res: Response, next: NextFunction) => void;
};

const emailSchema = z.string().trim().email("邮箱格式不正确").max(255);
const passwordSchema = z.string().min(6, "密码至少 6 位").max(72, "密码不能超过 72 位");

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function maskEmail(email: string) {
  const [local, domain] = normalizeEmail(email).split("@");
  if (!local || !domain) return "";
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, Math.min(3, local.length - 1));
  return `${visible}***@${domain}`;
}

export function emailCodeDigest(challengeId: string, code: string, secret = config.emailVerificationSecret) {
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

export function resetTokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function matchesDigest(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function generateVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function mysqlDate(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function verifiedEmail(pool: Pool, userId: string) {
  const [[identity]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT identifier, verified_at
     FROM user_identities
     WHERE user_id = ? AND identity_type = 'email' AND verified_at IS NOT NULL
     LIMIT 1`,
    [userId]
  );
  return identity
    ? { email: String(identity.identifier), verifiedAt: new Date(identity.verified_at).toISOString() }
    : null;
}

async function verifyCurrentPassword(pool: Pool, userId: string, password: string) {
  const [[user]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT password FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  return Boolean(user && await bcrypt.compare(password, String(user.password)));
}

async function enforceEmailSendLimits(pool: Pool, userId: string, email: string) {
  const [[latest]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT created_at
     FROM email_verification_challenges
     WHERE user_id = ? OR email = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, email]
  );
  if (latest && Date.now() - new Date(latest.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return { allowed: false as const, message: "验证码发送过于频繁，请 60 秒后再试" };
  }
  const [[daily]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM email_verification_challenges
     WHERE (user_id = ? OR email = ?)
       AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)`,
    [userId, email]
  );
  if (Number(daily.count ?? 0) >= DAILY_SEND_LIMIT) {
    return { allowed: false as const, message: "今日验证码发送次数已达上限，请明天再试" };
  }
  return { allowed: true as const };
}

export function registerEmailAuthRoutes(app: Express, options: RegisterEmailAuthOptions) {
  const { pool, requireAuth, sendError, createRateLimiter } = options;
  const emailSendRateLimiter = createRateLimiter(
    60 * 60_000,
    12,
    (req) => `email-send:${req.ip ?? "unknown"}`
  );
  const resetConfirmRateLimiter = createRateLimiter(
    15 * 60_000,
    10,
    (req) => `email-reset:${req.ip ?? "unknown"}`
  );

  app.get("/api/auth/email/status", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const identity = await verifiedEmail(pool, user.id);
    res.json({
      configured: isEmailDeliveryConfigured(),
      email: identity
        ? { masked: maskEmail(identity.email), verifiedAt: identity.verifiedAt }
        : null
    });
  });

  app.post("/api/auth/email/bind/request", emailSendRateLimiter, async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!isEmailDeliveryConfigured()) {
      return sendError(res, 503, "邮件服务尚未配置，请联系管理员");
    }
    const parsed = z.object({
      email: emailSchema,
      password: z.string().min(1, "请输入当前密码").max(72)
    }).safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0]?.message ?? "邮箱信息不正确");
    }
    if (!await verifyCurrentPassword(pool, user.id, parsed.data.password)) {
      return sendError(res, 401, "当前密码错误");
    }

    const email = normalizeEmail(parsed.data.email);
    const current = await verifiedEmail(pool, user.id);
    if (current?.email === email) return sendError(res, 409, "该邮箱已经绑定当前账号");

    const [[owner]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT user_id FROM user_identities
       WHERE identity_type = 'email' AND identifier = ?
       LIMIT 1`,
      [email]
    );
    if (owner && String(owner.user_id) !== user.id) {
      return sendError(res, 409, "该邮箱不可用于绑定");
    }

    const limit = await enforceEmailSendLimits(pool, user.id, email);
    if (!limit.allowed) return sendError(res, 429, limit.message);

    const purpose = current ? "change" as const : "bind" as const;
    const challengeId = nanoid();
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
    await pool.query(
      `UPDATE email_verification_challenges
       SET consumed_at = UTC_TIMESTAMP()
       WHERE user_id = ? AND consumed_at IS NULL`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO email_verification_challenges
       (id, user_id, email, purpose, code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [challengeId, user.id, email, purpose, emailCodeDigest(challengeId, code), mysqlDate(expiresAt)]
    );
    try {
      await sendEmailVerificationCode(email, code, purpose);
    } catch (error) {
      await pool.query("DELETE FROM email_verification_challenges WHERE id = ?", [challengeId]);
      console.error("Email verification delivery failed:", (error as Error).message);
      return sendError(res, 502, "验证码邮件发送失败，请稍后重试");
    }
    res.json({
      ok: true,
      maskedEmail: maskEmail(email),
      expiresInSeconds: EMAIL_CODE_TTL_MS / 1000
    });
  });

  app.post("/api/auth/email/bind/confirm", resetConfirmRateLimiter, async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const parsed = z.object({
      email: emailSchema,
      code: z.string().trim().regex(/^\d{6}$/, "请输入 6 位验证码")
    }).safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0]?.message ?? "验证码信息不正确");
    }
    const email = normalizeEmail(parsed.data.email);
    const [[challenge]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, code_hash, attempts, expires_at
       FROM email_verification_challenges
       WHERE user_id = ? AND email = ? AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id, email]
    );
    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
      return sendError(res, 400, "验证码已失效，请重新获取");
    }
    if (Number(challenge.attempts) >= MAX_CODE_ATTEMPTS) {
      return sendError(res, 400, "验证码尝试次数过多，请重新获取");
    }
    const digest = emailCodeDigest(String(challenge.id), parsed.data.code);
    if (!matchesDigest(digest, String(challenge.code_hash))) {
      const nextAttempts = Number(challenge.attempts) + 1;
      await pool.query(
        `UPDATE email_verification_challenges
         SET attempts = ?, consumed_at = CASE WHEN ? >= ? THEN UTC_TIMESTAMP() ELSE consumed_at END
         WHERE id = ?`,
        [nextAttempts, nextAttempts, MAX_CODE_ATTEMPTS, challenge.id]
      );
      return sendError(
        res,
        400,
        nextAttempts >= MAX_CODE_ATTEMPTS ? "验证码尝试次数过多，请重新获取" : "验证码错误"
      );
    }

    const connection = await pool.getConnection();
    let oldEmail: string | null = null;
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, identifier
         FROM user_identities
         WHERE user_id = ? AND identity_type = 'email'
         FOR UPDATE`,
        [user.id]
      );
      oldEmail = existing ? String(existing.identifier) : null;
      const [[owner]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT user_id FROM user_identities
         WHERE identity_type = 'email' AND identifier = ?
         FOR UPDATE`,
        [email]
      );
      if (owner && String(owner.user_id) !== user.id) {
        await connection.rollback();
        return sendError(res, 409, "该邮箱已被其他账号绑定");
      }
      if (existing) {
        await connection.query(
          `UPDATE user_identities
           SET identifier = ?, verified_at = UTC_TIMESTAMP()
           WHERE id = ?`,
          [email, existing.id]
        );
      } else {
        await connection.query(
          `INSERT INTO user_identities
           (id, user_id, identity_type, identifier, verified_at)
           VALUES (?, ?, 'email', ?, UTC_TIMESTAMP())`,
          [nanoid(), user.id, email]
        );
      }
      await connection.query(
        "UPDATE email_verification_challenges SET consumed_at = UTC_TIMESTAMP() WHERE id = ?",
        [challenge.id]
      );
      if (oldEmail && oldEmail !== email) {
        await connection.query(
          "UPDATE password_reset_tokens SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND consumed_at IS NULL",
          [user.id]
        );
      }
      await awardInviteEmailBindingWithConnection(connection, user.id);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        return sendError(res, 409, "该邮箱不可用于绑定");
      }
      throw error;
    } finally {
      connection.release();
    }

    if (oldEmail && oldEmail !== email) {
      sendEmailSecurityNotice(oldEmail, "changed").catch((error) => {
        console.error("Email change notice failed:", (error as Error).message);
      });
    }
    await awardBeginnerTask(user.id, "bind_email");
    res.json({
      ok: true,
      email: { masked: maskEmail(email), verifiedAt: new Date().toISOString() }
    });
  });

  app.delete("/api/auth/email", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const parsed = z.object({
      password: z.string().min(1, "请输入当前密码").max(72)
    }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "请输入当前密码");
    if (!await verifyCurrentPassword(pool, user.id, parsed.data.password)) {
      return sendError(res, 401, "当前密码错误");
    }
    const current = await verifiedEmail(pool, user.id);
    if (!current) return sendError(res, 404, "当前账号尚未绑定邮箱");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        "DELETE FROM user_identities WHERE user_id = ? AND identity_type = 'email'",
        [user.id]
      );
      await connection.query(
        "UPDATE password_reset_tokens SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND consumed_at IS NULL",
        [user.id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    sendEmailSecurityNotice(current.email, "unbound").catch((error) => {
      console.error("Email unbind notice failed:", (error as Error).message);
    });
    res.json({ ok: true });
  });

  app.post("/api/auth/password/reset/request", emailSendRateLimiter, async (req, res) => {
    const parsed = z.object({ email: emailSchema }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "邮箱格式不正确");
    if (!isEmailDeliveryConfigured()) {
      return sendError(res, 503, "邮件服务尚未配置，请联系管理员");
    }
    const email = normalizeEmail(parsed.data.email);
    const [[identity]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT identity.user_id, u.username
       FROM user_identities identity
       INNER JOIN users u ON u.id = identity.user_id
       WHERE identity.identity_type = 'email' AND identity.identifier = ? AND identity.verified_at IS NOT NULL
       LIMIT 1`,
      [email]
    );
    if (identity) {
      const userId = String(identity.user_id);
      const [[recent]] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT created_at FROM password_reset_tokens
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );
      if (!recent || Date.now() - new Date(recent.created_at).getTime() >= RESEND_COOLDOWN_MS) {
        const token = randomBytes(32).toString("base64url");
        const tokenId = nanoid();
        await pool.query(
          "UPDATE password_reset_tokens SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND consumed_at IS NULL",
          [userId]
        );
        await pool.query(
          `INSERT INTO password_reset_tokens
           (id, user_id, token_hash, expires_at)
           VALUES (?, ?, ?, ?)`,
          [
            tokenId,
            userId,
            resetTokenDigest(token),
            mysqlDate(new Date(Date.now() + RESET_TOKEN_TTL_MS))
          ]
        );
        try {
          await sendPasswordResetEmail(email, String(identity.username), token);
        } catch (error) {
          await pool.query("DELETE FROM password_reset_tokens WHERE id = ?", [tokenId]);
          console.error("Password reset email delivery failed:", (error as Error).message);
        }
      }
    }
    res.json({ ok: true, message: GENERIC_RESET_MESSAGE });
  });

  app.post("/api/auth/password/reset/confirm", resetConfirmRateLimiter, async (req, res) => {
    const parsed = z.object({
      token: z.string().min(20, "重置链接无效").max(200),
      newPassword: passwordSchema
    }).safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0]?.message ?? "重置信息不正确");
    }
    const tokenHash = resetTokenDigest(parsed.data.token);
    const connection = await pool.getConnection();
    let email: string | null = null;
    try {
      await connection.beginTransaction();
      const [[tokenRow]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, user_id
         FROM password_reset_tokens
         WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP()
         FOR UPDATE`,
        [tokenHash]
      );
      if (!tokenRow) {
        await connection.rollback();
        return sendError(res, 400, "重置链接已失效，请重新申请");
      }
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      await connection.query(
        "UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?",
        [passwordHash, tokenRow.user_id]
      );
      await connection.query(
        "UPDATE password_reset_tokens SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND consumed_at IS NULL",
        [tokenRow.user_id]
      );
      const [[identity]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT identifier FROM user_identities
         WHERE user_id = ? AND identity_type = 'email'
         LIMIT 1`,
        [tokenRow.user_id]
      );
      email = identity ? String(identity.identifier) : null;
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (email) {
      sendEmailSecurityNotice(email, "password_reset").catch((error) => {
        console.error("Password reset notice failed:", (error as Error).message);
      });
    }
    res.json({ ok: true });
  });
}
