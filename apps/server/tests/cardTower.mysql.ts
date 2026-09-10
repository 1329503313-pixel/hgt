// Isolated loopback MySQL fixtures. Clone schema only; never read/change application rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import express from "express";
import "express-async-errors";
import { config } from "../src/config.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback database required");
const prefix = `ct_${process.pid}_${Date.now().toString(36)}_`;
const sourceNames = ["users", "asset_cards", "user_asset_cards", "asset_card_battle_tiers", "asset_card_battle_effects", "collectibles", "user_card_battle_decks", "shell_transactions", "notifications", "card_battle_boss_covers"];
const towerNames = ["card_tower_admin_lock", "card_tower_floors", "card_tower_profiles", "card_tower_rooms", "card_tower_games", "card_tower_clears"];
const names = [...sourceNames, ...towerNames];
const admin = await mysql.createConnection({ ...config.db, timezone: "Z" });
let pool: mysql.Pool | undefined, server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
try {
  for (const name of sourceNames) {
    if (name === "card_battle_boss_covers") await admin.query(`CREATE TABLE \`${prefix}${name}\` (id CHAR(64) PRIMARY KEY, image MEDIUMBLOB NOT NULL)`);
    else await admin.query(`CREATE TABLE \`${prefix}${name}\` LIKE \`${name}\``);
  }
  ({ pool } = await import("../src/db.js"));
  const regex = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const rewrite = (sql: string) => sql.replace(regex, (name) => prefix + name);
  const query = pool.query.bind(pool), lease = pool.getConnection.bind(pool);
  pool.query = ((sql: string, values?: unknown) => query(rewrite(sql), values as any)) as typeof pool.query;
  pool.getConnection = async () => {
    const db = await lease();
    return new Proxy(db, { get(target, key) {
      if (key === "query") return (sql: string, values?: unknown) => target.query(rewrite(sql), values as any);
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  // Mirror additive pending card migrations in the disposable fixture tables.
  const migration = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
  for (const match of migration.matchAll(/ensureColumn\("([a-z_]+)", "([a-z_]+)", "([^"]+)"\)/g)) if (sourceNames.includes(match[1]!)) {
    const [columns] = await pool.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${match[1]} LIKE ?`, [match[2]]);
    if (!columns.length) await pool.query(`ALTER TABLE ${match[1]} ADD COLUMN ${match[3]}`);
  }
  const { initCardTowerSchema } = await import("../src/cardTowerSchema.js");
  await initCardTowerSchema(pool); await initCardTowerSchema(pool);
  const { registerCardTowerRoutes, recoverCardTowerGames, finalizeCardTowerRoom } = await import("../src/cardTower.js");
  const { defaultCardBattleTiers } = await import("../src/cardBattleConfig.js");
  for (const [id, role] of [["admin", "super_admin"], ["staff", "backoffice_admin"], ["u1", "user"], ["u2", "user"]]) {
    await pool.query("INSERT INTO users (id,username,password,nickname,role) VALUES (?,?, 'unused',?,?)", [id, id, id, role]);
  }
  for (let i = 0; i < 15; i++) {
    await pool.query("INSERT INTO asset_cards (id,card_no,name,rarity,image_url,battle_role,status) VALUES (?,?,?,'epic','/fixture','damage','active')", [`c${i}`, String(i + 1), `卡${i}`]);
    await pool.query("INSERT INTO asset_card_battle_tiers (card_id,star_level,max_hp,attack_value,defense_value,speed_value,energy_required) VALUES (?,0,10000,5000,100,100,40)", [`c${i}`]);
    for (const id of ["u1", "u2"]) await pool.query("INSERT INTO user_asset_cards (user_id,card_id,star_level) VALUES (?,?,0)", [id, `c${i}`]);
  }
  await pool.query("INSERT INTO card_battle_boss_covers (id,image) VALUES (?,?)", ["a".repeat(64), Buffer.from("fixture")]);
  const app = express(); app.use(express.json());
  app.use(async (req, _res, next) => { const [[user]] = await pool!.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE id=?", [req.header("x-test-user") ?? ""]); (req as any).user = user; next(); });
  const router = express.Router(); registerCardTowerRoutes(router); app.use("/api/online-soup", router);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: error.message }); });
  server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address() as { port: number };
  async function api(path: string, user = "u1", method = "GET", body?: unknown, status = 200) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/online-soup${path}`, { method, headers: { "x-test-user": user, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  }
  const floors = "/admin/card-tower/floors", root = "/card-tower";
  await api(floors, "", "GET", undefined, 401); await api(floors, "staff", "GET", undefined, 403);
  const draft = { enabled: false, rewardShells: 50, cards: Array(5).fill(null) };
  const created = await api(floors, "admin", "POST", draft);
  await api(floors, "admin", "POST", draft, 400);
  await api(`${floors}/${created.id}`, "admin", "DELETE", undefined, 405);
  await api(`${floors}/${created.id}`, "admin", "PUT", { ...draft, enabled: true, revision: 1 }, 400);
  const card = { name: "守卫", imageUrl: `/api/online-soup/card-battle-boss/covers/${"a".repeat(64)}`, tier: { ...defaultCardBattleTiers()[3]!, maxHp: 10, attack: 0, defense: 0, speed: 1,
    skillName: "治疗", skillDescription: "恢复生命", effects: [{ id: "heal", order: 0, condition: "energy_full", conditionValue: null, type: "heal_self", value: 1, duration: null }] } };
  const enabled = { ...draft, enabled: true, cards: Array(5).fill(card) };
  await api(`${floors}/${created.id}`, "admin", "PUT", { ...enabled, revision: 1 });
  await api(`${floors}/${created.id}`, "admin", "PUT", { ...draft, revision: 2 }, 400);
  await api(`${floors}/${created.id}`, "admin", "PUT", { ...enabled, revision: 1 }, 400);
  const newFloors = await Promise.all([api(floors, "admin", "POST", enabled), api(floors, "admin", "POST", enabled)]);
  const list = await api(floors, "admin"); assert.deepEqual(list.floors.map((floor: any) => floor.floorNumber), [1, 2, 3]);
  const room = await api(`${root}/rooms`, "u1", "POST", { name: "单人闯关" });
  const same = await api(`${root}/rooms`, "u1", "POST", { name: "重复点击" }); assert.equal(room.roomId, same.roomId);
  const path = `${root}/rooms/${room.roomId}`;
  await api(path, "u2", "GET", undefined, 400); await api(`${path}/start`, "u2", "POST", {}, 400);
  let state = await api(path);
  await api(`${path}/start`, "u1", "POST", { revision: state.revision, floorId: created.id }, 400);
  const formation = (start: number) => ({ cardIds: Array.from({ length: 5 }, (_, i) => `c${i + start}`), collectibleBindings: [] });
  for (let i = 0; i < 3; i++) state = { ...state, ...await api(`${path}/formation`, "u1", "PUT", { index: i, formation: formation(i * 5), revision: state.revision }) };
  state = { ...state, ...await api(`${path}/formation`, "u1", "PUT", { index: 1, formation: formation(0), revision: state.revision }) };
  assert.deepEqual(state.formations[0].cardIds, Array(5).fill(null));
  state = { ...state, ...await api(`${path}/formation`, "u1", "PUT", { index: 0, formation: formation(5), revision: state.revision }) };
  await api(`${path}/formation`, "u1", "PUT", { index: 0, formation: formation(5), revision: 1 }, 400);
  const started = await api(`${path}/start`, "u1", "POST", { revision: state.revision, floorId: created.id });
  await api(`${path}/start`, "u1", "POST", { revision: state.revision, floorId: created.id }, 400);
  await api(`${path}/formation`, "u1", "PUT", { index: 0, formation: formation(5), revision: state.revision }, 400);
  const active = await api(path); assert.equal(active.game.status, "playing"); assert.equal(active.game.settlement, null);
  assert.equal(active.game.lineups.length, 4); assert.equal(active.game.playback.states.length, 10);
  const power = active.game.lineups.filter((lineup: any) => lineup.seat === 1).flatMap((lineup: any) => lineup.cards).reduce((sum: number, card: any) => sum + card.combatPower, 0);
  assert.equal(active.game.totalPower, power);
  // Changes after opening do not affect the already frozen reward.
  await api(`${floors}/${created.id}`, "admin", "PUT", { ...enabled, rewardShells: 999, revision: 2 });
  await pool.query("UPDATE card_tower_games SET started_at=DATE_SUB(NOW(3), INTERVAL 1 HOUR),playback_ends_at=NOW(3) WHERE id=?", [started.gameId]);
  await Promise.all([finalizeCardTowerRoom(room.roomId, "u1"), finalizeCardTowerRoom(room.roomId, "u1"), recoverCardTowerGames()]);
  const done = await api(path); assert.equal(done.clearedFloor, 1); assert.equal(done.nextFloor.floorNumber, 2); assert.equal(done.game.settlement.winnerSeat, 1);
  const [[balance]] = await pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u1'"); assert.equal(Number(balance!.shell_balance), 50);
  const [[count]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM shell_transactions WHERE user_id='u1' AND transaction_type='card_tower'"); assert.equal(Number(count!.total), 1);
  const ranking = await api(`${root}/ranking`); assert.equal(ranking.entries[0].userId, "u1"); assert.equal(ranking.me.totalPower, power);
  const clears = await api(`${floors}/${created.id}/clears`, "admin"); assert.equal(clears.total, 1); assert.equal(clears.clears[0].username, "u1"); assert.match(clears.clears[0].clearedAt, /T\d\d:\d\d:\d\d/);
  await api(`${path}/start`, "u1", "POST", { revision: done.revision, floorId: created.id }, 400);
  await api(`${path}/close`, "u1", "POST", {});
  const nextRoom = await api(`${root}/rooms`, "u1", "POST", { name: "重新建房" });
  const restored = await api(`${root}/rooms/${nextRoom.roomId}`); assert.deepEqual(restored.formations, done.formations); assert.equal(restored.clearedFloor, 1);
  await api(`${root}/rooms/${nextRoom.roomId}/start`, "u1", "POST", { revision: restored.revision, floorId: restored.nextFloor.id });
  await api(`${root}/rooms/${nextRoom.roomId}/close`, "u1", "POST", {});
  await recoverCardTowerGames();
  const [[afterClose]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM card_tower_clears WHERE user_id='u1'"); assert.equal(Number(afterClose!.total), 1);
  assert.equal(newFloors.length, 2);
  const secondRoom = await api(`${root}/rooms`, "u2", "POST", { name: "第二位挑战者" });
  const secondPath = `${root}/rooms/${secondRoom.roomId}`;
  let second = await api(secondPath, "u2");
  second = { ...second, ...await api(`${secondPath}/formation`, "u2", "PUT", { index: 0, formation: formation(0), revision: second.revision }) };
  const clearNext = async (target: string, user: string) => {
    const current = await api(target, user);
    const game = await api(`${target}/start`, user, "POST", { revision: current.revision, floorId: current.nextFloor.id });
    await pool!.query("UPDATE card_tower_games SET started_at=DATE_SUB(NOW(3), INTERVAL 1 HOUR),playback_ends_at=NOW(3) WHERE id=?", [game.gameId]);
    await recoverCardTowerGames();
    return api(target, user);
  };
  await clearNext(secondPath, "u2");
  const sameFloor = await api(`${root}/ranking`, "u2");
  assert.deepEqual(sameFloor.entries.map((entry: any) => entry.userId), ["u1", "u2"], "同层按首次通关时间排名");
  await clearNext(secondPath, "u2");
  assert.equal((await api(`${root}/ranking`)).entries[0].userId, "u2", "层数优先于通关时间");
  const allCleared = await clearNext(secondPath, "u2");
  assert.equal(allCleared.message, "当前所有层级已全部通关"); assert.equal(allCleared.nextFloor, null);
  await api(floors, "admin", "POST", draft);
  const waiting = await api(secondPath, "u2"); assert.match(waiting.message, /第 4 层尚未上架/); assert.equal(waiting.nextFloor, null);
  await api(`${secondPath}/start`, "u2", "POST", { revision: waiting.revision, floorId: "unpublished" }, 400);
  console.log("PASS: floor lifecycle/concurrency, authorization, persistent formations, unique rewards, frozen power/rewards, ranking and recovery");
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (pool) await pool.end();
  await admin.query("SET FOREIGN_KEY_CHECKS=0");
  for (const name of [...names].reverse()) { const table = prefix + name; assert.ok(table.startsWith(prefix) && /^ct_\d+_[a-z0-9]+_[a-z_]+$/.test(table)); await admin.query(`DROP TABLE IF EXISTS \`${table}\``); }
  await admin.query("SET FOREIGN_KEY_CHECKS=1"); await admin.end();
}
