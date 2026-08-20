import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";

export const VIP_GROWTH_LEVELS = [0, 5, 300, 800, 1500, 2800, 4500, 7000, 10000, 15000] as const;
export const VIP_MAX_LEVEL = 9;
export const VIP_DAILY_ACTIVE_GROWTH = 10;
export const VIP_DAILY_INACTIVE_DECAY = 5;
export const VIP_GRANT_GROWTH_PER_DAY = 5;

export type VipGrowthEventType = "grant" | "daily_active" | "daily_inactive" | "adjustment";

export function vipLevelForGrowth(value: number) {
  const growth = Math.max(0, Math.floor(Number(value) || 0));
  let level = 0;
  for (let index = 1; index < VIP_GROWTH_LEVELS.length; index += 1) {
    if (growth >= VIP_GROWTH_LEVELS[index]) level = index;
    else break;
  }
  return level;
}

export function vipGrowthMultiplier(level: number) {
  const normalized = Math.min(VIP_MAX_LEVEL, Math.max(0, Math.floor(Number(level) || 0)));
  return normalized < 2 ? 1 : 1 + (normalized - 1) * 0.2;
}

export function roundVipBenefit(value: number) {
  return Math.max(0, Math.floor(Number(value) + 0.5));
}

export function vipBenefitValue(base: number | null, level: number) {
  if (base == null) return null;
  return roundVipBenefit(base * vipGrowthMultiplier(level));
}

export function beijingDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function isVipActiveRow(row: any, now = new Date()) {
  const role = String(row.role ?? "");
  // Administrator identities are retained when VIP is granted. Their active
  // subscription must therefore be derived from the underlying VIP fields,
  // just like an ordinary VIP account.
  if (role === "vip" || role === "backoffice_admin" || role === "super_admin") {
    if (Boolean(row.vip_legacy_active)) return true;
    return Boolean(row.vip_expires_at && new Date(row.vip_expires_at as string | Date).getTime() > now.getTime());
  }
  return false;
}

export function vipGrowthSnapshot(row: any, now = new Date()) {
  const growthValue = Math.max(0, Math.floor(Number(row.vip_growth_value ?? 0) || 0));
  const level = vipLevelForGrowth(growthValue);
  return { growthValue, level, active: isVipActiveRow(row, now), multiplier: vipGrowthMultiplier(level) };
}

type GrowthConnection = mysql.PoolConnection;

export function vipGrowthDateKey(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match?.[1] ?? null;
}

export async function recordVipGrowthEvent(
  connection: GrowthConnection,
  input: {
    userId: string;
    amount: number;
    eventType: VipGrowthEventType;
    eventKey: string;
    remark: string;
    eventDate?: string | null;
  }
) {
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount === 0) return false;
  const [result] = await connection.query<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO vip_growth_events
      (id, user_id, event_type, amount, event_key, event_date, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), input.userId, input.eventType, amount, input.eventKey, input.eventDate ?? null, input.remark]
  );
  if (!result.affectedRows) return false;
  await connection.query(
    `UPDATE users
     SET vip_growth_value = GREATEST(0, CAST(vip_growth_value AS SIGNED) + ?)
     WHERE id = ?`,
    [amount, input.userId]
  );
  return true;
}

export async function settleVipGrowthForDate(
  connection: GrowthConnection,
  user: any,
  date = beijingDateKey()
) {
  const userId = String(user.id);
  await connection.query(
    `INSERT IGNORE INTO vip_growth_daily_settlements
      (user_id, growth_date, active_at_settlement, amount)
     VALUES (?, ?, ?, ?)`,
    [userId, date, isVipActiveRow(user), isVipActiveRow(user) ? VIP_DAILY_ACTIVE_GROWTH : -VIP_DAILY_INACTIVE_DECAY]
  );
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT amount, active_at_settlement
     FROM vip_growth_daily_settlements
     WHERE user_id = ? AND growth_date = ?
     LIMIT 1`,
    [userId, date]
  );
  const settlement = rows[0];
  if (!settlement) return 0;
  const eventType: VipGrowthEventType = Boolean(settlement.active_at_settlement) ? "daily_active" : "daily_inactive";
  const amount = Number(settlement.amount ?? 0);
  await recordVipGrowthEvent(connection, {
    userId,
    amount,
    eventType,
    eventKey: `vip-growth:${userId}:${date}`,
    eventDate: date,
    remark: Boolean(settlement.active_at_settlement) ? "VIP每日成长值" : "非VIP每日成长值扣减"
  });
  return amount;
}

export async function settleVipGrowthThroughDate(
  connection: GrowthConnection,
  user: any,
  date = beijingDateKey()
) {
  const [[latest]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT MAX(growth_date) AS latest_date FROM vip_growth_daily_settlements WHERE user_id = ?",
    [user.id]
  );
  const latestDate = vipGrowthDateKey(latest?.latest_date);
  const start = latestDate ? new Date(`${latestDate}T00:00:00Z`) : new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T00:00:00Z`);
  if (start > end) return 0;
  let total = 0;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    total += await settleVipGrowthForDate(connection, user, cursor.toISOString().slice(0, 10));
  }
  return total;
}
