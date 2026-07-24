import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { experienceProgress, MAX_EXPERIENCE } from "./levelSystem.js";
import { inviteRewardTaskStats } from "./inviteRewards.js";

let badgeProgressListener: ((userId: string) => void) | null = null;

export function setShellBadgeProgressListener(listener: (userId: string) => void) {
  badgeProgressListener = listener;
}

function reportBadgeProgress(userIds: string | string[]) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  ids.forEach((userId) => badgeProgressListener?.(userId));
}

export const SHELL_DAILY_LIMIT = 60;

export type ShellTaskType =
  | "daily_login"
  | "publish_soup"
  | "like_soup"
  | "favorite_soup"
  | "publish_evaluation"
  | "speak_circle"
  | "join_online_soup"
  | "host_online_soup"
  | "receive_soup_like"
  | "receive_soup_favorite"
  | "receive_soup_evaluation"
  | "soup_ai_played"
  | "soup_online_completed";

export type ShellTaskDefinition = {
  type: ShellTaskType;
  name: string;
  description: string;
  reward: number;
  dailyLimit: number;
  consumeBeyondDailyLimit?: boolean;
};

export type BeginnerTaskType =
  | "upload_avatar"
  | "complete_ten_draws"
  | "equip_badge"
  | "bind_email"
  | "change_profile_background"
  | "invite_verified_email"
  | "invite_shell_milestone";

export type BeginnerTaskDefinition = {
  type: BeginnerTaskType;
  name: string;
  description: string;
  reward: number;
};

export const SHELL_TASKS: readonly ShellTaskDefinition[] = [
  { type: "daily_login", name: "每日登录", description: "当天首次进入应用", reward: 5, dailyLimit: 1 },
  { type: "publish_soup", name: "发布海龟汤", description: "审核通过并公开展示", reward: 10, dailyLimit: 3, consumeBeyondDailyLimit: true },
  { type: "like_soup", name: "点赞海龟汤", description: "点赞不同的海龟汤", reward: 2, dailyLimit: 3 },
  { type: "favorite_soup", name: "收藏海龟汤", description: "收藏不同的海龟汤", reward: 2, dailyLimit: 3 },
  { type: "publish_evaluation", name: "发表评论", description: "首次发布评分或评论", reward: 3, dailyLimit: 1, consumeBeyondDailyLimit: true },
  { type: "speak_circle", name: "圈子发言", description: "在任意圈子发送一条文字消息", reward: 2, dailyLimit: 3 },
  { type: "join_online_soup", name: "完整参与玩汤", description: "满足完整参与条件并完成一轮", reward: 5, dailyLimit: 2 },
  { type: "host_online_soup", name: "完整主持玩汤", description: "满足完整主持条件并完成一轮", reward: 10, dailyLimit: 1 },
  { type: "receive_soup_like", name: "作品获得点赞", description: "其他用户首次点赞你发布的作品", reward: 2, dailyLimit: 3, consumeBeyondDailyLimit: true },
  { type: "receive_soup_favorite", name: "作品获得收藏", description: "其他用户首次收藏你发布的作品", reward: 2, dailyLimit: 3, consumeBeyondDailyLimit: true },
  { type: "receive_soup_evaluation", name: "作品获得评论", description: "其他用户首次评论你发布的作品", reward: 5, dailyLimit: 3, consumeBeyondDailyLimit: true },
  { type: "soup_ai_played", name: "作品被 AI 玩汤", description: "其他用户使用 AI 玩汤开启你的作品", reward: 5, dailyLimit: 3, consumeBeyondDailyLimit: true },
  { type: "soup_online_completed", name: "作品被完整玩汤", description: "其他玩家完整玩完你发布的作品", reward: 10, dailyLimit: 2, consumeBeyondDailyLimit: true }
] as const;

export const BEGINNER_TASKS: readonly BeginnerTaskDefinition[] = [
  { type: "upload_avatar", name: "上传一次头像", description: "在账号设置中上传个人头像", reward: 10 },
  { type: "complete_ten_draws", name: "完成 10 次抽卡", description: "单抽与十连抽均按实际抽取次数累计", reward: 10 },
  { type: "equip_badge", name: "装配一枚徽章", description: "在个人中心装配任意已获得徽章", reward: 10 },
  { type: "bind_email", name: "绑定邮箱", description: "完成邮箱验证码验证并绑定", reward: 25 },
  { type: "change_profile_background", name: "更换一次主页背景", description: "使用已解锁的卡牌设置主页背景", reward: 10 }
] as const;

const TASK_BY_TYPE = new Map(SHELL_TASKS.map((task) => [task.type, task]));
const BEGINNER_TASK_BY_TYPE = new Map(BEGINNER_TASKS.map((task) => [task.type, task]));

export function beijingTaskDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function calculateTaskReward(earnedToday: number, nominalReward: number) {
  return Math.max(0, Math.min(nominalReward, SHELL_DAILY_LIMIT - earnedToday));
}

export function isEligibleOnlineSoupDuration(startedAt: Date, endedAt: Date) {
  return endedAt.getTime() - startedAt.getTime() > 5 * 60_000;
}

export function hasOtherEligibleOnlineSoupPlayer(creatorId: string, playerIds: string[]) {
  return playerIds.some((playerId) => playerId !== creatorId);
}

type QueryConnection = mysql.PoolConnection;

export type AwardTaskResult = {
  recorded: boolean;
  actualReward: number;
  experienceReward: number;
  balance: number;
  dailyEarned: number;
};

async function awardTaskEventWithConnection(
  connection: QueryConnection,
  userId: string,
  taskType: ShellTaskType,
  eventKey: string,
  relatedType: string | null,
  relatedId: string | null,
  now = new Date()
): Promise<AwardTaskResult> {
  const definition = TASK_BY_TYPE.get(taskType);
  if (!definition) throw new Error(`UNKNOWN_SHELL_TASK:${taskType}`);
  const taskDate = beijingTaskDate(now);
  const [[userRow]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT shell_balance, experience FROM users WHERE id = ? FOR UPDATE",
    [userId]
  );
  if (!userRow) throw new Error("SHELL_USER_NOT_FOUND");
  const balance = Number(userRow.shell_balance ?? 0);
  const experience = Number(userRow.experience ?? 0);
  const [[existing]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT actual_reward, experience_reward FROM shell_task_events WHERE event_key = ? LIMIT 1",
    [eventKey]
  );
  const [[dailyRow]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COALESCE(SUM(actual_reward), 0) AS earned FROM shell_task_events WHERE user_id = ? AND task_date = ?",
    [userId, taskDate]
  );
  const dailyEarned = Number(dailyRow?.earned ?? 0);
  if (existing) {
    return { recorded: false, actualReward: Number(existing.actual_reward ?? 0), experienceReward: Number(existing.experience_reward ?? 0), balance, dailyEarned };
  }
  const [[progressRow]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS progress FROM shell_task_events WHERE user_id = ? AND task_date = ? AND task_type = ?",
    [userId, taskDate, taskType]
  );
  if (Number(progressRow?.progress ?? 0) >= definition.dailyLimit) {
    if (definition.consumeBeyondDailyLimit) {
      await connection.query(
        `INSERT INTO shell_task_events
          (id, user_id, task_date, task_type, event_key, related_type, related_id, nominal_reward, actual_reward, experience_reward, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        [nanoid(), userId, taskDate, taskType, eventKey, relatedType, relatedId, definition.reward, now]
      );
      return { recorded: true, actualReward: 0, experienceReward: 0, balance, dailyEarned };
    }
    return { recorded: false, actualReward: 0, experienceReward: 0, balance, dailyEarned };
  }

  const actualReward = calculateTaskReward(dailyEarned, definition.reward);
  const experienceReward = Math.max(0, Math.min(definition.reward, MAX_EXPERIENCE - experience));
  const balanceAfter = balance + actualReward;
  await connection.query(
    `INSERT INTO shell_task_events
      (id, user_id, task_date, task_type, event_key, related_type, related_id, nominal_reward, actual_reward, experience_reward, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), userId, taskDate, taskType, eventKey, relatedType, relatedId, definition.reward, actualReward, experienceReward, now]
  );
  if (experienceReward > 0) {
    await connection.query("UPDATE users SET experience = experience + ? WHERE id = ?", [experienceReward, userId]);
  }
  if (actualReward > 0) {
    await connection.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balanceAfter, userId]);
    await connection.query(
      `INSERT INTO shell_transactions
        (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key, created_at)
       VALUES (?, ?, 'daily_task_reward', ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        userId,
        actualReward,
        balanceAfter,
        relatedType,
        relatedId,
        `${definition.name}奖励`,
        `task:${eventKey}`,
        now
      ]
    );
  }
  return { recorded: true, actualReward, experienceReward, balance: balanceAfter, dailyEarned: dailyEarned + actualReward };
}

export async function awardShellTask(
  userId: string,
  taskType: ShellTaskType,
  eventKey: string,
  options: {
    relatedType?: string | null;
    relatedId?: string | null;
    now?: Date;
    connection?: QueryConnection;
  } = {}
) {
  if (options.connection) {
    const result = await awardTaskEventWithConnection(
      options.connection,
      userId,
      taskType,
      eventKey,
      options.relatedType ?? null,
      options.relatedId ?? null,
      options.now
    );
    if (result.recorded && result.actualReward > 0) reportBadgeProgress(userId);
    return result;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await awardTaskEventWithConnection(
      connection,
      userId,
      taskType,
      eventKey,
      options.relatedType ?? null,
      options.relatedId ?? null,
      options.now
    );
    await connection.commit();
    if (result.recorded && result.actualReward > 0) reportBadgeProgress(userId);
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function awardBeginnerTask(userId: string, taskType: BeginnerTaskType) {
  const definition = BEGINNER_TASK_BY_TYPE.get(taskType);
  if (!definition) throw new Error(`UNKNOWN_BEGINNER_TASK:${taskType}`);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[userRow]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT shell_balance, experience FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );
    if (!userRow) throw new Error("SHELL_USER_NOT_FOUND");
    const [[existing]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM beginner_task_events WHERE user_id = ? AND task_type = ? LIMIT 1",
      [userId, taskType]
    );
    if (existing) {
      await connection.commit();
      return { recorded: false, balance: Number(userRow.shell_balance ?? 0), experienceReward: 0 };
    }

    const balanceAfter = Number(userRow.shell_balance ?? 0) + definition.reward;
    const experienceReward = Math.max(
      0,
      Math.min(definition.reward, MAX_EXPERIENCE - Number(userRow.experience ?? 0))
    );
    const eventId = nanoid();
    await connection.query(
      `INSERT INTO beginner_task_events
        (id, user_id, task_type, shell_reward, experience_reward)
       VALUES (?, ?, ?, ?, ?)`,
      [eventId, userId, taskType, definition.reward, experienceReward]
    );
    await connection.query(
      "UPDATE users SET shell_balance = ?, experience = experience + ? WHERE id = ?",
      [balanceAfter, experienceReward, userId]
    );
    await connection.query(
      `INSERT INTO shell_transactions
        (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
       VALUES (?, ?, 'beginner_task_reward', ?, ?, 'beginner_task', ?, ?, ?)`,
      [
        nanoid(),
        userId,
        definition.reward,
        balanceAfter,
        taskType,
        `${definition.name}奖励`,
        `beginner-task:${userId}:${taskType}`
      ]
    );
    await connection.commit();
    reportBadgeProgress(userId);
    return { recorded: true, balance: balanceAfter, experienceReward };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function eligibleBeginnerTaskTypes(state: {
  hasAvatar: boolean;
  completedDraws: number;
  hasEquippedBadge: boolean;
  hasVerifiedEmail: boolean;
  hasProfileBackground: boolean;
}) {
  const eligible: BeginnerTaskType[] = [];
  if (state.hasAvatar) eligible.push("upload_avatar");
  if (state.completedDraws >= 10) eligible.push("complete_ten_draws");
  if (state.hasEquippedBadge) eligible.push("equip_badge");
  if (state.hasVerifiedEmail) eligible.push("bind_email");
  if (state.hasProfileBackground) eligible.push("change_profile_background");
  return eligible;
}

export async function syncBeginnerTasks(userId: string) {
  const [[state], completedRows] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
         u.avatar IS NOT NULL AS has_avatar,
         u.equipped_badge_key IS NOT NULL AS has_equipped_badge,
         u.profile_background IS NOT NULL AS has_profile_background,
         EXISTS (
           SELECT 1 FROM user_identities identity
           WHERE identity.user_id = u.id
             AND identity.identity_type = 'email'
             AND identity.verified_at IS NOT NULL
         ) AS has_verified_email,
         COALESCE((
           SELECT SUM(draw_count) FROM asset_draw_orders
           WHERE user_id = u.id AND status = 'completed'
         ), 0) AS completed_draws
       FROM users u WHERE u.id = ? LIMIT 1`,
      [userId]
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      "SELECT task_type FROM beginner_task_events WHERE user_id = ?",
      [userId]
    ).then(([rows]) => rows)
  ]);
  if (!state) throw new Error("SHELL_USER_NOT_FOUND");
  const completed = new Set(completedRows.map((row) => String(row.task_type)));
  const eligible = eligibleBeginnerTaskTypes({
    hasAvatar: Number(state.has_avatar) === 1,
    completedDraws: Number(state.completed_draws ?? 0),
    hasEquippedBadge: Number(state.has_equipped_badge) === 1,
    hasVerifiedEmail: Number(state.has_verified_email) === 1,
    hasProfileBackground: Number(state.has_profile_background) === 1
  });
  for (const taskType of eligible) {
    if (!completed.has(taskType)) await awardBeginnerTask(userId, taskType);
  }
}

export async function shellTaskCenter(userId: string, now = new Date()) {
  await syncBeginnerTasks(userId);
  const taskDate = beijingTaskDate(now);
  const [[userRow], eventRows, beginnerEventRows, inviteStats] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>("SELECT shell_balance, experience FROM users WHERE id = ? LIMIT 1", [userId]).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT task_type, COUNT(*) AS progress, COALESCE(SUM(actual_reward), 0) AS actual_reward,
         COALESCE(SUM(experience_reward), 0) AS experience_reward
       FROM shell_task_events
       WHERE user_id = ? AND task_date = ?
       GROUP BY task_type`,
      [userId, taskDate]
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT task_type, shell_reward, experience_reward, completed_at
       FROM beginner_task_events WHERE user_id = ?`,
      [userId]
    ).then(([rows]) => rows),
    inviteRewardTaskStats(userId)
  ]);
  if (!userRow) throw new Error("SHELL_USER_NOT_FOUND");
  const progress = new Map(eventRows.map((row) => [String(row.task_type), row]));
  const tasks = SHELL_TASKS.map((task) => {
    const row = progress.get(task.type);
    const current = Math.min(task.dailyLimit, Number(row?.progress ?? 0));
    return {
      ...task,
      progress: current,
      completed: current >= task.dailyLimit,
      actualReward: Number(row?.actual_reward ?? 0),
      experienceReward: task.reward,
      actualExperience: Number(row?.experience_reward ?? 0),
      dailyMaximum: task.reward * task.dailyLimit
    };
  });
  const beginnerProgress = new Map(beginnerEventRows.map((row) => [String(row.task_type), row]));
  const beginnerTasks: Array<{
    type: BeginnerTaskType;
    name: string;
    description: string;
    reward: number;
    progress: number;
    target: number;
    completed: boolean;
    actualReward: number;
    experienceReward: number;
    actualExperience: number;
    completedAt: string | null;
    repeatable?: boolean;
    completedCount?: number;
  }> = BEGINNER_TASKS.map((task) => {
    const row = beginnerProgress.get(task.type);
    return {
      ...task,
      progress: row ? 1 : 0,
      target: 1,
      completed: Boolean(row),
      actualReward: Number(row?.shell_reward ?? 0),
      experienceReward: task.reward,
      actualExperience: Number(row?.experience_reward ?? 0),
      completedAt: row?.completed_at ? new Date(row.completed_at).toISOString() : null
    };
  });
  beginnerTasks.push(
    {
      type: "invite_verified_email",
      name: "邀请新用户并绑定邮箱",
      description: "每邀请 1 名新用户注册并完成邮箱绑定",
      reward: 50,
      progress: inviteStats.emailCompletedCount,
      target: 1,
      completed: inviteStats.emailCompletedCount > 0,
      actualReward: inviteStats.emailShellReward,
      experienceReward: 50,
      actualExperience: inviteStats.emailExperienceReward,
      completedAt: null,
      repeatable: true,
      completedCount: inviteStats.emailCompletedCount
    },
    {
      type: "invite_shell_milestone",
      name: "邀请用户成长奖励",
      description: "每名受邀用户累计获得 20 贝壳，次日结算",
      reward: 1,
      progress: inviteStats.shellCompletedCount,
      target: 1,
      completed: inviteStats.shellCompletedCount > 0,
      actualReward: inviteStats.shellReward,
      experienceReward: 1,
      actualExperience: inviteStats.shellExperienceReward,
      completedAt: null,
      repeatable: true,
      completedCount: inviteStats.shellCompletedCount
    }
  );
  return {
    balance: Number(userRow.shell_balance ?? 0),
    levelProgress: experienceProgress(userRow.experience),
    taskDate,
    earnedToday: tasks.reduce((sum, task) => sum + task.actualReward, 0),
    earnedExperienceToday: tasks.reduce((sum, task) => sum + task.actualExperience, 0),
    dailyLimit: SHELL_DAILY_LIMIT,
    theoreticalMaximum: SHELL_TASKS.reduce((sum, task) => sum + task.reward * task.dailyLimit, 0),
    tasks,
    beginnerTasks
  };
}

const TRANSACTION_LABELS: Record<string, string> = {
  daily_task_reward: "每日任务奖励",
  beginner_task_reward: "新手任务奖励",
  invite_email_reward: "邀请用户绑定邮箱奖励",
  invite_shell_milestone_reward: "邀请用户成长奖励",
  badge_unlock_reward: "首次获得徽章奖励",
  badge_history_backfill: "历史徽章奖励贝壳补发",
  pack_single_draw: "卡包单抽消费",
  pack_ten_draw: "卡包十连消费",
  duplicate_card_refund: "满星重复卡片返还",
  admin_add: "后台人工增加",
  admin_deduct: "后台人工扣减"
};

export async function shellTransactions(userId: string, limit: number, offset: number) {
  const [[totalRow], rows] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM shell_transactions WHERE user_id = ?", [userId]).then(([items]) => items),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT id, transaction_type, amount, balance_after, related_type, related_id, remark, operator_id, created_at
       FROM shell_transactions
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    ).then(([items]) => items)
  ]);
  const total = Number(totalRow?.total ?? 0);
  return {
    total,
    hasMore: offset + rows.length < total,
    transactions: rows.map((row) => ({
      id: String(row.id),
      type: String(row.transaction_type),
      typeLabel: TRANSACTION_LABELS[String(row.transaction_type)] ?? String(row.transaction_type),
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      relatedType: row.related_type ? String(row.related_type) : null,
      relatedId: row.related_id ? String(row.related_id) : null,
      remark: row.remark ? String(row.remark) : null,
      operatorId: row.operator_id ? String(row.operator_id) : null,
      createdAt: new Date(row.created_at).toISOString()
    }))
  };
}

export async function adjustShellBalance(userId: string, operatorId: string, operation: "add" | "deduct", amount: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[row]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT shell_balance FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );
    if (!row) throw new Error("SHELL_USER_NOT_FOUND");
    const balance = Number(row.shell_balance ?? 0);
    if (operation === "deduct" && amount > balance) throw new Error("SHELL_INSUFFICIENT_BALANCE");
    const signedAmount = operation === "add" ? amount : -amount;
    const balanceAfter = balance + signedAmount;
    const transactionId = nanoid();
    await connection.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balanceAfter, userId]);
    await connection.query(
      `INSERT INTO shell_transactions
        (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, operator_id)
       VALUES (?, ?, ?, ?, ?, 'admin_user', ?, ?, ?)`,
      [
        transactionId,
        userId,
        operation === "add" ? "admin_add" : "admin_deduct",
        signedAmount,
        balanceAfter,
        userId,
        operation === "add" ? "管理员人工增加" : "管理员人工扣减",
        operatorId
      ]
    );
    await connection.query(
      `INSERT INTO notifications (id, user_id, type, title, content, related_id, actor_id)
       VALUES (?, ?, 'shell_adjustment', ?, ?, ?, ?)`,
      [
        nanoid(),
        userId,
        operation === "add" ? "贝壳到账通知" : "贝壳扣除通知",
        operation === "add"
          ? `管理员向你发放了 ${amount} 贝壳，当前余额 ${balanceAfter} 贝壳。`
          : `管理员扣除了你 ${amount} 贝壳，当前余额 ${balanceAfter} 贝壳。`,
        transactionId,
        operatorId
      ]
    );
    await connection.commit();
    reportBadgeProgress(userId);
    return { balance: balanceAfter };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function bulkAdjustShellBalances(userIds: string[], operatorId: string, operation: "add" | "deduct", amount: number) {
  if (userIds.length === 0) return { matchedCount: 0, adjustedCount: 0, skippedCount: 0, adjustedUserIds: [] as string[] };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const placeholders = userIds.map(() => "?").join(",");
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, shell_balance FROM users WHERE role = 'user' AND id IN (${placeholders}) FOR UPDATE`,
      userIds
    );
    const eligible = rows.filter((row) => operation === "add" || Number(row.shell_balance ?? 0) >= amount);
    if (eligible.length > 0) {
      const eligibleIds = eligible.map((row) => String(row.id));
      const eligiblePlaceholders = eligibleIds.map(() => "?").join(",");
      await connection.query(
        `UPDATE users SET shell_balance = shell_balance ${operation === "add" ? "+" : "-"} ? WHERE id IN (${eligiblePlaceholders})`,
        [amount, ...eligibleIds]
      );
      const transactionRows = eligible.map((row) => {
        const transactionId = nanoid();
        const balanceAfter = Number(row.shell_balance ?? 0) + (operation === "add" ? amount : -amount);
        return { transactionId, userId: String(row.id), balanceAfter };
      });
      await connection.query(
        `INSERT INTO shell_transactions
          (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, operator_id)
         VALUES ${transactionRows.map(() => "(?, ?, ?, ?, ?, 'admin_bulk', ?, ?, ?)").join(",")}`,
        transactionRows.flatMap((item) => [
          item.transactionId,
          item.userId,
          operation === "add" ? "admin_add" : "admin_deduct",
          operation === "add" ? amount : -amount,
          item.balanceAfter,
          item.userId,
          operation === "add" ? "管理员批量增加" : "管理员批量扣减",
          operatorId
        ])
      );
      await connection.query(
        `INSERT INTO notifications (id, user_id, type, title, content, related_id, actor_id)
         VALUES ${transactionRows.map(() => "(?, ?, 'shell_adjustment', ?, ?, ?, ?)").join(",")}`,
        transactionRows.flatMap((item) => [
          nanoid(),
          item.userId,
          operation === "add" ? "贝壳到账通知" : "贝壳扣除通知",
          operation === "add"
            ? `管理员向你发放了 ${amount} 贝壳，当前余额 ${item.balanceAfter} 贝壳。`
            : `管理员扣除了你 ${amount} 贝壳，当前余额 ${item.balanceAfter} 贝壳。`,
          item.transactionId,
          operatorId
        ])
      );
    }
    await connection.commit();
    reportBadgeProgress(eligible.map((row) => String(row.id)));
    return {
      matchedCount: rows.length,
      adjustedCount: eligible.length,
      skippedCount: rows.length - eligible.length,
      adjustedUserIds: eligible.map((row) => String(row.id))
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function settleOnlineSoupRound(connection: QueryConnection, roundId: string) {
  const [[round]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT r.id, r.room_id, r.soup_id, r.started_at, r.ended_at, rooms.host_id, soups.creator_id AS soup_creator_id
     FROM online_soup_rounds r
     INNER JOIN online_soup_rooms rooms ON rooms.id = r.room_id
     INNER JOIN soups ON soups.id = r.soup_id
     WHERE r.id = ? AND r.status = 'ended'
     LIMIT 1`,
    [roundId]
  );
  if (!round?.started_at || !round?.ended_at) return { eligible: false, awardedUsers: [] as string[] };
  const startedAt = new Date(round.started_at);
  const endedAt = new Date(round.ended_at);
  if (!isEligibleOnlineSoupDuration(startedAt, endedAt)) return { eligible: false, awardedUsers: [] as string[] };

  const [playerRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT members.user_id, COUNT(messages.id) AS answered_questions
     FROM online_soup_members members
     LEFT JOIN online_soup_messages messages
       ON messages.round_id = ?
      AND messages.sender_id = members.user_id
      AND messages.message_type = 'question'
      AND messages.answer IS NOT NULL
     WHERE members.room_id = ?
       AND members.member_role = 'player'
       AND members.is_active = 1
     GROUP BY members.user_id
     HAVING answered_questions >= 5`,
    [roundId, round.room_id]
  );
  const [[hostRow]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS answered_questions
     FROM online_soup_messages
     WHERE round_id = ? AND message_type = 'question' AND answer IS NOT NULL`,
    [roundId]
  );
  const awards: Array<{ userId: string; taskType: ShellTaskType; eventKey: string }> = playerRows.map((row) => ({
    userId: String(row.user_id),
    taskType: "join_online_soup",
    eventKey: `online-join:${row.user_id}:${roundId}`
  }));
  if (Number(hostRow?.answered_questions ?? 0) >= 5) {
    awards.push({
      userId: String(round.host_id),
      taskType: "host_online_soup",
      eventKey: `online-host:${round.host_id}:${roundId}`
    });
  }
  const soupCreatorId = String(round.soup_creator_id ?? "");
  const hasOtherEligiblePlayer = hasOtherEligibleOnlineSoupPlayer(
    soupCreatorId,
    playerRows.map((row) => String(row.user_id))
  );
  if (soupCreatorId && hasOtherEligiblePlayer) {
    awards.push({
      userId: soupCreatorId,
      taskType: "soup_online_completed",
      eventKey: `online-soup-completed:${soupCreatorId}:${roundId}`
    });
  }
  awards.sort((a, b) => a.userId.localeCompare(b.userId));
  const awardedUsers: string[] = [];
  for (const award of awards) {
    const result = await awardTaskEventWithConnection(
      connection,
      award.userId,
      award.taskType,
      award.eventKey,
      "online_soup_round",
      roundId,
      endedAt
    );
    if (result.recorded) awardedUsers.push(award.userId);
    if (result.recorded && result.actualReward > 0) reportBadgeProgress(award.userId);
  }
  return { eligible: true, awardedUsers };
}
