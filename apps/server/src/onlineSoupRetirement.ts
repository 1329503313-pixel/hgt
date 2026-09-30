import type { Router, RequestHandler } from "express";
import type mysql from "mysql2/promise";

const retired: RequestHandler = (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(410).json({ error: "语音玩汤已下架，请返回大厅选择文字玩汤或 AI玩汤", code: "ROOM_CLOSED" });
};

// Keep only tombstones for installed clients. No configuration can re-enable RTC.
export function registerRetiredVoiceRoutes(router: Router, db: Pick<mysql.Pool, "query">) {
  router.get("/voice/capabilities", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled: false, retired: true, version: "1" });
  });
  router.use("/voice", retired);
  router.use("/rooms/:roomId/voice", retired);
  router.post("/rooms", (req, res, next) => {
    if (req.body?.communicationMode === "voice" || req.body?.hostMode === "voice") return retired(req, res, next);
    next();
  });
  // Covers snapshots, join, heartbeats, invitations and all room mutations,
  // including handlers that bypass roomById and lock the room directly.
  router.param("roomId", async (req, res, next, roomId: string) => {
    try {
      const [[room]] = await db.query<mysql.RowDataPacket[]>(
        "SELECT communication_mode FROM online_soup_rooms WHERE id = ? LIMIT 1", [roomId]
      );
      if (room?.communication_mode === "voice") return retired(req, res, next);
      next();
    } catch (error) { next(error); }
  });
}

// Called during normal database initialization, never by read-only release candidates.
// Preserve rounds, messages, honors and records; closing is not a game settlement.
export async function retireLegacyVoiceRooms(db: mysql.PoolConnection) {
  await db.beginTransaction();
  try {
    await db.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = COALESCE(closed_at, NOW()) WHERE communication_mode = 'voice' AND status <> 'closed'");
    await db.query(`UPDATE online_soup_members m JOIN online_soup_rooms r ON r.id = m.room_id
      SET m.is_active = 0, m.left_at = COALESCE(m.left_at, NOW())
      WHERE r.communication_mode = 'voice' AND m.is_active = 1`);
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  }
}
