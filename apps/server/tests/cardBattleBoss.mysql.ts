// Integration tests create disposable, prefixed schema-only tables on loopback MySQL.
// All application SQL is redirected to these tables; no source rows are read or changed. Run with: node --import tsx apps/server/tests/cardBattleBoss.mysql.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import express from "express";
import "express-async-errors";
import sharp from "sharp";
import { config } from "../src/config.js";
import { mock } from "node:test";

assert.ok(["127.0.0.1", "localhost", "::1"].includes(config.db.host), "Loopback MySQL required");
const sourceDatabase = config.db.database;
assert.match(sourceDatabase, /^[a-zA-Z0-9_]+$/);
const fixturePrefix = `bt_${process.pid}_${Date.now().toString(36)}_`;
assert.match(fixturePrefix, /^bt_\d+_[a-z0-9]+_$/);
const admin = await mysql.createConnection({ ...config.db, timezone: "Z" });
let pool: mysql.Pool | undefined;
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
const fixtureTables = new Set<string>();
// HTTP mutations schedule real playback timers. Dispose them before removing
// the isolated tables/pool, otherwise a late timer can outlive this fixture.
const fixtureTimers = new Set<ReturnType<typeof setTimeout>>();
const nativeSetTimeout = globalThis.setTimeout;
const timerMock = mock.method(globalThis, "setTimeout", (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
  const timer = nativeSetTimeout(callback, delay, ...args);
  fixtureTimers.add(timer);
  return timer;
});
try {
  const [tables] = await admin.query<mysql.RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [sourceDatabase]);
  const recordTables = ['game_records','game_record_users','game_record_impostor_steps','game_record_starts'];
  const sourceTables = tables.filter((table) => !/^(bt_|rh_|gr_|vr_)/.test(String(table.TABLE_NAME)) && !String(table.TABLE_NAME).startsWith("card_battle_boss") && !recordTables.includes(String(table.TABLE_NAME)));
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
  assert.equal((await request("/rooms", "u0")).rooms.some((room: any) => room.id === boss.roomId), false);
  assert.equal((await request("/card-battle-bosses", "u0")).bosses[0].id, boss.roomId);
  await request(`/rooms/${boss.roomId}/join-auto`, "u0", "POST", {}, 404);
  await request(`/rooms/lookup/${boss.code}`, "u0", "GET", undefined, 404);
  const createBoss = (user = "u0", extra: Record<string, unknown> = {}) => request("/rooms", user, "POST", { name: "玩家 BOSS 房间", type: "public", contentType: "card_battle", cardBattleMode: "boss", bossTemplateId: boss.roomId, bossClearLabel: "uncleared", ...extra }, 201);
  for (const invalid of [{ bossTemplateId: undefined }, { bossClearLabel: undefined }, { bossClearLabel: "invalid" }, { contentType: "soup" }]) {
    await request("/rooms", "u0", "POST", { name: "无效创建", type: "public", contentType: "card_battle", cardBattleMode: "boss", bossTemplateId: boss.roomId, bossClearLabel: "uncleared", ...invalid }, 400);
  }
  const playerRoom = await createBoss();
  const roomId = playerRoom.roomId;
  assert.notEqual(roomId, boss.roomId);
  const listed = (await request("/rooms", "u0")).rooms.find((room: any) => room.id === roomId);
  assert.equal(listed.host.id, "u0"); assert.equal(listed.bossName, boss.name); assert.equal(listed.bossClearLabel, "uncleared");
  const path = `/rooms/${roomId}`;
  for (const user of ["u0", "u1", "u2"]) assert.equal((await request(`${path}/join-auto`, user, "POST", {})).role, "player");
  for (let i = 4; i < 14; i++) assert.equal((await request(`${path}/join-auto`, `u${i}`, "POST", {})).role, "spectator");
  await request(`${path}/join-auto`, "u14", "POST", {}, 409);
  for (const user of ["u0", "u1", "u2"]) await request(`${path}/card-battle/lineup`, user, "PUT", { cardIds: cardIds.slice(0, 3) });
  const prepared = await cardBattleClientState(roomId, "u4");
  const snapshot = await request(path, "u4");
  assert.equal(snapshot.room.cardBattle.mode, "boss"); assert.equal(snapshot.me.isHost, false);
  assert.equal(prepared.seats.length, 3); assert.ok(prepared.seats.every((seat) => seat.lineup.every((item) => item.card && !item.cardBack)));
  assert.deepEqual(prepared.seats.map((seat) => seat.lineup[0]!.card!.starLevel), [0, 1, 2]);
  // A smaller team needs fresh consent: departure cannot turn partial readiness into a battle.
  const assertWaiting = async (readyUsers: string[]) => {
    const state = await cardBattleClientState(roomId, "u0");
    assert.deepEqual(state.seats.filter((seat) => seat.ready).map((seat) => seat.user!.id).sort(), readyUsers);
    const [[count]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM online_card_battles WHERE room_id=?", [roomId]);
    assert.equal(count.total, 0, "Leaving must not create a battle");
    assert.equal((await request(path, "u0")).room.status, "preparing");
  };
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true });
  await request(`${path}/card-battle/ready`, "u1", "POST", { ready: true });
  await request(`${path}/leave`, "u13", "POST", {});
  await assertWaiting(["u0", "u1"]); // Spectators do not change the fighting team.
  await request(`${path}/leave`, "u2", "POST", {});
  await assertWaiting([]); // Both remaining players must immediately be unready.
  await recoverCardBattleGames();
  await assertWaiting([]); // Recovery cannot start the reduced team either.
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true });
  await request(`${path}/leave`, "u1", "POST", {});
  await recoverCardBattleGames();
  await assertWaiting([]); // Two seats shrinking to one must not start a solo battle.
  for (const user of ["u1", "u2"]) {
    await request(`${path}/join-auto`, user, "POST", {});
    await request(`${path}/card-battle/lineup`, user, "PUT", { cardIds: cardIds.slice(0, 3) });
  }
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true });
  await request(`${path}/card-battle/ready`, "u1", "POST", { ready: true });
  await request(`${path}/card-battle/member-role`, "u2", "POST", { role: "spectator" });
  await assertWaiting([]); // Switching out of the fighting seats shares the same guard.
  await request(`${path}/card-battle/member-role`, "u2", "POST", { role: "player" });
  await request(`${path}/card-battle/lineup`, "u2", "PUT", { cardIds: cardIds.slice(0, 3) });
  await Promise.all(["u0", "u1", "u2"].map((user) => request(`${path}/card-battle/ready`, user, "POST", { ready: true })));
  const [[first]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE room_id=?", [roomId]);
  assert.equal(first.game_number, 1); assert.equal(JSON.parse(JSON.stringify(first.result_json)).winnerSeat, 1);
  await request(`${base}/${boss.roomId}/battles/${first.id}/replay`, "admin", "GET", undefined, 409);
  assert.equal((await cardBattleClientState(roomId, "u4")).game?.settlement, null);
  await request(`${path}/card-battle/member-role`, "u4", "POST", { role: "player" }, 409);
  await request(`${path}/leave`, "u1", "POST", {});
  await pool.query("UPDATE online_soup_members SET last_seen_at=NOW()-INTERVAL 10 MINUTE WHERE room_id=? AND user_id='u0'", [roomId]);
  await cleanupOnlineSoupStaleSeats();
  await request(`${base}/${boss.roomId}/status`, "admin", "PATCH", { enabled: false, revision: boss.revision });
  await request(`${path}/join-auto`, "u14", "POST", {}, 409);
  assert.equal((await request("/rooms", "u0")).rooms.some((room: any) => room.id === roomId), false);
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE id=?", [first.id]);
  await Promise.all(Array.from({ length: 5 }, () => finalizeCardBattleIfDue(roomId)));
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
  const [[second]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE room_id=? ORDER BY game_number DESC LIMIT 1", [roomId]);
  assert.equal(second.game_number, 2);
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE id=?", [second.id]);
  await recoverCardBattleGames();
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u0'"))[0][0]!.shell_balance, 123);
  assert.equal((await request(`${base}/${boss.roomId}/battles`)).total, 2);
  await request(`${path}/join-auto`, "u1", "POST", {});
  await request(`${path}/card-battle/lineup`, "u1", "PUT", { cardIds: cardIds.slice(0, 3) });
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true });
  await request(`${path}/card-battle/ready`, "u1", "POST", { ready: true });
  const [[third]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE room_id=? ORDER BY game_number DESC LIMIT 1", [roomId]);
  assert.equal(third.game_number, 3);
  assert.equal(third.lineup_snapshot_json.length, 3, "两位玩家对阵 BOSS");
  boss = (await request(`${base}/${boss.roomId}`, "admin", "PUT", { ...boss, endsAt: new Date(Date.now() - 1).toISOString() })).boss;
  await request(`${path}/join-auto`, "u15", "POST", {}, 409);
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE id=?", [third.id]);
  await recoverCardBattleGames();
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u1'"))[0][0]!.shell_balance, 999, "先前主动退出者仍可在以后通关获得首次奖励");
  await request(`${path}/card-battle/ready`, "u0", "POST", { ready: true }, 409);
  await request(`${base}/${boss.roomId}/battles/${third.id}/replay`, "staff", "GET", undefined, 403);
  // Restore availability for lifecycle tests; each player room is disposable.
  boss = (await request(`${base}/${boss.roomId}`, "admin", "PUT", { ...boss, endsAt: new Date(Date.now() + 3600000).toISOString() })).boss;
  const [[template]] = await pool.query<mysql.RowDataPacket[]>("SELECT host_id,status FROM online_soup_rooms WHERE id=?", [boss.roomId]);
  assert.equal(template.host_id, null); assert.equal(template.status, "closed");
  // A new room with the same BOSS cannot grant a second reward, even with a cleared label.
  const repeated = await createBoss("u0", { bossClearLabel: "cleared" });
  const repeatPath = `/rooms/${repeated.roomId}`;
  assert.equal((await request(repeatPath, "u0")).room.cardBattle.boss.rewardClaimed, true);
  await request(`${repeatPath}/card-battle/lineup`, "u0", "PUT", { cardIds: cardIds.slice(0, 3) });
  await request(`${repeatPath}/card-battle/ready`, "u0", "POST", { ready: true });
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE room_id=?", [repeated.roomId]);
  await finalizeCardBattleIfDue(repeated.roomId);
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u0'"))[0][0]!.shell_balance, 123);
  assert.equal((await request(`${repeatPath}/leave`, "u0", "POST", {})).roomClosed, true);
  await request(`${repeatPath}/join-auto`, "u1", "POST", {}, 404);
  // Labels never restrict members; a spectator can own the room and transfer ownership.
  const lifecycle = await createBoss("u4", { type: "password", password: "1234", bossClearLabel: "cleared" });
  const lifePath = `/rooms/${lifecycle.roomId}`;
  assert.equal((await request(lifePath, "u4")).me.isHost, true);
  await request(`${lifePath}/join-auto`, "u3", "POST", { password: "0000" }, 403);
  await request(`${lifePath}/join-auto`, "u3", "POST", { password: "1234" });
  await request(`${lifePath}/join-auto`, "u5", "POST", { password: "1234" });
  await request(`${lifePath}/members/u5/kick`, "u3", "POST", {}, 403);
  await request(`${lifePath}/members/u4/kick`, "u4", "POST", {}, 400);
  await request(`${lifePath}/card-battle/lineup`, "u3", "PUT", { cardIds: cardIds.slice(0, 3) });
  await request(`${lifePath}/card-battle/ready`, "u3", "POST", { ready: true });
  await request(`${lifePath}/members/u3/kick`, "u4", "POST", {}, 409);
  await request(`${lifePath}/members/u5/kick`, "u4", "POST", {});
  const departure = await request(`${lifePath}/leave`, "u4", "POST", {});
  assert.equal(departure.newHostId, "u3");
  assert.equal((await request(lifePath, "u3")).me.isHost, true);
  assert.equal((await request(`${lifePath}/leave`, "u3", "POST", {})).roomClosed, true);
  const [[closedGame]] = await pool.query<mysql.RowDataPacket[]>("SELECT status FROM online_card_battles WHERE room_id=?", [lifecycle.roomId]);
  assert.equal(closedGame.status, "aborted");
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM online_soup_members WHERE room_id=? AND is_active=1", [lifecycle.roomId]))[0][0]!.total, 0);
  // In preparation, kicking a teammate resets readiness and releases the seat.
  const kickRoom = await createBoss("u0"); const kickPath = `/rooms/${kickRoom.roomId}`;
  await request(`${kickPath}/join-auto`, "u3", "POST", {});
  await request(`${kickPath}/card-battle/lineup`, "u0", "PUT", { cardIds: cardIds.slice(0, 3) });
  await request(`${kickPath}/card-battle/ready`, "u0", "POST", { ready: true });
  await request(`${kickPath}/members/u3/kick`, "u0", "POST", {});
  const kicked = await cardBattleClientState(kickRoom.roomId, "u0");
  assert.equal(kicked.seats.filter(seat => seat.user).length, 1); assert.equal(kicked.seats.some(seat => seat.ready), false);
  // Host departure transfers to a player without promoting them out of the combat seat.
  await request(`${kickPath}/join-auto`, "u3", "POST", {});
  assert.equal((await request(`${kickPath}/leave`, "u0", "POST", {})).newHostId, "u3");
  const successor = await request(kickPath, "u3"); assert.equal(successor.me.isHost, true); assert.equal(successor.me.role, "player");
  await request(`${kickPath}/leave`, "u3", "POST", {});
  // Separate rooms finalizing concurrently serialize on the same account's first-clear record.
  const concurrent = await Promise.all([createBoss("u3"), createBoss("u3")]);
  for (const room of concurrent) {
    await request(`/rooms/${room.roomId}/card-battle/lineup`, "u3", "PUT", { cardIds: cardIds.slice(0, 3) });
    await request(`/rooms/${room.roomId}/card-battle/ready`, "u3", "POST", { ready: true });
    await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE room_id=?", [room.roomId]);
  }
  await Promise.all(concurrent.map(room => finalizeCardBattleIfDue(room.roomId)));
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u3'"))[0][0]!.shell_balance, 999);
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM card_battle_boss_rewards WHERE room_id=? AND user_id='u3'", [boss.roomId]))[0][0]!.total, 1);
  // Old rewards have only the legacy system room identity, and remain valid in new rooms.
  await pool.query("INSERT INTO card_battle_boss_rewards (room_id,user_id,game_id,amount) VALUES (?,?,?,77)", [boss.roomId, "u4", first.id]);
  await pool.query("UPDATE online_soup_rooms SET status='preparing', closed_at=NULL WHERE id=?", [boss.roomId]);
  await initCardBattleBossSchema(pool); await initCardBattleBossSchema(pool);
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT status FROM online_soup_rooms WHERE id=?", [boss.roomId]))[0][0]!.status, "closed");
  const historical = await createBoss("u4");
  assert.equal((await cardBattleClientState(historical.roomId, "u4")).boss?.rewardClaimed, true);
  // Editing a definition clears preparation in every linked room, including rooms of the same account.
  const revisionRooms = await Promise.all([createBoss("u0"), createBoss("u0")]);
  for (const room of revisionRooms) {
    await request(`/rooms/${room.roomId}/join-auto`, "u3", "POST", {});
    await request(`/rooms/${room.roomId}/card-battle/lineup`, "u0", "PUT", { cardIds: cardIds.slice(0, 3) });
    await request(`/rooms/${room.roomId}/card-battle/ready`, "u0", "POST", { ready: true });
  }
  boss = (await request(`${base}/${boss.roomId}`, "admin", "PUT", { ...boss, rewardShells: 1000 })).boss;
  for (const room of revisionRooms) assert.equal((await cardBattleClientState(room.roomId, "u0")).seats.some(seat => seat.ready), false);
  // Revalidate availability on submit, rather than trusting the previously loaded picker.
  boss = (await request(`${base}/${boss.roomId}/status`, "admin", "PATCH", { enabled: false, revision: boss.revision })).boss;
  assert.equal((await request("/card-battle-bosses", "u0")).bosses.length, 0);
  await request("/rooms", "u0", "POST", { name: "已下架", type: "public", contentType: "card_battle", cardBattleMode: "boss", bossTemplateId: boss.roomId, bossClearLabel: "cleared" }, 409);
  boss = (await request(`${base}/${boss.roomId}/status`, "admin", "PATCH", { enabled: true, revision: boss.revision })).boss;
  // Simultaneous departures re-check the current owner under the room lock.
  const simultaneous = await createBoss("u0");
  await request(`/rooms/${simultaneous.roomId}/join-auto`, "u3", "POST", {});
  await Promise.all(["u0", "u3"].map(user => request(`/rooms/${simultaneous.roomId}/leave`, user, "POST", {})));
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT status FROM online_soup_rooms WHERE id=?", [simultaneous.roomId]))[0][0]!.status, "closed");
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM online_soup_members WHERE room_id=? AND is_active=1", [simultaneous.roomId]))[0][0]!.total, 0);
  // A combatant host can depart while the frozen team continues for the successor.
  const activeHost = await createBoss("u0"); const activePath = `/rooms/${activeHost.roomId}`;
  await request(`${activePath}/join-auto`, "u3", "POST", {});
  for (const user of ["u0", "u3"]) {
    await request(`${activePath}/card-battle/lineup`, user, "PUT", { cardIds: cardIds.slice(0, 3) });
    await request(`${activePath}/card-battle/ready`, user, "POST", { ready: true });
  }
  assert.equal((await request(`${activePath}/leave`, "u0", "POST", {})).newHostId, "u3");
  const ongoing = await request(activePath, "u3"); assert.equal(ongoing.me.isHost, true); assert.equal(ongoing.room.status, "playing");
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT forfeited_at FROM card_battle_boss_participants WHERE game_id=? AND user_id='u0'", [ongoing.room.cardBattle.game.id]))[0][0]!.forfeited_at != null, true);
  await pool.query("UPDATE online_card_battles SET playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE room_id=?", [activeHost.roomId]);
  assert.equal((await request(`${activePath}/leave`, "u3", "POST", {})).roomClosed, true);
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT status FROM online_card_battles WHERE room_id=?", [activeHost.roomId]))[0][0]!.status, "ended", "Due battles settle before closure");
  // Offline empty BOSS rooms close after the existing host grace period.
  const offline = await createBoss("u3");
  await pool.query("UPDATE online_soup_rooms SET host_last_seen_at=NOW()-INTERVAL 30 DAY WHERE id=?", [offline.roomId]);
  await cleanupOnlineSoupInactiveHostRooms();
  assert.equal((await pool.query<mysql.RowDataPacket[]>("SELECT status FROM online_soup_rooms WHERE id=?", [offline.roomId]))[0][0]!.status, "closed");
  await request(`${base}/${boss.roomId}`, "staff", "PUT", boss, 403);
  for (const departure of ["member", "host", "kick"] as const) {
    const normal = await request("/rooms", "u2", "POST", { name: "退出准备回归", type: "public", contentType: "card_battle" }, 201);
    const normalPath = `/rooms/${normal.roomId}`;
    await request(`${normalPath}/join-auto`, "u3", "POST", {});
    const remaining = departure === "host" ? "u3" : "u2";
    await request(`${normalPath}/card-battle/lineup`, remaining, "PUT", { cardIds });
    await request(`${normalPath}/card-battle/ready`, remaining, "POST", { ready: true });
    if (departure === "kick") await request(`${normalPath}/members/u3/kick`, "u2", "POST", {});
    else await request(`${normalPath}/leave`, departure === "host" ? "u2" : "u3", "POST", {});
    const state = await cardBattleClientState(normal.roomId, remaining);
    assert.equal(state.seats.filter((seat) => seat.user).length, 1);
    assert.equal(state.seats.some((seat) => seat.ready), false, `${departure}: remaining player must be unready`);
    assert.equal(state.game, null);
    const snapshot = await request(normalPath, remaining);
    assert.equal(snapshot.room.status, "preparing");
    if (departure === "host") assert.equal(snapshot.me.isHost, true);
  }
  console.log("PASS: unready departure resets 3-to-2 and 2-to-1 teams, recovery cannot autostart, spectator exit preserves readiness, role changes, ordinary member/host exit and kick; schema migration twice, simultaneous readiness, frozen replay, explicit exit vs disconnect, atomic rewards, solo autostart, player room lifecycle, labels, shared rewards, password, host transfer, kicking, offline closure.");
} finally {
  timerMock.mock.restore();
  for (const timer of fixtureTimers) clearTimeout(timer);
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
