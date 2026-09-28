// Loopback database, connection-local temporary tables only.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { loadDrawCollectibleCandidates, awardCollectiblesForDraw } from "../src/collectibles.js";
import { digitalAssetRules as rules } from "../src/digitalAssets.js";
import { pool } from "../src/db.js";
assert.ok(["127.0.0.1", "localhost", "::1"].includes(config.db.host), "Loopback MySQL required");
const connection = await mysql.createConnection({ ...config.db, connectTimeout: 5000 });
try {
  const tables = ["collectibles", "collectible_pack_bindings", "collectible_draw_awards", "collectible_transfers", "collectible_value_events", "users", "asset_packs", "asset_cards", "asset_pack_cards", "asset_pack_rarity_probabilities", "user_asset_cards", "user_asset_pack_up_selections", "asset_draw_orders", "asset_draw_results", "asset_pity_progress", "user_asset_summaries", "asset_draw_count_events", "asset_collection_value_events", "user_asset_draw_totals", "shell_transactions", "entitlement_daily_usage", "entitlement_daily_events", "vip_growth_events", "vip_growth_daily_settlements"];
  for (const table of tables) {
    const [[schema]] = await connection.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE ${table}`);
    const ddl = String(schema["Create Table"]).replace("CREATE TABLE", "CREATE TEMPORARY TABLE").replace(/\n\s*CONSTRAINT[^\n]+/g, "").replace(/,\n\)/, "\n)");
    await connection.query(ddl);
  }
  // This local DB may predate the effects migration; adjust only the temp table.
  const [columns] = await connection.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM collectibles");
  if (!columns.some(row => row.Field === "battle_effects_json")) await connection.query("ALTER TABLE collectibles ADD COLUMN battle_effects_json JSON NULL");
  const [packColumns] = await connection.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM asset_packs");
  for (const [rarity, value] of [["normal", 0], ["rare", 1], ["epic", 2], ["legend", 5]] as const) {
    if (!packColumns.some(row => row.Field === `full_star_refund_${rarity}`)) {
      await connection.query(`ALTER TABLE asset_packs ADD COLUMN full_star_refund_${rarity} INT UNSIGNED NOT NULL DEFAULT ${value}`);
    }
  }
  const image = "data:image/webp;base64," + "A".repeat(1_000_000);
  for (let i = 1; i <= 3; i++) {
    await connection.query("INSERT INTO collectibles (id,collectible_no,name,rarity,image_url,thumbnail_url,status) VALUES (?,?,?,'epic',?,?,'draw_linked')", [`prize${i}`, `00${i}`, `奖品${i}`, image, image]);
    await connection.query("INSERT INTO collectible_pack_bindings (collectible_id,pack_id,probability) VALUES (?, 'pack', 100)", [`prize${i}`]);
  }
  await connection.beginTransaction();
  let legacyBytes = 0;
  const start = performance.now();
  for (let i = 0; i < 10; i++) {
    const [rows] = await connection.query("SELECT c.*, b.probability AS draw_probability FROM collectibles c INNER JOIN collectible_pack_bindings b ON b.collectible_id=c.id WHERE b.pack_id='pack' AND c.status='draw_linked' AND c.owner_user_id IS NULL AND c.deleted_at IS NULL ORDER BY CAST(c.collectible_no AS UNSIGNED), c.collectible_no,c.id FOR UPDATE");
    legacyBytes += Buffer.byteLength(JSON.stringify(rows));
  }
  const legacyMs = performance.now() - start;
  const newStart = performance.now();
  const candidates = await loadDrawCollectibleCandidates(connection as mysql.PoolConnection, "pack");
  const candidateMs = performance.now() - newStart;
  const candidateBytes = Buffer.byteLength(JSON.stringify(candidates));
  assert.equal(candidates.length, 3);
  assert.ok(candidateBytes < 10_000);
  const awards = [];
  for (let i = 1; i <= 10; i++) awards.push(...await awardCollectiblesForDraw(connection as mysql.PoolConnection, "user", "pack", "order", i, 95 + i - 1, candidates));
  assert.equal(awards.length, 3, "Each collectible awarded exactly once across the ten draws");
  assert.ok(awards.every(award => award.drawIndex === 1 && award.packDrawNumber === 96));
  assert.equal((await loadDrawCollectibleCandidates(connection as mysql.PoolConnection, "pack")).length, 0);
  await connection.rollback();
  assert.equal((await loadDrawCollectibleCandidates(connection as mysql.PoolConnection, "pack")).length, 3, "Rollback restores ownership and bindings");
  console.log(JSON.stringify({ passed: true, fixture: "3 collectibles, 1MB full + 1MB thumbnail each; local synthetic data", legacyReads: 10, candidateReads: 1, legacyBytes, candidateBytes, legacyMs, candidateMs }));
  // Exercise the actual draw transaction against the same private tables.
  await connection.query("INSERT INTO users (id,username,password,nickname,role,shell_balance) VALUES ('user','draw-test','unused','测试','super_admin',10000)");
  await connection.query("INSERT INTO asset_packs (id,name,cover_url,ten_price,enabled) VALUES ('pack','测试卡包','/test',100,1)");
  for (const [i, rarity] of ["normal", "rare", "epic", "legend"].entries()) {
    await connection.query("INSERT INTO asset_cards (id,card_no,name,rarity,image_url,status) VALUES (?,?,?,?, '/test','active')", [rarity, String(i), rarity, rarity]);
    await connection.query("INSERT INTO asset_pack_cards (pack_id,card_id,probability,enabled) VALUES ('pack',?,0,1)", [rarity]);
    await connection.query("INSERT INTO asset_pack_rarity_probabilities (pack_id,rarity,probability) VALUES ('pack',?,?)", [rarity, rarity === "epic" ? 100 : 0]);
  }
  const rawQuery = connection.query.bind(connection);
  const statements: string[] = [];
  const guardedQuery = ((sql: string, params?: unknown[]) => {
    const mutation = /^(?:INSERT(?: IGNORE)? INTO|UPDATE|DELETE FROM)\s+`?(\w+)/i.exec(sql.trim());
    if (mutation) assert.ok(tables.includes(mutation[1]), `Persistent writes forbidden: ${mutation[1]}`);
    statements.push(sql);
    return rawQuery(sql, params);
  }) as typeof connection.query;
  const oldPoolQuery = pool.query, oldGetConnection = pool.getConnection;
  connection.query = guardedQuery;
  pool.query = guardedQuery as typeof pool.query;
  pool.getConnection = (async () => Object.assign(connection, { release() {} })) as typeof pool.getConnection;
  try {
    const result = await rules.performDraw("user", "pack", "ten", "test-request-1");
    assert.equal(result!.results.length, 10);
    assert.equal(result!.results.filter(card => card.firstObtained).length, 1);
    assert.deepEqual(result!.results.map(card => card.starAfter), Array.from({ length: 10 }, (_, i) => rules.starForTotal(i + 1)));
    const [[owned]] = await rawQuery<mysql.RowDataPacket[]>("SELECT * FROM user_asset_cards WHERE user_id='user' AND card_id='epic'");
    assert.equal(owned.total_obtained, 10);
    const [[balance]] = await rawQuery<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='user'");
    const expectedRefund = result!.results.reduce((sum, card) => sum + card.shellRefund, 0);
    assert.equal(balance.shell_balance, 9900 + expectedRefund);
    const repeated = await rules.performDraw("user", "pack", "ten", "test-request-1");
    assert.equal(repeated!.id, result!.id);
    const [[afterRetry]] = await rawQuery<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='user'");
    assert.equal(afterRetry.shell_balance, balance.shell_balance, "Retry must not charge again");
    assert.equal(statements.filter(sql => sql.includes("SELECT card_id, star_level, total_obtained")).length, 1);
    assert.equal(statements.filter(sql => sql.includes("b.probability AS draw_probability")).length, 1);
    await rawQuery("UPDATE asset_packs SET full_star_refund_epic = 7 WHERE id = 'pack'");
    await rawQuery("UPDATE user_asset_cards SET star_level = 3, total_obtained = 19, duplicate_progress = 0 WHERE user_id = 'user' AND card_id = 'epic'");
    const configured = await rules.performDraw("user", "pack", "ten", "test-request-2");
    assert.ok(configured!.results.every(card => card.fullStarDuplicate && card.shellRefund === 7), "The locked pack's configured refund applies to each duplicate");
    const [[configuredBalance]] = await rawQuery<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='user'");
    assert.equal(configuredBalance.shell_balance, balance.shell_balance - 100 + 70);
    console.log("PASS: real ten-draw transaction, repeated-card upgrades, refunds, unique collectibles, idempotent retry; all mutations confined to temporary tables");
  } finally { pool.query = oldPoolQuery; pool.getConnection = oldGetConnection; }
} finally { await connection.end(); }
