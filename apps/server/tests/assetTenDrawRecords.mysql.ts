// All fixture writes stay in connection-local temporary tables.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { listTenDrawRecords } from "../src/assetTenDrawRecords.js";

assert.ok(["127.0.0.1", "localhost", "::1"].includes(config.db.host), "Loopback MySQL required");
const connection = await mysql.createConnection({ ...config.db, connectTimeout: 5000 });
try {
  await connection.query("CREATE TEMPORARY TABLE users (id VARCHAR(64) PRIMARY KEY, username VARCHAR(64), nickname VARCHAR(64))");
  await connection.query("CREATE TEMPORARY TABLE asset_packs (id VARCHAR(64) PRIMARY KEY, name VARCHAR(64))");
  await connection.query("CREATE TEMPORARY TABLE asset_draw_orders (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64), pack_id VARCHAR(64), draw_mode VARCHAR(16), status VARCHAR(16), created_at DATETIME, completed_at DATETIME)");
  await connection.query("CREATE TEMPORARY TABLE asset_draw_results (id VARCHAR(64) PRIMARY KEY, order_id VARCHAR(64), rarity VARCHAR(16))");
  await connection.query("INSERT INTO users VALUES ('user','original-account','测试用户')");
  await connection.query("INSERT INTO asset_packs VALUES ('pack','测试卡包')");
  const fixtures = [
    { id: "a", time: "2026-09-01 01:00:00", rarities: ["legend", ...Array(9).fill("normal")] },
    { id: "b", time: "2026-09-02 01:00:00", rarities: ["legend", "epic", ...Array(8).fill("normal")] },
    { id: "c", time: "2026-09-03 01:00:00", rarities: ["legend", "epic", "rare", ...Array(7).fill("normal")] },
    { id: "d", time: "2026-09-04 01:00:00", rarities: ["epic", "epic", ...Array(8).fill("normal")] },
    { id: "e", time: "2026-09-05 01:00:00", rarities: ["epic", "epic", ...Array(8).fill("normal")] },
    { id: "f", time: "2026-09-06 01:00:00", rarities: Array(10).fill("normal") },
  ];
  for (const fixture of fixtures) {
    await connection.query("INSERT INTO asset_draw_orders VALUES (?, 'user', 'pack', 'ten', 'completed', ?, ?)", [fixture.id, fixture.time, fixture.time]);
    for (const [index, rarity] of fixture.rarities.entries()) {
      await connection.query("INSERT INTO asset_draw_results VALUES (?, ?, ?)", [`${fixture.id}-${index}`, fixture.id, rarity]);
    }
  }
  await connection.query("INSERT INTO asset_draw_orders VALUES ('single', 'user', 'pack', 'single', 'completed', '2026-09-07 01:00:00', '2026-09-07 01:00:00')");
  await connection.query("INSERT INTO asset_draw_orders VALUES ('processing', 'user', 'pack', 'ten', 'processing', '2026-09-08 01:00:00', NULL)");
  await connection.query("INSERT INTO asset_draw_results VALUES ('single-result', 'single', 'legend')");

  const list = (sort: string, limit = 10, offset = 0, keyword = "") => listTenDrawRecords(connection, { sort, limit, offset, keyword });
  const expected: Record<string, string[]> = {
    "time-desc": ["f", "e", "d", "c", "b", "a"],
    "time-asc": ["a", "b", "c", "d", "e", "f"],
    "rainbow-desc": ["c", "b", "a", "e", "d", "f"],
    "rainbow-asc": ["e", "d", "f", "c", "b", "a"],
    "gold-desc": ["e", "d", "c", "b", "a", "f"],
    "gold-asc": ["a", "f", "c", "b", "e", "d"],
    "score-desc": ["c", "b", "a", "e", "d", "f"],
    "score-asc": ["f", "e", "d", "a", "b", "c"],
  };
  for (const [sort, ids] of Object.entries(expected)) {
    const result = await list(sort);
    assert.equal(result.total, 6, sort);
    assert.deepEqual(result.records.map((row) => row.id), ids, sort);
  }
  const scored = await list("time-desc");
  assert.deepEqual(scored.records.find((row) => row.id === "c") && {
    rainbow: scored.records.find((row) => row.id === "c")!.rainbowCount,
    gold: scored.records.find((row) => row.id === "c")!.goldCount,
    purple: scored.records.find((row) => row.id === "c")!.purpleCount,
    blue: scored.records.find((row) => row.id === "c")!.blueCount,
    score: scored.records.find((row) => row.id === "c")!.score,
  }, { rainbow: 1, gold: 1, purple: 1, blue: 7, score: 29 });
  assert.deepEqual((await list("rainbow-desc", 2, 1)).records.map((row) => row.id), ["b", "a"]);
  assert.equal((await list("time-desc", 10, 0, "测试卡包")).total, 6);
  assert.equal((await list("time-desc", 10, 0, "不存在")).total, 0);
  assert.deepEqual((await list("DROP TABLE users")).records.map((row) => row.id), expected["time-desc"]);
  console.log("PASS ten-draw records: one row per completed order, historical rarity score, eight global sorts, ties, pagination and search");
} finally {
  await connection.end();
}
