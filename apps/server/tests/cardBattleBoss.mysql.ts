// Integration tests create disposable, prefixed schema-only tables on loopback MySQL.
// All application SQL is redirected to these tables; no source rows are read or changed. Run with: node --import tsx apps/server/tests/cardBattleBoss.mysql.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import express from "express";
import "express-async-errors";
import sharp from "sharp";
import { config } from "../src/config.js";

assert.ok(["127.0.0.1", "localhost", "::1"].includes(config.db.host), "Loopback MySQL required");
const sourceDatabase = config.db.database;
assert.match(sourceDatabase, /^[a-zA-Z0-9_]+$/);
const fixturePrefix = `bt_${process.pid}_${Date.now().toString(36)}_`;
assert.match(fixturePrefix, /^bt_\d+_[a-z0-9]+_$/);
const admin = await mysql.createConnection({ ...config.db, timezone: "Z" });
let pool: mysql.Pool | undefined;
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
const fixtureTables = new Set<string>();
try {
  const [tables] = await admin.query<mysql.RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [sourceDatabase]);
  const recordTables = ['game_records','game_record_users','game_record_impostor_steps','game_record_starts'];
  const sourceTables = tables.filter((table) => !/^(bt_|rh_|gr_)/.test(String(table.TABLE_NAME)) && !String(table.TABLE_NAME).startsWith("card_battle_boss") && !recordTables.includes(String(table.TABLE_NAME)));
  const names = [...sourceTables.map((table) => String(table.TABLE_NAME)), ...recordTables, "card_battle_boss_covers", "card_battle_bosses", "card_battle_boss_participants", "card_battle_boss_rewards"];
  for (const name of names) { assert.match(name, /^[a-zA-Z0-9_]+$/); assert.ok((fixturePrefix + name).length <= 64); fixtureTables.add(fixturePrefix + name); }
  for (const table of sourceTables) await admin.query(`CREATE TABLE \`${fixturePrefix}${table.TABLE_NAME}\` LIKE \`${table.TABLE_NAME}\``);
  // LIKE generates its own CHECK name; name the copied old seat constraint explicitly.
  const [[seatDDL]] = await admin.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE \`${fixturePrefix}online_card_battle_seats\``);
  for (const match of String(seatDDL["Create Table"]).matchAll(/CONSTRAINT \`([^\`]+)\` CHECK/g)) await admin.query(`ALTER TABLE \`${fixturePrefix}online_card_battle_seats\` DROP CHECK \`${match[1]}\``);
  await admin.query(`ALTER TABLE \`${fixturePrefix}online_card_battle_seats\` ADD CONSTRAINT \`${fixturePrefix}chk_online_card_battle_seat\` CHECK (seat_number IN (1,2))`);
  ({ pool } = await import("../src/db.js"));
  const token = new RegExp(`\\b(${names.join("|")}|(?:fk|chk)_[a-zA-Z0-9_]+)\\b`, "g");
  const rewrite = (sql: string) => sql.replace(token, (name) => fixturePrefix + name);
  const parameters = (values: unknown) => Array.isArray(values) ? values.map((value) => typeof value === "string" && names.includes(value) ? fixturePrefix + value : value) : values;
  const query = pool.query.bind(pool);
  pool.query = ((sql: string, values?: unknown) => query(rewrite(sql), parameters(values) as any)) as typeof pool.query;
  const lease = pool.getConnection.bind(pool);
  pool.getConnection = async () => { const connection = await lease(); return new Proxy(connection, { get(target, key) {
    if (key === "query") return (sql: string, values?: unknown) => target.query(rewrite(sql), parameters(values) as any);
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }); };
  const migration = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
  // Keep fixture schemas in step with other pending local card/collectible migrations.
  const ensure = async (table: string, name: string, definition: string) => {
    const [rows] = await pool!.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [name]);
    if (!rows.length) await pool!.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  };
  for (const match of migration.matchAll(/ensureColumn\("([a-z_]+)", "([a-z_]+)", "([^"]+)"\)/g)) {
    if (tables.some((table) => table.TABLE_NAME === match[1])) await ensure(match[1]!, match[2]!, match[3]!);
  }
  const binding = migration.match(/ensureColumn\(table, "collectible_bindings_json", "([^"]+)"\)/)![1]!;
  for (const table of ["online_card_battle_seats", "user_card_battle_decks", "card_battle_ranking_entries"]) await ensure(table, "collectible_bindings_json", binding);
  const { initCardBattleBossSchema } = await import("../src/cardBattleBossSchema.js");
  await initCardBattleBossSchema(pool); await initCardBattleBossSchema(pool);
  const { initGameRecordSchema } = await import('../src/gameRecords.js');
  await initGameRecordSchema(pool);
  const { default: router, recoverCardBattleGames, cleanupOnlineSoupStaleSeats, cleanupOnlineSoupInactiveHostRooms } = await import("../src/onlineSoup.js");
  const { finalizeCardBattleIfDue, cardBattleClientState } = await import("../src/cardBattleRoom.js");
  const { defaultCardBattleTiers } = await import("../src/cardBattleConfig.js");
  for (const [id, role] of [["admin", "super_admin"], ["staff", "backoffice_admin"], ...Array.from({ length: 16 }, (_, i) => [`u${i}`, "user"])]) {
    await pool.query("INSERT INTO users (id,username,password,nickname,role) VALUES (?,?, 'unused',?,?)", [id, id, id, role]);
  }
  const cardIds = [1, 2, 3, 4, 5].map((i) => `card${i}`);
  for (const [i, id] of cardIds.entries()) {
    await pool.query("INSERT INTO asset_cards (id,card_no,name,rarity,image_url,battle_role,status) VALUES (?,?,?,'epic','/fixture','damage','active')", [id, String(i + 1), `测试卡${i + 1}`]);
    for (const star of [0, 1, 2, 3]) await pool.query("INSERT INTO asset_card_battle_tiers (card_id,star_level,max_hp,attack_value,defense_value,speed_value,energy_required) VALUES (?,?,10000,500,20,100,40)", [id, star]);
    for (const user of ["u0", "u1", "u2", "u3"]) await pool.query("INSERT INTO user_asset_cards (user_id,card_id,star_level) VALUES (?,?,?)", [user, id, Number(user.slice(1))]);
  }
  const app = express(); app.use(express.json({ limit: "10mb" }));
  app.use(async (req, _res, next) => { const [[user]] = await pool!.query<mysql.RowDataPacket[]>("SELECT id,username,nickname,role FROM users WHERE id = ?", [req.header("x-fixture-user") ?? ""]); (req as any).user = user; next(); });
  app.use("/api/online-soup", router);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: error.message }); });
  server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server!.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}/api/online-soup`;
  async function request(path: string, user = "admin", method = "GET", body?: unknown, expected = 200): Promise<any> {
    const response = await fetch(origin + path, { method, headers: { "x-fixture-user": user, "Content-Type": "application/json" }, ...(body == null ? {} : { body: JSON.stringify(body) }) });
    const json = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(json)}`); return json;
  }
  const base = "/admin/card-battle-bosses";
  await request(base, "staff", "GET", undefined, 403); await request(base, "u0", "GET", undefined, 403); await request(base, "", "GET", undefined, 401);
  const image = await sharp({ create: { width: 10, height: 14, channels: 3, background: "#124566" } }).png().toBuffer();
  const cover = await request(`${base}/covers`, "admin", "POST", { image: `data:image/png;base64,${image.toString("base64")}` }, 201);
  const draft = { name: "集结挑战", startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), enabled: false, rewardShells: 123, cards: Array(5).fill(null) };
  const created = await request(base, "admin", "POST", draft, 201);
  let boss = created.boss;
  assert.ok(boss?.roomId, JSON.stringify(created));
  assert.match(boss.code, /^\d{6}$/);
  const [[room]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_soup_rooms WHERE id=?", [boss.roomId]); assert.equal(room.host_id, null);
  await request(`${base}/${boss.roomId}/status`, "admin", "PATCH", { enabled: true, revision: boss.revision }, 400);
  const cards = Array.from({ length: 5 }, (_, i) => ({ name: `BOSS${i}`, imageUrl: cover.imageUrl, tier: { ...defaultCardBattleTiers()[3], maxHp: 1, attack: 0, defense: 0, speed: 0, skillName: "微光", skillDescription: "恢复自身能量", effects: [{ order: 0, condition: "energy_full", conditionValue: null, type: "energy_self", value: 1, duration: null }] } }));
  boss = (await request(`${base}/${boss.roomId}`, "admin", "PUT", { ...boss, cards, enabled: true })).boss;
  assert.equal((await request("/rooms", "u0")).rooms.some((room: any) => room.id === boss.roomId), true);
  const path = `/rooms/${boss.roomId}`;
  for (const user of ["u0", "u1", "u2"]) assert.equal((await request(`${path}/join-auto`, user, "POST", {})).role, "player");
  for (let i = 4; i < 14; i++) assert.equal((await request(`${path}/join-auto`, `u${i}`, "POST", {})).role, "spectator");
  await request(`${path}/join-auto`, "u14", "POST", {}, 409);
  for (const user of ["u0", "u1", "u2"]) await request(`${path}/card-battle/lineup`, user, "PUT", { cardIds: cardIds.slice(0, 3) });
  const prepared = await cardBattleClientState(boss.roomId, "u4");
  const snapshot = await request(path, "u4");
  assert.equal(snapshot.room.cardBattle.mode, "boss"); assert.equal(snapshot.me.isHost, false);
  assert.equal(prepared.seats.length, 3); assert.ok(prepared.seats.every((seat) => seat.lineup.every((item) => item.card && !item.cardBack)));
  assert.deepEqual(prepared.seats.map((seat) => seat.lineup[0]!.card!.starLevel), [0, 1, 2]);
  await Promise.all(["u0", "u1", "u2"].map((user) => request(`${path}/card-battle/ready`, user, "POST", { ready: true })));
  const [[first]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE room_id=?", [boss.roomId]);
  assert.equal(first.game_number, 1); assert.equal(JSON.parse(JSON.stringify(first.result_json)).winnerSeat, 1);
  await request(`${base}/${boss.roomId}/battles/${first.id}/replay`, "admin", "GET", undefined, 409);
  assert.equal((await cardBattleClientState(boss.roomId, "u4")).game?.settlement, null);
  await request(`${path}/card-battle/member-role`, "u4", "POST", { role: "player" }, 409);
  await request(`${path}/leave`, "u1", "POST", {});
  await pool.query("UPDATE online_soup_members SET last_seen_at=NOW()-INTERVAL 10 MINUTE WHERE room_id=? AND user_id='u0'", [boss.roomId]);
  await cleanupOnlineSoupStaleSeats();
  await request(`${base}/${boss.roomId}/status`, "admin", "PATCH", { enabled: false, revision: boss.revision });
  await request(`${path}/join-auto`, "u14", "POST", {}, 409);
  assert.equal((await request("/rooms", "u0")).rooms.some((room: any) => room.id === boss.roomId), false);
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE id=?", [first.id]);
  await Promise.all(Array.from({ length: 5 }, () => finalizeCardBattleIfDue(boss.roomId)));
  const [recordOwners] = await pool.query<mysql.RowDataPacket[]>("SELECT user_id FROM game_record_users WHERE record_id=? ORDER BY user_id", [`card_battle:${first.id}`]);
  assert.deepEqual(recordOwners.map(row=>row.user_id), ['u0','u2'], 'BOSS archive excludes explicit departure and spectators, retaining disconnected players');
  const archivedReplay = await request(`/game-records/${encodeURIComponent(`card_battle:${first.id}`)}`, 'u2');
  assert.equal(archivedReplay.record.subtype, 'boss');
  assert.equal(archivedReplay.replay.lineups.length, 4);
  await request(`/game-records/${encodeURIComponent(`card_battle:${first.id}`)}`, 'u1', 'GET', undefined, 404);
  const [rewards] = await pool.query<mysql.RowDataPacket[]>("SELECT user_id, amount FROM card_battle_boss_rewards WHERE room_id=? ORDER BY user_id", [boss.roomId]);
  assert.deepEqual(rewards.map((r) => [r.user_id, r.amount]), [["u0", 123], ["u2", 123]]);
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM shell_transactions"))[0][0]!.total, 2);
  const replay = (await request(`${base}/${boss.roomId}/battles/${first.id}/replay`)).replay;
  assert.equal(replay.lineups.length, 4); assert.equal(replay.result.initialStates.length, 14);
  boss = (await request(base)).bosses[0];
  boss = (await request(`${base}/${boss.roomId}`, "admin", "PUT", { ...boss, name: "修改后的挑战", rewardShells: 999, enabled: true })).boss;
  assert.deepEqual((await request(`${base}/${boss.roomId}/battles/${first.id}/replay`)).replay, replay);
  // Remove other combatants; one occupied seat must start immediately.
  await request(`${path}/leave`, "u2", "POST", {});
  await request(`${path}/join-auto`, "u0", "POST", {});
  await request(`${path}/card-battle/lineup`, "u0", "PUT", { cardIds: cardIds.slice(0, 3) });
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true });
  const [[second]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE room_id=? ORDER BY game_number DESC LIMIT 1", [boss.roomId]);
  assert.equal(second.game_number, 2);
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE id=?", [second.id]);
  await recoverCardBattleGames();
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u0'"))[0][0]!.shell_balance, 123);
  assert.equal((await request(`${base}/${boss.roomId}/battles`)).total, 2);
  await request(`${path}/join-auto`, "u1", "POST", {});
  await request(`${path}/card-battle/lineup`, "u1", "PUT", { cardIds: cardIds.slice(0, 3) });
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true });
  await request(`${path}/card-battle/ready`, "u1", "POST", { ready: true });
  const [[third]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE room_id=? ORDER BY game_number DESC LIMIT 1", [boss.roomId]);
  assert.equal(third.game_number, 3);
  assert.equal(third.lineup_snapshot_json.length, 3, "两位玩家对阵 BOSS");
  boss = (await request(`${base}/${boss.roomId}`, "admin", "PUT", { ...boss, endsAt: new Date(Date.now() - 1).toISOString() })).boss;
  await request(`${path}/join-auto`, "u15", "POST", {}, 409);
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE id=?", [third.id]);
  await recoverCardBattleGames();
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u1'"))[0][0]!.shell_balance, 999, "先前主动退出者仍可在以后通关获得首次奖励");
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true }, 409);
  await request(`${base}/${boss.roomId}/battles/${third.id}/replay`, "staff", "GET", undefined, 403);
  await pool.query("UPDATE online_soup_rooms SET host_last_seen_at=NOW()-INTERVAL 30 DAY, last_action_at=NOW()-INTERVAL 30 DAY WHERE id=?", [boss.roomId]);
  await cleanupOnlineSoupInactiveHostRooms();
  const [[permanent]] = await pool.query<mysql.RowDataPacket[]>("SELECT room_code,host_id,status FROM online_soup_rooms WHERE id=?", [boss.roomId]);
  assert.equal(permanent.room_code, boss.code); assert.equal(permanent.host_id, null); assert.notEqual(permanent.status, "closed");
  await request(`${base}/${boss.roomId}`, "staff", "PUT", boss, 403);
  console.log("PASS: schema migration twice, superadmin API, immutable uploads, publication validation, 3+10 seats, teammate previews, simultaneous readiness, frozen replay, explicit exit vs disconnect, atomic once-per-room rewards, solo autostart, permanent room lifecycle.");
} finally {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
  if (pool) await pool.end();
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of [...fixtureTables].reverse()) {
    assert.ok(table.startsWith(fixturePrefix)); assert.match(table, /^[a-zA-Z0-9_]+$/);
    await admin.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
  await admin.query("SET FOREIGN_KEY_CHECKS = 1");
  await admin.end();
}
