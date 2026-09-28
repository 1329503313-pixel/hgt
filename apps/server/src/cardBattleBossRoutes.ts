import type { Router, RequestHandler } from "express";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { createHash, randomInt } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { pool } from "./db.js";
import { isSuperAdminRole } from "./roles.js";
import { bossCoverPattern, bossInputSchema } from "./cardBattleBossRules.js";
import { bossPublic, CardBattleBossRuleError, loadBoss } from "./cardBattleBoss.js";
import { publicFrozenCard } from "./cardBattleRoom.js";
import { resolveCardBattleSettlementPlayers } from "./cardBattleSettlement.js";
import type { CardBattlePlayerInput, CardBattleResult } from "./cardBattle.js";

export function registerCardBattleBossRoutes(router: Router, changed: (roomId: string) => void) {
  const prefix = "/admin/card-battle-bosses";
  router.use(prefix, async (req, res, next) => {
    const user = (req as any).user;
    if (!user) { res.status(401).json({ error: "请先登录" }); return; }
    const [[current]] = await pool.query<mysql.RowDataPacket[]>("SELECT role FROM users WHERE id = ?", [user.id]);
    if (!current || !isSuperAdminRole(current.role)) { res.status(403).json({ error: "需要超级管理员权限" }); return; }
    next();
  });
  router.get("/card-battle-boss/covers/:id", async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) { res.sendStatus(404); return; }
    const [[cover]] = await pool.query<mysql.RowDataPacket[]>("SELECT image FROM card_battle_boss_covers WHERE id = ?", [req.params.id]);
    if (!cover) { res.sendStatus(404); return; }
    res.set({ "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" }).send(cover.image);
  });
  router.get("/card-battle-bosses", async (_req, res) => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT bosses.room_id AS id, rooms.name, bosses.reward_shells
       FROM card_battle_bosses bosses JOIN online_soup_rooms rooms ON rooms.id = bosses.room_id
       WHERE bosses.enabled = 1 AND bosses.starts_at <= NOW(3) AND bosses.ends_at > NOW(3)
       ORDER BY rooms.name, bosses.room_id`);
    res.set("Cache-Control", "no-store").json({ bosses: rows.map(row => ({ id: String(row.id), name: String(row.name), rewardShells: Number(row.reward_shells) })) });
  });
  router.post(`${prefix}/covers`, async (req, res) => {
    const parsed = z.object({ image: z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "请上传 5MB 以内的 PNG、JPG 或 WebP 图片" }); return; }
    const source = Buffer.from(parsed.data.image.split(",")[1]!, "base64");
    if (source.length > 5 * 1024 * 1024) { res.status(400).json({ error: "封面不能超过 5MB" }); return; }
    let image: Buffer;
    try { image = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1000, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer(); }
    catch { res.status(400).json({ error: "无法读取这张图片，请重新选择" }); return; }
    const id = createHash("sha256").update(image).digest("hex");
    await pool.query("INSERT IGNORE INTO card_battle_boss_covers (id, image) VALUES (?, ?)", [id, image]);
    res.status(201).json({ imageUrl: `/api/online-soup/card-battle-boss/covers/${id}` });
  });
  router.get(prefix, async (req, res) => {
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT bosses.*, rooms.name, rooms.room_code, NOW(3) AS db_now,
       (SELECT COUNT(*) FROM online_card_battles games WHERE COALESCE(games.boss_template_id, games.room_id) = bosses.room_id AND mode = 'boss') AS battle_count
       FROM card_battle_bosses bosses JOIN online_soup_rooms rooms ON rooms.id = bosses.room_id
       ORDER BY bosses.created_at DESC, bosses.room_id DESC LIMIT 10 OFFSET ?`, [offset]);
    const [[total]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM card_battle_bosses");
    res.set("Cache-Control", "no-store").json({ bosses: rows.map((row) => ({ ...bossPublic(row), battleCount: Number(row.battle_count) })), total: Number(total.total) });
  });
  const save: RequestHandler = async (req, res) => {
    const parsed = bossInputSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "BOSS 配置不正确" }); return; }
    const input = parsed.data;
    const editing = Boolean(req.params.roomId);
    const roomId = editing ? String(req.params.roomId) : nanoid();
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      if (editing) {
        const [[room]] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM online_soup_rooms WHERE id = ? AND card_battle_mode = 'boss' AND boss_template_id IS NULL FOR UPDATE", [roomId]);
        const current = room ? await loadBoss(roomId, db) : null;
        if (!current) throw new CardBattleBossRuleError("BOSS 房间不存在");
        if (input.revision !== Number(current.revision)) throw new CardBattleBossRuleError("配置已被其他操作更新，请刷新后重新编辑");
      }
      for (const card of input.cards) if (card) {
        const [[cover]] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM card_battle_boss_covers WHERE id = ?", [bossCoverPattern.exec(card.imageUrl)![1]]);
        if (!cover) throw new CardBattleBossRuleError("卡牌封面不存在，请重新上传");
      }
      if (!editing) {
        let created = false;
        for (let attempt = 0; attempt < 30 && !created; attempt++) {
          try {
            await db.query(`INSERT INTO online_soup_rooms (id, room_code, name, host_id, content_type, card_battle_mode, status, closed_at)
              VALUES (?, ?, ?, NULL, 'card_battle', 'boss', 'closed', NOW())`, [roomId, String(randomInt(100000, 1_000_000)), input.name]);
            created = true;
          } catch (error) { if ((error as any).code !== "ER_DUP_ENTRY") throw error; }
        }
        if (!created) throw new CardBattleBossRuleError("暂时无法生成房间号，请重试");
        await db.query(`INSERT INTO card_battle_bosses (room_id, enabled, starts_at, ends_at, reward_shells, cards_json, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [roomId, input.enabled, new Date(input.startsAt), new Date(input.endsAt), input.rewardShells, JSON.stringify(input.cards), (req as any).user.id, (req as any).user.id]);
      } else {
        await db.query("UPDATE online_soup_rooms SET name = ? WHERE id = ?", [input.name, roomId]);
        await db.query(`UPDATE card_battle_bosses SET enabled = ?, starts_at = ?, ends_at = ?, reward_shells = ?, cards_json = ?, updated_by = ?, revision = revision + 1 WHERE room_id = ?`,
          [input.enabled, new Date(input.startsAt), new Date(input.endsAt), input.rewardShells, JSON.stringify(input.cards), (req as any).user.id, roomId]);
        // Preparation is consent to this revision; changing it requires fresh readiness.
        await db.query(`UPDATE online_card_battle_seats seats JOIN online_soup_rooms rooms ON rooms.id = seats.room_id
          SET seats.is_ready = 0 WHERE rooms.boss_template_id = ? AND rooms.status <> 'playing'`, [roomId]);
      }
      await db.commit();
      res.status(editing ? 200 : 201).json({ boss: bossPublic((await loadBoss(roomId))!) });
      changed(roomId);
      const [rooms] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM online_soup_rooms WHERE boss_template_id = ? AND status <> 'closed'", [roomId]);
      for (const room of rooms) changed(String(room.id));
    } catch (error) {
      await db.rollback().catch(() => {});
      if (error instanceof CardBattleBossRuleError) { res.status(409).json({ error: error.message }); return; }
      throw error;
    } finally { db.release(); }
  };
  router.post(prefix, save);
  router.put(`${prefix}/:roomId`, save);
  router.patch(`${prefix}/:roomId/status`, async (req, res) => {
    const parsed = z.object({ enabled: z.boolean(), revision: z.number().int().min(1) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "上架状态不正确" }); return; }
    const current = await loadBoss(req.params.roomId);
    if (!current) { res.status(404).json({ error: "BOSS 房间不存在" }); return; }
    req.body = { ...bossPublic(current), ...parsed.data };
    await save(req, res, () => {});
  });
  router.get(`${prefix}/:roomId/battles`, async (req, res) => {
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_card_battles WHERE COALESCE(boss_template_id, room_id) = ? AND mode = 'boss' ORDER BY started_at DESC, id DESC LIMIT 10 OFFSET ?", [req.params.roomId, offset]);
    const [[count]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM online_card_battles WHERE COALESCE(boss_template_id, room_id) = ? AND mode = 'boss'", [req.params.roomId]);
    const battles = await Promise.all(rows.map(async (row) => {
      const result: CardBattleResult = typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json;
      const [players] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT participants.*, rewards.amount AS reward_amount FROM card_battle_boss_participants participants
         LEFT JOIN card_battle_boss_rewards rewards ON rewards.game_id = participants.game_id AND rewards.user_id = participants.user_id
         WHERE participants.game_id = ? ORDER BY player_seat`, [row.id]);
      return { id: String(row.id), gameNumber: Number(row.game_number), startedAt: new Date(row.started_at).toISOString(),
        status: String(row.status), outcome: row.status === "playing" ? "playing" : row.status === "aborted" ? "aborted" : result.winnerSeat === 1 ? "won" : "lost",
        players: players.map((player) => ({ userId: String(player.user_id), nickname: String(player.nickname_snapshot), forfeited: Boolean(player.forfeited_at), reward: player.reward_amount == null ? null : Number(player.reward_amount) })) };
    }));
    res.set("Cache-Control", "no-store").json({ battles, total: Number(count.total) });
  });
  router.get(`${prefix}/:roomId/battles/:gameId/replay`, async (req, res) => {
    const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE id = ? AND COALESCE(boss_template_id, room_id) = ? AND mode = 'boss'", [req.params.gameId, req.params.roomId]);
    if (!row) { res.status(404).json({ error: "对战记录不存在" }); return; }
    if (row.status !== "ended") { res.status(409).json({ error: "对局结束后才可查看回放" }); return; }
    const players: CardBattlePlayerInput[] = typeof row.lineup_snapshot_json === "string" ? JSON.parse(row.lineup_snapshot_json) : row.lineup_snapshot_json;
    const result: CardBattleResult = typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json;
    res.set("Cache-Control", "no-store").json({ replay: {
      gameId: String(row.id), gameNumber: Number(row.game_number), name: String(row.boss_name_snapshot),
      lineups: players.map((player) => ({ userId: player.userId, nickname: player.nickname, seat: player.seat, playerSeat: player.playerSeat, cards: player.cards.map(publicFrozenCard) })),
      result: { ...result, players: resolveCardBattleSettlementPlayers(result) },
    } });
  });
}
