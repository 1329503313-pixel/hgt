import { createHash, randomUUID } from "node:crypto";
import type { Router, Request } from "express";
import type mysql from "mysql2/promise";
import { Api } from "tls-sig-api-v2";
import { Client } from "tencentcloud-sdk-nodejs-trtc/tencentcloud/services/trtc/v20190722/trtc_client.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { assignVoiceSeats, voiceAvailable, voicePrivileges, VOICE_TICKET_SECONDS, VOICE_VERSION } from "./onlineSoupVoicePolicy.js";

export const isVoiceRoom = (room: Record<string, unknown>) => room.communication_mode === "voice";
export const voiceEnabled = () => voiceAvailable(config.voice);
const rtcRoom = (id: string) => `hgt_${id}`;
let client: Client | undefined;
function rtcClient() {
  return client ??= new Client({ credential: { secretId: config.voice.secretId, secretKey: config.voice.secretKey },
    region: "ap-guangzhou", profile: { httpProfile: { reqTimeout: 5 } } });
}
export async function syncVoiceSeats(db: mysql.PoolConnection, roomId: string) {
  const [[room]] = await db.query<mysql.RowDataPacket[]>("SELECT communication_mode FROM online_soup_rooms WHERE id=? FOR UPDATE", [roomId]);
  if (!room || !isVoiceRoom(room)) return;
  await db.query("UPDATE online_soup_members SET voice_seat=NULL WHERE room_id=? AND (is_active=0 OR member_role<>'player')", [roomId]);
  const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT user_id,member_role,voice_seat FROM online_soup_members WHERE room_id=? AND is_active=1 ORDER BY voice_seat IS NULL, joined_at,user_id", [roomId]);
  for (const member of assignVoiceSeats(rows.map(r => ({ id: String(r.user_id), role: String(r.member_role), seat: r.voice_seat == null ? null : Number(r.voice_seat) })))) {
    await db.query("UPDATE online_soup_members SET voice_seat=? WHERE room_id=? AND user_id=?", [member.seat, roomId, member.id]);
  }
}

// A durable outbox also covers disconnects, host succession, idle cleanup and server restarts.
// Revoked identities are removed repeatedly until their last entry ticket expires.
let reconciling = false;
export async function reconcileVoiceSessions() {
  if (config.releaseCandidate || reconciling || !config.voice.sdkAppId || !config.voice.secretId || !config.voice.secretKey) return;
  reconciling = true;
  try {
    await pool.query(`UPDATE online_soup_voice_sessions s LEFT JOIN online_soup_members m ON m.room_id=s.room_id AND m.user_id=s.user_id
      LEFT JOIN online_soup_rooms r ON r.id=s.room_id SET s.revoked=1
      WHERE s.revoked=0 AND (m.user_id IS NULL OR m.is_active=0 OR m.member_role='spectator' OR r.status='closed'
      OR s.last_seen_at < NOW(3)-INTERVAL 30 SECOND OR s.can_publish<>(IF(m.muted_until>NOW(),0,1)) OR ?=0)`, [voiceEnabled() ? 1 : 0]);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id,room_id,rtc_user_id,ticket_expires_at FROM online_soup_voice_sessions WHERE revoked=1 ORDER BY last_seen_at LIMIT 100");
    for (const row of rows) {
      try {
        await rtcClient().RemoveUserByStrRoomId({ SdkAppId: config.voice.sdkAppId, RoomId: rtcRoom(String(row.room_id)), UserIds: [String(row.rtc_user_id)] });
        if (new Date(row.ticket_expires_at).getTime() + 5000 < Date.now()) await pool.query("DELETE FROM online_soup_voice_sessions WHERE id=? AND revoked=1", [row.id]);
      } catch { /* Retry from persisted outbox; never log provider credentials or signed requests. */ }
    }
  } finally { reconciling = false; }
}

export async function voiceMvpCandidates(db: Pick<mysql.PoolConnection, "query">, roomId: string, roundId: string) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(`SELECT m.user_id AS id,u.nickname,u.avatar IS NOT NULL AS has_avatar
    FROM online_soup_members m JOIN users u ON u.id=m.user_id
    JOIN online_soup_round_viewers v ON v.user_id=m.user_id AND v.round_id=?
    WHERE m.room_id=? AND m.member_role='player' AND m.is_active=1 ORDER BY m.joined_at,m.user_id`, [roundId, roomId]);
  return rows.map(r => ({ id: String(r.id), nickname: String(r.nickname), avatar: r.has_avatar ? `/api/media/users/${encodeURIComponent(String(r.id))}/avatar` : null }));
}

export function registerVoiceRoutes(router: Router, userOf: (req: Request) => { id: string } | null | undefined) {
  router.get("/voice/capabilities", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ enabled: voiceEnabled(), version: VOICE_VERSION }); });
  router.use("/rooms/:roomId", async (req, res, next) => {
    if (!["POST", "PATCH"].includes(req.method)) return next();
    const guarded = /^\/(join(?:-auto)?|messages|host-mode|resolve-question-limit|.*best-question|.*answer)(?:\/|$)/.test(req.path);
    if (!guarded) return next();
    const [[room]] = await pool.query<mysql.RowDataPacket[]>("SELECT communication_mode FROM online_soup_rooms WHERE id=?", [req.params.roomId]);
    if (!room || !isVoiceRoom(room)) return next();
    if (!req.path.startsWith("/join")) { res.status(409).json({ error: "语音玩汤不支持该文字操作" }); return; }
    if (!voiceEnabled()) { res.status(503).json({ error: "语音玩汤暂未开放" }); return; }
    if (req.get("X-HGT-Voice-Version") !== VOICE_VERSION) { res.status(426).json({ error: "请更新客户端后进入语音房" }); return; }
    if (req.body?.role === "spectator") { res.status(400).json({ error: "语音房不支持观战" }); return; }
    next();
  });
  router.get("/rooms/:roomId/voice/mvp-candidates", async (req, res) => {
    const user = userOf(req);
    const [[room]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_soup_rooms WHERE id=? AND host_id=? AND communication_mode='voice'", [req.params.roomId, user?.id ?? ""]);
    if (!room) { res.status(403).json({ error: "仅语音房主持人可评选 MVP" }); return; }
    res.json({ candidates: await voiceMvpCandidates(pool, String(room.id), String(room.current_round_id)) });
  });
  router.post("/rooms/:roomId/voice/session", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = userOf(req);
    if (!user) { res.status(401).json({ error: "请先登录" }); return; }
    if (!voiceEnabled()) { res.status(503).json({ error: "语音玩汤暂未开放" }); return; }
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      // User lock makes simultaneous tabs/devices mutually exclusive without affecting login sessions.
      await db.query("SELECT id FROM users WHERE id=? FOR UPDATE", [user.id]);
      const [[member]] = await db.query<mysql.RowDataPacket[]>(`SELECT m.*,r.status,r.communication_mode FROM online_soup_members m JOIN online_soup_rooms r ON r.id=m.room_id
        WHERE m.room_id=? AND m.user_id=? AND m.is_active=1 AND m.member_role IN ('host','player') AND r.status<>'closed' FOR UPDATE`, [req.params.roomId, user.id]);
      if (!member || !isVoiceRoom(member)) { await db.rollback(); res.status(403).json({ error: "你已离开语音房" }); return; }
      const [[active]] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM online_soup_voice_sessions WHERE user_id=? AND revoked=0 AND last_seen_at>NOW(3)-INTERVAL 30 SECOND", [user.id]);
      if (active && active.id !== req.body?.sessionId) { await db.rollback(); res.status(409).json({ error: "另一页面或设备正在使用语音，请先断开该连接" }); return; }
      await db.query("UPDATE online_soup_voice_sessions SET revoked=1 WHERE user_id=?", [user.id]);
      const id = randomUUID();
      const rtcUserId = createHash("sha256").update(`${user.id}:${id}`).digest("hex").slice(0, 32);
      const canPublish = !member.muted_until || new Date(member.muted_until).getTime() <= Date.now();
      await db.query(`INSERT INTO online_soup_voice_sessions (id,user_id,room_id,rtc_user_id,can_publish,ticket_expires_at)
        VALUES (?,?,?,?,?,NOW(3)+INTERVAL ? SECOND)`, [id, user.id, req.params.roomId, rtcUserId, canPublish, VOICE_TICKET_SECONDS]);
      await db.commit();
      const signer = new Api(config.voice.sdkAppId, config.voice.sdkSecret);
      res.json({ sessionId: id, sdkAppId: config.voice.sdkAppId, userId: rtcUserId, strRoomId: rtcRoom(String(req.params.roomId)),
        userSig: signer.genUserSig(rtcUserId, VOICE_TICKET_SECONDS), privateMapKey: signer.genPrivateMapKeyWithStringRoomID(rtcUserId, VOICE_TICKET_SECONDS, rtcRoom(String(req.params.roomId)), voicePrivileges(!canPublish)), canPublish });
      void reconcileVoiceSessions().catch(() => {});
    } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
  });
  router.post("/rooms/:roomId/voice/heartbeat", async (req, res) => {
    const user = userOf(req);
    // Cloud control-plane retries must never block media leases or business requests.
    void reconcileVoiceSessions().catch(() => {});
    const [result] = await pool.query<mysql.ResultSetHeader>(`UPDATE online_soup_voice_sessions s
      JOIN online_soup_members m ON m.room_id=s.room_id AND m.user_id=s.user_id
      JOIN online_soup_rooms r ON r.id=s.room_id SET s.last_seen_at=NOW(3)
      WHERE s.id=? AND s.room_id=? AND s.user_id=? AND s.revoked=0 AND m.is_active=1
      AND m.member_role IN ('host','player') AND r.status<>'closed' AND r.communication_mode='voice'
      AND s.can_publish=IF(m.muted_until>NOW(),0,1)`, [String(req.body?.sessionId ?? ""), req.params.roomId, user?.id ?? ""]);
    if (!result.affectedRows || !voiceEnabled()) {
      await pool.query("UPDATE online_soup_voice_sessions SET revoked=1 WHERE id=? AND user_id=?", [String(req.body?.sessionId ?? ""), user?.id ?? ""]);
      res.status(403).json({ error: "语音权限已变更，请重新连接" }); return;
    }
    const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT s.rtc_user_id,s.user_id,s.can_publish FROM online_soup_voice_sessions s
      JOIN online_soup_members m ON m.room_id=s.room_id AND m.user_id=s.user_id
      WHERE s.room_id=? AND s.revoked=0 AND m.is_active=1 AND m.member_role IN ('host','player')
      AND s.can_publish=IF(m.muted_until>NOW(),0,1) AND s.last_seen_at>NOW(3)-INTERVAL 30 SECOND`, [req.params.roomId]);
    res.setHeader("Cache-Control", "no-store"); res.json({ members: rows.map(r => ({ rtcUserId: r.rtc_user_id, userId: r.user_id, canPublish: Boolean(r.can_publish) })) });
  });
  router.post("/rooms/:roomId/voice/leave", async (req, res) => {
    await pool.query("UPDATE online_soup_voice_sessions SET revoked=1 WHERE id=? AND room_id=? AND user_id=?", [String(req.body?.sessionId ?? ""), req.params.roomId, userOf(req)?.id ?? ""]);
    res.json({ ok: true }); void reconcileVoiceSessions().catch(() => {});
  });
  if (!config.releaseCandidate) {
    const timer = setInterval(() => { void reconcileVoiceSessions().catch(() => {}); }, 5000); timer.unref();
  }
}
