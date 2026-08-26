import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { creditGiftInventory } from "./giftInventory.js";
import { MAX_EXPERIENCE } from "./levelSystem.js";
import { SYSTEM_BADGE_ACHIEVEMENT_POINTS } from "./badgeRewards.js";
import { resolveRewardGift, type RewardGiftBindingKey } from "./rewardGiftBindings.js";
import { rankingRewardNotificationSummary } from "./rankingRewardNotifications.js";
import { COLLECTIBLE_RANKING_ELIGIBLE_ROLES_SQL, CURRENT_COLLECTIBLE_HOLDINGS_SQL } from "./collectibleRankings.js";
import { TIMED_RANKING_BADGES, type TimedRankingBadgeBoard } from "./timedRankingBadges.js";

export type RankingRewardPeriod = "weekly" | "monthly";
export type RankingRewardBoard = "achievement" | "level" | "collection" | "collectible" | "charm" | "generosity" | "draws";

type CurrencyReward = { type: "currency"; experience: number; shell: number };
type GiftReward = { type: "gift"; giftName: "月亮小船" | "智慧水晶球" | "神秘钥匙" | "深海明珠"; quantity: number };
export type RankingReward = CurrencyReward | GiftReward;

const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const BOARD_ORDER: RankingRewardBoard[] = ["achievement", "level", "collection", "collectible", "charm", "generosity", "draws"];
export const RANKING_REWARD_BOARD_LABELS: Record<RankingRewardBoard, string> = {
  achievement: "成就榜",
  level: "等级榜",
  collection: "卡牌榜",
  collectible: "收藏品榜",
  charm: "魅力榜",
  generosity: "慷慨榜",
  draws: "抽卡榜"
};
const RANKING_GIFT_BINDING_KEYS: Record<GiftReward["giftName"], RewardGiftBindingKey> = {
  神秘钥匙: "ranking:mystery_key",
  智慧水晶球: "ranking:wisdom_crystal",
  月亮小船: "ranking:moon_boat",
  深海明珠: "ranking:deep_sea_pearl"
};

function beijingParts(value: Date) {
  const shifted = new Date(value.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay()
  };
}

function beijingMidnightUtc(year: number, month: number, date: number) {
  return new Date(Date.UTC(year, month, date) - BEIJING_OFFSET_MS);
}

export function nextWeeklyRankingSettlement(now: Date) {
  const parts = beijingParts(now);
  const todayMidnight = beijingMidnightUtc(parts.year, parts.month, parts.date);
  let daysUntilMonday = (8 - parts.day) % 7;
  if (daysUntilMonday === 0 && now.getTime() >= todayMidnight.getTime()) daysUntilMonday = 7;
  return new Date(todayMidnight.getTime() + daysUntilMonday * DAY_MS);
}

export function nextMonthlyRankingSettlement(now: Date) {
  const parts = beijingParts(now);
  return beijingMidnightUtc(parts.year, parts.month + 1, 1);
}

export function rankingPeriodStart(period: RankingRewardPeriod, periodEnd: Date) {
  return new Date(periodEnd.getTime() - (period === "weekly" ? 7 : 30) * DAY_MS);
}

export function nextRankingPeriodEnd(period: RankingRewardPeriod, periodEnd: Date) {
  if (period === "weekly") return new Date(periodEnd.getTime() + 7 * DAY_MS);
  const parts = beijingParts(periodEnd);
  return beijingMidnightUtc(parts.year, parts.month + 1, 1);
}

export function rankingRewardFor(period: RankingRewardPeriod, board: RankingRewardBoard, rank: number): RankingReward | null {
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) return null;
  const currencyBoard = board === "level" || board === "charm" || board === "generosity";
  if (currencyBoard) {
    if (period === "weekly") {
      if (rank === 1) return { type: "currency", experience: 100, shell: 50 };
      if (rank <= 3) return { type: "currency", experience: 60, shell: 30 };
      if (rank <= 5) return { type: "currency", experience: 40, shell: 20 };
      return { type: "currency", experience: 30, shell: 15 };
    }
    if (rank === 1) return { type: "currency", experience: 500, shell: 200 };
    if (rank <= 3) return { type: "currency", experience: 300, shell: 100 };
    if (rank <= 5) return { type: "currency", experience: 200, shell: 80 };
    return { type: "currency", experience: 100, shell: 50 };
  }
  if (period === "weekly") {
    if (rank === 1) return { type: "gift", giftName: "月亮小船", quantity: 1 };
    if (rank <= 3) return { type: "gift", giftName: "智慧水晶球", quantity: 2 };
    if (rank <= 5) return { type: "gift", giftName: "神秘钥匙", quantity: 3 };
    return { type: "gift", giftName: "神秘钥匙", quantity: 2 };
  }
  if (rank === 1) return { type: "gift", giftName: "深海明珠", quantity: 1 };
  if (rank <= 3) return { type: "gift", giftName: "月亮小船", quantity: 2 };
  if (rank <= 5) return { type: "gift", giftName: "月亮小船", quantity: 1 };
  return { type: "gift", giftName: "月亮小船", quantity: 1 };
}

type Standing = { userId: string; rank: number; value: number };
type Standings = Record<RankingRewardBoard, Standing[]>;
type RankedValue = { userId: string; value: number; reachedAt: number; createdAt: number };

export function rankPositiveValues(items: RankedValue[], limit = 10): Standing[] {
  return items
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value
      || a.reachedAt - b.reachedAt
      || a.createdAt - b.createdAt
      || a.userId.localeCompare(b.userId))
    .slice(0, limit)
    .map(({ userId, value }, index) => ({ userId, value, rank: index + 1 }));
}

export function monthlyTimedBadgeWinners(standings: Standings) {
  return (Object.keys(TIMED_RANKING_BADGES) as TimedRankingBadgeBoard[]).flatMap((board) => {
    const winner = standings[board][0];
    return winner ? [{ board, badge: TIMED_RANKING_BADGES[board], winner }] : [];
  });
}

async function replaceMonthlyTimedBadges(
  connection: mysql.PoolConnection,
  settlementId: string,
  standings: Standings,
  periodEnd: Date,
  nextPeriodEnd: Date
) {
  const winners = monthlyTimedBadgeWinners(standings);
  const badgeIds = Object.values(TIMED_RANKING_BADGES).map((badge) => badge.id);
  const badgeKeys = badgeIds.map((badgeId) => `legendary:${badgeId}`);
  const placeholders = badgeIds.map(() => "?").join(",");
  const [activeRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT user_id, badge_id
     FROM timed_ranking_badge_grants
     WHERE badge_id IN (${placeholders}) AND expired_at IS NULL
     ORDER BY badge_id, granted_at
     FOR UPDATE`,
    badgeIds
  );
  const changedUsers = new Set(activeRows.map((row) => String(row.user_id)));

  await connection.query(
    `UPDATE timed_ranking_badge_grants
     SET expired_at = ?
     WHERE badge_id IN (${placeholders}) AND expired_at IS NULL`,
    [periodEnd, ...badgeIds]
  );
  await connection.query(
    `DELETE FROM user_badge_unlocks WHERE badge_key IN (${badgeKeys.map(() => "?").join(",")})`,
    badgeKeys
  );
  await connection.query(
    `UPDATE users
     SET equipped_badge_key = NULL, equipped_badge_icon_url = NULL
     WHERE equipped_badge_key IN (${badgeKeys.map(() => "?").join(",")})`,
    badgeKeys
  );

  for (const { board, badge, winner } of winners) {
    const badgeKey = `legendary:${badge.id}`;
    await connection.query(
      `INSERT INTO timed_ranking_badge_grants
        (id, settlement_id, board_type, badge_id, user_id, granted_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), settlementId, board, badge.id, winner.userId, periodEnd, nextPeriodEnd]
    );
    await connection.query(
      `INSERT INTO user_badge_unlocks (user_id, badge_key, unlocked_at, surfaced_at)
       VALUES (?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE unlocked_at = VALUES(unlocked_at), surfaced_at = NULL`,
      [winner.userId, badgeKey, periodEnd]
    );
    changedUsers.add(winner.userId);
  }
  return [...changedUsers];
}

async function rankingStandings(
  connection: mysql.PoolConnection,
  periodStart: Date,
  periodEnd: Date
): Promise<Standings> {
  const [achievementRows, levelRows, charmRows, generosityRows, collectionRows, collectibleRows, drawRows] = await Promise.all([
    connection.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.created_at, ubu.badge_key, ubu.unlocked_at,
         lb.achievement_points AS legendary_points
       FROM users u
       LEFT JOIN user_badge_unlocks ubu
         ON ubu.user_id = u.id AND ubu.unlocked_at >= ? AND ubu.unlocked_at < ?
       LEFT JOIN legendary_badges lb ON ubu.badge_key = CONCAT('legendary:', lb.id)
       WHERE u.role IN ('user', 'vip', 'backoffice_admin')
       ORDER BY u.created_at ASC, u.id ASC, ubu.unlocked_at ASC`,
      [periodStart, periodEnd]
    ).then(([rows]) => rows),
    connection.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.created_at,
         COALESCE(task_gain.value, 0) + COALESCE(beginner_gain.value, 0)
           + COALESCE(adjustment_gain.value, 0) + COALESCE(invite_email_gain.value, 0)
           + COALESCE(invite_milestone_gain.value, 0) AS metric_value,
         GREATEST(
           COALESCE(task_gain.reached_at, '1970-01-01'),
           COALESCE(beginner_gain.reached_at, '1970-01-01'),
           COALESCE(adjustment_gain.reached_at, '1970-01-01'),
           COALESCE(invite_email_gain.reached_at, '1970-01-01'),
           COALESCE(invite_milestone_gain.reached_at, '1970-01-01')
         ) AS reached_at
       FROM users u
       LEFT JOIN (
         SELECT user_id, SUM(experience_reward) AS value, MAX(created_at) AS reached_at FROM shell_task_events
         WHERE created_at >= ? AND created_at < ? GROUP BY user_id
       ) task_gain ON task_gain.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(experience_reward) AS value, MAX(completed_at) AS reached_at FROM beginner_task_events
         WHERE completed_at >= ? AND completed_at < ? GROUP BY user_id
       ) beginner_gain ON beginner_gain.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(amount) AS value, MAX(created_at) AS reached_at FROM user_experience_adjustments
         WHERE created_at >= ? AND created_at < ? GROUP BY user_id
       ) adjustment_gain ON adjustment_gain.user_id = u.id
       LEFT JOIN (
         SELECT inviter_user_id AS user_id, SUM(email_experience_reward) AS value,
           MAX(email_rewarded_at) AS reached_at
         FROM user_invite_reward_progress
         WHERE email_rewarded_at >= ? AND email_rewarded_at < ? GROUP BY inviter_user_id
       ) invite_email_gain ON invite_email_gain.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(experience_amount) AS value, MAX(created_at) AS reached_at FROM shell_transactions
         WHERE transaction_type = 'invite_shell_milestone_reward'
           AND created_at >= ? AND created_at < ?
         GROUP BY user_id
       ) invite_milestone_gain ON invite_milestone_gain.user_id = u.id
       WHERE u.role IN ('user', 'vip', 'backoffice_admin')`,
      [periodStart, periodEnd, periodStart, periodEnd, periodStart, periodEnd, periodStart, periodEnd, periodStart, periodEnd]
    ).then(([rows]) => rows),
    connection.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.created_at,
         COALESCE(SUM(CASE WHEN gs.created_at >= ? AND gs.created_at < ? THEN gs.total_reward_charm ELSE 0 END), 0) AS metric_value,
         MAX(CASE WHEN gs.created_at >= ? AND gs.created_at < ? THEN gs.created_at END) AS reached_at
       FROM users u
       LEFT JOIN gift_sends gs ON gs.recipient_id = u.id
       WHERE u.role IN ('user', 'vip', 'backoffice_admin')
       GROUP BY u.id, u.created_at`,
      [periodStart, periodEnd, periodStart, periodEnd]
    ).then(([rows]) => rows),
    connection.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.created_at,
         COALESCE(SUM(CASE WHEN gs.created_at >= ? AND gs.created_at < ? THEN gs.total_reward_charm ELSE 0 END), 0) AS metric_value,
         MAX(CASE WHEN gs.created_at >= ? AND gs.created_at < ? THEN gs.created_at END) AS reached_at
       FROM users u
       LEFT JOIN gift_sends gs ON gs.sender_id = u.id
       WHERE u.role IN ('user', 'vip', 'backoffice_admin')
       GROUP BY u.id, u.created_at`,
      [periodStart, periodEnd, periodStart, periodEnd]
    ).then(([rows]) => rows),
    connection.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.created_at, COALESCE(SUM(events.amount), 0) AS metric_value,
         MAX(events.created_at) AS reached_at
       FROM users u
       LEFT JOIN asset_collection_value_events events
         ON events.user_id = u.id
        AND events.included_in_rankings = 1
        AND events.created_at >= ? AND events.created_at < ?
       WHERE u.role IN ('user', 'vip', 'backoffice_admin')
       GROUP BY u.id, u.created_at`,
      [periodStart, periodEnd]
    ).then(([rows]) => rows),
    connection.query<mysql.RowDataPacket[]>(
      `SELECT u.id,u.created_at,COALESCE(owned.collectible_value,0) AS metric_value,
         COALESCE(owned.reached_at,u.created_at) AS reached_at
       FROM users u LEFT JOIN (${CURRENT_COLLECTIBLE_HOLDINGS_SQL}) owned ON owned.user_id=u.id
       WHERE u.role IN (${COLLECTIBLE_RANKING_ELIGIBLE_ROLES_SQL})
      `
    ).then(([rows])=>rows),
    connection.query<mysql.RowDataPacket[]>(
      `SELECT events.user_id AS id, users.created_at,
         SUM(events.draw_count) AS metric_value,
         MAX(events.completed_at) AS reached_at
       FROM asset_draw_count_events events
       INNER JOIN users ON users.id = events.user_id
       WHERE events.completed_at >= ?
         AND events.completed_at < ?
         AND users.role IN ('user', 'vip', 'backoffice_admin')
       GROUP BY events.user_id, users.created_at`,
      [periodStart, periodEnd]
    ).then(([rows]) => rows)
  ]);

  const achievements = new Map<string, { userId: string; value: number; reachedAt: number; createdAt: number }>();
  for (const row of achievementRows) {
    const userId = String(row.id);
    const createdAt = new Date(row.created_at).getTime();
    const current = achievements.get(userId) ?? { userId, value: 0, reachedAt: createdAt, createdAt };
    if (row.badge_key) {
      const key = String(row.badge_key);
      const points = key.startsWith("legendary:")
        ? Number(row.legendary_points ?? 0)
        : Number(SYSTEM_BADGE_ACHIEVEMENT_POINTS[key] ?? 0);
      if (points > 0) {
        current.value += points;
        current.reachedAt = Math.max(current.reachedAt, new Date(row.unlocked_at).getTime());
      }
    }
    achievements.set(userId, current);
  }

  const rankRows = (
    rows: mysql.RowDataPacket[],
    reachedAt: (row: mysql.RowDataPacket) => number = (row) => new Date(row.created_at).getTime()
  ) => rankPositiveValues(rows
    .map((row) => ({
      userId: String(row.id),
      value: Math.max(0, Math.floor(Number(row.metric_value ?? 0))),
      reachedAt: reachedAt(row),
      createdAt: new Date(row.created_at).getTime()
    })));

  return {
    achievement: rankPositiveValues([...achievements.values()]),
    level: rankRows(levelRows, (row) => new Date(row.reached_at ?? row.created_at).getTime()),
    collection: rankRows(collectionRows, (row) => new Date(row.reached_at ?? row.created_at).getTime()),
    collectible: rankRows(collectibleRows, (row) => new Date(row.reached_at ?? row.created_at).getTime()),
    charm: rankRows(charmRows, (row) => new Date(row.reached_at ?? row.created_at).getTime()),
    generosity: rankRows(generosityRows, (row) => new Date(row.reached_at ?? row.created_at).getTime()),
    draws: rankRows(drawRows, (row) => new Date(row.reached_at).getTime())
  };
}

async function settlePeriod(
  connection: mysql.PoolConnection,
  period: RankingRewardPeriod,
  periodEnd: Date,
  nextPeriodEnd: Date
) {
  const periodStart = rankingPeriodStart(period, periodEnd);
  await connection.beginTransaction();
  try {
    const [existingRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id, status FROM ranking_reward_settlements WHERE period_type = ? AND period_end = ? LIMIT 1 FOR UPDATE",
      [period, periodEnd]
    );
    if (existingRows[0]?.status === "completed") {
      await connection.query(
        "UPDATE ranking_reward_schedules SET next_settlement_at = ? WHERE period_type = ?",
        [nextPeriodEnd, period]
      );
      await connection.commit();
      return [] as string[];
    }

    const settlementId = existingRows[0] ? String(existingRows[0].id) : nanoid();
    if (!existingRows[0]) {
      await connection.query(
        `INSERT INTO ranking_reward_settlements
          (id, period_type, period_start, period_end, status)
         VALUES (?, ?, ?, ?, 'processing')`,
        [settlementId, period, periodStart, periodEnd]
      );
    }

    const standings = await rankingStandings(connection, periodStart, periodEnd);
    const planned = BOARD_ORDER.flatMap((board) =>
      standings[board].map((standing) => ({ board, standing, reward: rankingRewardFor(period, board, standing.rank)! }))
    );
    const userIds = [...new Set(planned.map((item) => item.standing.userId))].sort();
    const balances = new Map<string, { experience: number; shell: number }>();
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(",");
      const [userRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, experience, shell_balance FROM users WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`,
        userIds
      );
      userRows.forEach((row) => balances.set(String(row.id), {
        experience: Number(row.experience ?? 0),
        shell: Number(row.shell_balance ?? 0)
      }));
    }

    for (const item of planned) {
      const { board, standing, reward } = item;
      const balance = balances.get(standing.userId);
      if (!balance) continue;
      const grantId = nanoid();
      let actualExperience = 0;
      let actualShell = 0;
      let giftId: string | null = null;
      let giftName: string | null = null;
      let giftQuantity = 0;

      if (reward.type === "currency") {
        actualExperience = Math.max(0, Math.min(reward.experience, MAX_EXPERIENCE - balance.experience));
        actualShell = Math.max(0, Math.min(reward.shell, 4_294_967_295 - balance.shell));
        balance.experience += actualExperience;
        balance.shell += actualShell;
        await connection.query(
          "UPDATE users SET experience = ?, shell_balance = ? WHERE id = ?",
          [balance.experience, balance.shell, standing.userId]
        );
        if (actualExperience > 0) {
          await connection.query(
            `INSERT INTO user_experience_adjustments
              (id, user_id, admin_id, amount, experience_after)
             VALUES (?, ?, NULL, ?, ?)`,
            [nanoid(), standing.userId, actualExperience, balance.experience]
          );
        }
        if (actualShell > 0) {
          await connection.query(
            `INSERT INTO shell_transactions
              (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
             VALUES (?, ?, 'ranking_reward', ?, ?, 'ranking_reward', ?, ?, ?)`,
            [
              nanoid(),
              standing.userId,
              actualShell,
              balance.shell,
              grantId,
              `${period === "weekly" ? "7日" : "30日"}${RANKING_REWARD_BOARD_LABELS[board]}第${standing.rank}名奖励`,
              `ranking-reward:shell:${grantId}`
            ]
          );
        }
      } else {
        const boundGift = await resolveRewardGift(
          connection,
          RANKING_GIFT_BINDING_KEYS[reward.giftName],
          reward.giftName
        );
        giftId = boundGift.id;
        giftName = boundGift.name;
        giftQuantity = reward.quantity;
        const inventory = await creditGiftInventory(connection, {
          userId: standing.userId,
          giftId,
          quantity: giftQuantity,
          idempotencyKey: `ranking-gift:${grantId}`,
          relatedType: "ranking_reward",
          relatedId: grantId,
          remark: `${period === "weekly" ? "7日" : "30日"}${RANKING_REWARD_BOARD_LABELS[board]}第${standing.rank}名奖励`
        });
        balance.shell = inventory.shellBalance;
      }

      await connection.query(
        `INSERT INTO ranking_reward_grants
          (id, settlement_id, board_type, user_id, rank_position, metric_value,
           experience_reward, actual_experience_reward, shell_reward, actual_shell_reward,
           gift_id, gift_name_snapshot, gift_quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          grantId,
          settlementId,
          board,
          standing.userId,
          standing.rank,
          standing.value,
          reward.type === "currency" ? reward.experience : 0,
          actualExperience,
          reward.type === "currency" ? reward.shell : 0,
          actualShell,
          giftId,
          giftName,
          giftQuantity
        ]
      );
    }

    const boardCounts = new Map<string, number>();
    for (const item of planned) {
      if (!balances.has(item.standing.userId)) continue;
      boardCounts.set(item.standing.userId, (boardCounts.get(item.standing.userId) ?? 0) + 1);
    }
    for (const [userId, boardCount] of boardCounts) {
      const notification = rankingRewardNotificationSummary(period, boardCount);
      await connection.query(
        `INSERT INTO notifications (id, user_id, type, title, content, related_id, actor_id)
         VALUES (?, ?, 'ranking_reward', ?, ?, ?, ?)`,
        [
          nanoid(),
          userId,
          notification.title,
          notification.content,
          settlementId,
          userId
        ]
      );
    }

    const timedBadgeChangedUsers = period === "monthly"
      ? await replaceMonthlyTimedBadges(connection, settlementId, standings, periodEnd, nextPeriodEnd)
      : [];

    await connection.query(
      `UPDATE ranking_reward_settlements
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [settlementId]
    );
    await connection.query(
      "UPDATE ranking_reward_schedules SET next_settlement_at = ? WHERE period_type = ?",
      [nextPeriodEnd, period]
    );
    await connection.commit();
    return [...new Set([...userIds, ...timedBadgeChangedUsers])];
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

export async function runRankingRewardScheduler(now = new Date()) {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [[lockRow]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT GET_LOCK('hgt-ranking-reward-scheduler', 0) AS acquired"
    );
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) return [] as string[];

    await connection.query(
      `INSERT IGNORE INTO ranking_reward_schedules (period_type, next_settlement_at)
       VALUES ('weekly', ?), ('monthly', ?)`,
      [nextWeeklyRankingSettlement(now), nextMonthlyRankingSettlement(now)]
    );

    const notifiedUsers = new Set<string>();
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const [dueRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT period_type, next_settlement_at
         FROM ranking_reward_schedules
         WHERE next_settlement_at <= ?
         ORDER BY next_settlement_at ASC
         LIMIT 1`,
        [now]
      );
      if (!dueRows[0]) break;
      const period = String(dueRows[0].period_type) as RankingRewardPeriod;
      const periodEnd = new Date(dueRows[0].next_settlement_at);
      const awardedUsers = await settlePeriod(connection, period, periodEnd, nextRankingPeriodEnd(period, periodEnd));
      awardedUsers.forEach((userId) => notifiedUsers.add(userId));
    }
    return [...notifiedUsers];
  } finally {
    if (lockAcquired) {
      await connection.query("SELECT RELEASE_LOCK('hgt-ranking-reward-scheduler')").catch(() => undefined);
    }
    connection.release();
  }
}
