// Uses schema-only copies in loopback MySQL. All application queries target disposable prefixed tables.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import express from "express";
import "express-async-errors";
import { config } from "../src/config.js";
import { canViewOnlineSoupMessage, initOnlineSoupHistory, initOnlineSoupHistorySchema } from "../src/onlineSoupHistory.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback MySQL required");
const prefix = `rh_${process.pid}_${Date.now().toString(36)}_`;
assert.match(prefix, /^rh_\d+_[a-z0-9]+_$/);
const admin = await mysql.createConnection({ ...config.db, timezone: "Z" });
let pool: mysql.Pool | undefined;
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
const created = new Set<string>();
try {
  const [source] = await admin.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [config.db.database]
  );
  const newTables = ["online_soup_round_history", "online_soup_round_viewers"];
  const sourceNames = source.map(row => String(row.TABLE_NAME)).filter(name => !/^(bt_|rh_)/.test(name) && !newTables.includes(name));
  const names = [...sourceNames, ...newTables];
  for (const name of names) { assert.match(name, /^[a-zA-Z0-9_]+$/); assert.ok((prefix + name).length <= 64); }
  for (const name of sourceNames) {
    await admin.query(`CREATE TABLE \`${prefix}${name}\` LIKE \`${name}\``);
    created.add(prefix + name);
  }
  ({ pool } = await import("../src/db.js"));
  const tokens = new RegExp(`\\b(${names.join("|")}|fk_[a-zA-Z0-9_]+)\\b`, "g");
  const rewrite = (sql: string) => sql.replace(tokens, name => prefix + name);
  const query = pool.query.bind(pool);
  pool.query = ((sql: string, values?: unknown) => query(rewrite(sql), values as any)) as typeof pool.query;
  const lease = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const connection = await lease();
    return new Proxy(connection, { get(target, key) {
      if (key === "query") return (sql: string, values?: unknown) => target.query(rewrite(sql), values as any);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  for (const name of newTables) created.add(prefix + name);
  await initOnlineSoupHistorySchema(pool);
  const { default: router } = await import("../src/onlineSoup.js");
  for (const id of ["host", "x", "stay", "prep", "late", "watch", "new-ai"]) {
    await pool.query("INSERT INTO users (id, username, password, nickname, role) VALUES (?, ?, 'unused', ?, ?)", [id, id, id, id === "host" ? "super_admin" : "user"]);
  }
  await pool.query(`INSERT INTO soups (id, title, author, type, surface, bottom, supplemental_surfaces, supplemental_bottoms,
    host_manual, creator_id, creator_name, enable_ai_game, is_bottom_public)
    VALUES ('soup', '测试汤', 'host', '本格清汤', '汤面', '汤底秘密', '["补充秘密"]', '[]', '手册秘密', 'host', 'host', 1, 1)`);
  // Legacy migration: preserve proven visits, but never infer older visits from a later join.
  await pool.query(`INSERT INTO online_soup_rooms (id, room_code, name, host_id, status)
    VALUES ('legacy', 'LEGACY', '旧房间', 'host', 'ended')`);
  await pool.query(`INSERT INTO online_soup_rounds (id, room_id, soup_id, round_number, status, started_at, ended_at)
    VALUES ('legacy-round', 'legacy', 'soup', 1, 'ended', '2026-01-01 10:00:00', '2026-01-01 11:00:00')`);
  for (const [user, joined, left] of [
    ['x', '2026-01-01 09:00:00', '2026-01-01 10:30:00'],
    ['stay', '2026-01-01 12:00:00', '2026-01-01 12:30:00'],
    ['late', '2026-01-01 11:00:00', '2026-01-01 12:00:00'],
    ['prep', '2026-01-01 09:00:00', '2026-01-01 09:30:00']
  ]) await pool.query(`INSERT INTO online_soup_members (room_id, user_id, member_role, is_active, joined_at, left_at)
    VALUES ('legacy', ?, 'player', 0, ?, ?)`, [user, joined, left]);
  for (const [id, user, type, at] of [
    ['legacy-question', 'stay', 'question', '2026-01-01 10:30:00'],
    ['legacy-mvp', null, 'ai_honor', '2026-01-01 11:00:00'],
    ['legacy-after', 'late', 'discussion', '2026-01-01 11:00:00']
  ]) await pool.query(`INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content, created_at)
    VALUES (?, 'legacy', 'legacy-round', ?, ?, '历史消息', ?)`, [id, user, type, at]);
  await initOnlineSoupHistory(pool);
  for (const user of ['x', 'stay']) assert.equal(await canViewOnlineSoupMessage(pool, 'legacy', 'legacy-question', user), true);
  for (const user of ['late', 'prep']) {
    assert.equal(await canViewOnlineSoupMessage(pool, 'legacy', 'legacy-question', user), false);
    assert.equal(await canViewOnlineSoupMessage(pool, 'legacy', 'legacy-mvp', user), false);
    assert.equal(await canViewOnlineSoupMessage(pool, 'legacy', 'legacy-after', user), true);
  }
  console.log('PASS legacy migration: member interval, earlier message evidence, same-second post-MVP boundary');
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const [[user]] = await pool!.query<mysql.RowDataPacket[]>("SELECT id, nickname, role FROM users WHERE id = ?", [req.header("x-test-user") || ""]);
    (req as any).user = user;
    next();
  });
  app.use("/api/online-soup", router);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}/api/online-soup`;
  const request = async (path: string, user = "host", method = "GET", body?: unknown, status = 200): Promise<any> => {
    const response = await fetch(origin + path, { method, headers: { "x-test-user": user, "Content-Type": "application/json" }, ...(body == null ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  };
  const room = await request("/rooms", "host", "POST", { name: "历史可见性", type: "public", hostMode: "human" }, 201);
  const path = `/rooms/${room.roomId}`;
  const join = (user: string, auto = true, role = "player") => request(`${path}/${auto ? "join-auto" : "join"}`, user, "POST", auto ? {} : { role });
  const leave = (user: string) => request(`${path}/leave`, user, "POST", {});
  const currentRound = async () => {
    const [[row]] = await pool!.query<mysql.RowDataPacket[]>("SELECT current_round_id FROM online_soup_rooms WHERE id = ?", [room.roomId]);
    return String(row.current_round_id);
  };
  const insert = async (round: string, id: string, type = "discussion", user = "stay") => {
    await pool!.query(`INSERT INTO online_soup_messages (id, room_id, round_id, sender_id, message_type, content, question_number, answer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, room.roomId, round, user, type, `${id}-秘密`, type === "question" ? 1 : null, type === "question" ? "yes" : null]);
  };
  const finish = (question: string, user: string) => request(`${path}/publish-bottom`, "host", "POST", { mvpUserId: user, bestQuestionMessageId: question });
  const history = (user: string, suffix = "") => request(`${path}/messages${suffix}`, user);
  const has = (page: any, id: string) => page.messages.some((message: any) => message.id === id);

  await join("stay");
  await join("prep");
  await request(`${path}/select-soup`, "host", "POST", { soupId: "soup" });
  await leave("prep");
  await request(`${path}/start`, "host", "POST", {});
  const A = await currentRound();
  await join("x");
  await join("watch", false, "spectator");
  await insert(A, "A-question", "question", "x");
  await leave("x");
  await leave("watch");
  await finish("A-question", "x");
  const [[aBoundary]] = await pool.query<mysql.RowDataPacket[]>("SELECT through_sequence FROM online_soup_round_history WHERE round_id = ?", [A]);
  assert.ok(aBoundary?.through_sequence);
  await join("x");
  assert.ok(has(await history("x"), "A-question"));
  await leave("x");

  await request(`${path}/select-soup`, "host", "POST", { soupId: "soup" });
  await request(`${path}/start`, "host", "POST", {});
  const B = await currentRound();
  await insert(B, "B-question", "question");
  await insert(B, "B-clue", "clue");
  for (let i = 0; i < 205; i++) await insert(B, `B-chat-${i}`);
  await pool.query("UPDATE online_soup_rounds SET published_surface_indices = '[0]' WHERE id = ?", [B]);
  await finish("B-question", "stay");
  await join("x", false);
  await join("prep");
  await join("late");
  await join("watch");
  // A post-settlement chat remains public even though its legacy round_id still points at B.
  const reply = await request(`${path}/messages`, "stay", "POST", { type: "discussion", content: "结算后新聊天", replyToMessageId: "B-question" }, 201);
  const xHistory = await history("x");
  assert.ok(has(xHistory, "A-question"));
  assert.ok(has(xHistory, reply.id));
  assert.equal(xHistory.messages.find((m: any) => m.id === reply.id).replyTo, null);
  assert.ok(!xHistory.messages.some((m: any) => m.id.startsWith("B-") || m.type === "ai_honor" && m.roundId === B));
  assert.ok(has(await history("watch"), "A-question"), "spectator retains A");
  for (const user of ["prep", "late"]) {
    const page = await history(user);
    assert.ok(!has(page, "A-question") && !has(page, "B-question"));
    assert.ok(has(page, reply.id));
  }
  const xSnapshot = await request(path, "x");
  assert.equal(xSnapshot.room.currentRoundId, null);
  assert.deepEqual(xSnapshot.room.soup.visibleSupplementalSurfaces, []);
  assert.deepEqual((await request(`${path}/progress`, "x")).questions, []);
  assert.deepEqual((await request(`${path}/clues`, "x")).clues, []);
  assert.ok(has((await request("/active-room", "x")).session.snapshot, "A-question"));
  await request(`${path}/messages`, "x", "POST", { type: "discussion", content: "不能引用", replyToMessageId: "B-question" }, 400);
  const retained = await history("stay");
  assert.ok(has(retained, "B-chat-204"));
  assert.ok(retained.hasMore);
  const audit = await request(`/admin/rooms/${room.roomId}`);
  assert.ok(has(audit, "B-chat-204"));
  const all: any[] = [];
  let cursor = "0", seen = new Set<string>();
  for (;;) {
    const page = await history("x", `?after=${cursor}&limit=3`);
    all.push(...page.messages);
    if (!page.hasMore) break;
    assert.ok(!seen.has(page.nextCursor)); seen.add(page.nextCursor); cursor = page.nextCursor;
  }
  assert.ok(all.some(m => m.id === "A-question") && all.some(m => m.id === reply.id));
  assert.ok(!all.some(m => m.id.startsWith("B-")));
  assert.equal(new Set(all.map(m => m.id)).size, all.length);
  const backward: any[] = []; let before = "";
  for (;;) {
    const page = await history("x", `?limit=3${before ? `&before=${before}` : ""}`);
    backward.push(...page.messages);
    if (!page.hasMore) break;
    before = page.nextCursor;
  }
  assert.deepEqual(backward.map(m => m.id).sort(), all.map(m => m.id).sort());
  await leave("x"); await join("x");
  await initOnlineSoupHistory(pool); // Restart must not grant B to a returning user.
  assert.ok(!has(await history("x"), "B-question"));
  assert.equal(await canViewOnlineSoupMessage(pool, room.roomId, "A-question", "x"), true);
  assert.equal(await canViewOnlineSoupMessage(pool, room.roomId, "B-question", "x"), false);
  assert.equal(await canViewOnlineSoupMessage(pool, room.roomId, "B-question", "stay"), true);
  await request(`${path}/start`, "host", "POST", {});
  const C = await currentRound();
  await insert(C, "C-chat"); await leave("x");
  await request(`${path}/end-round`, "host", "POST", {});
  await join("x");
  assert.ok(has(await history("x"), "C-chat"));
  assert.ok(!has(await history("x"), "B-question"));
  await request(`${path}/start`, "host", "POST", {});
  const D = await currentRound();
  await insert(D, "D-question", "question");
  await pool.query("UPDATE online_soup_rooms SET host_mode = 'ai' WHERE id = ?", [room.roomId]);
  await pool.query("UPDATE online_soup_rounds SET host_mode = 'ai', ai_progress = 80 WHERE id = ?", [D]);
  await pool.query("UPDATE online_soup_messages SET ai_status = 'completed', ai_progress_delta = 20 WHERE id = 'D-question'");
  await pool.query("INSERT INTO online_soup_finish_votes (id, round_id, room_id) VALUES ('vote-D', ?, ?)", [D, room.roomId]);
  await pool.query("INSERT INTO online_soup_finish_vote_members (vote_id, user_id) VALUES ('vote-D', 'stay')");
  const voted = await request(`${path}/finish-vote`, "stay", "POST", { choice: "view_bottom" });
  assert.equal(voted.ended, true);
  await join("new-ai");
  assert.ok(!has(await history("new-ai"), "D-question"));
  assert.ok(has(await history("x"), "D-question"));
  const [[aiBoundary]] = await pool.query<mysql.RowDataPacket[]>(`SELECT m.message_type FROM online_soup_round_history h
    JOIN online_soup_messages m ON m.room_id = h.room_id AND m.message_sequence = h.through_sequence WHERE h.round_id = ?`, [D]);
  assert.equal(aiBoundary.message_type, "ai_honor");
  await leave("new-ai");
  await pool.query("UPDATE online_soup_rooms SET host_mode = 'human' WHERE id = ?", [room.roomId]);
  await request(`${path}/start`, "host", "POST", {});
  const E = await currentRound();
  await insert(E, "E-chat");
  await Promise.all([join("new-ai"), request(`${path}/end-round`, "host", "POST", {})]);
  const [[raceViewer]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM online_soup_round_viewers WHERE round_id = ? AND user_id = 'new-ai'", [E]);
  assert.equal(has(await history("new-ai"), "E-chat"), Number(raceViewer.count) === 1);
  assert.ok(!has(await history("new-ai"), "D-question"), "concurrent later entry cannot unlock an older round");
  console.log("PASS concurrent join/end: history agrees with transaction-serialized participation");
  console.log("PASS MySQL/API: A retained, B hidden, preparation-only denied, spectators, same-second joins, >200 hidden messages, forward/backward pagination, reply sanitization/rejection, socket visibility, panels, mini snapshot, admin audit, restart, interrupted round and AI vote/MVP boundary");
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const name of created) { assert.ok(name.startsWith(prefix)); await admin.query(`DROP TABLE IF EXISTS \`${name}\``); }
  await admin.end();
}
