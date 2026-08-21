import { randomInt } from "node:crypto";
import type express from "express";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";

const MAX_PACKET_COUNT = 1_000;
const MAX_TOTAL_SHELLS = 2_000_000_000;
const MAX_SHELL_BALANCE = 4_294_967_295;
const RED_PACKET_LIFETIME_MS = 24 * 60 * 60_000;

type RouteUser = { id: string };
type Dependencies = {
  pool: mysql.Pool;
  requireAuth: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  requireAdmin: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  sendError: (res: express.Response, status: number, message: string) => unknown;
  onPublished: (circleId: string, messageId: string) => Promise<void> | void;
};

const packetSchema = z.object({
  packetCount: z.coerce.number().int().min(1).max(MAX_PACKET_COUNT),
  totalShells: z.coerce.number().int().min(1).max(MAX_TOTAL_SHELLS),
  publishAt: z.string().datetime().optional()
}).superRefine((value, context) => {
  if (value.packetCount > value.totalShells) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["packetCount"], message: "红包个数不能超过贝壳总数" });
  }
});

const periodicSchema = z.object({
  packetCount: z.coerce.number().int().min(1).max(MAX_PACKET_COUNT),
  totalShells: z.coerce.number().int().min(1).max(MAX_TOTAL_SHELLS),
  publishTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "发布时间格式不正确"),
  enabled: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.packetCount > value.totalShells) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["packetCount"], message: "红包个数不能超过贝壳总数" });
  }
});

export function luckyRedPacketAmount(remainingShells: number, remainingPackets: number, rng: (min: number, max: number) => number = (min, max) => randomInt(min, max)) {
  if (!Number.isInteger(remainingShells) || !Number.isInteger(remainingPackets) || remainingPackets < 1 || remainingShells < remainingPackets) {
    throw new Error("INVALID_RED_PACKET_REMAINDER");
  }
  if (remainingPackets === 1) return remainingShells;
  const reservableMaximum = remainingShells - remainingPackets + 1;
  const doubleAverageMaximum = Math.max(1, Math.floor((remainingShells / remainingPackets) * 2));
  return rng(1, Math.min(reservableMaximum, doubleAverageMaximum) + 1);
}

function packetContent(packet: { id: string; total_shells: number; packet_count: number; published_at: Date; expires_at: Date }) {
  return JSON.stringify({
    packetId: packet.id,
    totalShells: Number(packet.total_shells),
    packetCount: Number(packet.packet_count),
    publishedAt: new Date(packet.published_at).toISOString(),
    expiresAt: new Date(packet.expires_at).toISOString()
  });
}

async function publishLocked(connection: mysql.PoolConnection, row: mysql.RowDataPacket) {
  const publishedAt = new Date();
  const expiresAt = new Date(publishedAt.getTime() + RED_PACKET_LIFETIME_MS);
  const messageId = nanoid();
  const [updated] = await connection.query<mysql.ResultSetHeader>(
    `UPDATE circle_red_packets SET status = 'published', published_at = ?, expires_at = ?, message_id = ?
     WHERE id = ? AND status = 'scheduled'`,
    [publishedAt, expiresAt, messageId, row.id]
  );
  if (!updated.affectedRows) return null;
  await connection.query(
    `INSERT INTO circle_messages (id, circle_id, sender_id, content, message_type, red_packet_id)
     VALUES (?, ?, NULL, ?, 'red_packet', ?)`,
    [messageId, row.circle_id, packetContent({ id: String(row.id), total_shells: Number(row.total_shells), packet_count: Number(row.packet_count), published_at: publishedAt, expires_at: expiresAt }), row.id]
  );
  await connection.query("UPDATE circles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [row.circle_id]);
  return { circleId: String(row.circle_id), messageId };
}

function packetResponse(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    circleId: String(row.circle_id),
    source: row.source === "periodic" ? "periodic" : "one_time",
    packetCount: Number(row.packet_count),
    totalShells: Number(row.total_shells),
    status: String(row.status),
    publishAt: new Date(row.publish_at).toISOString(),
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null
  };
}

function beijingParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:00` };
}

export function registerCircleRedPacketRoutes(app: express.Express, dependencies: Dependencies) {
  const { pool, requireAuth, requireAdmin, sendError, onPublished } = dependencies;

  app.get("/api/admin/circles/:id/red-packets/pending", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM circle_red_packets WHERE circle_id = ? AND source = 'one_time' AND status = 'scheduled'
       ORDER BY publish_at ASC`, [req.params.id]
    );
    res.json({ packets: rows.map(packetResponse) });
  });

  app.post("/api/admin/circles/:id/red-packets", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = packetSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "红包参数不正确");
    const [[circle]] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM circles WHERE id = ? LIMIT 1", [req.params.id]);
    if (!circle) return sendError(res, 404, "圈子不存在");
    const publishAt = parsed.data.publishAt ? new Date(parsed.data.publishAt) : new Date();
    if (parsed.data.publishAt && publishAt.getTime() <= Date.now() + 30_000) return sendError(res, 400, "定时发布时间至少晚于当前时间 30 秒");
    const id = nanoid();
    const connection = await pool.getConnection();
    let published: { circleId: string; messageId: string } | null = null;
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO circle_red_packets (id, circle_id, created_by, source, packet_count, total_shells, status, publish_at)
         VALUES (?, ?, ?, 'one_time', ?, ?, 'scheduled', ?)`,
        [id, req.params.id, admin.id, parsed.data.packetCount, parsed.data.totalShells, publishAt]
      );
      if (!parsed.data.publishAt) {
        const [[row]] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM circle_red_packets WHERE id = ? FOR UPDATE", [id]);
        published = await publishLocked(connection, row);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
    if (published) await onPublished(published.circleId, published.messageId);
    const [[created]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM circle_red_packets WHERE id = ? LIMIT 1", [id]);
    res.status(201).json({ packet: packetResponse(created) });
  });

  app.put("/api/admin/circles/:circleId/red-packets/:packetId", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = packetSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.publishAt) return sendError(res, 400, parsed.success ? "定时红包必须设置发布时间" : parsed.error.issues[0]?.message ?? "红包参数不正确");
    const publishAt = new Date(parsed.data.publishAt);
    if (publishAt.getTime() <= Date.now() + 30_000) return sendError(res, 400, "定时发布时间至少晚于当前时间 30 秒");
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE circle_red_packets SET packet_count = ?, total_shells = ?, publish_at = ?
       WHERE id = ? AND circle_id = ? AND source = 'one_time' AND status = 'scheduled'`,
      [parsed.data.packetCount, parsed.data.totalShells, publishAt, req.params.packetId, req.params.circleId]
    );
    if (!result.affectedRows) return sendError(res, 409, "红包已发布或已取消，不能修改");
    const [[updated]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM circle_red_packets WHERE id = ? LIMIT 1", [req.params.packetId]);
    res.json({ packet: packetResponse(updated) });
  });

  app.delete("/api/admin/circles/:circleId/red-packets/:packetId", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE circle_red_packets SET status = 'cancelled'
       WHERE id = ? AND circle_id = ? AND source = 'one_time' AND status = 'scheduled'`,
      [req.params.packetId, req.params.circleId]
    );
    if (!result.affectedRows) return sendError(res, 409, "红包已发布或已取消，不能取消");
    res.json({ ok: true });
  });

  app.get("/api/admin/circles/:id/red-packet-schedule", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM circle_red_packet_schedules WHERE circle_id = ? LIMIT 1", [req.params.id]);
    res.json({ schedule: row ? { packetCount: Number(row.packet_count), totalShells: Number(row.total_shells), publishTime: String(row.publish_time).slice(0, 5), enabled: Boolean(row.enabled) } : null });
  });

  app.put("/api/admin/circles/:id/red-packet-schedule", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = periodicSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "周期红包参数不正确");
    const [[circle]] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM circles WHERE id = ? LIMIT 1", [req.params.id]);
    if (!circle) return sendError(res, 404, "圈子不存在");
    await pool.query(
      `INSERT INTO circle_red_packet_schedules (circle_id, packet_count, total_shells, publish_time, enabled, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE packet_count = VALUES(packet_count), total_shells = VALUES(total_shells),
         publish_time = VALUES(publish_time), enabled = VALUES(enabled), updated_by = VALUES(updated_by)`,
      [req.params.id, parsed.data.packetCount, parsed.data.totalShells, `${parsed.data.publishTime}:00`, parsed.data.enabled, admin.id, admin.id]
    );
    res.json({ schedule: parsed.data });
  });

  app.get("/api/circles/:circleId/red-packets/:packetId", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [[packet]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT p.*, EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = p.circle_id AND m.user_id = ?) AS is_member
       FROM circle_red_packets p WHERE p.id = ? AND p.circle_id = ? LIMIT 1`,
      [user.id, req.params.packetId, req.params.circleId]
    );
    if (!packet || !packet.is_member || packet.status !== "published") return sendError(res, 404, "红包不存在或你不在该圈子");
    const [claims] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT c.user_id, c.amount, c.claimed_at, u.nickname, u.avatar IS NOT NULL AS has_avatar
       FROM circle_red_packet_claims c INNER JOIN users u ON u.id = c.user_id
       WHERE c.packet_id = ? ORDER BY c.claimed_at ASC`, [packet.id]
    );
    const mine = claims.find((claim) => String(claim.user_id) === user.id);
    const claimedShells = claims.reduce((sum, claim) => sum + Number(claim.amount), 0);
    res.json({ packet: { ...packetResponse(packet), claimedCount: claims.length, claimedShells, myAmount: mine ? Number(mine.amount) : null,
      canClaim: !mine && claims.length < Number(packet.packet_count) && new Date(packet.expires_at).getTime() > Date.now(),
      claims: claims.map((claim) => ({ userId: String(claim.user_id), nickname: String(claim.nickname), amount: Number(claim.amount), claimedAt: new Date(claim.claimed_at).toISOString() })) } });
  });

  app.post("/api/circles/:circleId/red-packets/:packetId/claim", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[packet]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT p.*, EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = p.circle_id AND m.user_id = ?) AS is_member
         FROM circle_red_packets p WHERE p.id = ? AND p.circle_id = ? FOR UPDATE`, [user.id, req.params.packetId, req.params.circleId]
      );
      if (!packet || !packet.is_member || packet.status !== "published") { await connection.rollback(); return sendError(res, 404, "红包不存在或你不在该圈子"); }
      const [[existing]] = await connection.query<mysql.RowDataPacket[]>("SELECT amount FROM circle_red_packet_claims WHERE packet_id = ? AND user_id = ? LIMIT 1", [packet.id, user.id]);
      if (existing) { await connection.rollback(); return sendError(res, 409, "你已经领取过这个红包"); }
      if (new Date(packet.expires_at).getTime() <= Date.now()) { await connection.rollback(); return sendError(res, 409, "红包已过期"); }
      const [[summary]] = await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS claimed_count, COALESCE(SUM(amount), 0) AS claimed_shells FROM circle_red_packet_claims WHERE packet_id = ?", [packet.id]);
      const remainingPackets = Number(packet.packet_count) - Number(summary.claimed_count);
      const remainingShells = Number(packet.total_shells) - Number(summary.claimed_shells);
      if (remainingPackets <= 0) { await connection.rollback(); return sendError(res, 409, "红包已经被领完了"); }
      const amount = luckyRedPacketAmount(remainingShells, remainingPackets);
      const [[balanceRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? FOR UPDATE", [user.id]);
      const balanceAfter = Number(balanceRow.shell_balance) + amount;
      if (balanceAfter > MAX_SHELL_BALANCE) { await connection.rollback(); return sendError(res, 409, "贝壳余额已达上限，暂时无法领取"); }
      await connection.query("INSERT INTO circle_red_packet_claims (packet_id, user_id, amount) VALUES (?, ?, ?)", [packet.id, user.id, amount]);
      await connection.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balanceAfter, user.id]);
      await connection.query(
        `INSERT INTO shell_transactions (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
         VALUES (?, ?, 'circle_red_packet', ?, ?, 'circle_red_packet', ?, '领取圈子系统红包', ?)`,
        [nanoid(), user.id, amount, balanceAfter, packet.id, `circle-red-packet:${packet.id}:${user.id}`]
      );
      await connection.commit();
      res.json({ amount, balance: balanceAfter });
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
  });
}

export function startCircleRedPacketScheduler(dependencies: Pick<Dependencies, "pool" | "onPublished">) {
  const run = async () => {
    const notifications: Array<{ circleId: string; messageId: string }> = [];
    const [due] = await dependencies.pool.query<mysql.RowDataPacket[]>("SELECT id FROM circle_red_packets WHERE status = 'scheduled' AND publish_at <= UTC_TIMESTAMP() ORDER BY publish_at ASC LIMIT 100");
    for (const candidate of due) {
      const connection = await dependencies.pool.getConnection();
      try {
        await connection.beginTransaction();
        const [[row]] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM circle_red_packets WHERE id = ? FOR UPDATE", [candidate.id]);
        if (row && row.status === "scheduled" && new Date(row.publish_at).getTime() <= Date.now()) {
          const published = await publishLocked(connection, row);
          if (published) notifications.push(published);
        }
        await connection.commit();
      } catch (error) { await connection.rollback().catch(() => {}); throw error; }
      finally { connection.release(); }
    }

    const now = beijingParts();
    const [schedules] = await dependencies.pool.query<mysql.RowDataPacket[]>(
      `SELECT circle_id FROM circle_red_packet_schedules
       WHERE enabled = TRUE AND publish_time <= ? AND (last_published_date IS NULL OR last_published_date < ?)` , [now.time, now.date]
    );
    for (const candidate of schedules) {
      const connection = await dependencies.pool.getConnection();
      try {
        await connection.beginTransaction();
        const [[schedule]] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM circle_red_packet_schedules WHERE circle_id = ? FOR UPDATE", [candidate.circle_id]);
        const lastPublishedDate = schedule?.last_published_date instanceof Date
          ? schedule.last_published_date.toISOString().slice(0, 10)
          : String(schedule?.last_published_date ?? "").slice(0, 10);
        if (schedule && Boolean(schedule.enabled) && String(schedule.publish_time) <= now.time && (!lastPublishedDate || lastPublishedDate < now.date)) {
          const id = nanoid();
          await connection.query(
            `INSERT INTO circle_red_packets (id, circle_id, created_by, source, packet_count, total_shells, status, publish_at)
             VALUES (?, ?, ?, 'periodic', ?, ?, 'scheduled', UTC_TIMESTAMP())`,
            [id, schedule.circle_id, schedule.updated_by ?? schedule.created_by, schedule.packet_count, schedule.total_shells]
          );
          const [[row]] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM circle_red_packets WHERE id = ? FOR UPDATE", [id]);
          const published = await publishLocked(connection, row);
          if (published) notifications.push(published);
          await connection.query("UPDATE circle_red_packet_schedules SET last_published_date = ? WHERE circle_id = ?", [now.date, schedule.circle_id]);
        }
        await connection.commit();
      } catch (error) { await connection.rollback().catch(() => {}); throw error; }
      finally { connection.release(); }
    }
    for (const notification of notifications) await dependencies.onPublished(notification.circleId, notification.messageId);
  };
  void run().catch((error) => console.error("Circle red packet scheduler failed:", error));
  const timer = setInterval(() => void run().catch((error) => console.error("Circle red packet scheduler failed:", error)), 30_000);
  timer.unref();
  return timer;
}
