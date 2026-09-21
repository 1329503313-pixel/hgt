// Isolated disposable tables on loopback MySQL; no application data is changed.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { backfillOnlineSoupKeyHits, recordKeyHits } from "../src/gameKeyHits.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback database required");
const raw = mysql.createPool({ ...config.db, timezone: "Z" });
const prefix = `kh_${process.pid}_${Date.now().toString(36)}_`;
const schemas: Record<string, string> = {
  users: "id VARCHAR(64) PRIMARY KEY",
  game_key_hits: "user_id VARCHAR(64), soup_id VARCHAR(64), key_id INT, PRIMARY KEY(user_id,soup_id,key_id)",
  online_soup_rounds: "id VARCHAR(64) PRIMARY KEY, soup_id VARCHAR(64), host_mode VARCHAR(16), ai_fact_version_id VARCHAR(64), ai_revealed_keys JSON",
  ai_soup_facts: "version_id VARCHAR(64), fact_id VARCHAR(16), source_key_id INT, PRIMARY KEY(version_id,fact_id)",
  online_soup_round_fact_states: "round_id VARCHAR(64), fact_version_id VARCHAR(64), fact_id VARCHAR(16), state VARCHAR(16), first_discovered_by VARCHAR(64), first_discovered_question_id VARCHAR(64), PRIMARY KEY(round_id,fact_id)",
  online_soup_messages: "id VARCHAR(64) PRIMARY KEY, round_id VARCHAR(64), sender_id VARCHAR(64), message_type VARCHAR(16), ai_status VARCHAR(16), ai_scoring_degraded INT, message_sequence BIGINT",
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
  await db.query("INSERT INTO users VALUES ('alice'),('bob')");
  await db.query("INSERT INTO online_soup_rounds VALUES ('r','s','ai','v','[1,2,3,4,5,6,7,8,9]')");
  // Same-second discoveries are intentionally distinguished by sequence, not timestamps.
  await db.query(`INSERT INTO online_soup_messages VALUES
    ('a','r','alice','question','completed',0,10), ('b','r','bob','question','completed',0,11),
    ('failed','r','bob','question','failed',0,12), ('degraded','r','bob','question','completed',1,13),
    ('hint','r',NULL,'clue','completed',0,14), ('other','other-round','bob','question','completed',0,15)`);
  const fact = async (key: number, suffix: string, state: string | null, user: string | null, question: string | null) => {
    const id = `${key}-${suffix}`;
    await db.query("INSERT INTO ai_soup_facts VALUES ('v',?,?)", [id, key]);
    if (state) await db.query("INSERT INTO online_soup_round_fact_states VALUES ('r','v',?,?,?,?)", [id, state, user, question]);
  };
  await fact(1, "a", "DISCOVERED", "alice", "a");
  await fact(1, "b", "DISCOVERED", "bob", "b"); // Bob completes Alice's partially discovered key.
  await fact(2, "a", "DISCOVERED", "alice", "a");
  await fact(3, "a", "DISCOVERED", "alice", "a");
  await fact(3, "b", "TOUCHED", null, null); // Partial key.
  await fact(4, "a", "DISCOVERED", null, null); // Migrated without ownership evidence.
  await fact(5, "a", "DISCOVERED", "bob", "failed");
  await fact(6, "a", "DISCOVERED", "bob", "degraded");
  await fact(7, "a", "DISCOVERED", "bob", "a"); // Sender mismatch.
  await fact(8, "a", "DISCOVERED", "bob", "hint");
  await fact(9, "a", "DISCOVERED", "bob", "b");
  await fact(9, "b", null, null, null); // Missing fact state must prevent partial recovery.
  await fact(10, "a", "DISCOVERED", "bob", "b"); // Key not in committed round progress.
  assert.equal(await backfillOnlineSoupKeyHits(db), 2);
  const [recovered] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM game_key_hits ORDER BY user_id,key_id");
  assert.deepEqual(recovered.map((r) => [r.user_id, r.soup_id, r.key_id]), [["alice", "s", 2], ["bob", "s", 1]]);
  assert.equal(await backfillOnlineSoupKeyHits(db), 0);
  console.log("PASS history: completed keys, last discoverer, partial/missing facts, unknown owner, failed/degraded answers, hints, sender checks, idempotency");

  await db.query("UPDATE online_soup_round_fact_states SET first_discovered_question_id='other' WHERE fact_id='1-b'");
  await db.query("DELETE FROM game_key_hits WHERE user_id='bob'");
  assert.equal(await backfillOnlineSoupKeyHits(db), 0);
  await db.query("UPDATE online_soup_rounds SET host_mode='human'");
  await db.query("DELETE FROM game_key_hits");
  assert.equal(await backfillOnlineSoupKeyHits(db), 0);
  console.log("PASS history: cross-round questions and human-host rounds excluded");

  const connection = wrap(await raw.getConnection());
  try {
    await connection.beginTransaction();
    assert.equal(await recordKeyHits("alice", "s", [1, 1, 2], connection), 2);
    await connection.rollback();
    const [[rolledBack]] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM game_key_hits");
    assert.equal(Number(rolledBack.n), 0);
    await connection.beginTransaction();
    assert.equal(await recordKeyHits("alice", "s", [1, 2], connection), 2);
    await connection.commit();
    assert.equal(await recordKeyHits("alice", "s", [1, 2], connection), 0);
    assert.equal(await recordKeyHits("bob", "s", [1], connection), 1);
    assert.equal(await recordKeyHits("alice", "other-soup", [1], connection), 1);
    assert.equal(await recordKeyHits("alice", "s", Array.from({ length: 10 }, (_, i) => i + 1), connection), 8);
    const [[total]] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM game_key_hits WHERE user_id='alice' AND soup_id='s'");
    assert.equal(Number(total.n), 10);
  } finally { connection.release(); }
  console.log("PASS live: rollback, commit, replay deduplication, independent users/soups, ten-hit threshold");
} finally {
  for (const name of created.reverse()) await raw.query(`DROP TABLE ${name}`);
  await raw.end();
}
