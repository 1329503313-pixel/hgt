import type express from "express";
import type mysql from "mysql2/promise";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import { pool } from "./db.js";
import { MAX_EXPERIENCE } from "./levelSystem.js";
import { isSuperAdminRole, normalizeUserRole, type UserRole } from "./roles.js";
import { settleVipGrowthThroughDate, vipBenefitValue, vipGrowthSnapshot } from "./vipGrowth.js";

export type EntitlementTier = "user" | "vip";

export type EntitlementPlan = {
  dailySoupPublishLimit: number | null;
  dailyEvaluationLimit: number | null;
  dailyAutoShellGrant: number;
  dailyAutoExperienceGrant: number;
  dailyLikeLimit: number | null;
  dailyFavoriteLimit: number | null;
  dailyDrawLimit: number | null;
  dailyAiQuestionLimit: number | null;
  dailyMysteryQuestionLimit: number | null;
  dailyGiftSendShellValueLimit: number | null;
  dailyCharmReceiveLimit: number | null;
  dailyAiHintLimit: number | null;
  dailyGiftReceiveShellLimit: number | null;
  dailyExtraFreeDraws: number | null;
};

export type EntitlementMetric =
  | "soup_publish"
  | "evaluation"
  | "like"
  | "favorite"
  | "draw"
  | "ai_question"
  | "mystery_question"
  | "gift_send_shell_value"
  | "charm_receive"
  | "ai_hint"
  | "gift_receive_shell"
  | "extra_free_draw";

const MAX_CONFIG_VALUE = 2_000_000_000;
const finiteGrantSchema = z.number().int().min(0).max(MAX_CONFIG_VALUE);
const limitSchema = finiteGrantSchema.nullable();

export const entitlementPlanSchema = z.object({
  dailySoupPublishLimit: limitSchema,
  dailyEvaluationLimit: limitSchema,
  dailyAutoShellGrant: finiteGrantSchema,
  dailyAutoExperienceGrant: finiteGrantSchema,
  dailyLikeLimit: limitSchema,
  dailyFavoriteLimit: limitSchema,
  dailyDrawLimit: limitSchema,
  dailyAiQuestionLimit: limitSchema,
  dailyMysteryQuestionLimit: limitSchema,
  dailyGiftSendShellValueLimit: limitSchema,
  dailyCharmReceiveLimit: limitSchema,
  dailyAiHintLimit: limitSchema,
  dailyGiftReceiveShellLimit: limitSchema,
  dailyExtraFreeDraws: limitSchema
}).strict();

export const DEFAULT_ENTITLEMENT_PLANS: Record<EntitlementTier, EntitlementPlan> = {
  user: {
    dailySoupPublishLimit: 10,
    dailyEvaluationLimit: null,
    dailyAutoShellGrant: 0,
    dailyAutoExperienceGrant: 0,
    dailyLikeLimit: null,
    dailyFavoriteLimit: null,
    dailyDrawLimit: null,
    dailyAiQuestionLimit: null,
    dailyMysteryQuestionLimit: null,
    dailyGiftSendShellValueLimit: null,
    dailyCharmReceiveLimit: null,
    dailyAiHintLimit: null,
    dailyGiftReceiveShellLimit: null,
    dailyExtraFreeDraws: 0
  },
  vip: {
    dailySoupPublishLimit: null,
    dailyEvaluationLimit: null,
    dailyAutoShellGrant: 0,
    dailyAutoExperienceGrant: 0,
    dailyLikeLimit: null,
    dailyFavoriteLimit: null,
    dailyDrawLimit: null,
    dailyAiQuestionLimit: null,
    dailyMysteryQuestionLimit: null,
    dailyGiftSendShellValueLimit: null,
    dailyCharmReceiveLimit: null,
    dailyAiHintLimit: null,
    dailyGiftReceiveShellLimit: null,
    dailyExtraFreeDraws: 0
  }
};

const metricPlanKey: Record<EntitlementMetric, keyof EntitlementPlan> = {
  soup_publish: "dailySoupPublishLimit",
  evaluation: "dailyEvaluationLimit",
  like: "dailyLikeLimit",
  favorite: "dailyFavoriteLimit",
  draw: "dailyDrawLimit",
  ai_question: "dailyAiQuestionLimit",
  mystery_question: "dailyMysteryQuestionLimit",
  gift_send_shell_value: "dailyGiftSendShellValueLimit",
  charm_receive: "dailyCharmReceiveLimit",
  ai_hint: "dailyAiHintLimit",
  gift_receive_shell: "dailyGiftReceiveShellLimit",
  extra_free_draw: "dailyExtraFreeDraws"
};

const metricLabels: Record<EntitlementMetric, string> = {
  soup_publish: "发布海龟汤",
  evaluation: "发表评论",
  like: "点赞",
  favorite: "收藏",
  draw: "抽卡",
  ai_question: "AI 主持提问",
  mystery_question: "谜局提问",
  gift_send_shell_value: "送出礼物价值",
  charm_receive: "获取魅力",
  ai_hint: "AI 提示",
  gift_receive_shell: "通过礼物获取贝壳",
  extra_free_draw: "VIP 额外免费抽卡"
};

type EntitlementRoleInput = UserRole | "admin" | null | undefined;
type QueryConnection = mysql.Pool | mysql.PoolConnection;

export class EntitlementLimitError extends Error {
  readonly status = 429;
  readonly code = "DAILY_ENTITLEMENT_LIMIT";
  constructor(readonly metric: EntitlementMetric) {
    super(`今日${metricLabels[metric]}操作已达上限`);
    this.name = "EntitlementLimitError";
  }
}

export function isEntitlementLimitError(error: unknown): error is EntitlementLimitError {
  return error instanceof EntitlementLimitError
    || (error instanceof Error && (error as { code?: string }).code === "DAILY_ENTITLEMENT_LIMIT");
}

export function entitlementTierForRole(role: EntitlementRoleInput): EntitlementTier | null {
  if (isSuperAdminRole(role)) return null;
  const normalized = normalizeUserRole(role);
  return normalized === "vip" || normalized === "backoffice_admin" ? "vip" : "user";
}

export function entitlementTierForUserState(
  role: EntitlementRoleInput,
  vipActive: boolean,
  subscriptionOnly = false
): EntitlementTier | null {
  if (subscriptionOnly) return vipActive ? "vip" : "user";
  const tier = entitlementTierForRole(role);
  return tier === "vip" && !vipActive ? "user" : tier;
}

export function beijingEntitlementDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function entitlementConfigurationEffectiveDate(now = new Date()) {
  return beijingEntitlementDate(now);
}

function parsePlan(value: unknown, fallback: EntitlementPlan) {
  let candidate = value;
  if (Buffer.isBuffer(candidate)) candidate = candidate.toString("utf8");
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); } catch { candidate = null; }
  }
  const parsed = entitlementPlanSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { ...fallback };
}

function mysqlDateKey(value: unknown) {
  if (typeof value === "string") {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  return beijingEntitlementDate(new Date(value as string | number | Date));
}

let planCache: { date: string; plans: Record<EntitlementTier, EntitlementPlan>; effectiveDate: string | null } | null = null;

async function planVersionForDate(date: string, exact = false) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT effective_date, user_config, vip_config
     FROM entitlement_plan_versions
     WHERE effective_date ${exact ? "=" : "<="} ?
     ORDER BY effective_date DESC, id DESC
     LIMIT 1`,
    [date]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    effectiveDate: mysqlDateKey(row.effective_date),
    plans: {
      user: parsePlan(row.user_config, DEFAULT_ENTITLEMENT_PLANS.user),
      vip: parsePlan(row.vip_config, DEFAULT_ENTITLEMENT_PLANS.vip)
    } satisfies Record<EntitlementTier, EntitlementPlan>
  };
}

export async function effectiveEntitlementPlans(now = new Date()) {
  const date = beijingEntitlementDate(now);
  if (planCache?.date === date) return planCache;
  const stored = await planVersionForDate(date);
  planCache = {
    date,
    effectiveDate: stored?.effectiveDate ?? null,
    plans: stored?.plans ?? {
      user: { ...DEFAULT_ENTITLEMENT_PLANS.user },
      vip: { ...DEFAULT_ENTITLEMENT_PLANS.vip }
    }
  };
  return planCache;
}

export async function effectiveEntitlementPlanForRole(role: EntitlementRoleInput, now = new Date()) {
  const tier = entitlementTierForRole(role);
  if (!tier) return { tier: null, plan: null };
  const current = await effectiveEntitlementPlans(now);
  return { tier, plan: current.plans[tier] };
}

export async function entitlementLimitForRole(role: EntitlementRoleInput, metric: EntitlementMetric, now = new Date()) {
  const { plan } = await effectiveEntitlementPlanForRole(role, now);
  if (!plan) return null;
  return plan[metricPlanKey[metric]] as number | null;
}

export function entitlementPlanForUserState(
  plans: Record<EntitlementTier, EntitlementPlan>,
  currentUser: { role?: unknown; vip_expires_at?: unknown; vip_legacy_active?: unknown; vip_growth_value?: unknown },
  fallbackRole: EntitlementRoleInput,
  now = new Date(),
  subscriptionOnly = false
) {
  const actualRole = currentUser.role == null ? fallbackRole : normalizeUserRole(currentUser.role);
  const snapshot = vipGrowthSnapshot({ ...currentUser, role: actualRole }, now);
  const tier = entitlementTierForUserState(actualRole, snapshot.active, subscriptionOnly);
  if (!tier) return { tier: null, plan: null } as const;
  const base = plans[tier];
  if (tier !== "vip") return { tier, plan: base } as const;
  return {
    tier,
    plan: {
      ...base,
      dailyAutoShellGrant: vipBenefitValue(base.dailyAutoShellGrant, snapshot.level) ?? 0,
      dailyAutoExperienceGrant: vipBenefitValue(base.dailyAutoExperienceGrant, snapshot.level) ?? 0,
      dailyExtraFreeDraws: vipBenefitValue(base.dailyExtraFreeDraws, snapshot.level)
    }
  } as const;
}

async function effectiveEntitlementPlanForUser(
  userId: string,
  role: EntitlementRoleInput,
  connection: QueryConnection,
  now = new Date(),
  subscriptionOnly = false
) {
  const current = await effectiveEntitlementPlans(now);
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT role, vip_expires_at, vip_legacy_active, vip_growth_value
     FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  const currentUser = row ? {
    role: row.role,
    vip_expires_at: row.vip_expires_at,
    vip_legacy_active: row.vip_legacy_active,
    vip_growth_value: row.vip_growth_value
  } : { role, vip_growth_value: 0 };
  return entitlementPlanForUserState(current.plans, currentUser, role, now, subscriptionOnly);
}

async function existingEventAmount(connection: QueryConnection, userId: string, date: string, metric: EntitlementMetric, eventKey: string) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT granted_amount FROM entitlement_daily_events
     WHERE user_id = ? AND usage_date = ? AND metric = ? AND event_key = ? LIMIT 1`,
    [userId, date, metric, eventKey]
  );
  return rows[0] ? Number(rows[0].granted_amount ?? 0) : null;
}

export function scopedEntitlementUsageMetric(metric: EntitlementMetric, usageScope?: string) {
  if (!usageScope) return metric;
  const scopeHash = createHash("sha256").update(usageScope).digest("hex").slice(0, 24);
  return `${metric}:${scopeHash}`;
}

async function reserveDailyAmount(options: {
  connection: QueryConnection;
  userId: string;
  role: EntitlementRoleInput;
  metric: EntitlementMetric;
  requestedAmount: number;
  eventKey: string;
  usageScope?: string;
  capInsteadOfReject?: boolean;
  now?: Date;
}) {
  const { connection, userId, role, metric, eventKey } = options;
  const usageMetric = scopedEntitlementUsageMetric(metric, options.usageScope);
  const requestedAmount = Math.max(0, Math.floor(options.requestedAmount));
  if (!Number.isSafeInteger(requestedAmount)) throw new Error("ENTITLEMENT_AMOUNT_INVALID");
  const date = beijingEntitlementDate(options.now);
  const duplicateAmount = await existingEventAmount(connection, userId, date, metric, eventKey);
  if (duplicateAmount != null) return { grantedAmount: duplicateAmount, duplicate: true };

  const { plan } = await effectiveEntitlementPlanForUser(
    userId,
    role,
    connection,
    options.now,
    metric === "extra_free_draw"
  );
  const limit = plan ? plan[metricPlanKey[metric]] as number | null : null;
  let grantedAmount = requestedAmount;
  if (limit != null) {
    await connection.query(
      `INSERT IGNORE INTO entitlement_daily_usage (user_id, usage_date, metric, used_amount)
       VALUES (?, ?, ?, 0)`,
      [userId, date, usageMetric]
    );
    const [usageRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT used_amount FROM entitlement_daily_usage
       WHERE user_id = ? AND usage_date = ? AND metric = ? FOR UPDATE`,
      [userId, date, usageMetric]
    );
    const used = Number(usageRows[0]?.used_amount ?? 0);
    const remaining = Math.max(0, limit - used);
    if (requestedAmount > remaining) {
      if (!options.capInsteadOfReject) throw new EntitlementLimitError(metric);
      grantedAmount = remaining;
    }
    if (grantedAmount > 0) {
      await connection.query(
        `UPDATE entitlement_daily_usage SET used_amount = used_amount + ?
         WHERE user_id = ? AND usage_date = ? AND metric = ?`,
        [grantedAmount, userId, date, usageMetric]
      );
    }
  }
  await connection.query(
    `INSERT INTO entitlement_daily_events
       (user_id, usage_date, metric, event_key, requested_amount, granted_amount)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, date, metric, eventKey, requestedAmount, grantedAmount]
  );
  return { grantedAmount, duplicate: false };
}

export async function consumeDailyEntitlement(
  connection: QueryConnection,
  options: { userId: string; role: EntitlementRoleInput; metric: EntitlementMetric; amount?: number; eventKey: string; usageScope?: string; now?: Date }
) {
  return reserveDailyAmount({
    connection,
    userId: options.userId,
    role: options.role,
    metric: options.metric,
    requestedAmount: options.amount ?? 1,
    eventKey: options.eventKey,
    usageScope: options.usageScope,
    now: options.now
  });
}

export async function tryConsumeDailyEntitlement(
  connection: QueryConnection,
  options: { userId: string; role: EntitlementRoleInput; metric: EntitlementMetric; amount?: number; eventKey: string; usageScope?: string; now?: Date }
) {
  try {
    const result = await consumeDailyEntitlement(connection, options);
    return result.grantedAmount === (options.amount ?? 1);
  } catch (error) {
    if (isEntitlementLimitError(error)) return false;
    throw error;
  }
}

export async function capDailyEntitlement(
  connection: QueryConnection,
  options: { userId: string; role: EntitlementRoleInput; metric: "charm_receive" | "gift_receive_shell"; amount: number; eventKey: string; now?: Date }
) {
  return reserveDailyAmount({
    connection,
    userId: options.userId,
    role: options.role,
    metric: options.metric,
    requestedAmount: options.amount,
    eventKey: options.eventKey,
    now: options.now,
    capInsteadOfReject: true
  });
}

export async function dailyEntitlementStatus(userId: string, role: EntitlementRoleInput, metric: EntitlementMetric, now = new Date(), usageScope?: string) {
  const date = beijingEntitlementDate(now);
  const { plan } = await effectiveEntitlementPlanForUser(userId, role, pool, now, metric === "extra_free_draw");
  const limit = plan ? plan[metricPlanKey[metric]] as number | null : null;
  if (limit == null) return { allowed: true, used: 0, remaining: null, limit: null };
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT used_amount FROM entitlement_daily_usage
     WHERE user_id = ? AND usage_date = ? AND metric = ? LIMIT 1`,
    [userId, date, scopedEntitlementUsageMetric(metric, usageScope)]
  );
  const used = Number(rows[0]?.used_amount ?? 0);
  return { allowed: used < limit, used, remaining: Math.max(0, limit - used), limit };
}

function effectiveRoleFromUserRow(row: mysql.RowDataPacket): UserRole {
  const role = normalizeUserRole(row.role);
  if (role !== "vip") return role;
  if (Boolean(row.vip_legacy_active)) return "vip";
  if (!row.vip_expires_at || new Date(row.vip_expires_at).getTime() <= Date.now()) return "user";
  return "vip";
}

export function dailyEntitlementGrantAmounts(input: {
  plan: Pick<EntitlementPlan, "dailyAutoShellGrant" | "dailyAutoExperienceGrant">;
  shellTargetProcessed: number;
  experienceTargetProcessed: number;
  shellBalance: number;
  experience: number;
}) {
  const requestedShell = Math.max(0, input.plan.dailyAutoShellGrant - Math.max(0, input.shellTargetProcessed));
  const requestedExperience = Math.max(0, input.plan.dailyAutoExperienceGrant - Math.max(0, input.experienceTargetProcessed));
  const shellGranted = Math.min(requestedShell, Math.max(0, 4_294_967_295 - Math.max(0, input.shellBalance)));
  const experienceGranted = Math.min(requestedExperience, Math.max(0, MAX_EXPERIENCE - Math.max(0, input.experience)));
  return {
    requestedShell,
    requestedExperience,
    shellGranted,
    experienceGranted,
    shellBalance: input.shellBalance + shellGranted,
    experience: input.experience + experienceGranted
  };
}

export async function ensureDailyEntitlementGrantForUser(userId: string, now = new Date()) {
  const date = beijingEntitlementDate(now);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, role, vip_expires_at, vip_legacy_active, vip_growth_value, shell_balance, experience
       FROM users WHERE id = ? LIMIT 1 FOR UPDATE`,
      [userId]
    );
    const user = rows[0];
    if (!user) {
      await connection.rollback();
      return;
    }
    await settleVipGrowthThroughDate(connection, user, date);
    const role = effectiveRoleFromUserRow(user);
    const { tier, plan } = await effectiveEntitlementPlanForUser(userId, role, connection, now, true);
    if (!tier || !plan) {
      await connection.commit();
      return;
    }
    await connection.query(
      `INSERT IGNORE INTO entitlement_daily_grants
       (user_id, grant_date, shell_target_processed, experience_target_processed, shell_actual_granted, experience_actual_granted, tier)
       VALUES (?, ?, 0, 0, 0, 0, ?)`,
      [userId, date, tier]
    );
    const [grantRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT shell_target_processed, experience_target_processed, shell_actual_granted, experience_actual_granted
       FROM entitlement_daily_grants WHERE user_id = ? AND grant_date = ? FOR UPDATE`,
      [userId, date]
    );
    const grant = grantRows[0];
    const shellTargetProcessed = Number(grant?.shell_target_processed ?? 0);
    const experienceTargetProcessed = Number(grant?.experience_target_processed ?? 0);
    const { shellGranted, experienceGranted, shellBalance, experience } = dailyEntitlementGrantAmounts({
      plan,
      shellTargetProcessed,
      experienceTargetProcessed,
      shellBalance: Number(user.shell_balance ?? 0),
      experience: Number(user.experience ?? 0)
    });
    if (shellGranted > 0 || experienceGranted > 0) {
      await connection.query(
        "UPDATE users SET shell_balance = ?, experience = ? WHERE id = ?",
        [shellBalance, experience, userId]
      );
      await connection.query(
        `INSERT INTO shell_transactions
           (id, user_id, transaction_type, amount, experience_amount, balance_after, related_type, related_id, remark, idempotency_key)
         VALUES (?, ?, 'daily_entitlement_grant', ?, ?, ?, 'entitlement_daily_grant', ?, ?, ?)`,
        [nanoid(), userId, shellGranted, experienceGranted, shellBalance, date, "每日权益自动赠送", `entitlement-grant:${userId}:${date}:${plan.dailyAutoShellGrant}:${plan.dailyAutoExperienceGrant}`]
      );
    }
    await connection.query(
      `UPDATE entitlement_daily_grants
       SET shell_target_processed = GREATEST(shell_target_processed, ?),
           experience_target_processed = GREATEST(experience_target_processed, ?),
           shell_actual_granted = shell_actual_granted + ?,
           experience_actual_granted = experience_actual_granted + ?, tier = ?
       WHERE user_id = ? AND grant_date = ?`,
      [plan.dailyAutoShellGrant, plan.dailyAutoExperienceGrant, shellGranted, experienceGranted, tier, userId, date]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

let lastGrantSweepDate = "";
export async function runDailyEntitlementGrantSweep(now = new Date()) {
  const date = beijingEntitlementDate(now);
  const lockConnection = await pool.getConnection();
  const lockName = `hgt-entitlement-grants-${date}`;
  try {
    const [[lock]] = await lockConnection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    if (Number(lock?.acquired ?? 0) !== 1) return;
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users ORDER BY id");
    for (const user of users) await ensureDailyEntitlementGrantForUser(String(user.id), now);
    lastGrantSweepDate = date;
  } finally {
    await lockConnection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    lockConnection.release();
  }
}

export function refreshDailyEntitlementGrants(now = new Date()) {
  lastGrantSweepDate = "";
  return runDailyEntitlementGrantSweep(now);
}

export function startDailyEntitlementGrantScheduler() {
  const run = () => {
    const date = beijingEntitlementDate();
    if (date === lastGrantSweepDate) return;
    void runDailyEntitlementGrantSweep().catch((error) => console.error("Daily entitlement grants failed:", error));
  };
  run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return timer;
}

type RouteUser = { id: string; role: UserRole };
type EntitlementRouteDependencies = {
  requireAuth: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  requireAdmin: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
};

export function registerEntitlementRoutes(app: express.Express, dependencies: EntitlementRouteDependencies) {
  const { requireAuth, requireAdmin, sendError } = dependencies;
  app.get("/api/admin/entitlements", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const current = await effectiveEntitlementPlans();
    res.json({
      current: current.plans,
      currentEffectiveDate: current.effectiveDate,
      effectiveImmediately: true,
      rules: { mysteryQuestionEnforced: true, autoGrantsSupportUnlimited: false }
    });
  });

  app.put("/api/admin/entitlements", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = z.object({ user: entitlementPlanSchema, vip: entitlementPlanSchema }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "权益配置不正确");
    if (parsed.data.user.dailyExtraFreeDraws !== 0) return sendError(res, 400, "VIP 每日额外免费抽卡次数不适用于普通用户");
    const effectiveDate = entitlementConfigurationEffectiveDate();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("DELETE FROM entitlement_plan_versions WHERE effective_date >= ?", [effectiveDate]);
      await connection.query(
        `INSERT INTO entitlement_plan_versions (effective_date, user_config, vip_config, created_by)
         VALUES (?, ?, ?, ?)`,
        [effectiveDate, JSON.stringify(parsed.data.user), JSON.stringify(parsed.data.vip), admin.id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    planCache = null;
    res.json({ current: parsed.data, currentEffectiveDate: effectiveDate, effectiveImmediately: true });
    void refreshDailyEntitlementGrants().catch((error) => console.error("Immediate entitlement grant refresh failed:", error));
  });

  app.get("/api/me/entitlements", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const current = await effectiveEntitlementPlans();
    const tier = entitlementTierForRole(user.role);
    res.json({
      tier: tier ?? "super_admin",
      plan: tier ? current.plans[tier] : null,
      effectiveDate: current.effectiveDate,
      mysteryQuestionEnforced: true
    });
  });
}

export async function initializeEntitlementsDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entitlement_plan_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      effective_date DATE NOT NULL,
      user_config JSON NOT NULL,
      vip_config JSON NOT NULL,
      created_by VARCHAR(64) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      INDEX idx_entitlement_plan_effective (effective_date, id),
      CONSTRAINT fk_entitlement_plan_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entitlement_daily_usage (
      user_id VARCHAR(64) NOT NULL,
      usage_date DATE NOT NULL,
      metric VARCHAR(48) NOT NULL,
      used_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (user_id, usage_date, metric),
      INDEX idx_entitlement_usage_date (usage_date, metric),
      CONSTRAINT fk_entitlement_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entitlement_daily_events (
      user_id VARCHAR(64) NOT NULL,
      usage_date DATE NOT NULL,
      metric VARCHAR(48) NOT NULL,
      event_key VARCHAR(191) NOT NULL,
      requested_amount BIGINT UNSIGNED NOT NULL,
      granted_amount BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (user_id, usage_date, metric, event_key),
      INDEX idx_entitlement_events_date (usage_date, metric),
      CONSTRAINT fk_entitlement_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entitlement_daily_grants (
      user_id VARCHAR(64) NOT NULL,
      grant_date DATE NOT NULL,
      shell_target_processed BIGINT UNSIGNED NOT NULL DEFAULT 0,
      experience_target_processed BIGINT UNSIGNED NOT NULL DEFAULT 0,
      shell_actual_granted BIGINT UNSIGNED NOT NULL DEFAULT 0,
      experience_actual_granted BIGINT UNSIGNED NOT NULL DEFAULT 0,
      tier ENUM('user','vip') NOT NULL,
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (user_id, grant_date),
      INDEX idx_entitlement_grants_date (grant_date),
      CONSTRAINT fk_entitlement_grants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
