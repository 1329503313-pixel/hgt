import { Router } from "express";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { getSticker } from "./stickers.js";
import { settleOnlineSoupRound } from "./shellCurrency.js";
import { levelForExperience } from "./levelSystem.js";

type OnlineUser = { id: string; nickname: string; role: "admin" | "user" };
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
const HOST_OFFLINE_ROOM_EXPIRY_MINUTES = 30;
const MESSAGE_PAGE_SIZE = 100;
export const ONLINE_SOUP_PARTICIPANT_CAPACITY = 11;
export const ONLINE_SOUP_PLAYER_CAPACITY = ONLINE_SOUP_PARTICIPANT_CAPACITY - 1;
const PLAYER_CAPACITY = ONLINE_SOUP_PLAYER_CAPACITY;
const SPECTATOR_CAPACITY = 20;
const answerValues = ["yes", "no", "both", "unknown", "irrelevant"] as const;
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
       s.host_manual AS soup_manual,
       cr.published_surface_indices, cr.published_bottom_indices
     FROM online_soup_rooms r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN soups s ON s.id = r.current_soup_id
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
       ${roomId ? "AND room_id = ?" : ""}`,
    roomId ? [roomId] : []
  );
}

export async function cleanupOnlineSoupStaleSeats() {
  const [staleRooms] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT room_id FROM online_soup_members
     WHERE is_active = 1 AND member_role <> 'host' AND last_seen_at < NOW() - INTERVAL 2 MINUTE`
  );
  await releaseStaleSeats();
  for (const row of staleRooms) notifyRoom(String(row.room_id), "member_left");
}

export async function cleanupOnlineSoupInactiveHostRooms() {
  const [staleRooms] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, current_round_id
     FROM online_soup_rooms
     WHERE status <> 'closed'
       AND host_last_seen_at < NOW() - INTERVAL ${HOST_OFFLINE_ROOM_EXPIRY_MINUTES} MINUTE`
  );
  for (const room of staleRooms) {
    const connection = await pool.getConnection();
    let closed = false;
    try {
      await connection.beginTransaction();
      const [result] = await connection.query<mysql.ResultSetHeader>(
        `UPDATE online_soup_rooms
         SET status = 'closed', closed_at = NOW()
         WHERE id = ? AND status <> 'closed'
           AND host_last_seen_at < NOW() - INTERVAL ${HOST_OFFLINE_ROOM_EXPIRY_MINUTES} MINUTE`,
        [room.id]
      );
      if (result.affectedRows === 1) {
        await systemMessage(
          String(room.id),
          room.current_round_id ? String(room.current_round_id) : null,
          `主持人离线超过${HOST_OFFLINE_ROOM_EXPIRY_MINUTES}分钟，房间已自动解散`,
          connection
        );
        closed = true;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (closed) notifyRoom(String(room.id), "room_closed", { cause: "host_offline_timeout" });
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
      `UPDATE online_soup_rooms SET host_last_seen_at = NOW()
       WHERE id = ? AND host_id = ? AND status <> 'closed'
         AND host_last_seen_at < NOW() - INTERVAL 45 SECOND`,
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

async function requireMember(req: any, res: any) {
  const user = userOf(req);
  if (!user) { fail(res, 401, "请先登录", "LOGIN_REQUIRED"); return null; }
  const room = await roomById(req.params.roomId);
  if (!room || room.status === "closed") { fail(res, 404, "房间不存在或已关闭", "ROOM_CLOSED"); return null; }
  const member = await activeMember(room.id, user.id);
  if (!member && user.role !== "admin") { fail(res, 403, "你尚未加入该房间", "NOT_MEMBER"); return null; }
  const isHost = room.host_id === user.id;
  await touch(room.id, user, isHost);
  if (isHost) room.host_last_seen_at = new Date();
  return { user, room, member };
}

async function requireHost(req: any, res: any) {
  const context = await requireMember(req, res);
  if (!context) return null;
  if (context.room.host_id !== context.user.id) { fail(res, 403, "仅主持人可以执行此操作"); return null; }
  return context;
}

function lobbyRoom(row: mysql.RowDataPacket) {
  const playerCount = Number(row.player_count ?? 0);
  return {
    id: String(row.id),
    code: String(row.room_code),
    name: String(row.name),
    type: String(row.room_type),
    status: String(row.status),
    host: { id: String(row.host_id), nickname: String(row.host_name) },
    soupTitle: row.soup_title ? String(row.soup_title) : null,
    playerCount,
    playerCapacity: PLAYER_CAPACITY,
    participantCount: playerCount + 1,
    participantCapacity: ONLINE_SOUP_PARTICIPANT_CAPACITY,
    hasPassword: row.room_type === "password",
    createdAt: iso(row.created_at)
  };
}

function mapRoomMessage(row: mysql.RowDataPacket, room: mysql.RowDataPacket) {
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
    content: String(row.content),
    stickerId: row.sticker_id ? String(row.sticker_id) : null,
    senderIsHost: Boolean(row.sender_id && String(row.sender_id) === String(room.host_id)),
    contentIndex: row.content_index == null ? null : Number(row.content_index),
    questionNumber: row.question_number == null ? null : Number(row.question_number),
    answer: row.answer ? String(row.answer) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
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
       ms.supplemental_bottoms AS message_supplemental_bottoms
     FROM online_soup_messages m LEFT JOIN users u ON u.id = m.sender_id
     LEFT JOIN legendary_badges sender_lb ON u.equipped_badge_key = CONCAT('legendary:', sender_lb.id)
     LEFT JOIN online_soup_rounds r ON r.id = m.round_id
     LEFT JOIN soups ms ON ms.id = r.soup_id
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
  const [[memberRows], messagePage] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
    `SELECT m.user_id, m.member_role, m.joined_at, m.last_seen_at, u.nickname, u.experience, u.avatar IS NOT NULL AS has_avatar,
       u.equipped_badge_key, u.equipped_badge_icon_url, lb.name AS special_badge_name, lb.tier AS special_badge_tier
     FROM online_soup_members m JOIN users u ON u.id = m.user_id
     LEFT JOIN legendary_badges lb ON u.equipped_badge_key = CONCAT('legendary:', lb.id)
     WHERE m.room_id = ? AND m.is_active = 1 ORDER BY FIELD(m.member_role, 'host','player','spectator'), m.joined_at`,
    [roomId]
    ),
    includeMessages ? roomMessagePage(room) : Promise.resolve(null)
  ]);
  const viewerMember = memberRows.find((row) => String(row.user_id) === viewer.id);
  const isHost = room.host_id === viewer.id;
  const hostOnline = Date.now() - new Date(room.host_last_seen_at).getTime() <= HOST_ONLINE_SECONDS * 1000;
  const supplementalSurfaces = jsonList<string>(room.soup_supplemental_surfaces);
  const publishedSurfaceIndices = jsonList<number>(room.published_surface_indices);
  const visibleSupplementalSurfaces = publishedSurfaceIndices
    .filter((index) => supplementalSurfaces[index])
    .map((index) => ({ index, content: supplementalSurfaces[index] }));
  return {
    room: {
      id: String(room.id), code: String(room.room_code), name: String(room.name), type: String(room.room_type),
      status: String(room.status), hostOnline, playerCount: memberRows.filter((row) => row.member_role === "player").length,
      playerCapacity: PLAYER_CAPACITY,
      participantCapacity: ONLINE_SOUP_PARTICIPANT_CAPACITY,
      currentRoundId: room.current_round_id ? String(room.current_round_id) : null,
      soup: room.current_soup_id ? {
        id: String(room.current_soup_id), title: String(room.soup_title), type: String(room.soup_type),
        surface: String(room.soup_surface),
        visibleSupplementalSurfaces,
        ...(isHost ? {
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
    me: { role: isHost ? "host" : String(viewerMember?.member_role ?? "admin"), isHost },
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

router.get("/rooms", async (_req, res) => {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT r.*, u.nickname AS host_name, s.title AS soup_title,
       SUM(CASE WHEN m.member_role = 'player' AND m.is_active = 1 THEN 1 ELSE 0 END) AS player_count
     FROM online_soup_rooms r JOIN users u ON u.id = r.host_id
     LEFT JOIN soups s ON s.id = r.current_soup_id
     LEFT JOIN online_soup_members m ON m.room_id = r.id
     WHERE r.status IN ('preparing','playing','ended')
     GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 100`
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
  const [[count]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS player_count FROM online_soup_members WHERE room_id = ? AND is_active = 1 AND member_role = 'player'",
    [room.id]
  );
  res.json({ room: lobbyRoom({ ...room, player_count: count.player_count } as mysql.RowDataPacket) });
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
      participantCount: Number(counts.player_count ?? 0) + 1,
      participantCapacity: ONLINE_SOUP_PARTICIPANT_CAPACITY,
      spectatorCapacity: SPECTATOR_CAPACITY,
      hasPassword: room.room_type === "password"
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
    source: z.enum(["library", "mine"]).default("library"),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(60).default(40)
  }).safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "汤库筛选条件不正确");
  const { source, q, page, limit } = parsed.data;
  const conditions = ["s.review_status = 'approved'"];
  const params: Array<string | number> = [user.id];
  if (source === "mine") {
    conditions.push("s.creator_id = ?");
    params.push(user.id);
  } else {
    conditions.push("s.creator_id <> ?");
    conditions.push("(s.is_bottom_public = 1 OR g.user_id IS NOT NULL OR ? = 'admin')");
    params.push(user.id, user.role);
  }
  if (q) {
    conditions.push("(s.title LIKE ? OR s.author LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  params.push(limit + 1, page * limit);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT s.id, s.title, s.type, s.author, s.summary, s.creator_id, s.created_at,
       s.cover_thumbnail IS NOT NULL AS has_cover
     FROM soups s LEFT JOIN soup_access_grants g ON g.soup_id = s.id AND g.user_id = ?
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
    coverImage: row.has_cover ? `/api/media/soups/${encodeURIComponent(String(row.id))}/thumbnail` : null,
    source
  })), hasMore, nextPage: hasMore ? page + 1 : null });
});

router.post("/rooms", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  const parsed = z.object({
    name: z.string().trim().min(1).max(50), type: z.enum(["public", "password"]),
    password: z.string().max(4).optional().default("")
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
      `INSERT INTO online_soup_rooms (id, room_code, name, host_id, room_type, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [roomId, code, parsed.data.name, user.id, parsed.data.type, passwordHash]
    );
    await connection.query(
      "INSERT INTO online_soup_members (room_id, user_id, member_role) VALUES (?, ?, 'host')",
      [roomId, user.id]
    );
    await systemMessage(roomId, null, `主持人 ${user.nickname} 创建了房间`, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  res.status(201).json({ roomId, code });
  notifyLobby("room_created");
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
    if (room.host_id !== user.id && room.room_type === "password" && !(await bcrypt.compare(parsed.data.password, String(room.password_hash)))) {
      await connection.rollback(); return fail(res, 403, "房间密码错误");
    }
    const existing = await activeMember(room.id, user.id, connection);
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
        [room.id, user.id, room.host_id === user.id ? "host" : parsed.data.role]
      );
      await systemMessage(room.id, room.current_round_id, `${user.nickname} 进入了房间`, connection);
    }
    await connection.commit();
    res.json({ roomId: String(room.id) });
    void notifyRoom(String(room.id), "member_joined");
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
    return res.json({ questions: [], hasMore: false, nextCursor: null });
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
    `SELECT m.id, m.message_sequence, m.content, m.question_number, m.answer, m.created_at,
       m.sender_id, u.nickname AS sender_name, u.avatar IS NOT NULL AS sender_has_avatar
     FROM online_soup_messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.round_id = ? AND m.message_type = 'question' ${afterClause}
     ORDER BY m.message_sequence ASC LIMIT ?`,
    params
  );
  const hasMore = rows.length > parsed.data.limit;
  if (hasMore) rows.pop();
  res.json({
    questions: rows.map((row) => ({
      id: String(row.id),
      sequence: String(row.message_sequence),
      number: Number(row.question_number ?? 0),
      content: String(row.content),
      answer: row.answer ? String(row.answer) : null,
      sender: {
        id: row.sender_id ? String(row.sender_id) : null,
        nickname: row.sender_name ? String(row.sender_name) : "未知用户",
        avatar: row.sender_id && row.sender_has_avatar
          ? `/api/media/users/${encodeURIComponent(String(row.sender_id))}/avatar`
          : null
      },
      createdAt: iso(row.created_at)
    })),
    hasMore,
    nextCursor: hasMore && rows.length ? String(rows[rows.length - 1].message_sequence) : null
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
    try {
      await connection.beginTransaction();
      await systemMessage(context.room.id, context.room.current_round_id, "主持人退出，房间已解散", connection);
      await connection.query(
        "UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW() WHERE id = ? AND status <> 'closed'",
        [context.room.id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ ok: true, roomClosed: true });
    void notifyRoom(context.room.id, "room_closed");
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
        "SELECT host_id, current_round_id FROM online_soup_rooms WHERE id = ? AND status <> 'closed' FOR UPDATE",
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
        "SELECT host_id, current_round_id FROM online_soup_rooms WHERE id = ? AND status <> 'closed' FOR UPDATE",
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
      "UPDATE online_soup_rooms SET host_id = ?, host_last_seen_at = NOW() WHERE id = ?",
      [req.params.userId, context.room.id]
    );
    await connection.query(
      "UPDATE online_soup_members SET member_role = ? WHERE room_id = ? AND user_id = ? AND is_active = 1",
      [previousRole, context.room.id, context.user.id]
    );
    await connection.query(
      "UPDATE online_soup_members SET member_role = 'host' WHERE room_id = ? AND user_id = ? AND is_active = 1",
      [context.room.id, req.params.userId]
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
  const [soups] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.id, s.title FROM soups s LEFT JOIN soup_access_grants g ON g.soup_id = s.id AND g.user_id = ?
     WHERE s.id = ? AND s.review_status = 'approved' AND (s.creator_id = ? OR s.is_bottom_public = 1 OR g.user_id IS NOT NULL OR ? = 'admin') LIMIT 1`,
    [context.user.id, parsed.data.soupId, context.user.id, context.user.role]
  );
  if (!soups[0]) return fail(res, 403, "你尚未获得该海龟汤的汤底权限");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let roundId: string;
    if (context.room.status === "preparing" && context.room.current_round_id) {
      roundId = String(context.room.current_round_id);
      await connection.query(
        "UPDATE online_soup_rounds SET soup_id = ? WHERE id = ? AND status = 'preparing'",
        [parsed.data.soupId, roundId]
      );
    } else {
      const [[numberRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT COALESCE(MAX(round_number), 0) + 1 AS next_number FROM online_soup_rounds WHERE room_id = ?", [context.room.id]);
      roundId = nanoid();
      await connection.query("INSERT INTO online_soup_rounds (id, room_id, soup_id, round_number) VALUES (?, ?, ?, ?)", [roundId, context.room.id, parsed.data.soupId, numberRow.next_number]);
    }
    await connection.query("UPDATE online_soup_rooms SET current_soup_id = ?, current_round_id = ?, status = 'preparing' WHERE id = ?", [parsed.data.soupId, roundId, context.room.id]);
    const action = context.room.current_soup_id ? "更换了" : "选择了";
    await systemMessage(context.room.id, roundId, `主持人${action}海龟汤：${soups[0].title}`, connection);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  res.json({ ok: true }); void notifyRoom(context.room.id, "soup_selected");
});

router.post("/rooms/:roomId/start", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  if (context.room.status !== "preparing" || !context.room.current_round_id) return fail(res, 409, "当前房间无法开始新一轮");
  await pool.query("UPDATE online_soup_rounds SET status = 'playing', started_at = NOW() WHERE id = ?", [context.room.current_round_id]);
  await pool.query("UPDATE online_soup_rooms SET status = 'playing' WHERE id = ?", [context.room.id]);
  await systemMessage(context.room.id, context.room.current_round_id, "新一轮推理开始");
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, context.room.current_round_id);
  res.json({ ok: true }); void notifyRoom(context.room.id, "round_started", { activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/messages", async (req, res) => {
  const context = await requireMember(req, res);
  if (!context) return;
  const parsed = z.discriminatedUnion("type", [
    z.object({ type: z.enum(["discussion", "question"]), content: z.string().trim().min(1).max(1000) }),
    z.object({ type: z.literal("sticker"), stickerId: z.string().trim().min(1).max(64) })
  ]).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? "消息内容不正确");
  const sticker = parsed.data.type === "sticker" ? getSticker(parsed.data.stickerId) : null;
  if (parsed.data.type === "sticker" && !sticker) return fail(res, 400, "表情不存在或已下架");
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
    if (parsed.data.type === "question") {
      await connection.query("UPDATE online_soup_rounds SET question_count = LAST_INSERT_ID(question_count + 1) WHERE id = ?", [context.room.current_round_id]);
      const [[row]] = await connection.query<mysql.RowDataPacket[]>("SELECT question_count FROM online_soup_rounds WHERE id = ?", [context.room.current_round_id]);
      questionNumber = Number(row.question_count);
    }
    const type = parsed.data.type === "discussion" && context.user.id === context.room.host_id ? "host" : parsed.data.type;
    const content = parsed.data.type === "sticker" ? "" : parsed.data.content;
    const id = nanoid();
    await connection.query(
      "INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content, sticker_id, question_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, context.room.id, context.room.current_round_id, context.user.id, type, content, sticker?.id ?? null, questionNumber]
    );
    activitySequence = await recordRoomActivity(context.room.id, parsed.data.type === "question" ? "progress" : "chat", context.user.id, id, connection);
    await connection.commit();
    res.status(201).json({ id, questionNumber });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  void notifyRoom(context.room.id, "message", { activitySequence, activityType: parsed.data.type === "question" ? "progress" : "chat" });
});

router.patch("/rooms/:roomId/questions/:messageId/answer", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  const parsed = z.object({ answer: z.enum(answerValues).nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "回答类型不正确");
  const [result] = await pool.query<mysql.ResultSetHeader>(
    "UPDATE online_soup_messages SET answer = ? WHERE id = ? AND room_id = ? AND message_type = 'question'",
    [parsed.data.answer, req.params.messageId, context.room.id]
  );
  if (!result.affectedRows) return fail(res, 404, "提问不存在");
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, req.params.messageId);
  res.json({ ok: true });
  void notifyRoom(context.room.id, "answer_changed", { messageId: req.params.messageId, answer: parsed.data.answer, activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/clues", async (req, res) => {
  const context = await requireHost(req, res);
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
  const context = await requireHost(req, res);
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
  const context = await requireHost(req, res);
  if (!context) return;
  if (context.room.status !== "playing" || !context.room.current_soup_id || !context.room.current_round_id) return fail(res, 409, "当前没有进行中的推理");
  const parsed = z.object({ bottomIndex: z.number().int().min(0).default(0) }).safeParse(req.body ?? {});
  if (!parsed.success) return fail(res, 400, "请选择要发布的汤底");
  const bottoms = [String(context.room.soup_bottom), ...jsonList<string>(context.room.soup_supplemental_bottoms)];
  const content = bottoms[parsed.data.bottomIndex];
  if (!content) return fail(res, 404, "汤底不存在");

  const connection = await pool.getConnection();
  let ended = false;
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
      await settleOnlineSoupRound(connection, String(context.room.current_round_id));
    } else {
      const bottomLabel = parsed.data.bottomIndex === 0 ? "汤底" : `补充汤底 ${parsed.data.bottomIndex}`;
      await systemMessage(context.room.id, context.room.current_round_id, `主持人发布了${bottomLabel}`, connection);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, `bottom:${parsed.data.bottomIndex}`);
  res.json({ ok: true, ended }); void notifyRoom(context.room.id, ended ? "round_ended" : "bottom_published", { activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/end-round", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  const connection = await pool.getConnection();
  let roundId = "";
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
    await systemMessage(context.room.id, roundId, "主持人关闭了本轮推理", connection);
    await settleOnlineSoupRound(connection, roundId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const activitySequence = await recordRoomActivity(context.room.id, "progress", context.user.id, roundId);
  res.json({ ok: true });
  void notifyRoom(context.room.id, "round_ended", { activitySequence, activityType: "progress" });
});

router.post("/rooms/:roomId/close", async (req, res) => {
  const context = await requireHost(req, res);
  if (!context) return;
  await systemMessage(context.room.id, context.room.current_round_id, "主持人关闭了房间");
  await pool.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW() WHERE id = ?", [context.room.id]);
  res.json({ ok: true }); void notifyRoom(context.room.id, "room_closed");
});

router.get("/admin/rooms", async (req, res) => {
  const user = userOf(req);
  if (!user) return fail(res, 401, "请先登录");
  if (user.role !== "admin") return fail(res, 403, "需要管理员权限");
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
       GROUP BY r.id ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
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
  if (user.role !== "admin") return fail(res, 403, "需要管理员权限");
  const snapshot = await roomSnapshot(req.params.roomId, user);
  if (!snapshot) return fail(res, 404, "房间不存在");
  res.json(snapshot);
});

export default router;
