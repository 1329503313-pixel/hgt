import type { Express, Request, Response } from "express";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { isSuperAdminRole, normalizeUserRole, type UserRole } from "./roles.js";
import { effectiveEntitlementPlans } from "./entitlements.js";
import { recordVipGrowthEvent, vipBenefitValue, vipGrowthSnapshot, VIP_GRANT_GROWTH_PER_DAY } from "./vipGrowth.js";

export const VIP_DAY_MS = 24 * 60 * 60 * 1000;
export const VIP_MONTH_DAYS = 31;
export const VIP_YEAR_DAYS = 366;

export type VipOrderType = "purchase_month" | "purchase_year" | "gift" | "reduce" | "cancel";

type AdminActor = { id: string; role: UserRole };
type VipRouteDependencies = {
  pool: mysql.Pool;
  requireAuth: (req: Request, res: Response) => Promise<AdminActor | null>;
  requireAdmin: (req: Request, res: Response) => Promise<AdminActor | null>;
  sendError: (res: Response, status: number, message: string) => unknown;
  onEntitlementChanged?: (userId: string) => Promise<void> | void;
};

const grantDurationSchema = z.discriminatedUnion("unit", [
  z.object({ unit: z.literal("day"), value: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(15)]) }),
  z.object({ unit: z.literal("month"), value: z.number().int().positive().max(1200) })
]);

export function vipGrantDays(duration: z.infer<typeof grantDurationSchema>) {
  return duration.unit === "month" ? duration.value * VIP_MONTH_DAYS : duration.value;
}

export function vipBalanceDays(expiresAt: Date | null, now = new Date()) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / VIP_DAY_MS));
}

export function vipExpiryAfterGrant(currentExpiry: Date | null, days: number, now = new Date()) {
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry.getTime() : now.getTime();
  return new Date(base + days * VIP_DAY_MS);
}

export function vipExpiryAfterReduction(currentExpiry: Date, days: number, now = new Date()) {
  return new Date(Math.max(now.getTime(), currentExpiry.getTime() - days * VIP_DAY_MS));
}

export function formatVipOrderNumber(dateKey: string, sequence: number) {
  if (!/^\d{8}$/.test(dateKey) || !Number.isInteger(sequence) || sequence < 1 || sequence > 999999) {
    throw new Error("VIP_ORDER_NUMBER_INVALID");
  }
  return `${dateKey}${String(sequence).padStart(6, "0")}`;
}

export function roleAfterVipGrant(role: unknown): UserRole {
  const normalized = normalizeUserRole(role);
  return normalized === "user" || normalized === "vip" ? "vip" : normalized;
}

export function roleAfterVipRemoval(role: unknown): UserRole {
  const normalized = normalizeUserRole(role);
  return normalized === "vip" ? "user" : normalized;
}

export function roleAfterAdminRemoval(role: unknown, vipActive: boolean): UserRole {
  const normalized = normalizeUserRole(role);
  return normalized === "backoffice_admin" ? (vipActive ? "vip" : "user") : normalized;
}

export async function syncExpiredVipRoles(pool: mysql.Pool) {
  await pool.query(
    `UPDATE users
     SET role = 'user'
     WHERE role = 'vip'
       AND vip_legacy_active = 0
       AND vip_expires_at IS NOT NULL
       AND vip_expires_at <= UTC_TIMESTAMP()`
  );
}

async function nextVipOrderNumber(connection: mysql.PoolConnection) {
  const [[dateRow]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR), '%Y-%m-%d') AS order_date"
  );
  const orderDate = String(dateRow.order_date);
  await connection.query(
    `INSERT IGNORE INTO vip_daily_order_sequences (order_date, last_sequence)
     VALUES (?, 0)`,
    [orderDate]
  );
  const [[sequenceRow]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT last_sequence,
       DATE_FORMAT(order_date, '%Y%m%d') AS date_key
     FROM vip_daily_order_sequences
     WHERE order_date = ?
     FOR UPDATE`,
    [orderDate]
  );
  const sequence = Number(sequenceRow.last_sequence) + 1;
  if (!Number.isSafeInteger(sequence) || sequence > 999999) throw new Error("VIP_DAILY_SEQUENCE_EXHAUSTED");
  await connection.query(
    `UPDATE vip_daily_order_sequences SET last_sequence = ?
     WHERE order_date = ?`,
    [sequence, orderDate]
  );
  return formatVipOrderNumber(String(sequenceRow.date_key), sequence);
}

async function insertVipOrder(
  connection: mysql.PoolConnection,
  input: {
    userId: string;
    nickname: string;
    username: string;
    type: VipOrderType;
    dayChange: number;
    balanceAfterDays: number;
    operatorUserId: string | null;
  }
) {
  const orderNumber = await nextVipOrderNumber(connection);
  await connection.query(
    `INSERT INTO vip_orders
      (id, order_number, user_id, user_nickname, user_username, order_type,
       day_change, balance_after_days, operator_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), orderNumber, input.userId, input.nickname, input.username, input.type,
      input.dayChange, input.balanceAfterDays, input.operatorUserId
    ]
  );
  return orderNumber;
}

function mapVipUser(row: mysql.RowDataPacket) {
  const expiresAt = row.vip_expires_at ? new Date(row.vip_expires_at) : null;
  const legacyActive = Boolean(row.vip_legacy_active);
  const now = new Date();
  const vipActive = legacyActive || Boolean(expiresAt && expiresAt.getTime() > now.getTime());
  const role = normalizeUserRole(row.role);
  const growth = vipGrowthSnapshot(row);
  const currentIdentity = role === "super_admin"
    ? "super_admin"
    : role === "backoffice_admin"
      ? "backoffice_admin"
      : vipActive
        ? "vip"
        : "expired";
  return {
    id: String(row.id),
    nickname: String(row.nickname),
    username: String(row.username),
    role,
    vipGrowthValue: growth.growthValue,
    vipLevel: growth.level,
    vipActive: growth.active,
    currentIdentity,
    vipExpiresAt: expiresAt?.toISOString() ?? null,
    legacyActive,
    remainingMinutes: legacyActive ? null : Math.max(0, Math.floor(((expiresAt?.getTime() ?? 0) - now.getTime()) / 60_000)),
    expiredDays: !legacyActive && expiresAt && expiresAt.getTime() <= now.getTime()
      ? Math.max(0, Math.floor((now.getTime() - expiresAt.getTime()) / VIP_DAY_MS))
      : 0
  };
}

function mapVipOrder(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    userId: row.user_id ? String(row.user_id) : null,
    nickname: String(row.user_nickname),
    username: String(row.user_username),
    orderType: String(row.order_type) as VipOrderType,
    dayChange: Number(row.day_change),
    balanceAfterDays: Number(row.balance_after_days),
    createdAt: new Date(row.created_at).toISOString()
  };
}

export function registerVipRoutes(app: Express, dependencies: VipRouteDependencies) {
  const { pool, requireAuth, requireAdmin, sendError, onEntitlementChanged } = dependencies;
  const syncEntitlement = async (userId: string) => {
    try {
      await onEntitlementChanged?.(userId);
    } catch (error) {
      console.error("VIP entitlement top-up failed; the daily grant scheduler will retry:", { userId, error });
    }
  };

  // 购买接口仅保留协议占位。支付业务接入前，任何用户调用都不会创建订单或变更 VIP。
  app.post("/api/vip/purchase", async (req, res) => {
    if (!(await requireAuth(req, res))) return;
    const parsed = z.object({ plan: z.enum(["month", "year"]) }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "VIP购买套餐无效");
    return sendError(res, 501, "VIP购买功能暂未开放");
  });

  app.get("/api/vip/overview", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, role, vip_expires_at, vip_legacy_active, vip_growth_value
       FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    );
    if (!row) return sendError(res, 404, "用户不存在");
    const growth = vipGrowthSnapshot(row);
    const previousThreshold = [0, 5, 300, 800, 1500, 2800, 4500, 7000, 10000, 15000][growth.level] ?? 0;
    const nextThreshold = growth.level >= 9 ? null : [0, 5, 300, 800, 1500, 2800, 4500, 7000, 10000, 15000][growth.level + 1];
    const progressPercent = nextThreshold == null
      ? 100
      : Math.max(0, Math.min(100, Math.round(((growth.growthValue - previousThreshold) / Math.max(1, nextThreshold - previousThreshold)) * 100)));
    const currentPlans = await effectiveEntitlementPlans();
    const basePlan = growth.active ? currentPlans.plans.vip : currentPlans.plans.user;
    const vipPreviewPlan = currentPlans.plans.vip;
    const adjustedVipPlan = {
      ...vipPreviewPlan,
      dailyAutoShellGrant: vipBenefitValue(vipPreviewPlan.dailyAutoShellGrant, growth.level) ?? 0,
      dailyAutoExperienceGrant: vipBenefitValue(vipPreviewPlan.dailyAutoExperienceGrant, growth.level) ?? 0,
      dailyExtraFreeDraws: vipBenefitValue(vipPreviewPlan.dailyExtraFreeDraws, growth.level)
    };
    const [events] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, event_type, amount, event_date, remark, created_at
       FROM vip_growth_events WHERE user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [user.id]
    );
    res.json({
      growthValue: growth.growthValue,
      level: growth.level,
      active: growth.active,
      vipExpiresAt: row.vip_expires_at ? new Date(row.vip_expires_at).toISOString() : null,
      vipExpired: !growth.active && !row.vip_legacy_active && Boolean(row.vip_expires_at && new Date(row.vip_expires_at).getTime() <= Date.now()),
      multiplier: growth.multiplier,
      previousThreshold,
      nextThreshold,
      progressPercent,
      benefits: adjustedVipPlan,
      activePlan: basePlan,
      events: events.map((event) => ({
        id: String(event.id),
        type: String(event.event_type),
        amount: Number(event.amount ?? 0),
        date: event.event_date ? String(event.event_date).slice(0, 10) : null,
        remark: String(event.remark),
        createdAt: new Date(event.created_at).toISOString()
      }))
    });
  });

  app.get("/api/vip/growth-events", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit ?? 50) || 50)));
    const [events] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, event_type, amount, event_date, remark, created_at
       FROM vip_growth_events WHERE user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [user.id, limit]
    );
    res.json({ events: events.map((event) => ({
      id: String(event.id), type: String(event.event_type), amount: Number(event.amount ?? 0),
      date: event.event_date ? String(event.event_date).slice(0, 10) : null,
      remark: String(event.remark), createdAt: new Date(event.created_at).toISOString()
    })) });
  });

  app.get("/api/admin/vip/users/search", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const query = String(req.query.query ?? "").trim();
    const mode = req.query.mode === "nickname" ? "nickname" : "username";
    if (!query) return res.json({ users: [] });
    const column = mode === "nickname" ? "nickname" : "username";
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, nickname, username, role, vip_expires_at, vip_legacy_active, vip_growth_value
       FROM users WHERE ${column} LIKE ?
       ORDER BY CASE WHEN ${column} = ? THEN 0 ELSE 1 END, created_at ASC, id ASC
       LIMIT 20`,
      [`%${query}%`, query]
    );
    res.json({ users: rows.map(mapVipUser) });
  });

  app.get("/api/admin/vip/users", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    await syncExpiredVipRoles(pool);
    const keyword = String(req.query.keyword ?? "").trim();
    const requestedLimit = Number(req.query.limit ?? 10);
    const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : 10;
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0) || 0));
    const params: unknown[] = [];
    const conditions = [
      "(u.vip_expires_at IS NOT NULL OR u.vip_legacy_active = 1 OR EXISTS (SELECT 1 FROM vip_orders history WHERE history.user_id = u.id))"
    ];
    if (keyword) {
      conditions.push("(u.nickname LIKE ? OR u.username LIKE ?)");
      const like = `%${keyword.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      params.push(like, like);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.nickname, u.username, u.role, u.vip_expires_at, u.vip_legacy_active, u.vip_growth_value
       FROM users u ${where}
       ORDER BY
         CASE
           WHEN u.role = 'super_admin' THEN 0
           WHEN u.role = 'backoffice_admin' THEN 1
           WHEN u.vip_legacy_active = 1 OR u.vip_expires_at > UTC_TIMESTAMP() THEN 2
           ELSE 3
         END,
         COALESCE(u.vip_expires_at, '9999-12-31 23:59:59') DESC,
         u.id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM users u ${where}`,
      params
    );
    res.json({ users: rows.map(mapVipUser), total: Number(totalRow.total ?? 0) });
  });

  app.get("/api/admin/vip/orders", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const keyword = String(req.query.keyword ?? "").trim();
    const userId = String(req.query.userId ?? "").trim();
    const requestedType = String(req.query.orderType ?? "");
    const orderTypes: VipOrderType[] = ["purchase_month", "purchase_year", "gift", "reduce", "cancel"];
    const requestedLimit = Number(req.query.limit ?? 10);
    const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : 10;
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0) || 0));
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (userId) { conditions.push("orders.user_id = ?"); params.push(userId); }
    if (orderTypes.includes(requestedType as VipOrderType)) {
      conditions.push("orders.order_type = ?");
      params.push(requestedType);
    }
    if (keyword) {
      conditions.push(`(orders.order_number LIKE ? OR orders.user_nickname LIKE ? OR orders.user_username LIKE ? OR
        CASE orders.order_type
          WHEN 'purchase_month' THEN '购买月VIP'
          WHEN 'purchase_year' THEN '购买年VIP'
          WHEN 'gift' THEN '赠送VIP'
          WHEN 'reduce' THEN '减少时间'
          ELSE '取消身份'
        END LIKE ?)`);
      const like = `%${keyword.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT orders.* FROM vip_orders orders ${where}
       ORDER BY orders.order_number DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM vip_orders orders ${where}`,
      params
    );
    res.json({ orders: rows.map(mapVipOrder), total: Number(totalRow.total ?? 0) });
  });

  app.post("/api/admin/vip/grants", async (req, res) => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const parsed = z.object({
      userId: z.string().trim().min(1).optional(),
      username: z.string().trim().min(1).optional(),
      duration: grantDurationSchema
    }).refine((value) => Boolean(value.userId || value.username), "请选择用户").safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "VIP赠送信息无效");
    const days = vipGrantDays(parsed.data.duration);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const lookup = parsed.data.userId ? "id = ?" : "username = ?";
      const lookupValue = parsed.data.userId ?? parsed.data.username;
      const [[target]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, nickname, username, role, vip_expires_at, vip_legacy_active, vip_growth_value
         FROM users WHERE ${lookup} LIMIT 1 FOR UPDATE`,
        [lookupValue]
      );
      if (!target) throw new Error("VIP_USER_NOT_FOUND");
      const now = new Date();
      const currentExpiry = target.vip_legacy_active ? null : target.vip_expires_at ? new Date(target.vip_expires_at) : null;
      const expiresAt = vipExpiryAfterGrant(currentExpiry, days, now);
      const nextRole = roleAfterVipGrant(target.role);
      await connection.query(
        "UPDATE users SET role = ?, vip_expires_at = ?, vip_legacy_active = 0 WHERE id = ?",
        [nextRole, expiresAt, target.id]
      );
      const orderNumber = await insertVipOrder(connection, {
        userId: String(target.id), nickname: String(target.nickname), username: String(target.username),
        type: "gift", dayChange: days, balanceAfterDays: vipBalanceDays(expiresAt, now), operatorUserId: actor.id
      });
      await recordVipGrowthEvent(connection, {
        userId: String(target.id), amount: days * VIP_GRANT_GROWTH_PER_DAY, eventType: "grant",
        eventKey: `vip-growth:order:${orderNumber}`, remark: `VIP赠送/开通 ${days} 天`
      });
      await connection.commit();
      await syncEntitlement(String(target.id));
      res.json({ ok: true, orderNumber, expiresAt: expiresAt.toISOString(), balanceAfterDays: vipBalanceDays(expiresAt, now) });
    } catch (error) {
      await connection.rollback();
      if (error instanceof Error && error.message === "VIP_USER_NOT_FOUND") return sendError(res, 404, "用户不存在");
      if (error instanceof Error && error.message === "VIP_DAILY_SEQUENCE_EXHAUSTED") return sendError(res, 409, "今日VIP订单数量已达上限");
      throw error;
    } finally {
      connection.release();
    }
  });

  app.post("/api/admin/vip/users/:id/reduce", async (req, res) => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const parsed = z.object({ days: z.number().int().positive().max(1_000_000) }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "减少天数必须为正整数");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[target]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, nickname, username, role, vip_expires_at, vip_legacy_active, vip_growth_value
         FROM users WHERE id = ? LIMIT 1 FOR UPDATE`,
        [req.params.id]
      );
      if (!target) throw new Error("VIP_USER_NOT_FOUND");
      if (target.vip_legacy_active) throw new Error("VIP_LEGACY_DURATION");
      const now = new Date();
      const currentExpiry = target.vip_expires_at ? new Date(target.vip_expires_at) : now;
      const expiresAt = vipExpiryAfterReduction(currentExpiry, parsed.data.days, now);
      const balanceAfterDays = vipBalanceDays(expiresAt, now);
      await connection.query(
        "UPDATE users SET role = ?, vip_expires_at = ?, vip_legacy_active = 0 WHERE id = ?",
        [balanceAfterDays > 0 ? roleAfterVipGrant(target.role) : roleAfterVipRemoval(target.role), expiresAt, target.id]
      );
      const orderNumber = await insertVipOrder(connection, {
        userId: String(target.id), nickname: String(target.nickname), username: String(target.username),
        type: "reduce", dayChange: -parsed.data.days, balanceAfterDays, operatorUserId: actor.id
      });
      await connection.commit();
      res.json({ ok: true, orderNumber, expiresAt: expiresAt.toISOString(), balanceAfterDays });
    } catch (error) {
      await connection.rollback();
      if (error instanceof Error && error.message === "VIP_USER_NOT_FOUND") return sendError(res, 404, "用户不存在");
      if (error instanceof Error && error.message === "VIP_LEGACY_DURATION") return sendError(res, 409, "该历史VIP暂无到期时间，请先赠送新的VIP时长后再减少");
      throw error;
    } finally { connection.release(); }
  });

  app.post("/api/admin/vip/users/:id/cancel", async (req, res) => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[target]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id, nickname, username, role, vip_growth_value FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
        [req.params.id]
      );
      if (!target) throw new Error("VIP_USER_NOT_FOUND");
      await connection.query(
        "UPDATE users SET role = ?, vip_expires_at = UTC_TIMESTAMP(), vip_legacy_active = 0 WHERE id = ?",
        [roleAfterVipRemoval(target.role), target.id]
      );
      const orderNumber = await insertVipOrder(connection, {
        userId: String(target.id), nickname: String(target.nickname), username: String(target.username),
        type: "cancel", dayChange: 0, balanceAfterDays: 0, operatorUserId: actor.id
      });
      await connection.commit();
      res.json({ ok: true, orderNumber, balanceAfterDays: 0 });
    } catch (error) {
      await connection.rollback();
      if (error instanceof Error && error.message === "VIP_USER_NOT_FOUND") return sendError(res, 404, "用户不存在");
      throw error;
    } finally { connection.release(); }
  });

  app.post("/api/admin/users/:id/admin-role", async (req, res) => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE users
       SET role = 'backoffice_admin'
       WHERE id = ? AND role IN ('user', 'vip')`,
      [req.params.id]
    );
    if (!result.affectedRows) {
      const [[target]] = await pool.query<mysql.RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [req.params.id]);
      if (!target) return sendError(res, 404, "用户不存在");
      if (isSuperAdminRole(target.role)) return sendError(res, 400, "不能修改超级管理员身份");
      return sendError(res, 409, "该用户已经是后台管理员");
    }
    await syncEntitlement(req.params.id);
    res.json({ ok: true });
  });

  app.delete("/api/admin/users/:id/admin-role", async (req, res) => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    if (actor.id === req.params.id) return sendError(res, 400, "不能取消自己的超级管理员身份");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[target]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT role, vip_expires_at, vip_legacy_active FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
        [req.params.id]
      );
      if (!target) throw new Error("ADMIN_USER_NOT_FOUND");
      if (isSuperAdminRole(target.role)) throw new Error("ADMIN_SUPER_PROTECTED");
      if (normalizeUserRole(target.role) !== "backoffice_admin") throw new Error("ADMIN_ROLE_NOT_SET");
      const vipActive = Boolean(target.vip_legacy_active) || Boolean(target.vip_expires_at && new Date(target.vip_expires_at).getTime() > Date.now());
      await connection.query(
        "UPDATE users SET role = ? WHERE id = ?",
        [roleAfterAdminRemoval(target.role, vipActive), req.params.id]
      );
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      if (error instanceof Error && error.message === "ADMIN_USER_NOT_FOUND") return sendError(res, 404, "用户不存在");
      if (error instanceof Error && error.message === "ADMIN_SUPER_PROTECTED") return sendError(res, 400, "不能取消超级管理员身份");
      if (error instanceof Error && error.message === "ADMIN_ROLE_NOT_SET") return sendError(res, 409, "该用户不是后台管理员");
      throw error;
    } finally { connection.release(); }
  });
}
