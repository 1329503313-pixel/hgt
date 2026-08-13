import { Router } from "express";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { getSticker, userOwnsSticker } from "./stickers.js";
import { settleOnlineSoupRound } from "./shellCurrency.js";
import { levelForExperience } from "./levelSystem.js";
import { canViewAllSoupContentRole, isSuperAdminRole, type UserRole } from "./roles.js";
import { parseGiftMessage } from "./gifts.js";
import { recordUserBehavior } from "./behaviorAnalytics.js";
import { buildAnswerChangeNotice, onlineSoupAnswerValues, type OnlineSoupAnswerValue } from "./onlineSoupAnswerChange.js";
import { canViewOnlineSoupHostMaterials, finalizeOnlineSoupRoundPanelPage, ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS, onlineSoupAiFinishDecision, onlineSoupAiProgressChange, onlineSoupAiProgressEvents, requiredOnlineSoupFinishVotes } from "./onlineSoupRoundPanel.js";
import { selectOnlineSoupHostSuccessor, type OnlineSoupHostCandidate } from "./onlineSoupHostSuccession.js";
import { AiServiceError, canRequestRoomAiHint, ensureAiSoupKeyFacts, runRoomAiFastAnswer, runRoomAiHint, runRoomAiTurn, splitKeyFactsForSoup, type RoomAiGameState } from "./game.js";
import { renderProgressiveHint, roomAiProgressFeedback, roomAiQuestionRisks, shouldPublishRoomAiStallHint } from "./gameLogic.js";
import { recordChatMessageForRateLimit, stickerCooldownMessage } from "./chatMessageRateLimit.js";
import { parseOnlineSoupAiHonors, selectOnlineSoupAiHonors } from "./onlineSoupHonors.js";

type OnlineUser = { id: string; nickname: string; role: UserRole };
type RoomEventEmitter = (roomId: string, event: string, payload: unknown) => void;
type LobbyEventEmitter = (event: string, payload: unknown) => void;

let emitRoomEvent: RoomEventEmitter = () => undefined;
let emitLobbyEvent: LobbyEventEmitter = () => undefined;
export function setOnlineSoupEventEmitter(emitter: RoomEventEmitter) {
  emitRoomEvent = emitter;
}
export function setOnlineSoupLobbyEventEmitter(emitter: LobbyEventEmitter) {
  emitLobbyEvent = emitter;
}

const router = Router();
const HOST_ONLINE_SECONDS = 75;
export const HOST_OFFLINE_GRACE_MINUTES = 15;
const MESSAGE_PAGE_SIZE = 100;
export const ONLINE_SOUP_PARTICIPANT_CAPACITY = 11;
export const ONLINE_SOUP_PLAYER_CAPACITY = ONLINE_SOUP_PARTICIPANT_CAPACITY - 1;
const PLAYER_CAPACITY = ONLINE_SOUP_PLAYER_CAPACITY;
const SPECTATOR_CAPACITY = 20;
const answerValues = onlineSoupAnswerValues;
const aiAnswerMap: Record<string, OnlineSoupAnswerValue> = {
  "是": "yes", "不是": "no", "是也不是": "both", "不知道": "unknown", "不重要": "irrelevant"
};
const activeAiRooms = new Set<string>();
const AI_PLAY_ADVICE_CARD = [
  "提问尽量完整，明确写出人物、物品和行为。",
  "尽量使用可以回答“是 / 不是”的直接问句。",
  "少用反问、双重否定和含糊的“他 / 它 / 这件事”。",
  "复杂猜想请拆成一次一个判断，更容易获得准确回答和进度。",
].join("\n");
const badgeNames: Record<string, string[]> = {
  publish: ["熬汤新秀", "熬汤达人", "熬汤大师"],
  insight: ["灵光乍现", "洞察之眼", "全知全能"],
  favorite: ["私藏一汤", "藏汤百味", "万汤宝库"],
  like: ["一点心意", "热情汤客", "点赞如潮"],
  login: ["三日来客", "一月常客", "百日不辍"],
  creatorLike: ["小有名气", "我是明星", "人气王"],
  creatorFavorite: ["值得珍藏", "收藏达人", "镇馆之汤"],
  receivedComment: ["初有回响", "热议之汤", "话题之王"],
  commenter: ["初次开麦", "评论达人", "妙语连珠"],
  aiClear: ["初识汤灵", "汤灵搭档", "AI破局王"],
  heat: ["热力小子", "炽热瞩目", "狂热巅峰", "登峰造极"],
  collectionValue: ["收藏家", "大收藏家", "收藏之王", "收藏之神"],
  cardCollector: ["卡牌爱好者", "卡牌收集者", "卡牌大师", "袖里乾坤"],
  legendCard: ["传说降临I", "传说降临II", "传说降临III"],
  threeStarEpic: ["金色传说！", "金色传说！", "金色传说！"],
  threeStarLegend: ["炫彩传说！", "炫彩传说！", "炫彩传说！", "炫彩传说！"],
  packCompletion: ["整套收集I", "整套收集II", "整套收集III", "整套收集IV"],
  packAllThreeStar: ["土豪真爱粉", "土豪真爱粉", "土豪真爱粉", "土豪真爱粉"],
  shellWealth: ["小土豪", "大富翁", "百万富翁", "亿万富豪"],
  shellBalance: ["贝壳为王", "贝壳为王", "贝壳为王"],
  excellentAuthor: ["优秀作者", "优秀作者", "优秀作者"]
};

function userOf(req: any): OnlineUser | null {
  return req.user ?? null;
}

function fail(res: any, status: number, error: string, code?: string) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}

export function roomInviteToken(roomId: string) {
  return createHmac("sha256", config.sessionSecret)
    .update(`online-soup-invite:${roomId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function validRoomInviteToken(roomId: string, token: string) {
  const expected = roomInviteToken(roomId);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function iso(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

function jsonList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function memberBadge(keyValue: unknown, iconValue: unknown, specialName: unknown, specialTier: unknown) {
  if (!keyValue || !iconValue) return null;
  const key = String(keyValue);
  if (specialName) {
    const tier = String(specialTier) === "epic" ? "epic" : "legend";
    return { key, iconUrl: String(iconValue), name: String(specialName), tier };
  }
  const [series, rawTier] = key.split(":");
  const tier = rawTier === "rare" || rawTier === "epic" || rawTier === "legend" ? rawTier : "normal";
  const tierIndex = tier === "normal" ? 0 : tier === "rare" ? 1 : tier === "epic" ? 2 : 3;
  return { key, iconUrl: String(iconValue), name: badgeNames[series]?.[tierIndex] ?? key, tier };
}

async function roomByCode(code: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT r.*, u.nickname AS host_name, s.title AS soup_title
     FROM online_soup_rooms r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN soups s ON s.id = r.current_soup_id
     WHERE r.room_code = ? LIMIT 1`,
    [code]
  );
  return rows[0] ?? null;
}

async function roomById(id: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT r.*, u.nickname AS host_name, s.title AS soup_title, s.type AS soup_type,
       s.surface AS soup_surface, s.supplemental_surfaces AS soup_supplemental_surfaces,
       s.bottom AS soup_bottom, s.supplemental_bottoms AS soup_supplemental_bottoms,
       s.host_manual AS soup_manual, s.enable_ai_game AS soup_enable_ai_game,
       soup_creator.role AS soup_creator_role,
       cr.published_surface_indices, cr.published_bottom_indices, cr.ai_progress, cr.ai_hint_count
     FROM online_soup_rooms r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN soups s ON s.id = r.current_soup_id
     LEFT JOIN users soup_creator ON soup_creator.id = s.creator_id
     LEFT JOIN online_soup_rounds cr ON cr.id = r.current_round_id
     WHERE r.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

async function activeMember(roomId: string, userId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM online_soup_members WHERE room_id = ? AND user_id = ? AND is_active = 1 LIMIT 1",
    [roomId, userId]
  );
  return rows[0] ?? null;
}

const lobbyChangingReasons = new Set([
  "room_created", "member_joined", "member_left", "room_closed",
  "member_kicked", "host_transferred", "soup_selected", "round_started", "round_ended"
]);

function notifyLobby(reason: string) {
  emitLobbyEvent("online_soup_lobby_changed", { reason, at: new Date().toISOString() });
}

function notifyRoom(roomId: string, reason: string, details: Record<string, unknown> = {}) {
  emitRoomEvent(roomId, "online_soup_changed", { roomId, reason, ...details, at: new Date().toISOString() });
  if (lobbyChangingReasons.has(reason)) notifyLobby(reason);
}

type OnlineSoupActivityType = "chat" | "clue" | "progress";

async function recordRoomActivity(
  roomId: string,
  activityType: OnlineSoupActivityType,
  actorUserId: string | null,
  referenceId: string | null,
  db: mysql.Pool | mysql.PoolConnection = pool
) {
  const [result] = await db.query<mysql.ResultSetHeader>(
    `INSERT INTO online_soup_activities (id, room_id, actor_user_id, activity_type, reference_id)
     VALUES (?, ?, ?, ?, ?)`,
    [nanoid(), roomId, actorUserId, activityType, referenceId]
  );
  return String(result.insertId);
}

async function roomActivitySummary(roomId: string, userId: string, lastReadSequence: string | number) {
  const [[summary]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(MAX(activity_sequence), 0) AS latest_sequence,
       SUM(activity_sequence > ? AND (actor_user_id IS NULL OR actor_user_id <> ?)) AS unread_count
     FROM online_soup_activities WHERE room_id = ?`,
    [lastReadSequence, userId, roomId]
  );
  return {
    latestActivitySequence: String(summary?.latest_sequence ?? 0),
    unreadCount: Number(summary?.unread_count ?? 0)
  };
}

async function releaseStaleSeats(roomId?: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  await db.query(
    `UPDATE online_soup_members SET is_active = 0, left_at = NOW()
     WHERE is_active = 1 AND member_role <> 'host' AND last_seen_at < NOW() - INTERVAL 2 MINUTE
       AND NOT EXISTS (
         SELECT 1 FROM online_soup_rooms r
         WHERE r.id = online_soup_members.room_id AND r.host_id = online_soup_members.user_id
       )
       ${roomId ? "AND room_id = ?" : ""}`,
    roomId ? [roomId] : []
  );
}

type ActiveHostSuccessor = OnlineSoupHostCandidate & {
  previousRole: "player" | "spectator";
  nickname: string;
};

async function activeHostSuccessor(roomId: string, currentHostId: string, db: mysql.PoolConnection) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT m.user_id AS userId, m.member_role AS previousRole, m.joined_at AS joinedAt,
       u.experience, u.nickname
     FROM online_soup_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? AND m.user_id <> ? AND m.is_active = 1
     FOR UPDATE`,
    [roomId, currentHostId]
  );
  return selectOnlineSoupHostSuccessor<ActiveHostSuccessor>(rows.map((row) => ({
    userId: String(row.userId),
    experience: row.experience,
    joinedAt: row.joinedAt,
    previousRole: String(row.previousRole) as "player" | "spectator",
    nickname: String(row.nickname)
  })));
}

async function transferDepartedHost(
  roomId: string,
  previousHostId: string,
  successor: ActiveHostSuccessor,
  db: mysql.PoolConnection,
  hostMode: "human" | "ai" = "human"
) {
  await db.query(
    `UPDATE online_soup_rooms
     SET host_id = ?, host_last_seen_at = NOW(), host_grace_started_at = NULL
     WHERE id = ? AND host_id = ?`,
    [successor.userId, roomId, previousHostId]
  );
  await db.query(
    `UPDATE online_soup_members SET is_active = 0, left_at = NOW()
     WHERE room_id = ? AND user_id = ? AND is_active = 1`,
    [roomId, previousHostId]
  );
  await db.query(
    `UPDATE online_soup_members SET member_role = ?, last_seen_at = NOW()
     WHERE room_id = ? AND user_id = ? AND is_active = 1`,
    [hostMode === "ai" ? "player" : "host", roomId, successor.userId]
  );
}

export async function cleanupOnlineSoupStaleSeats() {
  const [staleRooms] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT m.room_id FROM online_soup_members m
     JOIN online_soup_rooms r ON r.id = m.room_id
     WHERE m.is_active = 1 AND m.member_role <> 'host' AND m.user_id <> r.host_id
       AND m.last_seen_at < NOW() - INTERVAL 2 MINUTE`
  );
  await releaseStaleSeats();
  for (const row of staleRooms) notifyRoom(String(row.room_id), "member_left");
}

export async function cleanupOnlineSoupInactiveHostRooms() {
  const [staleRooms] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id
     FROM online_soup_rooms
     WHERE status <> 'closed'
       AND COALESCE(host_grace_started_at, host_last_seen_at) < NOW() - INTERVAL ${HOST_OFFLINE_GRACE_MINUTES} MINUTE`
  );
  for (const staleRoom of staleRooms) {
    const connection = await pool.getConnection();
    let previousHostId = "";
    let successor: ActiveHostSuccessor | null = null;
    let endedRoundId: string | null = null;
    let clearedSoup = false;
    try {
      await connection.beginTransaction();
      const [[room]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT r.*, u.nickname AS host_name
         FROM online_soup_rooms r JOIN users u ON u.id = r.host_id
         WHERE r.id = ? AND r.status <> 'closed'
           AND COALESCE(r.host_grace_started_at, r.host_last_seen_at) < NOW() - INTERVAL ${HOST_OFFLINE_GRACE_MINUTES} MINUTE
         FOR UPDATE`,
        [staleRoom.id]
      );
      if (!room) {
        await connection.rollback();
        continue;
      }
      previousHostId = String(room.host_id);
      await releaseStaleSeats(String(room.id), connection);
      successor = await activeHostSuccessor(String(room.id), previousHostId, connection);

      if (String(room.status) === "playing" && room.current_round_id) {
        endedRoundId = String(room.current_round_id);
        await connection.query(
          "UPDATE online_soup_rounds SET status = 'ended', ended_at = NOW() WHERE id = ? AND status = 'playing'",
          [endedRoundId]
        );
        await settleOnlineSoupRound(connection, endedRoundId);
        await systemMessage(
          String(room.id),
          endedRoundId,
          `房主离线已满${HOST_OFFLINE_GRACE_MINUTES}分钟，本轮已结束，已取消当前海龟汤`,
          connection
        );
      }
      clearedSoup = Boolean(room.current_soup_id || room.current_round_id || String(room.status) !== "preparing");
      if (clearedSoup) {
        await connection.query(
          `UPDATE online_soup_rooms
           SET status = 'preparing', current_soup_id = NULL, current_round_id = NULL
           WHERE id = ?`,
          [room.id]
        );
      }
      if (successor) {
        await transferDepartedHost(String(room.id), previousHostId, successor, connection, String(room.host_mode ?? "human") === "ai" ? "ai" : "human");
        await systemMessage(
          String(room.id),
          null,
          `${String(successor.nickname)} 已按等级和加入时间接任房主`,
          connection
        );
      } else if (clearedSoup) {
        await systemMessage(String(room.id), null, "暂无在线成员可接任房主，房间将继续保留", connection);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (endedRoundId) {
      const activitySequence = await recordRoomActivity(String(staleRoom.id), "progress", null, endedRoundId);
      notifyRoom(String(staleRoom.id), "round_ended", {
        cause: "host_offline_timeout",
        activitySequence,
        activityType: "progress"
      });
    } else if (clearedSoup) {
      notifyRoom(String(staleRoom.id), "soup_selected", { cause: "host_offline_timeout", soupId: null });
    }
    if (successor) {
      notifyRoom(String(staleRoom.id), "host_transferred", {
        cause: "host_offline_timeout",
        previousHostId,
        newHostId: successor.userId,
        previousRole: String(successor.previousRole),
        newHostNickname: String(successor.nickname)
      });
    }
  }
}

/** 服务重启后继续处理已入队或已先返回答案但尚未完成进度核对的问题。 */
export async function resumePendingOnlineSoupAiQuestions() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT m.room_id
     FROM online_soup_messages m
     JOIN online_soup_rounds r ON r.id = m.round_id
     WHERE m.message_type = 'question'
       AND m.ai_status IN ('pending','answering','scoring')
       AND r.status = 'playing' AND r.host_mode = 'ai'`,
  );
  for (const row of rows) void processRoomAiQuestions(String(row.room_id));
}

/** 服务启动后为已经达到新门槛、但尚未生成投票的进行中回合补开投票。 */
export async function resumeEligibleOnlineSoupAiFinishVotes() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT r.id AS round_id, r.room_id
     FROM online_soup_rounds r
     JOIN online_soup_rooms rooms ON rooms.id = r.room_id
     LEFT JOIN online_soup_finish_votes votes ON votes.round_id = r.id
     WHERE r.status = 'playing' AND r.host_mode = 'ai' AND rooms.status = 'playing'
       AND r.ai_progress >= ? AND r.ai_progress < 100 AND votes.id IS NULL`,
    [ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS],
  );
  for (const row of rows) {
    const connection = await pool.getConnection();
    let opened = false;
    try {
      await connection.beginTransaction();
      const [[round]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT status, host_mode, ai_progress FROM online_soup_rounds
         WHERE id = ? FOR UPDATE`,
        [row.round_id],
      );
      if (
        round?.status === "playing"
        && round.host_mode === "ai"
        && Number(round.ai_progress ?? 0) >= ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS
        && Number(round.ai_progress ?? 0) < 100
      ) {
        opened = await openAiFinishVote(connection, String(row.room_id), String(row.round_id));
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    if (opened) void notifyRoom(String(row.room_id), "finish_vote_opened", { roundId: String(row.round_id) });
  }
}

async function touch(roomId: string, user: OnlineUser, isHost: boolean) {
  await pool.query(
    `UPDATE online_soup_members SET last_seen_at = NOW()
     WHERE room_id = ? AND user_id = ? AND is_active = 1
       AND last_seen_at < NOW() - INTERVAL 45 SECOND`,
    [roomId, user.id]
  );
  if (isHost) {
    await pool.query(
      `UPDATE online_soup_rooms SET host_last_seen_at = NOW(), host_grace_started_at = NULL
       WHERE id = ? AND host_id = ? AND status <> 'closed'
         AND (host_last_seen_at < NOW() - INTERVAL 45 SECOND OR host_grace_started_at IS NOT NULL)`,
      [roomId, user.id]
    );
  }
}

async function systemMessage(roomId: string, roundId: string | null, content: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  await db.query(
    "INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content) VALUES (?, ?, ?, NULL, 'system', ?)",
    [nanoid(), roomId, roundId, content]
  );
}

async function openAiFinishVote(
  db: mysql.PoolConnection,
  roomId: string,
  roundId: string,
) {
  const voteId = nanoid();
  const [inserted] = await db.query<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO online_soup_finish_votes (id, round_id, room_id)
     VALUES (?, ?, ?)`,
    [voteId, roundId, roomId],
  );
  if (inserted.affectedRows !== 1) return false;
  await db.query(
    `INSERT INTO online_soup_finish_vote_members (vote_id, user_id)
     SELECT ?, user_id FROM online_soup_members
     WHERE room_id = ? AND is_active = 1 AND member_role = 'player'`,
    [voteId, roomId],
  );
  await systemMessage(roomId, roundId, `推理进度已达到 ${ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS}%，正式玩家可投票选择查看汤底或继续游戏`, db);
  return true;
}

async function completeAiRound(
  db: mysql.PoolConnection,
  roomId: string,
  roundId: string,
  soupId: string,
  reason: "vote" | "progress",
) {
  const [[round]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT status, ai_revealed_supplements FROM online_soup_rounds WHERE id = ? LIMIT 1 FOR UPDATE",
    [roundId],
  );
  if (!round || round.status !== "playing") return false;
  const [[soup]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT bottom, supplemental_bottoms, host_manual FROM soups WHERE id = ? LIMIT 1",
    [soupId],
  );
  if (!soup) throw new Error("海龟汤不存在");

  const revealedSupplements = round.ai_revealed_supplements
    ? (typeof round.ai_revealed_supplements === "string"
      ? JSON.parse(round.ai_revealed_supplements)
      : round.ai_revealed_supplements)
    : { surfaces: [] };
  const bottoms = [String(soup.bottom), ...jsonList<string>(soup.supplemental_bottoms)];
  await db.query(
    `INSERT INTO online_soup_messages
      (id, room_id, round_id, sender_id, message_type, content, content_index)
     VALUES ${bottoms.map(() => "(?, ?, ?, NULL, 'bottom', ?, ?)").join(", ")}`,
    bottoms.flatMap((content, index) => [nanoid(), roomId, roundId, content, index]),
  );
  if (soup.host_manual) {
    await db.query(
      "INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content) VALUES (?, ?, ?, NULL, 'manual', ?)",
      [nanoid(), roomId, roundId, String(soup.host_manual)],
    );
  }
  await db.query(
    `UPDATE online_soup_rounds
     SET status = 'ended', ai_status = 'completed', published_surface_indices = ?,
       published_bottom_indices = ?, ended_at = NOW()
     WHERE id = ?`,
    [
      JSON.stringify(jsonList<number>(revealedSupplements?.surfaces)),
      JSON.stringify(bottoms.map((_, index) => index)),
      roundId,
    ],
  );
  await db.query("UPDATE online_soup_rooms SET status = 'ended' WHERE id = ?", [roomId]);
  await db.query(
    "UPDATE online_soup_messages SET ai_status = 'cancelled' WHERE round_id = ? AND ai_status IN ('pending','answering','scoring')",
    [roundId],
  );
  await db.query(
    `UPDATE online_soup_finish_votes
     SET status = ?, closed_at = NOW()
     WHERE round_id = ? AND status = 'open'`,
    [reason === "progress" ? "auto_completed" : "passed", roundId],
  );
  await db.query(
    `INSERT IGNORE INTO online_soup_completions (round_id, user_id, soup_id)
     SELECT ?, user_id, ? FROM online_soup_members
     WHERE room_id = ? AND is_active = 1 AND member_role = 'player'`,
    [roundId, soupId, roomId],
  );
  await db.query(
    `INSERT IGNORE INTO soup_access_grants (id, soup_id, user_id, granted_by)
     SELECT CONCAT('online-', LEFT(SHA2(CONCAT(?, ':', user_id), 256), 57)), ?, user_id, 'system'
     FROM online_soup_members WHERE room_id = ? AND is_active = 1 AND member_role = 'player'`,
    [roundId, soupId, roomId],
  );
  await systemMessage(
    roomId,
    roundId,
    reason === "progress"
      ? "推理进度达到 100%，已自动发布汤底，本轮游戏结束"
      : "达到投票门槛，已发布汤底，本轮游戏结束",
    db,
  );
  const [honorQuestions] = await db.query<mysql.RowDataPacket[]>(
    `SELECT m.id, m.message_sequence, m.question_number, m.sender_id, m.content, m.answer,
       m.ai_progress_delta, u.nickname, u.avatar IS NOT NULL AS has_avatar
     FROM online_soup_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.round_id = ? AND m.message_type = 'question' AND m.ai_status = 'completed'
       AND m.recalled_at IS NULL AND m.ai_progress_delta > 0
     ORDER BY m.message_sequence ASC`,
    [roundId],
  );
  const honors = selectOnlineSoupAiHonors(honorQuestions.map((question) => ({
    id: String(question.id),
    sequence: String(question.message_sequence),
    questionNumber: Number(question.question_number ?? 0),
    senderId: String(question.sender_id),
    senderNickname: String(question.nickname),
    senderAvatar: question.has_avatar
      ? `/api/media/users/${encodeURIComponent(String(question.sender_id))}/avatar`
      : null,
    content: String(question.content),
    answer: String(question.answer ?? ""),
    progressDelta: Number(question.ai_progress_delta ?? 0),
  })));
  if (honors) {
    await db.query(
      `INSERT INTO online_soup_messages
       (id, room_id, round_id, sender_id, message_type, content)
       VALUES (?, ?, ?, NULL, 'ai_honor', ?)`,
      [nanoid(), roomId, roundId, JSON.stringify(honors)],
    );
  }
  return true;
}

async function settleOnlineSoupRoundAfterCommit(roundId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await settleOnlineSoupRound(connection, roundId);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function roomAiState(round: mysql.RowDataPacket): RoomAiGameState {
  return {
    messages: jsonList<{ role: "user" | "assistant"; content: string }>(round.ai_messages),
    revealedKeys: jsonList<number>(round.ai_revealed_keys),
    revealedAtomicFactIds: jsonList<number>(round.ai_revealed_atoms),
    revealedSupplements: round.ai_revealed_supplements
      ? (typeof round.ai_revealed_supplements === "string" ? JSON.parse(round.ai_revealed_supplements) : round.ai_revealed_supplements)
      : { surfaces: [], bottoms: [] },
    progress: Number(round.ai_progress ?? 0),
    hintCount: Number(round.ai_hint_count ?? 0),
  };
}

const AI_STALL_QUESTION_THRESHOLD = 10;

async function shouldPublishStallHint(
  db: mysql.PoolConnection,
  roundId: string,
  messageId: string,
) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT ai_progress_delta FROM online_soup_messages
     WHERE round_id = ? AND message_type = 'question' AND ai_status = 'completed'
       AND recalled_at IS NULL AND message_sequence <= (
         SELECT message_sequence FROM online_soup_messages WHERE id = ?
       )
     ORDER BY message_sequence DESC LIMIT ${AI_STALL_QUESTION_THRESHOLD + 1}`,
    [roundId, messageId],
  );
  return shouldPublishRoomAiStallHint(
    rows.map((row) => Number(row.ai_progress_delta ?? 0)),
    AI_STALL_QUESTION_THRESHOLD,
  );
}

async function failAiQuestion(messageId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "AI 服务暂时不可用，请稍后重试";
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT room_id, round_id, answer FROM online_soup_messages WHERE id = ? LIMIT 1", [messageId]);
  await pool.query(
    "UPDATE online_soup_messages SET ai_status = 'failed', ai_error = ? WHERE id = ? AND ai_status IN ('pending','answering','scoring')",
    [message.slice(0, 255), messageId]
  );
  if (rows[0]?.round_id) {
    await pool.query(
      "UPDATE online_soup_rounds SET ai_status = 'failed' WHERE id = ? AND status = 'playing'",
      [rows[0].round_id],
    );
  }
  if (rows[0]) void notifyRoom(String(rows[0].room_id), "answer_changed", {
    messageId,
    answer: rows[0].answer ? String(rows[0].answer) : null,
    aiStatus: "failed",
    aiError: message.slice(0, 255),
    activityType: "progress"
  });
}

async function processRoomAiQuestions(roomId: string) {
  if (activeAiRooms.has(roomId)) return;
  activeAiRooms.add(roomId);
  try {
    while (true) {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT m.id, m.content, m.answer, m.sender_id, m.round_id, r.soup_id, r.status AS round_status, r.host_mode,
           r.ai_messages, r.ai_revealed_keys, r.ai_revealed_atoms, r.ai_revealed_supplements,
           r.ai_progress, r.ai_version, r.ai_hint_count
         FROM online_soup_messages m
         JOIN online_soup_rounds r ON r.id = m.round_id
         WHERE m.room_id = ? AND m.message_type = 'question' AND m.ai_status IN ('pending','answering','scoring')
         ORDER BY m.message_sequence ASC LIMIT 1`,
        [roomId]
      );
      const pending = rows[0];
      if (!pending) break;
      if (pending.round_status !== "playing" || pending.host_mode !== "ai") {
        await pool.query("UPDATE online_soup_messages SET ai_status = 'cancelled' WHERE id = ?", [pending.id]);
        continue;
      }
      await pool.query("UPDATE online_soup_rounds SET ai_status = 'processing' WHERE id = ?", [pending.round_id]);
      const risks = roomAiQuestionRisks(String(pending.content));
      try {
        let publishedAnswer = pending.answer ? String(pending.answer) : null;
        const complexQuestion = risks.length > 0;
        const aiState = roomAiState(pending);
        let concurrentReview: Promise<
          { ok: true; turn: Awaited<ReturnType<typeof runRoomAiTurn>> }
          | { ok: false; error: unknown }
        > | null = null;
        if (!publishedAnswer && !complexQuestion) {
          await pool.query("UPDATE online_soup_messages SET ai_status = 'answering', ai_error = NULL WHERE id = ?", [pending.id]);
          void notifyRoom(roomId, "answer_changed", { messageId: String(pending.id), aiStatus: "answering" });
          // 快速五态回答与完整进度复核互不依赖，并行启动可避免两次模型耗时串行叠加。
          // 完整复核仍独立判断最终回答和事实匹配，快速结果不会锁死准确性。
          concurrentReview = runRoomAiTurn(
            String(pending.soup_id),
            String(pending.content),
            aiState,
          ).then(
            (turn) => ({ ok: true as const, turn }),
            (error: unknown) => ({ ok: false as const, error }),
          );
          try {
            const fast = await runRoomAiFastAnswer(String(pending.soup_id), String(pending.content), aiState);
            const fastAnswer = aiAnswerMap[fast.answer];
            if (fastAnswer) {
              const [updated] = await pool.query<mysql.ResultSetHeader>(
                "UPDATE online_soup_messages SET answer = ?, ai_status = 'scoring', ai_error = NULL WHERE id = ? AND ai_status = 'answering'",
                [fastAnswer, pending.id],
              );
              if (updated.affectedRows === 1) {
                publishedAnswer = fastAnswer;
                void notifyRoom(roomId, "answer_changed", {
                  messageId: String(pending.id), answer: fastAnswer, aiStatus: "scoring", aiError: null,
                });
              }
            }
          } catch (error) {
            console.warn("Fast AI answer unavailable; falling back to full review:", error instanceof Error ? error.message : error);
          }
        }
        if (!publishedAnswer) {
          await pool.query("UPDATE online_soup_messages SET ai_status = 'scoring', ai_error = NULL WHERE id = ? AND ai_status IN ('pending','answering')", [pending.id]);
          void notifyRoom(roomId, "answer_changed", { messageId: String(pending.id), aiStatus: "scoring" });
        }
        const review = concurrentReview
          ? await concurrentReview
          : { ok: true as const, turn: await runRoomAiTurn(
              String(pending.soup_id),
              String(pending.content),
              aiState,
              { preliminaryAnswer: publishedAnswer ? Object.entries(aiAnswerMap).find(([, value]) => value === publishedAnswer)?.[0] : null },
            ) };
        if (!review.ok) throw review.error;
        const turn = review.turn;
        const answer = aiAnswerMap[turn.answer];
        const progressChange = onlineSoupAiProgressChange(pending.ai_progress, turn.progress);
        if (!answer) throw new Error("AI 返回了不支持的主持回答");
        const connection = await pool.getConnection();
        let ended = false;
        let voteOpened = false;
        try {
          await connection.beginTransaction();
          const [[locked]] = await connection.query<mysql.RowDataPacket[]>(
            `SELECT m.ai_status, r.status AS round_status, r.host_mode, r.ai_version
             FROM online_soup_messages m JOIN online_soup_rounds r ON r.id = m.round_id
             WHERE m.id = ? FOR UPDATE`, [pending.id]
          );
          if (!locked || !["pending", "answering", "scoring"].includes(String(locked.ai_status)) || locked.round_status !== "playing" || locked.host_mode !== "ai" || Number(locked.ai_version) !== Number(pending.ai_version)) {
            await connection.rollback();
            continue;
          }
          await connection.query(
            `UPDATE online_soup_rounds SET ai_messages = ?, ai_revealed_keys = ?, ai_revealed_atoms = ?,
               ai_revealed_supplements = ?, ai_progress = ?, ai_version = ai_version + 1,
               ai_status = ?, published_surface_indices = ? WHERE id = ?`,
            [JSON.stringify(turn.messages), JSON.stringify(turn.revealedKeys), JSON.stringify(turn.revealedAtomicFactIds),
              JSON.stringify(turn.revealedSupplements), progressChange.after, "idle",
              JSON.stringify(turn.revealedSupplements.surfaces), pending.round_id]
          );
          const baseFeedback = roomAiProgressFeedback(
            progressChange.delta,
            turn.factMatches.filter((match) => match.grade === "DIRECT" || match.grade === "STRONG").length,
            turn.factMatches.filter((match) => match.grade === "WEAK").length,
            risks,
          );
          const feedback = {
            ...baseFeedback,
            text: publishedAnswer && answer !== publishedAnswer
              ? `AI 复核后修正了主持结论。${baseFeedback.text}`
              : baseFeedback.text,
          };
          await connection.query(
            "UPDATE online_soup_messages SET answer = ?, ai_status = 'completed', ai_error = NULL, ai_progress_delta = ?, ai_progress_after = ?, ai_feedback = ? WHERE id = ?",
            [answer ?? "both", progressChange.delta || null, progressChange.after, feedback.text, pending.id]
          );
          for (const index of turn.newlyRevealedSurfaceIndices) {
            const [[soup]] = await connection.query<mysql.RowDataPacket[]>("SELECT supplemental_surfaces FROM soups WHERE id = ?", [pending.soup_id]);
            const content = jsonList<string>(soup?.supplemental_surfaces)[index];
            if (content) await connection.query(
              "INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content, content_index) VALUES (?, ?, ?, NULL, 'supplemental_surface', ?, ?)",
              [nanoid(), roomId, pending.round_id, content, index]
            );
          }
          const progressEvents = onlineSoupAiProgressEvents(pending.ai_progress, progressChange.after);
          for (const event of progressEvents) {
            if (event.type !== "milestone") continue;
            await systemMessage(roomId, String(pending.round_id), `推理进度达到 ${event.progress}%，离真相又近了一步`, connection);
          }
          if (onlineSoupAiFinishDecision(progressChange.after, 0, 0) === "progress") {
            ended = await completeAiRound(
              connection,
              roomId,
              String(pending.round_id),
              String(pending.soup_id),
              "progress",
            );
          } else if (progressChange.after >= ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS) {
            voteOpened = await openAiFinishVote(connection, roomId, String(pending.round_id));
          }
          if (!ended && progressChange.delta === 0 && await shouldPublishStallHint(connection, String(pending.round_id), String(pending.id))) {
            const rescueHint = renderProgressiveHint("因果关系", 2);
            const rescueId = nanoid();
            await connection.query(
              "INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content) VALUES (?, ?, ?, NULL, 'clue', ?)",
              [rescueId, roomId, pending.round_id, `连续 10 题没有发现新信息。AI 建议：${rescueHint}`],
            );
          }
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally { connection.release(); }
        const activitySequence = await recordRoomActivity(roomId, "progress", null, String(pending.id));
        const baseFeedback = roomAiProgressFeedback(
          progressChange.delta,
          turn.factMatches.filter((match) => match.grade === "DIRECT" || match.grade === "STRONG").length,
          turn.factMatches.filter((match) => match.grade === "WEAK").length,
          risks,
        );
        void notifyRoom(roomId, "answer_changed", {
          messageId: String(pending.id),
          answer: answer ?? "both",
          aiStatus: "completed",
          aiError: null,
          aiProgress: progressChange.after,
          aiProgressDelta: progressChange.delta || null,
          aiProgressAfter: progressChange.after,
          aiFeedback: publishedAnswer && answer !== publishedAnswer
            ? `AI 复核后修正了主持结论。${baseFeedback.text}`
            : baseFeedback.text,
          activitySequence,
          activityType: "progress"
        });
        if (ended) {
          void notifyRoom(roomId, "round_ended", {
            messageId: String(pending.id),
            aiProgress: progressChange.after,
            activitySequence,
            activityType: "progress",
          });
          void settleOnlineSoupRoundAfterCommit(String(pending.round_id)).catch((error) => {
            console.error("Online soup AI round settlement failed after completion", error);
          });
        }
        if (voteOpened) void notifyRoom(roomId, "finish_vote_opened", { roundId: String(pending.round_id) });
      } catch (error) {
        await failAiQuestion(String(pending.id), error);
      }
    }
  } finally {
    activeAiRooms.delete(roomId);
    const [remaining] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM online_soup_messages WHERE room_id = ? AND message_type = 'question' AND ai_status IN ('pending','answering','scoring') LIMIT 1",
      [roomId]
    );
    if (remaining[0]) void processRoomAiQuestions(roomId);
  }
}

async function requireMember(req: any, res: any) {
  const user = userOf(req);
  if (!user) { fail(res, 401, "请先登录", "LOGIN_REQUIRED"); return null; }
  const room = await roomById(req.params.roomId);
  if (!room || room.status === "closed") { fail(res, 404, "房间不存在或已关闭", "ROOM_CLOSED"); return null; }
  const member = await activeMember(room.id, user.id);
  if (!member && !isSuperAdminRole(user.role)) { fail(res, 403, "你尚未加入该房间", "NOT_MEMBER"); return null; }
  const isHost = room.host_id === user.id;
  await touch(room.id, user, isHost);
  if (isHost) room.host_last_seen_at = new Date();
  return { user, room, member };
}

async function requireHost(req: any, res: any) {
  const context = await requireMember(req, res);
  if (!context) return null;
  if (context.room.host_id !== context.user.id) { fail(res, 403, "仅房主可以执行此操作"); return null; }
  return context;
}

async function requireHumanHost(req: any, res: any) {
  const context = await requireHost(req, res);
  if (!context) return null;
  if (String(context.room.host_mode ?? "human") !== "human") { fail(res, 409, "当前由 AI 主持，不能执行真人主持操作"); return null; }
  return context;
}

function lobbyRoom(row: mysql.RowDataPacket) {
  const playerCount = Number(row.player_count ?? 0);
  const aiHosted = String(row.host_mode ?? "human") === "ai";
  return {
    id: String(row.id),
    code: String(row.room_code),
    name: String(row.name),
    type: String(row.room_type),
    status: String(row.status),
    hostMode: String(row.host_mode ?? "human"),
    host: { id: String(row.host_id), nickname: String(row.host_name) },
    soupTitle: row.soup_title ? String(row.soup_title) : null,
    playerCount,
    playerCapacity: PLAYER_CAPACITY,
    participantCount: playerCount + (aiHosted ? 0 : 1),
    participantCapacity: aiHosted ? PLAYER_CAPACITY : ONLINE_SOUP_PARTICIPANT_CAPACITY,
    hasPassword: row.room_type === "password",
    viewerRole: row.viewer_role ? String(row.viewer_role) : null,
    createdAt: iso(row.created_at)
  };
}

function mapRoomMessage(row: mysql.RowDataPacket, room: mysql.RowDataPacket) {
  const recalledAt = iso(row.recalled_at);
  const replyRecalledAt = iso(row.reply_recalled_at);
  const aiHonors = !recalledAt && row.message_type === "ai_honor"
    ? parseOnlineSoupAiHonors(row.content)
    : null;
  return {
    id: String(row.id),
    sequence: String(row.message_sequence),
    roundId: row.round_id ? String(row.round_id) : null,
    soupId: row.message_soup_id ? String(row.message_soup_id) : null,
    roundEnded: row.message_round_status === "ended",
    allBottomsPublished: row.message_round_status === "ended"
      && jsonList<number>(row.message_published_bottom_indices).length >= 1 + jsonList<string>(row.message_supplemental_bottoms).length,
    senderId: row.sender_id ? String(row.sender_id) : null,
    senderName: row.sender_name ? String(row.sender_name) : null,
    senderAvatar: row.sender_id && row.sender_has_avatar ? `/api/media/users/${encodeURIComponent(String(row.sender_id))}/avatar` : null,
    senderLevel: levelForExperience(row.sender_experience),
    senderEquippedBadge: memberBadge(row.sender_badge_key, row.sender_badge_icon_url, row.sender_special_badge_name, row.sender_special_badge_tier),
    type: String(row.message_type),
    content: recalledAt ? "" : aiHonors ? "AI 本轮评选" : String(row.content),
    aiHonors,
    gift: !recalledAt && row.message_type === "gift" ? parseGiftMessage(row.content) : null,
    stickerId: row.sticker_id ? String(row.sticker_id) : null,
    senderIsHost: Boolean(
      String(room.host_mode ?? "human") === "human"
      && row.sender_id
      && String(row.sender_id) === String(room.host_id)
    ),
    contentIndex: row.content_index == null ? null : Number(row.content_index),
    questionNumber: row.question_number == null ? null : Number(row.question_number),
    answer: row.answer ? String(row.answer) : null,
    aiStatus: String(row.ai_status ?? "none"),
    aiError: row.ai_error ? String(row.ai_error) : null,
    aiProgressDelta: row.ai_progress_delta == null ? null : Number(row.ai_progress_delta),
    aiProgressAfter: row.ai_progress_after == null ? null : Number(row.ai_progress_after),
    aiFeedback: row.ai_feedback ? String(row.ai_feedback) : null,
    targetMessageId: row.target_message_id ? String(row.target_message_id) : null,
    mentions: recalledAt ? [] : jsonList<{ userId: string; nickname: string }>(row.mentions_json),
    replyTo: row.reply_id ? {
      id: String(row.reply_id),
      sequence: String(row.reply_sequence),
      senderId: row.reply_sender_id ? String(row.reply_sender_id) : null,
      senderName: row.reply_sender_name ? String(row.reply_sender_name) : null,
      type: String(row.reply_message_type),
      content: replyRecalledAt ? "" : String(row.reply_content ?? ""),
      stickerId: row.reply_sticker_id ? String(row.reply_sticker_id) : null,
      recalledAt: replyRecalledAt
    } : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    recalledAt
  };
}

async function roomMessagePage(room: mysql.RowDataPacket, before?: string, limit = MESSAGE_PAGE_SIZE, after?: string) {
  const safeLimit = Math.max(1, Math.min(limit, MESSAGE_PAGE_SIZE));
  const params: Array<string | number> = [String(room.id)];
  const beforeClause = before ? "AND m.message_sequence < ?" : "";
  const afterClause = after ? "AND m.message_sequence > ?" : "";
  if (before) params.push(before);
  if (after) params.push(after);
  params.push(safeLimit + 1);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT m.*, u.nickname AS sender_name, u.experience AS sender_experience, u.avatar IS NOT NULL AS sender_has_avatar,
       u.equipped_badge_key AS sender_badge_key, u.equipped_badge_icon_url AS sender_badge_icon_url,
       sender_lb.name AS sender_special_badge_name, sender_lb.tier AS sender_special_badge_tier,
       r.soup_id AS message_soup_id, r.status AS message_round_status,
       r.published_bottom_indices AS message_published_bottom_indices,
       ms.supplemental_bottoms AS message_supplemental_bottoms,
       reply.id AS reply_id, reply.message_sequence AS reply_sequence,
       reply.sender_id AS reply_sender_id, reply_user.nickname AS reply_sender_name,
       reply.message_type AS reply_message_type, reply.content AS reply_content,
       reply.sticker_id AS reply_sticker_id, reply.recalled_at AS reply_recalled_at
     FROM online_soup_messages m LEFT JOIN users u ON u.id = m.sender_id
     LEFT JOIN legendary_badges sender_lb ON u.equipped_badge_key = CONCAT('legendary:', sender_lb.id)
     LEFT JOIN online_soup_rounds r ON r.id = m.round_id
     LEFT JOIN soups ms ON ms.id = r.soup_id
     LEFT JOIN online_soup_messages reply ON reply.id = m.reply_to_message_id AND reply.room_id = m.room_id
     LEFT JOIN users reply_user ON reply_user.id = reply.sender_id
     WHERE m.room_id = ? ${beforeClause} ${afterClause}
     ORDER BY m.message_sequence ${after ? "ASC" : "DESC"} LIMIT ?`,
    params
  );
  const hasMore = rows.length > safeLimit;
  if (hasMore) rows.pop();
  if (!after) rows.reverse();
  return {
    messages: rows.map((row) => mapRoomMessage(row, room)),
    hasMore,
    nextCursor: hasMore && rows.length
      ? String(after ? rows[rows.length - 1].message_sequence : rows[0].message_sequence)
      : null
  };
}

async function roomSnapshot(roomId: string, viewer: OnlineUser, knownRoom?: mysql.RowDataPacket, includeMessages = true) {
  const room = knownRoom ?? await roomById(roomId);
  if (!room) return null;
  const [[memberRows], messagePage, finishVote] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
    `SELECT m.user_id, m.member_role, m.joined_at, m.last_seen_at, u.nickname, u.experience, u.avatar IS NOT NULL AS has_avatar,
       u.equipped_badge_key, u.equipped_badge_icon_url, lb.name AS special_badge_name, lb.tier AS special_badge_tier
     FROM online_soup_members m JOIN users u ON u.id = m.user_id
     LEFT JOIN legendary_badges lb ON u.equipped_badge_key = CONCAT('legendary:', lb.id)
     WHERE m.room_id = ? AND m.is_active = 1 ORDER BY FIELD(m.member_role, 'host','player','spectator'), m.joined_at`,
    [roomId]
    ),
    includeMessages ? roomMessagePage(room) : Promise.resolve(null),
    room.current_round_id
      ? (async () => {
          const [rows] = await pool.query<mysql.RowDataPacket[]>(
            `SELECT v.id, v.status, v.opened_at,
               COUNT(vm.user_id) AS eligible_count,
               SUM(vm.choice = 'view_bottom') AS view_bottom_count,
               SUM(vm.choice = 'continue') AS continue_count,
               MAX(CASE WHEN vm.user_id = ? THEN vm.choice END) AS my_choice,
               MAX(CASE WHEN vm.user_id = ? THEN 1 ELSE 0 END) AS is_eligible
             FROM online_soup_finish_votes v
             JOIN online_soup_finish_vote_members vm ON vm.vote_id = v.id
             WHERE v.round_id = ?
             GROUP BY v.id LIMIT 1`,
            [viewer.id, viewer.id, room.current_round_id],
          );
          const vote = rows[0];
          if (!vote) return null;
          const eligibleCount = Number(vote.eligible_count ?? 0);
          const myChoice = vote.my_choice ? String(vote.my_choice) : null;
          return {
            id: String(vote.id),
            status: String(vote.status),
            eligibleCount,
            viewBottomCount: Number(vote.view_bottom_count ?? 0),
            continueCount: Number(vote.continue_count ?? 0),
            requiredViewBottomCount: requiredOnlineSoupFinishVotes(eligibleCount),
            myChoice,
            canVote: vote.status === "open" && Number(vote.is_eligible) === 1 && !myChoice,
            openedAt: iso(vote.opened_at),
          };
        })()
      : Promise.resolve(null),
  ]);
  const viewerMember = memberRows.find((row) => String(row.user_id) === viewer.id);
  const isHost = room.host_id === viewer.id;
  const canViewHostMaterials = canViewOnlineSoupHostMaterials(isHost, room.host_mode);
  const hostPresenceBase = room.host_grace_started_at ?? room.host_last_seen_at;
  const hostOnline = !room.host_grace_started_at
    && Date.now() - new Date(room.host_last_seen_at).getTime() <= HOST_ONLINE_SECONDS * 1000;
  const hostOfflineDeadline = hostOnline
    ? null
    : new Date(new Date(hostPresenceBase).getTime() + HOST_OFFLINE_GRACE_MINUTES * 60_000).toISOString();
  const supplementalSurfaces = jsonList<string>(room.soup_supplemental_surfaces);
  const publishedSurfaceIndices = jsonList<number>(room.published_surface_indices);
  const visibleSupplementalSurfaces = publishedSurfaceIndices
    .filter((index) => supplementalSurfaces[index])
    .map((index) => ({ index, content: supplementalSurfaces[index] }));
  return {
    room: {
      id: String(room.id), code: String(room.room_code), name: String(room.name), type: String(room.room_type),
      status: String(room.status), hostOnline, hostOfflineDeadline,
      hostMode: String(room.host_mode ?? "human"),
      aiProgress: String(room.host_mode ?? "human") === "ai" && room.current_round_id
        ? Number(room.ai_progress ?? 0)
        : null,
      finishVote,
      playerCount: memberRows.filter((row) => row.member_role === "player").length,
      playerCapacity: PLAYER_CAPACITY,
      participantCapacity: String(room.host_mode ?? "human") === "ai" ? PLAYER_CAPACITY : ONLINE_SOUP_PARTICIPANT_CAPACITY,
      currentRoundId: room.current_round_id ? String(room.current_round_id) : null,
      soup: room.current_soup_id ? {
        id: String(room.current_soup_id), title: String(room.soup_title), type: String(room.soup_type),
        enableAiGame: Boolean(room.soup_enable_ai_game)
          && ["super_admin", "backoffice_admin", "admin", "vip"].includes(String(room.soup_creator_role)),
        surface: String(room.soup_surface),
        visibleSupplementalSurfaces,
        ...(canViewHostMaterials ? {
          supplementalSurfaces,
          bottom: String(room.soup_bottom),
          supplementalBottoms: jsonList<string>(room.soup_supplemental_bottoms),
          manual: room.soup_manual ? String(room.soup_manual) : null,
          publishedSurfaceIndices,
          publishedBottomIndices: jsonList<number>(room.published_bottom_indices)
        } : {})
      } : null,
      createdAt: iso(room.created_at)
    },
    me: { role: String(viewerMember?.member_role ?? (isSuperAdminRole(viewer.role) ? "admin" : "spectator")), isHost },
    members: memberRows.map((row) => ({
      id: String(row.user_id), nickname: String(row.nickname), role: String(row.member_role),
      level: levelForExperience(row.experience),
      avatar: row.has_avatar ? `/api/media/users/${encodeURIComponent(String(row.user_id))}/avatar` : null,
      equippedBadge: memberBadge(row.equipped_badge_key, row.equipped_badge_icon_url, row.special_badge_name, row.special_badge_tier),
      joinedAt: iso(row.joined_at)
    })),
    ...(messagePage ? {
      messages: messagePage.messages,
      messagesHasMore: messagePage.hasMore,
      messagesNextCursor: messagePage.nextCursor
    } : {})
  };
}

router.get("/rooms", async (req, res) => {
  const user = userOf(req);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT r.*, u.nickname AS host_name, s.title AS soup_title,
       (SELECT viewer_member.member_role
        FROM online_soup_members viewer_member
        WHERE viewer_member.room_id = r.id AND viewer_member.user_id = ? AND viewer_member.is_active = 1
        LIMIT 1) AS viewer_role,
       SUM(CASE WHEN m.member_role = 'player' AND m.is_active = 1 THEN 1 ELSE 0 END) AS player_count
     FROM online_soup_rooms r JOIN users u ON u.id = r.host_id
     LEFT JOIN soups s ON s.id = r.current_soup_id
     LEFT JOIN online_soup_members m ON m.room_id = r.id
     WHERE r.status IN ('preparing','playing','ended')
     GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 100`,
    [user?.id ?? ""]
  );
  res.json({ rooms: rows.map(lobbyRoom) });
});

router.get("/active-room", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  const [members] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT m.*, r.status
     FROM online_soup_members m
     JOIN online_soup_rooms r ON r.id = m.room_id
     WHERE m.user_id = ? AND m.is_active = 1 AND r.status <> 'closed'
     ORDER BY m.last_seen_at DESC, m.joined_at DESC LIMIT 1`,
    [user.id]
  );
  const member = members[0];
  if (!member) return res.json({ session: null });
  const room = await roomById(String(member.room_id));
  if (!room) return res.json({ session: null });
  const [snapshot, activity] = await Promise.all([
    roomSnapshot(String(member.room_id), user, room),
    roomActivitySummary(String(member.room_id), user.id, String(member.last_read_activity_sequence ?? 0))
  ]);
  res.json({ session: { snapshot, ...activity } });
});

router.get("/rooms/lookup/:code", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  const room = await roomByCode(String(req.params.code).trim());
  if (!room || room.status === "closed") return fail(res, 404, "未找到该房间");
  const [[[count]], existing] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS player_count FROM online_soup_members WHERE room_id = ? AND is_active = 1 AND member_role = 'player'",
      [room.id]
    ),
    activeMember(room.id, user.id)
  ]);
  res.json({
    room: lobbyRoom({
      ...room,
      player_count: count.player_count,
      viewer_role: existing?.member_role ?? null
    } as mysql.RowDataPacket)
  });
});

router.get("/rooms/:roomId/invite-preview", async (req, res) => {
  const room = await roomById(req.params.roomId);
  if (!room || room.status === "closed") return fail(res, 404, "房间不存在或已关闭", "ROOM_CLOSED");
  const [[counts]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN member_role = 'player' AND is_active = 1 THEN 1 ELSE 0 END) AS player_count,
       SUM(CASE WHEN member_role = 'spectator' AND is_active = 1 THEN 1 ELSE 0 END) AS spectator_count
     FROM online_soup_members WHERE room_id = ?`,
    [room.id]
  );
  res.json({
    room: {
      id: String(room.id),
      code: String(room.room_code),
      name: String(room.name),
      type: String(room.room_type),
      status: String(room.status),
      host: { id: String(room.host_id), nickname: String(room.host_name) },
      playerCount: Number(counts.player_count ?? 0),
      spectatorCount: Number(counts.spectator_count ?? 0),
      playerCapacity: PLAYER_CAPACITY,
      participantCount: Number(counts.player_count ?? 0) + (String(room.host_mode ?? "human") === "ai" ? 0 : 1),
      participantCapacity: String(room.host_mode ?? "human") === "ai" ? PLAYER_CAPACITY : ONLINE_SOUP_PARTICIPANT_CAPACITY,
      spectatorCapacity: SPECTATOR_CAPACITY,
      hasPassword: room.room_type === "password"
    }
  });
});

router.get("/rooms/:roomId/invite-status", async (req, res) => {
  const inviteToken = String(req.query.inviteToken ?? "");
  if (!validRoomInviteToken(req.params.roomId, inviteToken)) {
    return fail(res, 403, "玩汤房间邀请无效");
  }
  const room = await roomById(req.params.roomId);
  if (!room) return fail(res, 404, "房间不存在", "ROOM_CLOSED");
  const [[counts]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT SUM(CASE WHEN member_role = 'player' AND is_active = 1 THEN 1 ELSE 0 END) AS player_count
     FROM online_soup_members WHERE room_id = ?`,
    [room.id]
  );
  const playerCount = Number(counts.player_count ?? 0);
  const aiHosted = String(room.host_mode ?? "human") === "ai";
  res.json({
    invite: {
      roomId: String(room.id),
      inviteToken,
      roomName: String(room.name),
      roomCode: String(room.room_code),
      soupTitle: room.soup_title ? String(room.soup_title) : null,
      status: String(room.status),
      playerCount,
      playerCapacity: PLAYER_CAPACITY,
      participantCount: playerCount + (aiHosted ? 0 : 1),
      participantCapacity: aiHosted ? PLAYER_CAPACITY : ONLINE_SOUP_PARTICIPANT_CAPACITY
    }
  });
});

router.get("/rooms/:roomId/invite", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  res.json({ token: roomInviteToken(context.room.id) });
});

router.post("/rooms/:roomId/join-auto", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录", "LOGIN_REQUIRED");
  const parsed = z.object({
    password: z.string().max(4).optional().default(""),
    inviteToken: z.string().max(100).optional().default("")
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "加入信息不正确", "INVALID_JOIN");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_soup_rooms WHERE id = ? FOR UPDATE",
      [req.params.roomId]
    );
    const room = rows[0];
    if (!room || room.status === "closed") {
      await connection.rollback();
      return fail(res, 404, "房间不存在或已关闭", "ROOM_CLOSED");
    }
    await releaseStaleSeats(String(room.id), connection);
    const existing = await activeMember(room.id, user.id, connection);
    if (existing) {
      await connection.commit();
      return res.json({ roomId: String(room.id), role: String(existing.member_role), joined: false });
    }

    const invited = Boolean(parsed.data.inviteToken) && validRoomInviteToken(String(room.id), parsed.data.inviteToken);
    if (room.host_id !== user.id && room.room_type === "password" && !invited) {
      if (!parsed.data.password) {
        await connection.rollback();
        return fail(res, 403, "请输入房间密码", "PASSWORD_REQUIRED");
      }
      if (!(await bcrypt.compare(parsed.data.password, String(room.password_hash)))) {
        await connection.rollback();
        return fail(res, 403, "房间密码错误", "INVALID_PASSWORD");
      }
    }

    const [[counts]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN member_role = 'player' AND is_active = 1 THEN 1 ELSE 0 END) AS player_count,
         SUM(CASE WHEN member_role = 'spectator' AND is_active = 1 THEN 1 ELSE 0 END) AS spectator_count
       FROM online_soup_members WHERE room_id = ?`,
      [room.id]
    );
    const role = Number(counts.player_count ?? 0) < PLAYER_CAPACITY
      ? "player"
      : Number(counts.spectator_count ?? 0) < SPECTATOR_CAPACITY
        ? "spectator"
        : null;
    if (!role) {
      await connection.rollback();
      return fail(res, 409, "房间已满", "ROOM_FULL");
    }

    await connection.query(
      `INSERT INTO online_soup_members (room_id, user_id, member_role) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE member_role = VALUES(member_role), is_active = 1, joined_at = NOW(), last_seen_at = NOW(), left_at = NULL`,
      [room.id, user.id, role]
    );
    await systemMessage(room.id, room.current_round_id, `${user.nickname} 进入了房间`, connection);
    await connection.commit();
    recordUserBehavior("join_online_room");
    res.json({ roomId: String(room.id), role, joined: true });
    void notifyRoom(String(room.id), "member_joined");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.get("/soups/eligible", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  const parsed = z.object({
    roomId: z.string().trim().max(64).optional(),
    source: z.enum(["library", "mine"]).default("library"),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(60).default(40)
  }).safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "汤库筛选条件不正确");
  const { source, q, page, limit } = parsed.data;
  const conditions = ["s.review_status = 'approved'"];
  const params: Array<string | number> = [user.id];
  let hostMode: "human" | "ai" = "human";
  if (parsed.data.roomId) {
    const room = await roomById(parsed.data.roomId);
    if (!room || String(room.host_id) !== user.id) return fail(res, 403, "仅房主可以选择海龟汤");
    hostMode = String(room.host_mode ?? "human") === "ai" ? "ai" : "human";
    if (hostMode === "ai") {
      conditions.push("s.enable_ai_game = 1");
      conditions.push("creator.role IN ('super_admin','backoffice_admin','admin','vip')");
    }
  }
  if (hostMode === "human") {
    if (source === "mine") {
      conditions.push("s.creator_id = ?");
      params.push(user.id);
    } else {
      conditions.push("s.creator_id <> ?");
      conditions.push("(s.is_bottom_public = 1 OR g.user_id IS NOT NULL OR ? = 1)");
      params.push(user.id, canViewAllSoupContentRole(user.role) ? 1 : 0);
    }
  }
  if (q) {
    conditions.push("(s.title LIKE ? OR s.author LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  params.push(limit + 1, page * limit);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT s.id, s.title, s.type, s.author, s.summary, s.creator_id, s.created_at,
       (s.enable_ai_game = 1 AND creator.role IN ('super_admin','backoffice_admin','admin','vip')) AS enable_ai_game,
       s.cover_thumbnail IS NOT NULL AS has_cover
     FROM soups s JOIN users creator ON creator.id = s.creator_id
     LEFT JOIN soup_access_grants g ON g.soup_id = s.id AND g.user_id = ?
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    params
  );
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  res.json({ soups: rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    type: String(row.type),
    author: String(row.author),
    summary: String(row.summary ?? ""),
    enableAiGame: Boolean(row.enable_ai_game),
    coverImage: row.has_cover ? `/api/media/soups/${encodeURIComponent(String(row.id))}/thumbnail` : null,
    source: hostMode === "ai" ? "library" : source
  })), hostMode, hasMore, nextPage: hasMore ? page + 1 : null });
});

router.post("/rooms", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  const parsed = z.object({
    name: z.string().trim().min(1).max(50), type: z.enum(["public", "password"]),
    password: z.string().max(4).optional().default(""),
    hostMode: z.enum(["human", "ai"]).default("human")
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? "房间信息不正确");
  if (parsed.data.type === "password" && parsed.data.password.length !== 4) return fail(res, 400, "房间密码必须为 4 位");
  let code = "";
  for (let i = 0; i < 10; i++) {
    code = String(Math.floor(100000 + Math.random() * 900000));
    const [exists] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM online_soup_rooms WHERE room_code = ? LIMIT 1", [code]);
    if (!exists[0]) break;
  }
  const roomId = nanoid();
  const passwordHash = parsed.data.type === "password" ? await bcrypt.hash(parsed.data.password, 10) : null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO online_soup_rooms (id, room_code, name, host_id, host_mode, room_type, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [roomId, code, parsed.data.name, user.id, parsed.data.hostMode, parsed.data.type, passwordHash]
    );
    await connection.query(
      "INSERT INTO online_soup_members (room_id, user_id, member_role) VALUES (?, ?, ?)",
      [roomId, user.id, parsed.data.hostMode === "ai" ? "player" : "host"]
    );
    await systemMessage(roomId, null, `主持人 ${user.nickname} 创建了房间`, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  recordUserBehavior("create_online_room");
  res.status(201).json({ roomId, code });
  notifyLobby("room_created");
});

router.patch("/rooms/:roomId/host-mode", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  if (context.room.status === "playing") return fail(res, 409, "游戏进行中不能更改主持模式，请先结束本轮");
  const parsed = z.object({ hostMode: z.enum(["human", "ai"]) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "主持模式不正确");
  if (String(context.room.host_mode ?? "human") === parsed.data.hostMode) return res.json({ ok: true });
  let clearCurrentSoup = false;
  if (context.room.current_soup_id) {
    if (parsed.data.hostMode === "ai") {
      const [[eligible]] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT s.id FROM soups s JOIN users creator ON creator.id = s.creator_id
         WHERE s.id = ? AND s.enable_ai_game = 1 AND s.review_status = 'approved'
           AND creator.role IN ('super_admin','backoffice_admin','admin','vip') LIMIT 1`,
        [context.room.current_soup_id]
      );
      clearCurrentSoup = !eligible;
    } else {
      const [[eligible]] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT s.id FROM soups s
         LEFT JOIN soup_access_grants g ON g.soup_id = s.id AND g.user_id = ?
         WHERE s.id = ? AND s.review_status = 'approved'
           AND (s.creator_id = ? OR s.is_bottom_public = 1 OR g.user_id IS NOT NULL OR ? = 1)
         LIMIT 1`,
        [context.user.id, context.room.current_soup_id, context.user.id, canViewAllSoupContentRole(context.user.role) ? 1 : 0]
      );
      clearCurrentSoup = !eligible;
    }
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE online_soup_rooms SET host_mode = ?,
         current_soup_id = IF(?, NULL, current_soup_id),
         current_round_id = IF(?, NULL, current_round_id),
         status = IF(?, 'preparing', status)
       WHERE id = ?`,
      [parsed.data.hostMode, clearCurrentSoup ? 1 : 0, clearCurrentSoup ? 1 : 0, clearCurrentSoup ? 1 : 0, context.room.id]
    );
    await connection.query(
      "UPDATE online_soup_members SET member_role = ? WHERE room_id = ? AND user_id = ? AND is_active = 1",
      [parsed.data.hostMode === "ai" ? "player" : "host", context.room.id, context.user.id]
    );
    if (!clearCurrentSoup && context.room.current_round_id) await connection.query(
      "UPDATE online_soup_rounds SET host_mode = ? WHERE id = ? AND status = 'preparing'",
      [parsed.data.hostMode, context.room.current_round_id]
    );
    await systemMessage(context.room.id, context.room.current_round_id ? String(context.room.current_round_id) : null,
      parsed.data.hostMode === "ai" ? "房主将主持方式更改为 AI 主持" : "房主将主持方式更改为真人主持", connection);
    if (clearCurrentSoup) await systemMessage(
      context.room.id,
      null,
      parsed.data.hostMode === "ai"
        ? "当前海龟汤不支持 AI 主持，已取消选择"
        : "房主尚未获得当前海龟汤汤底，已取消选择",
      connection
    );
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  res.json({ ok: true, hostMode: parsed.data.hostMode, soupCleared: clearCurrentSoup });
  void notifyRoom(context.room.id, "host_mode_changed", { hostMode: parsed.data.hostMode, soupCleared: clearCurrentSoup });
  if (parsed.data.hostMode === "ai" && context.room.current_soup_id && !clearCurrentSoup) {
    // 在准备阶段后台预热，避免首个正式问题承担关键事实拆分耗时。
    void splitKeyFactsForSoup(String(context.room.current_soup_id));
  }
});

router.post("/rooms/:roomId/join", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  const parsed = z.object({ password: z.string().max(4).optional().default(""), role: z.enum(["player", "spectator"]).default("player") }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "加入信息不正确");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM online_soup_rooms WHERE id = ? FOR UPDATE", [req.params.roomId]);
    const room = rows[0];
    if (!room || room.status === "closed") { await connection.rollback(); return fail(res, 404, "房间不存在或已关闭"); }
    await releaseStaleSeats(String(room.id), connection);
    const existing = await activeMember(room.id, user.id, connection);
    if (!existing && room.host_id !== user.id && room.room_type === "password" && !(await bcrypt.compare(parsed.data.password, String(room.password_hash)))) {
      await connection.rollback(); return fail(res, 403, "房间密码错误");
    }
    if (!existing) {
      const [[count]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM online_soup_members WHERE room_id = ? AND member_role = ? AND is_active = 1",
        [room.id, parsed.data.role]
      );
      const capacity = parsed.data.role === "player" ? PLAYER_CAPACITY : SPECTATOR_CAPACITY;
      if (Number(count.total) >= capacity) {
        await connection.rollback();
        return fail(
          res,
          409,
          parsed.data.role === "player" ? "玩家席位已满，可以选择旁观" : "房间已满",
          parsed.data.role === "player" ? "PLAYER_FULL" : "ROOM_FULL"
        );
      }
    }
    if (!existing) {
      await connection.query(
        `INSERT INTO online_soup_members (room_id, user_id, member_role) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE member_role = VALUES(member_role), is_active = 1, joined_at = NOW(), last_seen_at = NOW(), left_at = NULL`,
        [room.id, user.id, room.host_id === user.id
          ? (String(room.host_mode ?? "human") === "ai" ? "player" : "host")
          : parsed.data.role]
      );
      await systemMessage(room.id, room.current_round_id, `${user.nickname} 进入了房间`, connection);
    }
    const role = existing?.member_role ?? (room.host_id === user.id
      ? (String(room.host_mode ?? "human") === "ai" ? "player" : "host")
      : parsed.data.role);
    await connection.commit();
    if (!existing) recordUserBehavior("join_online_room");
    res.json({ roomId: String(room.id), role: String(role), joined: !existing });
    if (!existing) void notifyRoom(String(room.id), "member_joined");
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
});

router.get("/rooms/:roomId", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  res.json(await roomSnapshot(context.room.id, context.user, context.room));
});

router.get("/rooms/:roomId/state", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  res.json(await roomSnapshot(context.room.id, context.user, context.room, false));
});

router.get("/rooms/:roomId/messages", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  const parsed = z.object({
    before: z.string().regex(/^\d+$/).optional(),
    after: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE_SIZE).default(MESSAGE_PAGE_SIZE)
  }).refine((value) => !(value.before && value.after), {
    message: "消息游标不能同时向前和向后",
    path: ["before"]
  }).safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "消息游标不正确");
  res.json(await roomMessagePage(context.room, parsed.data.before, parsed.data.limit, parsed.data.after));
});

router.get("/rooms/:roomId/progress", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  if (!context.room.current_round_id) {
    return res.json({ roundId: null, aiProgress: null, questions: [], hasMore: false, nextCursor: null });
  }
  const parsed = z.object({
    after: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100)
  }).safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "进度游标不正确");
  const params: Array<string | number> = [String(context.room.current_round_id)];
  const afterClause = parsed.data.after ? "AND m.message_sequence > ?" : "";
  if (parsed.data.after) params.push(parsed.data.after);
  params.push(parsed.data.limit + 1);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT m.id, m.message_sequence, m.content, m.question_number, m.answer, m.ai_status, m.ai_error,
       m.ai_progress_delta, m.ai_progress_after, m.ai_feedback, m.created_at,
       m.sender_id, u.nickname AS sender_name, u.avatar IS NOT NULL AS sender_has_avatar
     FROM online_soup_messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.round_id = ? AND m.message_type = 'question' AND m.recalled_at IS NULL ${afterClause}
     ORDER BY m.message_sequence ASC LIMIT ?`,
    params
  );
  const page = finalizeOnlineSoupRoundPanelPage(rows, parsed.data.limit, (row) => row.message_sequence);
  res.json({
    roundId: String(context.room.current_round_id),
    aiProgress: String(context.room.host_mode ?? "human") === "ai" ? Number(context.room.ai_progress ?? 0) : null,
    questions: page.items.map((row) => ({
      id: String(row.id),
      sequence: String(row.message_sequence),
      number: Number(row.question_number ?? 0),
      content: String(row.content),
      answer: row.answer ? String(row.answer) : null,
      aiStatus: String(row.ai_status ?? "none"),
      aiError: row.ai_error ? String(row.ai_error) : null,
      aiProgressDelta: row.ai_progress_delta == null ? null : Number(row.ai_progress_delta),
      aiProgressAfter: row.ai_progress_after == null ? null : Number(row.ai_progress_after),
      aiFeedback: row.ai_feedback ? String(row.ai_feedback) : null,
      sender: {
        id: row.sender_id ? String(row.sender_id) : null,
        nickname: row.sender_name ? String(row.sender_name) : "未知用户",
        avatar: row.sender_id && row.sender_has_avatar
          ? `/api/media/users/${encodeURIComponent(String(row.sender_id))}/avatar`
          : null
      },
      createdAt: iso(row.created_at)
    })),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor
  });
});

router.post("/rooms/:roomId/ai-hint", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  if (context.room.status !== "playing" || !context.room.current_round_id) return fail(res, 409, "当前没有进行中的推理");
  if (String(context.room.host_mode ?? "human") !== "ai") return fail(res, 409, "当前不是 AI 主持模式");
  if (context.member?.member_role !== "player") return fail(res, 403, "只有本轮玩家可以请求提示");
  const progress = Number(context.room.ai_progress ?? 0);
  if (!canRequestRoomAiHint(progress)) return fail(res, 400, "推理进度达到 20% 后才能获取提示");
  if (activeAiRooms.has(context.room.id)) return fail(res, 409, "AI 正在回答问题，请稍后请求提示");

  activeAiRooms.add(context.room.id);
  try {
    const [[round]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, soup_id, status AS round_status, host_mode, ai_messages, ai_revealed_keys,
         ai_revealed_atoms, ai_revealed_supplements, ai_progress, ai_version, ai_hint_count
       FROM online_soup_rounds WHERE id = ? LIMIT 1`,
      [context.room.current_round_id]
    );
    if (!round || round.round_status !== "playing" || round.host_mode !== "ai") return fail(res, 409, "本轮状态已发生变化");
    const turn = await runRoomAiHint(String(round.soup_id), roomAiState(round));
    const clueId = nanoid();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[locked]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT status, host_mode, ai_version FROM online_soup_rounds WHERE id = ? FOR UPDATE",
        [round.id]
      );
      if (!locked || locked.status !== "playing" || locked.host_mode !== "ai" || Number(locked.ai_version) !== Number(round.ai_version)) {
        await connection.rollback();
        return fail(res, 409, "本轮状态已更新，请重试");
      }
      await connection.query(
        `UPDATE online_soup_rounds SET ai_messages = ?, ai_revealed_keys = ?, ai_revealed_atoms = ?,
           ai_revealed_supplements = ?, ai_progress = ?, ai_version = ai_version + 1,
           ai_hint_count = ai_hint_count + 1 WHERE id = ?`,
        [JSON.stringify(turn.messages), JSON.stringify(turn.revealedKeys), JSON.stringify(turn.revealedAtomicFactIds),
          JSON.stringify(turn.revealedSupplements), turn.progress, round.id]
      );
      await connection.query(
        "INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content) VALUES (?, ?, ?, NULL, 'clue', ?)",
        [clueId, context.room.id, round.id, `AI 提示：${turn.answer}`]
      );
      const activitySequence = await recordRoomActivity(context.room.id, "clue", context.user.id, clueId, connection);
      await connection.commit();
      res.status(201).json({ ok: true, hint: turn.answer, aiProgress: turn.progress });
      void notifyRoom(context.room.id, "clue", { activitySequence, activityType: "clue", aiProgress: turn.progress });
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (!res.headersSent) {
      if (error instanceof AiServiceError) fail(res, error.status, error.message);
      else {
        console.error("Online soup AI hint failed:", error);
        fail(res, 503, "AI 提示暂时不可用");
      }
    }
  } finally {
    activeAiRooms.delete(context.room.id);
    const [remaining] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM online_soup_messages WHERE room_id = ? AND message_type = 'question' AND ai_status IN ('pending','answering','scoring') LIMIT 1",
      [context.room.id]
    );
    if (remaining[0]) void processRoomAiQuestions(context.room.id);
  }
});

router.post("/rooms/:roomId/questions/:messageId/retry-ai", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  if (String(context.room.host_mode ?? "human") !== "ai") return fail(res, 409, "当前不是 AI 主持模式");
  const [[question]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT m.sender_id, m.answer, m.ai_status, m.round_id, r.status AS round_status
     FROM online_soup_messages m
     JOIN online_soup_rounds r ON r.id = m.round_id
     WHERE m.id = ? AND m.room_id = ? AND m.message_type = 'question' LIMIT 1`,
    [req.params.messageId, context.room.id],
  );
  if (!question) return fail(res, 404, "未找到该问题");
  if (String(question.sender_id) !== context.user.id && context.room.host_id !== context.user.id) {
    return fail(res, 403, "只有提问者或房主可以重试");
  }
  if (question.round_status !== "playing" || String(question.round_id) !== String(context.room.current_round_id)) {
    return fail(res, 409, "本轮已经结束");
  }
  if (question.ai_status !== "failed") return fail(res, 409, "该问题当前无需重试");
  const [updated] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE online_soup_messages
     SET ai_status = IF(answer IS NULL, 'pending', 'scoring'), ai_error = NULL,
       ai_progress_delta = NULL, ai_progress_after = NULL, ai_feedback = NULL
     WHERE id = ? AND ai_status = 'failed'`,
    [req.params.messageId],
  );
  if (updated.affectedRows !== 1) return fail(res, 409, "该问题状态已更新");
  await pool.query(
    "UPDATE online_soup_rounds SET ai_status = 'idle' WHERE id = ? AND status = 'playing'",
    [question.round_id],
  );
  res.status(202).json({ ok: true });
  void notifyRoom(context.room.id, "answer_changed", {
    messageId: req.params.messageId,
    aiStatus: question.answer ? "scoring" : "pending",
    aiError: null,
  });
  void processRoomAiQuestions(context.room.id);
});

router.post("/rooms/:roomId/finish-vote", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  const parsed = z.object({ choice: z.enum(["view_bottom", "continue"]) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "请选择查看汤底或继续游戏");
  if (String(context.room.host_mode ?? "human") !== "ai" || !context.room.current_round_id) {
    return fail(res, 409, "当前没有可参与的通关投票");
  }

  const connection = await pool.getConnection();
  let ended = false;
  let voteId = "";
  let eligibleCount = 0;
  let viewBottomCount = 0;
  let continueCount = 0;
  try {
    await connection.beginTransaction();
    const [[round]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT status AS round_status, soup_id, host_mode, ai_progress
       FROM online_soup_rounds WHERE id = ? FOR UPDATE`,
      [context.room.current_round_id],
    );
    const [[vote]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, status, round_id FROM online_soup_finish_votes
       WHERE room_id = ? AND round_id = ? FOR UPDATE`,
      [context.room.id, context.room.current_round_id],
    );
    if (!round || !vote || vote.status !== "open" || round.round_status !== "playing" || round.host_mode !== "ai") {
      await connection.rollback();
      return fail(res, 409, "当前投票已经结束");
    }
    voteId = String(vote.id);
    const [[eligible]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT choice FROM online_soup_finish_vote_members WHERE vote_id = ? AND user_id = ? FOR UPDATE",
      [voteId, context.user.id],
    );
    if (!eligible) {
      await connection.rollback();
      return fail(res, 403, "你不是本次投票的正式玩家");
    }
    if (eligible.choice && eligible.choice !== parsed.data.choice) {
      await connection.rollback();
      return fail(res, 409, "你已经完成投票，选择不可更改");
    }
    if (!eligible.choice) {
      await connection.query(
        "UPDATE online_soup_finish_vote_members SET choice = ?, voted_at = NOW() WHERE vote_id = ? AND user_id = ?",
        [parsed.data.choice, voteId, context.user.id],
      );
    }
    const [[counts]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS eligible_count,
         SUM(choice = 'view_bottom') AS view_bottom_count,
         SUM(choice = 'continue') AS continue_count
       FROM online_soup_finish_vote_members WHERE vote_id = ?`,
      [voteId],
    );
    eligibleCount = Number(counts.eligible_count ?? 0);
    viewBottomCount = Number(counts.view_bottom_count ?? 0);
    continueCount = Number(counts.continue_count ?? 0);
    if (onlineSoupAiFinishDecision(round.ai_progress, eligibleCount, viewBottomCount) === "vote") {
      ended = await completeAiRound(
        connection,
        context.room.id,
        String(vote.round_id),
        String(round.soup_id),
        "vote",
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  res.json({
    ok: true,
    ended,
    eligibleCount,
    viewBottomCount,
    continueCount,
    requiredViewBottomCount: requiredOnlineSoupFinishVotes(eligibleCount),
  });
  if (ended && context.room.current_round_id) {
    void settleOnlineSoupRoundAfterCommit(String(context.room.current_round_id)).catch((error) => {
      console.error("Online soup AI vote settlement failed after completion", error);
    });
  }
  void notifyRoom(context.room.id, ended ? "round_ended" : "finish_vote_updated", { voteId });
});

router.get("/rooms/:roomId/clues", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  if (!context.room.current_round_id) {
    return res.json({ roundId: null, clues: [], hasMore: false, nextCursor: null });
  }
  const parsed = z.object({
    after: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100)
  }).safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "线索游标不正确");
  const params: Array<string | number> = [String(context.room.current_round_id)];
  const afterClause = parsed.data.after ? "AND message_sequence > ?" : "";
  if (parsed.data.after) params.push(parsed.data.after);
  params.push(parsed.data.limit + 1);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, message_sequence, content, created_at
     FROM online_soup_messages
     WHERE round_id = ? AND message_type = 'clue' ${afterClause}
     ORDER BY message_sequence ASC LIMIT ?`,
    params
  );
  const page = finalizeOnlineSoupRoundPanelPage(rows, parsed.data.limit, (row) => row.message_sequence);
  res.json({
    roundId: String(context.room.current_round_id),
    clues: page.items.map((row) => ({
      id: String(row.id),
      sequence: String(row.message_sequence),
      content: String(row.content),
      createdAt: iso(row.created_at)
    })),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor
  });
});

router.post("/rooms/:roomId/ping", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  res.json({ ok: true });
});

router.patch("/rooms/:roomId/read", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  const parsed = z.object({ through: z.string().regex(/^\d+$/) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "已读游标不正确");
  await pool.query(
    `UPDATE online_soup_members
     SET last_read_activity_sequence = GREATEST(last_read_activity_sequence, ?)
     WHERE room_id = ? AND user_id = ? AND is_active = 1`,
    [parsed.data.through, context.room.id, context.user.id]
  );
  res.json({ ok: true });
});

router.post("/rooms/:roomId/leave", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  if (context.user.id === context.room.host_id) {
    const connection = await pool.getConnection();
    let successor: ActiveHostSuccessor | null = null;
    try {
      await connection.beginTransaction();
      const [[room]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT * FROM online_soup_rooms WHERE id = ? AND host_id = ? AND status <> 'closed' FOR UPDATE",
        [context.room.id, context.user.id]
      );
      if (!room) {
        await connection.rollback();
        return fail(res, 409, "房主身份已发生变化，请刷新房间状态");
      }
      await releaseStaleSeats(context.room.id, connection);
      successor = await activeHostSuccessor(context.room.id, context.user.id, connection);
      if (successor) {
        await transferDepartedHost(context.room.id, context.user.id, successor, connection, String(room.host_mode ?? "human") === "ai" ? "ai" : "human");
        await systemMessage(
          context.room.id,
          room.current_round_id ? String(room.current_round_id) : null,
          `${context.user.nickname} 已退出房间，${String(successor.nickname)} 接任房主`,
          connection
        );
      } else {
        await systemMessage(
          context.room.id,
          room.current_round_id ? String(room.current_round_id) : null,
          `${context.user.nickname} 已退出，房间内暂无其他成员，房间已解散`,
          connection
        );
        await connection.query(
          "UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW(), host_grace_started_at = NULL WHERE id = ? AND host_id = ?",
          [context.room.id, context.user.id]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({
      ok: true,
      roomClosed: !successor,
      hostTransferred: Boolean(successor),
      hostGracePeriod: false,
      newHostId: successor?.userId ?? null
    });
    if (successor) {
      void notifyRoom(context.room.id, "host_transferred", {
        cause: "host_exit",
        previousHostId: context.user.id,
        newHostId: successor.userId,
        previousRole: String(successor.previousRole),
        newHostNickname: String(successor.nickname)
      });
    } else {
      void notifyRoom(context.room.id, "room_closed", { cause: "host_exit_empty" });
    }
    return;
  }
  await pool.query("UPDATE online_soup_members SET is_active = 0, left_at = NOW() WHERE room_id = ? AND user_id = ?", [context.room.id, context.user.id]);
  await systemMessage(context.room.id, context.room.current_round_id, `${context.user.nickname} 离开了房间`);
  res.json({ ok: true });
  void notifyRoom(context.room.id, "member_left");
});

router.post("/rooms/:roomId/members/:userId/kick", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  if (req.params.userId === context.user.id) return fail(res, 400, "主持人不能将自己踢出房间");
  const connection = await pool.getConnection();
  let targetNickname = "";
  try {
    await connection.beginTransaction();
    const [[room], [target]] = await Promise.all([
      connection.query<mysql.RowDataPacket[]>(
        "SELECT host_id, host_mode, current_round_id FROM online_soup_rooms WHERE id = ? AND status <> 'closed' FOR UPDATE",
        [context.room.id]
      ).then(([rows]) => rows),
      connection.query<mysql.RowDataPacket[]>(
        `SELECT m.member_role, u.nickname
         FROM online_soup_members m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.user_id = ? AND m.is_active = 1
         LIMIT 1 FOR UPDATE`,
        [context.room.id, req.params.userId]
      ).then(([rows]) => rows)
    ]);
    if (!room || String(room.host_id) !== context.user.id) {
      await connection.rollback();
      return fail(res, 403, "仅当前主持人可以执行此操作");
    }
    if (!target) {
      await connection.rollback();
      return fail(res, 404, "该用户已不在房间");
    }
    if (String(target.member_role) === "host") {
      await connection.rollback();
      return fail(res, 400, "主持人不能将自己踢出房间");
    }
    targetNickname = String(target.nickname);
    await connection.query(
      "UPDATE online_soup_members SET is_active = 0, left_at = NOW() WHERE room_id = ? AND user_id = ? AND is_active = 1",
      [context.room.id, req.params.userId]
    );
    await systemMessage(context.room.id, room.current_round_id ? String(room.current_round_id) : null, `${targetNickname} 被主持人移出房间`, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ ok: true });
  void notifyRoom(context.room.id, "member_kicked", { userId: req.params.userId, nickname: targetNickname });
});

router.post("/rooms/:roomId/members/:userId/transfer-host", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  if (req.params.userId === context.user.id) return fail(res, 400, "你已经是房主");
  const connection = await pool.getConnection();
  let targetNickname = "";
  let previousRole = "";
  try {
    await connection.beginTransaction();
    const [[room], [target]] = await Promise.all([
      connection.query<mysql.RowDataPacket[]>(
        "SELECT host_id, host_mode, current_round_id FROM online_soup_rooms WHERE id = ? AND status <> 'closed' FOR UPDATE",
        [context.room.id]
      ).then(([rows]) => rows),
      connection.query<mysql.RowDataPacket[]>(
        `SELECT m.member_role, u.nickname
         FROM online_soup_members m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.user_id = ? AND m.is_active = 1
         LIMIT 1 FOR UPDATE`,
        [context.room.id, req.params.userId]
      ).then(([rows]) => rows)
    ]);
    if (!room || String(room.host_id) !== context.user.id) {
      await connection.rollback();
      return fail(res, 403, "仅当前主持人可以执行此操作");
    }
    if (!target) {
      await connection.rollback();
      return fail(res, 404, "该用户已不在房间");
    }
    previousRole = String(target.member_role);
    if (previousRole !== "player" && previousRole !== "spectator") {
      await connection.rollback();
      return fail(res, 409, "该用户当前不能接任房主");
    }
    targetNickname = String(target.nickname);
    await connection.query(
      "UPDATE online_soup_rooms SET host_id = ?, host_last_seen_at = NOW(), host_grace_started_at = NULL WHERE id = ?",
      [req.params.userId, context.room.id]
    );
    const aiHosted = String(room.host_mode ?? "human") === "ai";
    await connection.query(
      "UPDATE online_soup_members SET member_role = ? WHERE room_id = ? AND user_id = ? AND is_active = 1",
      [previousRole, context.room.id, context.user.id]
    );
    await connection.query(
      "UPDATE online_soup_members SET member_role = ? WHERE room_id = ? AND user_id = ? AND is_active = 1",
      [aiHosted ? "player" : "host", context.room.id, req.params.userId]
    );
    await systemMessage(
      context.room.id,
      room.current_round_id ? String(room.current_round_id) : null,
      `${context.user.nickname} 将房主转让给 ${targetNickname}`,
      connection
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ ok: true });
  void notifyRoom(context.room.id, "host_transferred", {
    previousHostId: context.user.id,
    newHostId: req.params.userId,
    previousRole
  });
});

router.post("/rooms/:roomId/select-soup", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  if (context.room.status === "playing") return fail(res, 409, "请先发布当前汤底再更换海龟汤");
  const parsed = z.object({ soupId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "请选择海龟汤");
  const aiHosted = String(context.room.host_mode ?? "human") === "ai";
  const aiClause = aiHosted
    ? "AND s.enable_ai_game = 1 AND creator.role IN ('super_admin','backoffice_admin','admin','vip')"
    : "";
  const accessClause = aiHosted
    ? ""
    : "AND (s.creator_id = ? OR s.is_bottom_public = 1 OR g.user_id IS NOT NULL OR ? = 1)";
  const selectParams: Array<string | number> = [context.user.id, parsed.data.soupId];
  if (!aiHosted) selectParams.push(context.user.id, canViewAllSoupContentRole(context.user.role) ? 1 : 0);
  const [soups] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.id, s.title FROM soups s JOIN users creator ON creator.id = s.creator_id
     LEFT JOIN soup_access_grants g ON g.soup_id = s.id AND g.user_id = ?
     WHERE s.id = ? AND s.review_status = 'approved' ${aiClause} ${accessClause} LIMIT 1`,
    selectParams
  );
  if (!soups[0]) return fail(res, 403, aiHosted ? "该海龟汤不支持 AI 主持" : "你尚未获得该海龟汤的汤底权限");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let roundId: string;
    if (context.room.status === "preparing" && context.room.current_round_id) {
      roundId = String(context.room.current_round_id);
      await connection.query(
        "UPDATE online_soup_rounds SET soup_id = ?, host_mode = ?, ai_messages = NULL, ai_revealed_keys = NULL, ai_revealed_atoms = NULL, ai_revealed_supplements = NULL, ai_progress = 0, ai_version = 0, ai_status = 'idle', ai_hint_count = 0 WHERE id = ? AND status = 'preparing'",
        [parsed.data.soupId, String(context.room.host_mode ?? "human"), roundId]
      );
    } else {
      const [[numberRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT COALESCE(MAX(round_number), 0) + 1 AS next_number FROM online_soup_rounds WHERE room_id = ?", [context.room.id]);
      roundId = nanoid();
      await connection.query("INSERT INTO online_soup_rounds (id, room_id, soup_id, round_number, host_mode) VALUES (?, ?, ?, ?, ?)", [roundId, context.room.id, parsed.data.soupId, numberRow.next_number, String(context.room.host_mode ?? "human")]);
    }
    await connection.query("UPDATE online_soup_rooms SET current_soup_id = ?, current_round_id = ?, status = 'preparing' WHERE id = ?", [parsed.data.soupId, roundId, context.room.id]);
    const action = context.room.current_soup_id ? "更换了" : "选择了";
    await systemMessage(context.room.id, roundId, `主持人${action}海龟汤：${soups[0].title}`, connection);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  res.json({ ok: true }); void notifyRoom(context.room.id, "soup_selected");
  if (String(context.room.host_mode ?? "human") === "ai") {
    void splitKeyFactsForSoup(parsed.data.soupId);
  }
});

router.post("/rooms/:roomId/start", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  if (String(context.room.host_mode ?? "human") === "ai" && context.room.current_soup_id) {
    // 等待准备阶段的内部事实拆分完成，避免原子事实 ID 在进行中的回合里发生变化。
    const keyFactsReady = await ensureAiSoupKeyFacts(String(context.room.current_soup_id));
    if (!keyFactsReady) return fail(res, 503, "AI 正在自动生成本汤的进度关键点，请稍后再开始");
  }
  const connection = await pool.getConnection();
  let roundId = "";
  try {
    await connection.beginTransaction();
    const [[room]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT host_id, status, host_mode, current_soup_id, current_round_id
       FROM online_soup_rooms WHERE id = ? AND status <> 'closed' FOR UPDATE`,
      [context.room.id]
    );
    if (!room || String(room.host_id) !== context.user.id) {
      await connection.rollback();
      return fail(res, 403, "仅当前房主可以开始游戏");
    }
    if (!room.current_soup_id || !["preparing", "ended"].includes(String(room.status))) {
      await connection.rollback();
      return fail(res, 409, "当前房间无法开始新一轮");
    }
    const hostMode = String(room.host_mode ?? "human");
    if (String(room.status) === "preparing") {
      if (!room.current_round_id) {
        await connection.rollback();
        return fail(res, 409, "请先选择海龟汤");
      }
      roundId = String(room.current_round_id);
      const [roundResult] = await connection.query<mysql.ResultSetHeader>(
        "UPDATE online_soup_rounds SET status = 'playing', host_mode = ?, started_at = NOW() WHERE id = ? AND status = 'preparing'",
        [hostMode, roundId]
      );
      if (roundResult.affectedRows !== 1) {
        await connection.rollback();
        return fail(res, 409, "本轮状态已更新，请刷新后重试");
      }
    } else {
      const [[numberRow]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT COALESCE(MAX(round_number), 0) + 1 AS next_number FROM online_soup_rounds WHERE room_id = ?",
        [context.room.id]
      );
      roundId = nanoid();
      await connection.query(
        `INSERT INTO online_soup_rounds
           (id, room_id, soup_id, round_number, status, host_mode, started_at)
         VALUES (?, ?, ?, ?, 'playing', ?, NOW())`,
        [roundId, context.room.id, room.current_soup_id, numberRow.next_number, hostMode]
      );
    }
    await connection.query(
      "UPDATE online_soup_rooms SET status = 'playing', current_round_id = ? WHERE id = ?",
      [roundId, context.room.id]
    );
    await systemMessage(context.room.id, roundId, "新一轮推理开始", connection);
    if (hostMode === "ai") {
      await connection.query(
        "INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content) VALUES (?, ?, ?, NULL, 'ai_advice', ?)",
        [nanoid(), context.room.id, roundId, AI_PLAY_ADVICE_CARD],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, roundId);
  res.json({ ok: true }); void notifyRoom(context.room.id, "round_started", { activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/messages", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  const parsed = z.discriminatedUnion("type", [
    z.object({
      type: z.enum(["discussion", "question"]),
      content: z.string().trim().min(1).max(1000),
      mentionedUserIds: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
      replyToMessageId: z.string().trim().min(1).max(64).optional()
    }),
    z.object({
      type: z.literal("sticker"),
      stickerId: z.string().trim().min(1).max(64),
      replyToMessageId: z.string().trim().min(1).max(64).optional()
    })
  ]).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? "消息内容不正确");
  const sticker = parsed.data.type === "sticker" ? getSticker(parsed.data.stickerId) : null;
  if (parsed.data.type === "sticker" && !sticker) return fail(res, 400, "表情不存在或已下架");
  if (parsed.data.type === "sticker" && !(await userOwnsSticker(context.user.id, parsed.data.stickerId))) return fail(res, 403, "尚未拥有该表情，请先前往商城购买");
  if (parsed.data.type === "question") {
    if (context.member?.member_role !== "player") return fail(res, 403, "只有玩家可以发送正式提问");
    if (context.room.status !== "playing") return fail(res, 409, "当前不在推理阶段");
  }
  if (parsed.data.type !== "question" && context.member?.member_role === "spectator") {
    return fail(res, 403, "旁观者只能查看房间内容");
  }
  const connection = await pool.getConnection();
  let questionNumber: number | null = null;
  let activitySequence = "0";
  try {
    await connection.beginTransaction();
    const stickerCooldownMs = await recordChatMessageForRateLimit(connection, {
      scopeType: "online_soup",
      scopeId: context.room.id,
      userId: context.user.id,
      messageType: parsed.data.type,
    });
    if (stickerCooldownMs > 0) {
      await connection.rollback();
      res.setHeader("Retry-After", Math.max(1, Math.ceil(stickerCooldownMs / 1000)));
      return fail(res, 429, stickerCooldownMessage(stickerCooldownMs), "STICKER_COOLDOWN");
    }
    if (parsed.data.replyToMessageId) {
      const [[replyTarget]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id FROM online_soup_messages
         WHERE id = ? AND room_id = ? AND recalled_at IS NULL
           AND message_type IN ('discussion','question','host','sticker')
         LIMIT 1`,
        [parsed.data.replyToMessageId, context.room.id]
      );
      if (!replyTarget) {
        await connection.rollback();
        return fail(res, 400, "被回复的消息不存在、已撤回或不属于当前房间");
      }
    }
    const mentionedUserIds = parsed.data.type === "sticker"
      ? []
      : [...new Set(parsed.data.mentionedUserIds ?? [])].filter((id) => id !== context.user.id);
    const messageContent = parsed.data.type === "sticker" ? "" : parsed.data.content;
    let mentions: Array<{ userId: string; nickname: string }> = [];
    if (mentionedUserIds.length) {
      const [mentionedMembers] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT m.user_id AS id, u.nickname
         FROM online_soup_members m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.is_active = 1 AND m.user_id IN (?)`,
        [context.room.id, mentionedUserIds]
      );
      if (mentionedMembers.length !== mentionedUserIds.length) {
        await connection.rollback();
        return fail(res, 400, "被@的用户不在当前房间");
      }
      mentions = mentionedMembers.map((member) => ({ userId: String(member.id), nickname: String(member.nickname) }));
      if (mentions.some((mention) => !messageContent.includes(`@${mention.nickname}`))) {
        await connection.rollback();
        return fail(res, 400, "消息正文缺少被@用户的完整昵称");
      }
    }
    if (parsed.data.type === "question") {
      await connection.query("UPDATE online_soup_rounds SET question_count = LAST_INSERT_ID(question_count + 1) WHERE id = ?", [context.room.current_round_id]);
      const [[row]] = await connection.query<mysql.RowDataPacket[]>("SELECT question_count FROM online_soup_rounds WHERE id = ?", [context.room.current_round_id]);
      questionNumber = Number(row.question_count);
    }
    const isHumanHost = String(context.room.host_mode ?? "human") === "human" && context.user.id === context.room.host_id;
    const type = parsed.data.type === "discussion" && isHumanHost ? "host" : parsed.data.type;
    const content = messageContent;
    const id = nanoid();
    await connection.query(
      `INSERT INTO online_soup_messages
       (id, room_id, round_id, sender_id, message_type, content, sticker_id, question_number, ai_status, mentions_json, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, context.room.id, context.room.current_round_id, context.user.id, type, content, sticker?.id ?? null, questionNumber,
        parsed.data.type === "question" && String(context.room.host_mode ?? "human") === "ai" ? "pending" : "none",
        mentions.length ? JSON.stringify(mentions) : null, parsed.data.replyToMessageId ?? null]
    );
    activitySequence = await recordRoomActivity(context.room.id, parsed.data.type === "question" ? "progress" : "chat", context.user.id, id, connection);
    await connection.commit();
    res.status(201).json({ id, questionNumber });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  void notifyRoom(context.room.id, "message", { activitySequence, activityType: parsed.data.type === "question" ? "progress" : "chat" });
  if (parsed.data.type === "question" && String(context.room.host_mode ?? "human") === "ai") void processRoomAiQuestions(context.room.id);
});

router.patch("/rooms/:roomId/messages/:messageId/recall", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  const connection = await pool.getConnection();
  let recalledAt = "";
  try {
    await connection.beginTransaction();
    const [[message]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, sender_id, message_type, answer, recalled_at,
         created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 MINUTE) AS within_window
       FROM online_soup_messages
       WHERE id = ? AND room_id = ? LIMIT 1 FOR UPDATE`,
      [req.params.messageId, context.room.id]
    );
    if (!message) {
      await connection.rollback();
      return fail(res, 404, "消息不存在");
    }
    if (String(message.sender_id ?? "") !== context.user.id) {
      await connection.rollback();
      return fail(res, 403, "只能撤回自己的发言");
    }
    if (!["discussion", "question", "host", "sticker"].includes(String(message.message_type))) {
      await connection.rollback();
      return fail(res, 409, "该消息类型不支持撤回");
    }
    if (message.recalled_at) {
      await connection.rollback();
      return fail(res, 409, "消息已经撤回");
    }
    if (!Boolean(message.within_window)) {
      await connection.rollback();
      return fail(res, 409, "消息发送超过2分钟，无法撤回");
    }
    if (message.message_type === "question" && message.answer != null) {
      await connection.rollback();
      return fail(res, 409, "主持人已回复该提问，无法撤回");
    }
    const [result] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE online_soup_messages
       SET content = '', sticker_id = NULL, mentions_json = NULL, recalled_at = CURRENT_TIMESTAMP
       WHERE id = ? AND room_id = ? AND sender_id = ? AND recalled_at IS NULL
         AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 MINUTE)
         AND (message_type <> 'question' OR answer IS NULL)`,
      [req.params.messageId, context.room.id, context.user.id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return fail(res, 409, "消息状态已变化，无法撤回");
    }
    const [[stored]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT recalled_at FROM online_soup_messages WHERE id = ? LIMIT 1",
      [req.params.messageId]
    );
    recalledAt = iso(stored.recalled_at) ?? new Date().toISOString();
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  res.json({ ok: true, messageId: req.params.messageId, recalledAt });
  void notifyRoom(context.room.id, "message_recalled", {
    messageId: req.params.messageId,
    senderId: context.user.id,
    recalledAt
  });
});

router.patch("/rooms/:roomId/questions/:messageId/answer", async (req, res) => {
  const context = await requireHumanHost(req, res);
  if (!context) return;
  const parsed = z.object({ answer: z.enum(answerValues).nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "回答类型不正确");
  const connection = await pool.getConnection();
  let notificationCreated = false;
  let activitySequence = "0";
  try {
    await connection.beginTransaction();
    const [[question]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, round_id, question_number, answer
       FROM online_soup_messages
       WHERE id = ? AND room_id = ? AND message_type = 'question' AND recalled_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [req.params.messageId, context.room.id]
    );
    if (!question) {
      await connection.rollback();
      return fail(res, 404, "提问不存在");
    }
    const previousAnswer = question.answer ? String(question.answer) as OnlineSoupAnswerValue : null;
    await connection.query(
      "UPDATE online_soup_messages SET answer = ? WHERE id = ?",
      [parsed.data.answer, req.params.messageId]
    );
    const noticeContent = buildAnswerChangeNotice(previousAnswer, parsed.data.answer, Number(question.question_number));
    if (noticeContent) {
      await connection.query(
        `INSERT INTO online_soup_messages
          (id, room_id, round_id, sender_id, message_type, content, target_message_id)
         VALUES (?, ?, ?, NULL, 'system', ?, ?)`,
        [nanoid(), context.room.id, question.round_id, noticeContent, req.params.messageId]
      );
      notificationCreated = true;
    }
    activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, req.params.messageId, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  res.json({ ok: true, notificationCreated });
  void notifyRoom(context.room.id, "answer_changed", {
    messageId: req.params.messageId,
    answer: parsed.data.answer,
    notificationCreated,
    activitySequence,
    activityType: "progress"
  });
});

router.post("/rooms/:roomId/clues", async (req, res) => {
  const context = await requireHumanHost(req, res);
  if (!context) return;
  if (context.room.status !== "playing") return fail(res, 409, "仅推理中可以发布线索");
  const parsed = z.object({ content: z.string().trim().min(1).max(2000) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "线索内容不正确");
  const clueId = nanoid();
  await pool.query("INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content) VALUES (?, ?, ?, ?, 'clue', ?)", [clueId, context.room.id, context.room.current_round_id, context.user.id, parsed.data.content]);
  await systemMessage(context.room.id, context.room.current_round_id, "主持人发布了一条线索");
  const activitySequence = await recordRoomActivity(context.room.id, "clue", context.user.id, clueId);
  res.status(201).json({ ok: true }); void notifyRoom(context.room.id, "clue", { activitySequence, activityType: "clue" });
});

router.post("/rooms/:roomId/publish-surface", async (req, res) => {
  const context = await requireHumanHost(req, res);
  if (!context) return;
  if (context.room.status !== "playing" || !context.room.current_round_id) return fail(res, 409, "仅推理中可以发布补充汤面");
  const parsed = z.object({ surfaceIndex: z.number().int().min(0) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "请选择补充汤面");
  const surfaces = jsonList<string>(context.room.soup_supplemental_surfaces);
  const content = surfaces[parsed.data.surfaceIndex];
  if (!content) return fail(res, 404, "补充汤面不存在");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[round]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT published_surface_indices FROM online_soup_rounds WHERE id = ? FOR UPDATE",
      [context.room.current_round_id]
    );
    const published = jsonList<number>(round?.published_surface_indices);
    if (published.includes(parsed.data.surfaceIndex)) {
      await connection.rollback();
      return fail(res, 409, "该补充汤面已经发布");
    }
    const nextPublished = [...published, parsed.data.surfaceIndex].sort((a, b) => a - b);
    await connection.query(
      "UPDATE online_soup_rounds SET published_surface_indices = ? WHERE id = ?",
      [JSON.stringify(nextPublished), context.room.current_round_id]
    );
    await connection.query(
      `INSERT INTO online_soup_messages
       (id, room_id, round_id, sender_id, message_type, content, content_index)
       VALUES (?, ?, ?, ?, 'supplemental_surface', ?, ?)`,
      [nanoid(), context.room.id, context.room.current_round_id, context.user.id, content, parsed.data.surfaceIndex]
    );
    await systemMessage(context.room.id, context.room.current_round_id, `主持人发布了补充汤面 ${parsed.data.surfaceIndex + 1}`, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, `surface:${parsed.data.surfaceIndex}`);
  res.status(201).json({ ok: true });
  void notifyRoom(context.room.id, "supplemental_surface_published", { activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/publish-bottom", async (req, res) => {
  const context = await requireHumanHost(req, res);
  if (!context) return;
  if (context.room.status !== "playing" || !context.room.current_soup_id || !context.room.current_round_id) return fail(res, 409, "当前没有进行中的推理");
  const parsed = z.object({ bottomIndex: z.number().int().min(0).default(0) }).safeParse(req.body ?? {});
  if (!parsed.success) return fail(res, 400, "请选择要发布的汤底");
  const bottoms = [String(context.room.soup_bottom), ...jsonList<string>(context.room.soup_supplemental_bottoms)];
  const content = bottoms[parsed.data.bottomIndex];
  if (!content) return fail(res, 404, "汤底不存在");

  const connection = await pool.getConnection();
  let ended = false;
  let completedRound = false;
  try {
    await connection.beginTransaction();
    const [[round]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT published_bottom_indices FROM online_soup_rounds WHERE id = ? FOR UPDATE",
      [context.room.current_round_id]
    );
    const published = jsonList<number>(round?.published_bottom_indices);
    if (published.includes(parsed.data.bottomIndex)) {
      await connection.rollback();
      return fail(res, 409, "该汤底已经发布");
    }
    const nextPublished = [...published, parsed.data.bottomIndex].sort((a, b) => a - b);
    ended = nextPublished.length === bottoms.length;
    await connection.query(
      "UPDATE online_soup_rounds SET published_bottom_indices = ?, status = ?, ended_at = ? WHERE id = ?",
      [JSON.stringify(nextPublished), ended ? "ended" : "playing", ended ? new Date() : null, context.room.current_round_id]
    );
    await connection.query(
      `INSERT INTO online_soup_messages
       (id, room_id, round_id, sender_id, message_type, content, content_index)
       VALUES (?, ?, ?, ?, 'bottom', ?, ?)`,
      [nanoid(), context.room.id, context.room.current_round_id, context.user.id, content, parsed.data.bottomIndex]
    );
    if (ended) {
      await connection.query("UPDATE online_soup_rooms SET status = 'ended' WHERE id = ?", [context.room.id]);
      await connection.query(
        `INSERT IGNORE INTO online_soup_completions (round_id, user_id, soup_id)
         SELECT ?, m.user_id, ? FROM online_soup_members m
         WHERE m.room_id = ? AND m.is_active = 1 AND m.member_role = 'player'`,
        [context.room.current_round_id, context.room.current_soup_id, context.room.id]
      );
      await connection.query(
        `INSERT IGNORE INTO soup_access_grants (id, soup_id, user_id, granted_by)
         SELECT CONCAT('online-', LEFT(SHA2(CONCAT(?, ':', m.user_id), 256), 57)), ?, m.user_id, ? FROM online_soup_members m
         WHERE m.room_id = ? AND m.is_active = 1 AND m.member_role = 'player'`,
        [context.room.current_round_id, context.room.current_soup_id, context.user.id, context.room.id]
      );
      await systemMessage(context.room.id, context.room.current_round_id, "所有汤底已发布，本轮游戏结束", connection);
      if (context.room.soup_manual) {
        await connection.query(
          `INSERT INTO online_soup_messages
           (id, room_id, round_id, sender_id, message_type, content)
           VALUES (?, ?, ?, ?, 'manual', ?)`,
          [nanoid(), context.room.id, context.room.current_round_id, context.user.id, String(context.room.soup_manual)]
        );
        await systemMessage(context.room.id, context.room.current_round_id, "主持人手册已自动发布", connection);
      }
      const settlement = await settleOnlineSoupRound(connection, String(context.room.current_round_id));
      completedRound = settlement.completed;
    } else {
      const bottomLabel = parsed.data.bottomIndex === 0 ? "汤底" : `补充汤底 ${parsed.data.bottomIndex}`;
      await systemMessage(context.room.id, context.room.current_round_id, `主持人发布了${bottomLabel}`, connection);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  if (completedRound) recordUserBehavior("complete_online_round");
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, `bottom:${parsed.data.bottomIndex}`);
  res.json({ ok: true, ended }); void notifyRoom(context.room.id, ended ? "round_ended" : "bottom_published", { activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/end-round", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  const connection = await pool.getConnection();
  let roundId = "";
  let completedRound = false;
  try {
    await connection.beginTransaction();
    const [[room]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT host_id, status, current_round_id FROM online_soup_rooms WHERE id = ? AND status <> 'closed' FOR UPDATE",
      [context.room.id]
    );
    if (!room || String(room.host_id) !== context.user.id) {
      await connection.rollback();
      return fail(res, 403, "仅当前主持人可以关闭本轮");
    }
    if (String(room.status) !== "playing" || !room.current_round_id) {
      await connection.rollback();
      return fail(res, 409, "当前没有进行中的推理");
    }
    roundId = String(room.current_round_id);
    const [roundResult] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE online_soup_rounds SET status = 'ended', ended_at = NOW() WHERE id = ? AND status = 'playing'",
      [roundId]
    );
    if (roundResult.affectedRows !== 1) {
      await connection.rollback();
      return fail(res, 409, "本轮推理已经结束");
    }
    await connection.query(
      "UPDATE online_soup_rooms SET status = 'ended' WHERE id = ? AND status = 'playing'",
      [context.room.id]
    );
    await connection.query(
      "UPDATE online_soup_messages SET ai_status = 'cancelled', ai_error = NULL WHERE round_id = ? AND ai_status IN ('pending','answering','scoring')",
      [roundId]
    );
    await connection.query(
      "UPDATE online_soup_finish_votes SET status = 'cancelled', closed_at = NOW() WHERE round_id = ? AND status = 'open'",
      [roundId],
    );
    await systemMessage(context.room.id, roundId, "主持人关闭了本轮推理", connection);
    const settlement = await settleOnlineSoupRound(connection, roundId);
    completedRound = settlement.completed;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (completedRound) recordUserBehavior("complete_online_round");
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, roundId);
  res.json({ ok: true });
  void notifyRoom(context.room.id, "round_ended", { activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/close", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  await systemMessage(context.room.id, context.room.current_round_id, "主持人关闭了房间");
  await pool.query(
    "UPDATE online_soup_finish_votes SET status = 'cancelled', closed_at = NOW() WHERE room_id = ? AND status = 'open'",
    [context.room.id],
  );
  await pool.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW() WHERE id = ?", [context.room.id]);
  res.json({ ok: true }); void notifyRoom(context.room.id, "room_closed");
});

router.get("/admin/rooms", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  if (!isSuperAdminRole(user.role)) return fail(res, 403, "需要超级管理员权限");
  const requestedLimit = Number(req.query.limit ?? 10);
  const requestedOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.trunc(requestedLimit))) : 10;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.trunc(requestedOffset)) : 0;
  const [[totalRow], rows] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM online_soup_rooms").then(([items]) => items),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT r.*, u.nickname AS host_name, u.username AS host_username, s.title AS soup_title,
         SUM(CASE WHEN m.member_role = 'player' AND m.is_active = 1 THEN 1 ELSE 0 END) AS player_count
       FROM online_soup_rooms r JOIN users u ON u.id = r.host_id LEFT JOIN soups s ON s.id = r.current_soup_id
       LEFT JOIN online_soup_members m ON m.room_id = r.id
       GROUP BY r.id
       ORDER BY CASE r.status
         WHEN 'playing' THEN 0
         WHEN 'preparing' THEN 1
         WHEN 'ended' THEN 2
         WHEN 'closed' THEN 3
         ELSE 4
       END, r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    ).then(([items]) => items)
  ]);
  res.json({
    total: Number(totalRow?.total ?? 0),
    rooms: rows.map((row) => ({ ...lobbyRoom(row), hostUsername: String(row.host_username) }))
  });
});

router.get("/admin/rooms/:roomId", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  if (!isSuperAdminRole(user.role)) return fail(res, 403, "需要超级管理员权限");
  const snapshot = await roomSnapshot(req.params.roomId, user);
  if (!snapshot) return fail(res, 404, "房间不存在");
  res.json({
    ...snapshot,
    // Room snapshots are chronological for the player chat timeline. The admin
    // detail panel is a recent-activity view, so keep the newest message first.
    messages: [...(snapshot.messages ?? [])].reverse()
  });
});

export default router;
