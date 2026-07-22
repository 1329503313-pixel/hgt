import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";

let badgeProgressListener: ((userId: string) => void) | null = null;

export function setShellBadgeProgressListener(listener: (userId: string) => void) {
  badgeProgressListener = listener;
}

function reportBadgeProgress(userIds: string | string[]) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  ids.forEach((userId) => badgeProgressListener?.(userId));
}

export const SHELL_DAILY_LIMIT = 50;

export type ShellTaskType =
  | "daily_login"
  | "publish_soup"
  | "like_soup"
  | "favorite_soup"
  | "publish_evaluation"
  | "speak_circle"
  | "join_online_soup"
  | "host_online_soup";

export type ShellTaskDefinition = {
  type: ShellTaskType;
  name: string;
  description: string;
  reward: number;
  dailyLimit: number;
  consumeBeyondDailyLimit?: boolean;
};

export const SHELL_TASKS: readonly ShellTaskDefinition[] = [
  { type: "daily_login", name: "每日登录", description: "当天首次进入应用", reward: 5, dailyLimit: 1 },
  { type: "publish_soup", name: "发布海龟汤", description: "审核通过并公开展示", reward: 10, dailyLimit: 3, consumeBeyondDailyLimit: true },
  { type: "like_soup", name: "点赞海龟汤", description: "点赞不同的海龟汤", reward: 2, dailyLimit: 3 },
  { type: "favorite_soup", name: "收藏海龟汤", description: "收藏不同的海龟汤", reward: 2, dailyLimit: 3 },
  { type: "publish_evaluation", name: "发表评论", description: "首次发布评分或评论", reward: 3, dailyLimit: 1, consumeBeyondDailyLimit: true },
  { type: "speak_circle", name: "圈子发言", description: "在任意圈子发送一条文字消息", reward: 2, dailyLimit: 3 },
  { type: "join_online_soup", name: "完整参与玩汤", description: "满足完整参与条件并完成一轮", reward: 5, dailyLimit: 2 },
  { type: "host_online_soup", name: "完整主持玩汤", description: "满足完整主持条件并完成一轮", reward: 10, dailyLimit: 1 }
] as const;

const TASK_BY_TYPE = new Map(SHELL_TASKS.map((task) => [task.type, task]));

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

type QueryConnection = mysql.PoolConnection;

export type AwardTaskResult = {
  recorded: boolean;
  actualReward: number;
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
    "SELECT shell_balance FROM users WHERE id = ? FOR UPDATE",
    [userId]
  );
  if (!userRow) throw new Error("SHELL_USER_NOT_FOUND");
  const balance = Number(userRow.shell_balance ?? 0);
  const [[existing]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT actual_reward FROM shell_task_events WHERE event_key = ? LIMIT 1",
    [eventKey]
  );
  const [[dailyRow]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COALESCE(SUM(actual_reward), 0) AS earned FROM shell_task_events WHERE user_id = ? AND task_date = ?",
    [userId, taskDate]
  );
  const dailyEarned = Number(dailyRow?.earned ?? 0);
  if (existing) {
    return { recorded: false, actualReward: Number(existing.actual_reward ?? 0), balance, dailyEarned };
  }
  const [[progressRow]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS progress FROM shell_task_events WHERE user_id = ? AND task_date = ? AND task_type = ?",
    [userId, taskDate, taskType]
  );
  if (Number(progressRow?.progress ?? 0) >= definition.dailyLimit) {
    if (definition.consumeBeyondDailyLimit) {
      await connection.query(
        `INSERT INTO shell_task_events
          (id, user_id, task_date, task_type, event_key, related_type, related_id, nominal_reward, actual_reward, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [nanoid(), userId, taskDate, taskType, eventKey, relatedType, relatedId, definition.reward, now]
      );
      return { recorded: true, actualReward: 0, balance, dailyEarned };
    }
    return { recorded: false, actualReward: 0, balance, dailyEarned };
  }

  const actualReward = calculateTaskReward(dailyEarned, definition.reward);
  const balanceAfter = balance + actualReward;
  await connection.query(
    `INSERT INTO shell_task_events
      (id, user_id, task_date, task_type, event_key, related_type, related_id, nominal_reward, actual_reward, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), userId, taskDate, taskType, eventKey, relatedType, relatedId, definition.reward, actualReward, now]
  );
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
  return { recorded: true, actualReward, balance: balanceAfter, dailyEarned: dailyEarned + actualReward };
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

export async function shellTaskCenter(userId: string, now = new Date()) {
  const taskDate = beijingTaskDate(now);
  const [[userRow], eventRows] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? LIMIT 1", [userId]).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT task_type, COUNT(*) AS progress, COALESCE(SUM(actual_reward), 0) AS actual_reward
       FROM shell_task_events
       WHERE user_id = ? AND task_date = ?
       GROUP BY task_type`,
      [userId, taskDate]
    ).then(([rows]) => rows)
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
      dailyMaximum: task.reward * task.dailyLimit
    };
  });
  return {
    balance: Number(userRow.shell_balance ?? 0),
    taskDate,
    earnedToday: tasks.reduce((sum, task) => sum + task.actualReward, 0),
    dailyLimit: SHELL_DAILY_LIMIT,
    theoreticalMaximum: SHELL_TASKS.reduce((sum, task) => sum + task.reward * task.dailyLimit, 0),
    tasks
  };
}

const TRANSACTION_LABELS: Record<string, string> = {
  daily_task_reward: "每日任务奖励",
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
    `SELECT r.id, r.room_id, r.started_at, r.ended_at, rooms.host_id
     FROM online_soup_rounds r
     INNER JOIN online_soup_rooms rooms ON rooms.id = r.room_id
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
  }
  return { eligible: true, awardedUsers };
}
