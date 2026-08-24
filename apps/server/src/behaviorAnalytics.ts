import mysql from "mysql2/promise";
import { pool } from "./db.js";

export const USER_BEHAVIOR_DEFINITIONS = [
  { key: "publish_soup", label: "发布海龟汤" },
  { key: "view_soup", label: "查看汤" },
  { key: "start_ai_game", label: "AI 主持" },
  { key: "like_soup", label: "点赞" },
  { key: "favorite_soup", label: "收藏" },
  { key: "save_evaluation", label: "评论" },
  { key: "draw_cards", label: "抽卡" },
  { key: "send_gift", label: "送礼" },
  { key: "speak_circle", label: "圈子发言" },
  { key: "speak_private", label: "私信发言" },
  { key: "create_online_room", label: "创建游戏房间" },
  { key: "join_online_room", label: "进入游戏房间" },
  { key: "complete_online_round", label: "完成一轮游戏" }
] as const;

export type UserBehaviorType = typeof USER_BEHAVIOR_DEFINITIONS[number]["key"];

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const BACKFILL_DAYS = 90;
const FLUSH_INTERVAL_MS = 5_000;
const BACKFILL_START_DELAY_MS = 60_000;
const BACKFILL_STEP_DELAY_MS = 500;

let pendingCounts = new Map<string, number>();
let flushPromise: Promise<void> | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let backfillTimer: NodeJS.Timeout | null = null;
let backfillRetryTimer: NodeJS.Timeout | null = null;

export function behaviorDateKey(date = new Date()) {
  return new Date(date.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

export function recordUserBehavior(type: UserBehaviorType, count = 1, occurredAt = new Date()) {
  if (!Number.isSafeInteger(count) || count <= 0) return;
  const key = `${behaviorDateKey(occurredAt)}|${type}`;
  pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + count);
}

function restoreBatch(batch: Map<string, number>) {
  for (const [key, count] of batch) {
    pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + count);
  }
}

async function writePendingBatch() {
  if (pendingCounts.size === 0) return;
  const batch = pendingCounts;
  pendingCounts = new Map();
  const rows = [...batch.entries()].map(([key, count]) => {
    const separator = key.indexOf("|");
    return [key.slice(0, separator), key.slice(separator + 1), count] as const;
  });
  try {
    await pool.query(
      `INSERT INTO user_behavior_daily_stats (stat_date, behavior_type, tracked_count)
       VALUES ${rows.map(() => "(?, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE
         tracked_count = tracked_count + VALUES(tracked_count)`,
      rows.flat()
    );
  } catch (error) {
    restoreBatch(batch);
    console.error("User behavior analytics flush failed:", error);
  }
}

export async function flushUserBehaviorAnalytics() {
  if (flushPromise) await flushPromise;
  if (pendingCounts.size === 0) return;
  flushPromise = writePendingBatch().finally(() => {
    flushPromise = null;
  });
  await flushPromise;
}

type BackfillSource = {
  type: UserBehaviorType;
  sql: string;
};

const backfillSources: BackfillSource[] = [
  {
    type: "publish_soup",
    sql: "SELECT created_at AS occurred_at FROM soups WHERE created_at >= ? AND created_at < ?"
  },
  {
    type: "view_soup",
    sql: "SELECT viewed_at AS occurred_at FROM soup_views WHERE viewed_at >= ? AND viewed_at < ? AND user_identifier LIKE 'user:%'"
  },
  {
    type: "start_ai_game",
    sql: "SELECT created_at AS occurred_at FROM game_sessions WHERE created_at >= ? AND created_at < ?"
  },
  {
    type: "like_soup",
    sql: `SELECT created_at AS occurred_at
          FROM soup_like_history
          WHERE created_at >= ? AND created_at < ?
          UNION ALL
          SELECT likes.created_at AS occurred_at
          FROM soup_likes likes
          INNER JOIN soups ON soups.id = likes.soup_id
          WHERE likes.created_at >= ? AND likes.created_at < ?
            AND soups.is_original = FALSE`
  },
  {
    type: "favorite_soup",
    sql: `SELECT created_at AS occurred_at
          FROM soup_favorite_history
          WHERE created_at >= ? AND created_at < ?
          UNION ALL
          SELECT favorites.created_at AS occurred_at
          FROM soup_favorites favorites
          INNER JOIN soups ON soups.id = favorites.soup_id
          WHERE favorites.created_at >= ? AND favorites.created_at < ?
            AND soups.is_original = FALSE`
  },
  {
    type: "save_evaluation",
    sql: "SELECT created_at AS occurred_at FROM evaluations WHERE created_at >= ? AND created_at < ?"
  },
  {
    type: "draw_cards",
    sql: "SELECT completed_at AS occurred_at FROM asset_draw_count_events WHERE completed_at >= ? AND completed_at < ?"
  },
  {
    type: "send_gift",
    sql: "SELECT created_at AS occurred_at FROM gift_sends WHERE created_at >= ? AND created_at < ?"
  },
  {
    type: "speak_circle",
    sql: "SELECT created_at AS occurred_at FROM circle_messages WHERE created_at >= ? AND created_at < ? AND message_type IN ('text','sticker')"
  },
  {
    type: "speak_private",
    sql: "SELECT created_at AS occurred_at FROM private_messages WHERE created_at >= ? AND created_at < ? AND message_type IN ('text','sticker')"
  },
  {
    type: "create_online_room",
    sql: "SELECT created_at AS occurred_at FROM online_soup_rooms WHERE created_at >= ? AND created_at < ?"
  },
  {
    type: "join_online_room",
    sql: "SELECT joined_at AS occurred_at FROM online_soup_members WHERE joined_at >= ? AND joined_at < ? AND member_role IN ('player','spectator')"
  },
  {
    type: "complete_online_round",
    sql: `SELECT rounds.ended_at AS occurred_at
          FROM online_soup_rounds rounds
          WHERE rounds.ended_at >= ? AND rounds.ended_at < ?
            AND rounds.status = 'ended'
            AND rounds.started_at IS NOT NULL
            AND TIMESTAMPDIFF(SECOND, rounds.started_at, rounds.ended_at) > 300
            AND (
              SELECT COUNT(*)
              FROM online_soup_messages messages
              WHERE messages.round_id = rounds.id
                AND messages.message_type = 'question'
                AND messages.answer IS NOT NULL
            ) >= 5`
  }
];

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

async function backfillSource(source: BackfillSource, rangeStart: Date, cutoff: Date) {
  const sourceParameters = Array.from(
    { length: (source.sql.match(/\?/g) ?? []).length / 2 },
    () => [rangeStart, cutoff]
  ).flat();
  await pool.query(
    `INSERT INTO user_behavior_daily_stats (stat_date, behavior_type, historical_count)
     SELECT DATE(DATE_ADD(occurred_at, INTERVAL 8 HOUR)), ?, COUNT(*)
     FROM (${source.sql}) behavior_source
     GROUP BY DATE(DATE_ADD(occurred_at, INTERVAL 8 HOUR))
     ON DUPLICATE KEY UPDATE historical_count = VALUES(historical_count)`,
    [source.type, ...sourceParameters]
  );
}

async function runHistoricalBackfill() {
  const [claimResult] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE user_behavior_tracking_state
     SET backfill_started_at = CURRENT_TIMESTAMP
     WHERE id = 1
       AND backfill_completed_at IS NULL
       AND (backfill_started_at IS NULL OR backfill_started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE))`
  );
  if (claimResult.affectedRows !== 1) return;
  try {
    const [[state]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT tracking_started_at FROM user_behavior_tracking_state WHERE id = 1 LIMIT 1"
    );
    const cutoff = new Date(state.tracking_started_at);
    const rangeStart = new Date(cutoff.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
    for (const source of backfillSources) {
      await backfillSource(source, rangeStart, cutoff);
      await wait(BACKFILL_STEP_DELAY_MS);
    }
    await pool.query(
      "UPDATE user_behavior_tracking_state SET backfill_completed_at = CURRENT_TIMESTAMP WHERE id = 1"
    );
    console.info("User behavior analytics historical backfill completed.");
  } catch (error) {
    await pool.query(
      "UPDATE user_behavior_tracking_state SET backfill_started_at = NULL WHERE id = 1 AND backfill_completed_at IS NULL"
    ).catch(() => undefined);
    console.error("User behavior analytics historical backfill failed:", error);
  }
}

export async function initializeUserBehaviorAnalytics() {
  await pool.query(
    `INSERT INTO user_behavior_tracking_state (id, tracking_started_at)
     VALUES (1, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id = id`
  );
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushUserBehaviorAnalytics();
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref();
  }
  if (!backfillTimer) {
    backfillTimer = setTimeout(() => {
      backfillTimer = null;
      void runHistoricalBackfill();
    }, BACKFILL_START_DELAY_MS);
    backfillTimer.unref();
  }
  if (!backfillRetryTimer) {
    backfillRetryTimer = setInterval(() => {
      void runHistoricalBackfill();
    }, 30 * 60_000);
    backfillRetryTimer.unref();
  }
}
