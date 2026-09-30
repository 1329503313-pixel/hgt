// Disposable prefixed tables on loopback MySQL; never modifies application data.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { getCollectibleAchievementStats, collectibleHoldingValueSnapshot, COLLECTIBLE_ACHIEVEMENT_USERS_SQL } from "../src/collectibleAchievements.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback database required");
const raw = mysql.createPool({ ...config.db, timezone: "Z" });
const prefix = `ca_${process.pid}_${Date.now().toString(36)}_`;
const schemas = {
  users: "id VARCHAR(64) PRIMARY KEY",
  collectibles: "id VARCHAR(64) PRIMARY KEY, owner_user_id VARCHAR(64), rarity VARCHAR(20), status VARCHAR(30), deleted_at DATETIME NULL, collectible_value BIGINT UNSIGNED, INDEX(owner_user_id)",
  collectible_transfers: "id VARCHAR(64) PRIMARY KEY, to_user_id VARCHAR(64), transfer_type VARCHAR(20), collectible_snapshot JSON",
  collectible_value_events: "id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64), amount BIGINT, holdings_value_before BIGINT UNSIGNED NULL, holdings_value_after BIGINT UNSIGNED NULL",
};
const tokens = new RegExp(`\\b(${Object.keys(schemas).join("|")})\\b`, "g");
const wrap = <T extends mysql.Pool | mysql.PoolConnection>(target: T): T => new Proxy(target, {
  get(target, key) {
    if (key === "query") return (sql: string, values?: unknown[]) => target.query(sql.replace(tokens, (name) => prefix + name), values);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const db = wrap(raw);
const created: string[] = [];
try {
  for (const [name, schema] of Object.entries(schemas)) {
    await raw.query(`CREATE TABLE ${prefix}${name} (${schema}) ENGINE=InnoDB`);
    created.push(prefix + name);
  }
  await db.query("INSERT INTO users VALUES ('alice'),('bob'),('historical'),('empty')");
  await db.query(`INSERT INTO collectibles VALUES
    ('epic','alice','epic','owned',NULL,50000),
    ('legend','bob','legend','owned',NULL,1000001),
    ('deleted','alice','legend','owned',NOW(),9999999),
    ('unowned','alice','legend','unowned',NULL,9999999)`);
  assert.deepEqual(await getCollectibleAchievementStats(db, 'alice'), { epicCollectibleAcquired: 1, legendCollectibleAcquired: 0, highestCollectibleValue: 50000 });
  assert.deepEqual(await getCollectibleAchievementStats(db, 'bob'), { epicCollectibleAcquired: 0, legendCollectibleAcquired: 1, highestCollectibleValue: 1000001 });
  await db.query(`INSERT INTO collectible_transfers VALUES
    ('real','historical','grant',JSON_OBJECT('rarity','epic')),
    ('reclaim','historical','reclaim',JSON_OBJECT('rarity','legend')),
    ('unknown','historical','draw',JSON_OBJECT('name','unknown rarity'))`);
  await db.query("INSERT INTO collectible_value_events VALUES ('old','historical',9999999,NULL,NULL)");
  assert.deepEqual(await getCollectibleAchievementStats(db, 'historical'), { epicCollectibleAcquired: 1, legendCollectibleAcquired: 0, highestCollectibleValue: 0 });
  const connection = wrap(await raw.getConnection());
  try {
    await connection.beginTransaction();
    await connection.query("UPDATE collectibles SET collectible_value=150001 WHERE id='epic'");
    const snapshot = await collectibleHoldingValueSnapshot(connection, 'alice', 100001);
    assert.deepEqual(snapshot, { before: 50000, after: 150001 });
    await connection.query("INSERT INTO collectible_value_events VALUES ('increase','alice',100001,?,?)", [snapshot.before, snapshot.after]);
    await connection.commit();
    await connection.beginTransaction();
    await connection.query("UPDATE collectibles SET owner_user_id=NULL,status='unowned' WHERE id='epic'");
    const reclaimed = await collectibleHoldingValueSnapshot(connection, 'alice', -150001);
    assert.deepEqual(reclaimed, { before: 150001, after: 0 });
    await connection.query("INSERT INTO collectible_value_events VALUES ('reclaim','alice',-150001,?,?)", [reclaimed.before, reclaimed.after]);
    await connection.commit();
    assert.equal((await getCollectibleAchievementStats(db, 'alice')).highestCollectibleValue, 150001);
    await connection.beginTransaction();
    await connection.query("UPDATE collectibles SET collectible_value=2000000 WHERE id='legend'");
    const rolledBack = await collectibleHoldingValueSnapshot(connection, 'bob', 999999);
    await connection.query("INSERT INTO collectible_value_events VALUES ('rollback','bob',999999,?,?)", [rolledBack.before, rolledBack.after]);
    await connection.rollback();
    assert.equal((await getCollectibleAchievementStats(db, 'bob')).highestCollectibleValue, 1000001);
  } finally { connection.release(); }
  const [candidates] = await db.query<mysql.RowDataPacket[]>(COLLECTIBLE_ACHIEVEMENT_USERS_SQL);
  assert.deepEqual(candidates.map((row) => row.user_id).sort(), ['alice','bob','historical']);
  console.log('PASS: exact current holdings, independent rarities, immutable historical rarity, unknown-history exclusion, adjustment/reclaim snapshots, rollback, backfill candidates');
} finally {
  for (const name of created.reverse()) await raw.query(`DROP TABLE ${name}`);
  await raw.end();
}
