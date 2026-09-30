// Connection-local temporary tables and rewritten queries; no persistent rows are changed.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { retireLegacyVoiceRooms } from "../src/onlineSoupRetirement.js";

assert.ok(["127.0.0.1", "localhost", "::1"].includes(config.db.host), "Loopback MySQL required");
const db = await mysql.createConnection({ ...config.db, timezone: "Z" });
try {
  const tables = ["online_soup_rooms", "online_soup_members", "online_soup_rounds"];
  for (const table of tables) {
    await db.query(`CREATE TEMPORARY TABLE retirement_${table} LIKE ${table}`);
  }
  const query = db.query.bind(db);
  const pattern = new RegExp(`\\b(${tables.join("|")})\\b`, "g");
  db.query = ((sql: string, values?: unknown) => query(sql.replace(pattern, table => `retirement_${table}`), values as never)) as typeof db.query;
  // Older local schemas may predate the voice release; migrate only these temporary copies.
  for (const table of ["online_soup_rooms", "online_soup_rounds"]) {
    const [columns] = await db.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE 'communication_mode'`);
    if (!columns.length) await db.query(`ALTER TABLE ${table} ADD communication_mode ENUM('text','voice') NOT NULL DEFAULT 'text'`);
  }
  let roomCode = 100000;
  for (const [id, mode, hostMode, status] of [
    ["voice-playing", "voice", "human", "playing"],
    ["voice-ended", "voice", "human", "ended"],
    ["voice-closed", "voice", "human", "closed"],
    ["text-playing", "text", "human", "playing"],
    ["ai-playing", "text", "ai", "playing"],
  ]) {
    await db.query(`INSERT INTO online_soup_rooms (id, room_code, name, host_id, communication_mode, host_mode, status)
      VALUES (?, ?, ?, 'host', ?, ?, ?)`, [id, String(++roomCode), id, mode, hostMode, status]);
    await db.query(`INSERT INTO online_soup_members (room_id, user_id, member_role, is_active)
      VALUES (?, 'host', 'host', 1), (?, 'player', 'player', 1)`, [id, id]);
  }
  await db.query(`INSERT INTO online_soup_rounds (id, room_id, soup_id, round_number, communication_mode, status, started_at)
    VALUES ('archive', 'voice-ended', 'soup', 1, 'voice', 'ended', '2026-09-01 12:00:00')`);
  const [beforeRounds] = await db.query("SELECT * FROM online_soup_rounds");
  const [beforeOtherRooms] = await db.query("SELECT * FROM online_soup_rooms WHERE communication_mode='text' ORDER BY id");
  const [beforeOtherMembers] = await db.query("SELECT * FROM online_soup_members WHERE room_id IN ('text-playing','ai-playing') ORDER BY room_id,user_id");
  await retireLegacyVoiceRooms(db as mysql.PoolConnection);
  const [rooms] = await db.query<mysql.RowDataPacket[]>("SELECT id,status FROM online_soup_rooms WHERE communication_mode='voice'");
  assert.ok(rooms.every(room => room.status === "closed"));
  const [[active]] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM online_soup_members WHERE room_id LIKE 'voice-%' AND is_active=1");
  assert.equal(Number(active.n), 0);
  assert.deepEqual((await db.query("SELECT * FROM online_soup_rounds"))[0], beforeRounds);
  assert.deepEqual((await db.query("SELECT * FROM online_soup_rooms WHERE communication_mode='text' ORDER BY id"))[0], beforeOtherRooms);
  assert.deepEqual((await db.query("SELECT * FROM online_soup_members WHERE room_id IN ('text-playing','ai-playing') ORDER BY room_id,user_id"))[0], beforeOtherMembers);
  const [afterRooms] = await db.query("SELECT * FROM online_soup_rooms ORDER BY id");
  const [afterMembers] = await db.query("SELECT * FROM online_soup_members ORDER BY room_id,user_id");
  await retireLegacyVoiceRooms(db as mysql.PoolConnection);
  assert.deepEqual((await db.query("SELECT * FROM online_soup_rooms ORDER BY id"))[0], afterRooms);
  assert.deepEqual((await db.query("SELECT * FROM online_soup_members ORDER BY room_id,user_id"))[0], afterMembers);
  console.log("PASS: legacy voice retirement, archived round preservation, text/AI isolation and idempotency");
} finally { await db.end(); }
