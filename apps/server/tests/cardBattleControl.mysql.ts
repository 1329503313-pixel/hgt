// Loopback only. Connection-local temporary tables shadow the application tables;
// no application rows or persistent schema are modified.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { cardBattleTiersSchema, defaultCardBattleTiers, loadCardBattleTiers, saveCardBattleTiers } from "../src/cardBattleConfig.js";
assert.ok(["127.0.0.1", "localhost", "::1"].includes(config.db.host), "Loopback MySQL required");
const connection = await mysql.createConnection({ ...config.db, connectTimeout: 5000 });
const db = connection as unknown as mysql.PoolConnection;
try {
  const source = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
  for (const table of ["asset_card_battle_tiers", "asset_card_battle_effects"]) {
    const start = source.indexOf("CREATE TABLE IF NOT EXISTS " + table + " (");
    assert.ok(start >= 0);
    const end = source.indexOf(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;", start);
    assert.ok(end > start);
    const original = source.slice(start, end + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;".length);
    const temporary = original.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMPORARY TABLE")
      .split("\n").filter((line) => !/CONSTRAINT |REFERENCES /.test(line)).join("\n")
      .replace(/,\s*\)/, "\n    )")
      .replace("duration_rounds BIGINT", "duration_rounds INT");
    await connection.query(temporary);
  }
  // Exercise the same widening DDL against a legacy INT column.
  const widening = source.match(/pool.query\("(ALTER TABLE asset_card_battle_effects MODIFY COLUMN duration_rounds [^"]+)"\)/)![1]!;
  await connection.query(widening);
  await connection.query(widening);
  const tiers = cardBattleTiersSchema.parse(defaultCardBattleTiers().map((tier) => ({ ...tier,
    bonds: [{cardNos:['001','002'],event:'energy_empty',actions:[{target:'trigger',type:'attack_up',value:123,duration:2},{target:'random_4',type:'skill',value:null,duration:null}]}], effects: [{
    order: 0, condition: "energy_full", conditionValue: null, type: "stun_enemy_all", value: null, duration: 5_000_000_000, probability: 12.25,
    additionalEffects: [
      { type: "damage_all", value: 1000, duration: null, ignoreDefensePercent: 75.25 },
      { type: "revival_block_damaged", value: null, duration: 365 },
      { type: "act_again", value: null, duration: null },
    ],
  }] })));
  await saveCardBattleTiers("control-integration", tiers, db);
  const loaded = await loadCardBattleTiers("control-integration", db);
  assert.equal(loaded.length, 4);
  for (const tier of loaded) {
    assert.deepEqual(tier.bonds, tiers[0]!.bonds);
    assert.equal(tier.effects[0]!.duration, 5_000_000_000);
    assert.equal(tier.effects[0]!.probability, 12.25);
    assert.equal(tier.effects[0]!.additionalEffects?.[0]?.ignoreDefensePercent, 75.25);
    assert.equal(tier.effects[0]!.additionalEffects?.[1]?.duration, 365);
    assert.equal(tier.effects[0]!.additionalEffects?.[2]?.type, "act_again");
  }
  assert.ok(cardBattleTiersSchema.safeParse(loaded).success);
  await saveCardBattleTiers("control-integration", loaded, db);
  assert.deepEqual(await loadCardBattleTiers("control-integration", db), loaded);
  console.log("PASS: loopback MySQL legacy duration widening and main/additional skill save/load round-trip; persistent tables unchanged");
} finally {
  await connection.end(); // Automatically drops only this connection's temporary tables.
}
