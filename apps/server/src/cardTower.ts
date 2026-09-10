import mysql from "mysql2/promise";
import type { Router, Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { applyBattleCollectibleStats, emptyCardTowerFormations, replaceCardTowerFormation, cardTowerFormationError, type CardTowerFormation } from "@hgt/shared";
import { pool } from "./db.js";
import { isSuperAdminRole } from "./roles.js";
import { vipGrowthSnapshot } from "./vipGrowth.js";
import { bossInputSchema, bossCoverPattern } from "./cardBattleBossRules.js";
import { bossBattlePlayer, emitBossRewards } from "./cardBattleBoss.js";
import { buildCardBattlePlayerInput, loadEligibleBattleCards, loadSavedCardBattleDecks, publicFrozenCard, CardBattleRoomRuleError } from "./cardBattleRoom.js";
import { resolveBattleCollectibles, loadBattleCollectibles, BattleCollectibleRuleError } from "./battleCollectibles.js";
import { calculateCardBattlePower, simulateCardBattle, type CardBattleResult, type CardBattlePlayerInput } from "./cardBattle.js";
import { resolveCardBattlePlayback } from "./cardBattlePlayback.js";

export class CardTowerError extends Error {}
const json = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
const iso = (value: unknown) => new Date(value as string).toISOString();
const formationSchema = z.object({ cardIds: z.array(z.string().min(1).max(64).nullable()).length(5),
  collectibleBindings: z.array(z.object({ cardId: z.string().min(1).max(64), collectibleId: z.string().min(1).max(64) })).max(5) });
const floorSchema = z.object({ enabled: z.boolean(), rewardShells: z.number().int().min(0).max(1_000_000_000),
  cards: z.array(z.unknown()).length(5), revision: z.number().int().positive().optional() }).strict();
const userId = (req: Request) => String((req as any).user.id);
const handler = (action: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try { await action(req, res); } catch (error) {
    if (error instanceof CardTowerError || error instanceof CardBattleRoomRuleError || error instanceof BattleCollectibleRuleError || error instanceof z.ZodError) {
      res.status(400).json({ error: error instanceof z.ZodError ? error.issues[0]?.message ?? "参数不正确" : error.message });
    } else next(error);
  }
};
async function transaction<T>(action: (db: mysql.PoolConnection) => Promise<T>) {
  const db = await pool.getConnection();
  try { await db.beginTransaction(); const value = await action(db); await db.commit(); return value; }
  catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

async function profileLock(id: string, db: mysql.PoolConnection) {
  // Lock the FK parent first: otherwise a concurrent profile upsert can hold
  // a shared users lock while reward settlement needs to update that balance.
  await db.query("SELECT id FROM users WHERE id=? FOR UPDATE", [id]);
  // Upsert takes an exclusive record lock immediately. INSERT IGNORE would
  // first take a shared duplicate-key lock and deadlock on concurrent upgrades.
  await db.query("INSERT INTO card_tower_profiles (user_id, formations_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)", [id, JSON.stringify(emptyCardTowerFormations())]);
  const [[row]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM card_tower_profiles WHERE user_id = ? FOR UPDATE", [id]);
  return row!;
}
async function requireRoom(roomId: string, id: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [[room]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM card_tower_rooms WHERE id = ? AND user_id = ? AND closed_at IS NULL", [roomId, id]);
  if (!room) throw new CardTowerError("闯关房间不存在或已关闭");
  return room;
}
async function nextFloor(id: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [[progress]] = await db.query<mysql.RowDataPacket[]>("SELECT COALESCE(MAX(floor_number), 0) AS floor FROM card_tower_clears WHERE user_id = ?", [id]);
  const floor = Number(progress!.floor) + 1;
  const [[row]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM card_tower_floors WHERE floor_number = ?", [floor]);
  return { clearedFloor: floor - 1, row: row ?? null, message: !row ? floor === 1 ? "暂无已开放的卡牌闯关层级" : "当前所有层级已全部通关" : !row.enabled ? `第 ${floor} 层尚未上架，敬请期待` : null };
}
function floorPublic(row: mysql.RowDataPacket) {
  return { id: String(row.id), floorNumber: Number(row.floor_number), enabled: Boolean(row.enabled), rewardShells: Number(row.reward_shells),
    cards: json<unknown[]>(row.cards_json), revision: Number(row.revision), clearCount: Number(row.clear_count ?? 0) };
}
function floorBoss(row: mysql.RowDataPacket) {
  return bossBattlePlayer({ ...row, room_id: row.id, name: `卡牌闯关第 ${row.floor_number} 层`, room_code: "", db_now: new Date(),
    starts_at: new Date("2000-01-01"), ends_at: new Date("2100-01-01") } as mysql.RowDataPacket);
}

/** Shared user -> room -> game lock order across start, save, exit and recovery. */
export async function finalizeCardTowerRoom(roomId: string, id: string) {
  const events = await transaction(async (db) => {
    await profileLock(id, db);
    await db.query("SELECT id FROM card_tower_rooms WHERE id = ? AND user_id = ? FOR UPDATE", [roomId, id]);
    const [games] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM card_tower_games WHERE room_id = ? AND user_id = ? AND status = 'playing' AND playback_ends_at <= NOW(3) FOR UPDATE", [roomId, id]);
    const rewards: Array<{ userId: string; amount: number; balance: number }> = [];
    for (const game of games) {
      const result = json<CardBattleResult>(game.result_json);
      if (result.winnerSeat === 1 && result.endReason === "elimination") {
        const [[already]] = await db.query<mysql.RowDataPacket[]>("SELECT 1 FROM card_tower_clears WHERE user_id = ? AND floor_id = ?", [id, game.floor_id]);
        if (!already) {
          const progress = await nextFloor(id, db);
          if (String(progress.row?.id) !== String(game.floor_id)) throw new CardTowerError("通关进度不一致，请联系管理员");
          const [[user]] = await db.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? FOR UPDATE", [id]);
          const amount = Number(game.reward_shells), balance = Number(user!.shell_balance) + amount;
          if (!Number.isSafeInteger(amount) || amount < 0 || balance > 4_294_967_295) throw new CardTowerError("通关奖励暂时无法入账，请联系管理员");
          await db.query(`INSERT INTO card_tower_clears (user_id,floor_id,floor_number,game_id,total_power,reward_shells,cleared_at) VALUES (?,?,?,?,?,?,?)`,
            [id, game.floor_id, game.floor_number, game.id, game.total_power, amount, game.playback_ends_at]);
          await db.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balance, id]);
          await db.query(`INSERT INTO shell_transactions (id,user_id,transaction_type,amount,balance_after,related_type,related_id,remark,idempotency_key)
            VALUES (?,?,'card_tower',?,?,'card_tower',?,?,?)`, [nanoid(), id, amount, balance, game.floor_id, `卡牌闯关第 ${game.floor_number} 层首次通关`, `tower:${id}:${game.floor_id}`]);
          await db.query(`INSERT INTO notifications (id,user_id,type,title,content,related_id) VALUES (?,?,'card_tower','卡牌闯关通关奖励',?,?)`,
            [nanoid(), id, `首次通关卡牌闯关第 ${game.floor_number} 层，${amount} 贝壳已到账。`, game.floor_id]);
          rewards.push({ userId: id, amount, balance });
        }
      }
      await db.query("UPDATE card_tower_games SET status = 'ended', ended_at = playback_ends_at WHERE id = ?", [game.id]);
    }
    return rewards;
  });
  emitBossRewards(events.map((event) => ({ ...event, source: "card_tower" })));
}
export async function recoverCardTowerGames() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT room_id,user_id FROM card_tower_games WHERE status = 'playing' AND playback_ends_at <= NOW(3)");
  for (const row of rows) {
    try { await finalizeCardTowerRoom(String(row.room_id), String(row.user_id)); }
    catch (error) { console.error("[card-tower] recovery failed", row.room_id, error instanceof Error ? error.message : "unknown error"); }
  }
}
async function assertIdle(id: string, db: mysql.PoolConnection) {
  const [[active]] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM card_tower_games WHERE user_id = ? AND status = 'playing' LIMIT 1", [id]);
  if (active) throw new CardTowerError("当前闯关尚未结束，请等待战斗结算");
}

export function registerCardTowerRoutes(router: Router) {
  const base = "/card-tower", admin = "/admin/card-tower";
  router.use([base, admin], (req, res, next) => { res.set("Cache-Control", "no-store"); if (!(req as any).user) { res.status(401).json({ error: "请先登录" }); return; } next(); });
  router.use(admin, async (req, res, next) => {
    const [[user]] = await pool.query<mysql.RowDataPacket[]>("SELECT role FROM users WHERE id = ?", [userId(req)]);
    if (!user || !isSuperAdminRole(user.role)) { res.status(403).json({ error: "需要超级管理员权限" }); return; }
    next();
  });
  router.get(`${admin}/floors`, handler(async (req, res) => {
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
    const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT floors.*, (SELECT COUNT(*) FROM card_tower_clears clears WHERE clears.floor_id = floors.id) AS clear_count
      FROM card_tower_floors floors ORDER BY floor_number LIMIT 10 OFFSET ?`, [offset]);
    const [[last]] = await pool.query<mysql.RowDataPacket[]>("SELECT floor_number,enabled FROM card_tower_floors ORDER BY floor_number DESC LIMIT 1");
    res.json({ floors: rows.map(floorPublic), total: Number(last?.floor_number ?? 0), canCreate: !last || Boolean(last.enabled) });
  }));
  const saveFloor = handler(async (req, res) => {
    const input = floorSchema.parse(req.body);
    const validated = bossInputSchema.parse({ ...input, name: "卡牌闯关", startsAt: "2000-01-01T00:00:00Z", endsAt: "2100-01-01T00:00:00Z" });
    const id = await transaction(async (db) => {
      await db.query("SELECT id FROM card_tower_admin_lock WHERE id = 1 FOR UPDATE");
      const floorId = req.params.floorId ? String(req.params.floorId) : nanoid();
      for (const card of validated.cards.filter(Boolean)) {
        const [[cover]] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM card_battle_boss_covers WHERE id = ?", [bossCoverPattern.exec(card!.imageUrl)![1]]);
        if (!cover) throw new CardTowerError("卡牌封面不存在，请重新上传");
      }
      if (req.params.floorId) {
        const [[current]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM card_tower_floors WHERE id = ? FOR UPDATE", [floorId]);
        if (!current) throw new CardTowerError("层级不存在");
        if (Number(current.revision) !== input.revision) throw new CardTowerError("配置已更新，请刷新后重新编辑");
        if (current.enabled && !input.enabled) throw new CardTowerError("已上架层级不可下架");
        await db.query("UPDATE card_tower_floors SET enabled=?,reward_shells=?,cards_json=?,revision=revision+1,updated_by=? WHERE id=?",
          [input.enabled, input.rewardShells, JSON.stringify(validated.cards), userId(req), floorId]);
      } else {
        const [[last]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM card_tower_floors ORDER BY floor_number DESC LIMIT 1");
        if (last && !last.enabled) throw new CardTowerError("上一层上架后才能创建下一层");
        await db.query("INSERT INTO card_tower_floors (id,floor_number,enabled,reward_shells,cards_json,created_by,updated_by) VALUES (?,?,?,?,?,?,?)",
          [floorId, Number(last?.floor_number ?? 0) + 1, input.enabled, input.rewardShells, JSON.stringify(validated.cards), userId(req), userId(req)]);
      }
      return floorId;
    }); res.json({ id });
  });
  router.post(`${admin}/floors`, saveFloor);
  router.put(`${admin}/floors/:floorId`, saveFloor);
  router.delete(`${admin}/floors/:floorId`, (_req, res) => { res.status(405).json({ error: "已创建层级不可删除" }); });
  router.get(`${admin}/floors/:floorId/clears`, handler(async (req, res) => {
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
    const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT users.id,users.nickname,users.username,clears.cleared_at FROM card_tower_clears clears JOIN users ON users.id=clears.user_id
      WHERE floor_id=? ORDER BY cleared_at,user_id LIMIT 10 OFFSET ?`, [req.params.floorId, offset]);
    const [[count]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM card_tower_clears WHERE floor_id=?", [req.params.floorId]);
    res.json({ clears: rows.map((row) => ({ userId: row.id, nickname: row.nickname, username: row.username, clearedAt: iso(row.cleared_at) })), total: Number(count!.total) });
  }));
  router.get(`${base}/resources`, handler(async (req, res) => { const [cards, decks, collectibles] = await Promise.all([loadEligibleBattleCards(userId(req)), loadSavedCardBattleDecks(userId(req)), loadBattleCollectibles(userId(req), pool)]); res.json({ cards, decks, collectibles }); }));
  router.post(`${base}/rooms`, handler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(50) }).parse(req.body);
    const id = userId(req);
    const roomId = await transaction(async (db) => {
      const profile = await profileLock(id, db);
      if (profile.current_room_id) { const [[existing]] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM card_tower_rooms WHERE id=? AND user_id=? AND closed_at IS NULL", [profile.current_room_id, id]); if (existing) return String(existing.id); }
      const roomId = nanoid();
      await db.query("INSERT INTO card_tower_rooms (id,user_id,name) VALUES (?,?,?)", [roomId, id, name]);
      await db.query("UPDATE card_tower_profiles SET current_room_id=? WHERE user_id=?", [roomId, id]); return roomId;
    }); res.json({ roomId });
  }));
  router.put(`${base}/rooms/:roomId/formation`, handler(async (req, res) => {
    const { index, formation, revision } = z.object({ index: z.number().int().min(0).max(2), formation: formationSchema, revision: z.number().int().positive() }).parse(req.body);
    const id = userId(req), roomId = String(req.params.roomId);
    await requireRoom(roomId, id); await finalizeCardTowerRoom(roomId, id);
    const saved = await transaction(async (db) => {
      const profile = await profileLock(id, db); await requireRoom(roomId, id, db); await assertIdle(id, db);
      if (Number(profile.revision) !== revision) throw new CardTowerError("阵容已在其他页面更新，请刷新后重试");
      const ids = formation.cardIds.filter((card): card is string => Boolean(card));
      if (new Set(ids).size !== ids.length) throw new CardTowerError("同一阵容内不能重复卡牌");
      const eligible = await loadEligibleBattleCards(id, db);
      if (ids.some((card) => !eligible.some((item) => item.id === card))) throw new CardTowerError("阵容含不可用卡牌，请重新选择");
      await resolveBattleCollectibles(id, formation.cardIds, formation.collectibleBindings, db);
      const formations = replaceCardTowerFormation(json<CardTowerFormation[]>(profile.formations_json), index, formation);
      await db.query("UPDATE card_tower_profiles SET formations_json=?,revision=revision+1 WHERE user_id=?", [JSON.stringify(formations), id]);
      return { formations, revision: revision + 1 };
    }); res.json(saved);
  }));
  router.post(`${base}/rooms/:roomId/start`, handler(async (req, res) => {
    const id = userId(req), roomId = String(req.params.roomId);
    await requireRoom(roomId, id); await finalizeCardTowerRoom(roomId, id);
    const started = await transaction(async (db) => {
      const profile = await profileLock(id, db); await requireRoom(roomId, id, db); await assertIdle(id, db);
      const { revision, floorId } = z.object({ revision: z.number().int().positive(), floorId: z.string() }).parse(req.body);
      if (revision !== Number(profile.revision)) throw new CardTowerError("阵容已更新，请刷新后开始");
      const next = await nextFloor(id, db);
      if (next.message) throw new CardTowerError(next.message);
      if (next.row!.id !== floorId) throw new CardTowerError("关卡已变更，请刷新后开始");
      const formations = json<CardTowerFormation[]>(profile.formations_json), error = cardTowerFormationError(formations);
      if (error) throw new CardTowerError(error);
      const players: CardBattlePlayerInput[] = [];
      for (const [index, formation] of formations.entries()) if (formation.cardIds.some(Boolean)) {
        const player = await buildCardBattlePlayerInput(id, `阵容 ${index + 1}`, 1, formation.cardIds as string[], db, formation.collectibleBindings);
        player.userId = `${id}:formation:${index + 1}`;
        player.cards = player.cards.map((card) => ({ ...card, instanceId: `tower:${index + 1}:${card.instanceId}` }));
        players.push(player);
      }
      const power = players.flatMap((player) => player.cards).reduce((sum, card) => sum + calculateCardBattlePower(applyBattleCollectibleStats(card.tier, card.collectible)), 0);
      players.push(floorBoss(next.row!));
      const result = simulateCardBattle(players, nanoid(), "tower"), gameId = nanoid();
      const [[clock]] = await db.query<mysql.RowDataPacket[]>("SELECT NOW(3) AS time");
      const startedAt = new Date(clock!.time), endsAt = new Date(startedAt.getTime() + result.playbackDurationMs);
      await db.query(`INSERT INTO card_tower_games (id,room_id,user_id,floor_id,floor_number,reward_shells,total_power,lineup_json,result_json,started_at,playback_ends_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [gameId, roomId, id, next.row!.id, next.row!.floor_number, next.row!.reward_shells, power, JSON.stringify(players), JSON.stringify(result), startedAt, endsAt]);
      return { gameId, endsAt };
    });
    const timer = setTimeout(() => { void finalizeCardTowerRoom(roomId, id).catch((error) => console.error("Tower finalization failed", error)); }, Math.max(0, started.endsAt.getTime() - Date.now()) + 50); timer.unref();
    res.json({ gameId: started.gameId });
  }));
  router.post(`${base}/rooms/:roomId/close`, handler(async (req, res) => {
    const id = userId(req), roomId = String(req.params.roomId);
    await requireRoom(roomId, id); await finalizeCardTowerRoom(roomId, id);
    await transaction(async (db) => {
      await profileLock(id, db); await requireRoom(roomId, id, db);
      await db.query("UPDATE card_tower_games SET status='aborted',ended_at=NOW(3) WHERE room_id=? AND status='playing'", [roomId]);
      await db.query("UPDATE card_tower_rooms SET closed_at=NOW(3) WHERE id=?", [roomId]);
      await db.query("UPDATE card_tower_profiles SET current_room_id=NULL WHERE user_id=? AND current_room_id=?", [id, roomId]);
    }); res.json({ ok: true });
  }));
  const roomState = async (req: Request) => {
    const id = userId(req), roomId = String(req.params.roomId);
    const room = await requireRoom(roomId, id); await finalizeCardTowerRoom(roomId, id);
    const [[game]] = await pool.query<mysql.RowDataPacket[]>("SELECT *,NOW(3) AS db_now FROM card_tower_games WHERE room_id=? ORDER BY started_at DESC,id DESC LIMIT 1", [roomId]);
    return { room, game, id };
  };
  router.get(`${base}/rooms/:roomId/playback`, handler(async (req, res) => {
    const { game } = await roomState(req);
    if (!game) throw new CardTowerError("当前没有可播放的战斗");
    res.json({ gameId: game.id, playback: resolveCardBattlePlayback(json<CardBattleResult>(game.result_json), game.started_at, game.status, new Date(game.db_now).getTime()) });
  }));
  router.get(`${base}/rooms/:roomId`, handler(async (req, res) => {
    const { room, game, id } = await roomState(req);
    const [[profile]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM card_tower_profiles WHERE user_id=?", [id]);
    const next = await nextFloor(id);
    const result = game ? json<CardBattleResult>(game.result_json) : null;
    res.json({ room: { id: room.id, name: room.name }, formations: json(profile!.formations_json), revision: Number(profile!.revision),
      clearedFloor: next.clearedFloor, message: next.message,
      nextFloor: next.row?.enabled ? { id: next.row.id, floorNumber: next.row.floor_number, rewardShells: next.row.reward_shells, lineup: floorBoss(next.row).cards.map(publicFrozenCard) } : null,
      game: game && result ? { id: game.id, status: game.status, floorNumber: game.floor_number, totalPower: Number(game.total_power), rewardShells: game.reward_shells,
        playback: resolveCardBattlePlayback(result, game.started_at, game.status, new Date(game.db_now).getTime()),
        lineups: json<CardBattlePlayerInput[]>(game.lineup_json).map((player) => ({ ...player, cards: player.cards.map(publicFrozenCard) })),
        settlement: game.status === "ended" ? { winnerSeat: result.winnerSeat, endReason: result.endReason, rounds: result.rounds, players: result.players } : null } : null });
  }));
  router.get(`${base}/ranking`, handler(async (req, res) => {
    const limit = req.query.limit === "100" ? 100 : 10;
    const sql = `SELECT clears.user_id AS userId, users.nickname, users.role, users.vip_growth_value, users.vip_expires_at, users.vip_legacy_active, clears.total_power AS totalPower, clears.floor_number AS floorNumber, clears.cleared_at AS clearedAt,
      ROW_NUMBER() OVER (ORDER BY clears.floor_number DESC,clears.cleared_at,clears.user_id) AS ranking
      FROM card_tower_clears clears JOIN users ON users.id=clears.user_id
      WHERE users.role <> 'super_admin' AND NOT EXISTS (SELECT 1 FROM card_tower_clears later WHERE later.user_id=clears.user_id AND later.floor_number>clears.floor_number)`;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT * FROM (${sql}) ranked WHERE ranking<=? OR userId=? ORDER BY ranking`, [limit, userId(req)]);
    const entries = rows.map((row) => ({ userId: String(row.userId), nickname: String(row.nickname), vipLevel: vipGrowthSnapshot(row).level, vipActive: vipGrowthSnapshot(row).active, ranking: Number(row.ranking), totalPower: Number(row.totalPower), floorNumber: Number(row.floorNumber), clearedAt: iso(row.clearedAt) }));
    res.json({ entries: entries.filter((row) => row.ranking <= limit), me: entries.find((row) => row.userId === userId(req)) ?? null });
  }));
}
