// Loopback only. All fixture writes use connection-local temporary tables.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import type { Express, Request, Response, RequestHandler } from "express";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { loadCardBattleCollectionBonus, loadCardBattleCollectionBonuses, applyCardBattlePlayerCollection } from "../src/cardBattleCollection.js";
import { buildCardBattlePlayerInput, loadEligibleBattleCards, publicFrozenCard } from "../src/cardBattleRoom.js";
import { listCardBattleRanking } from "../src/cardBattleRanking.js";
import { registerDigitalAssetRoutes } from "../src/digitalAssets.js";
import { saveCardBattleTiers, defaultCardBattleTiers } from "../src/cardBattleConfig.js";
import { calculateCardBattlePower } from "../src/cardBattle.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback MySQL required");
const connection = await mysql.createConnection({ ...config.db, connectTimeout: 5000 });
const db = connection as mysql.PoolConnection;
const originalQuery = pool.query;
const tables = ["users", "asset_cards", "user_asset_cards", "asset_packs", "asset_pack_cards", "asset_card_battle_tiers", "asset_card_battle_effects", "collectibles", "card_battle_ranking_entries", "user_asset_summaries"];
try {
  for (const table of tables) {
    await connection.query(`CREATE TEMPORARY TABLE collection_fixture_${table} LIKE ${table}`);
    await connection.query(`ALTER TABLE collection_fixture_${table} RENAME TO ${table}`);
  }
  const migration = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
  for (const match of migration.matchAll(/ensureColumn\("([a-z_]+)", "([a-z_]+)", "([^"]+)"\)/g)) {
    if (!tables.includes(match[1]!)) continue;
    const [columns] = await connection.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${match[1]} LIKE ?`, [match[2]]);
    if (!columns.length) await connection.query(`ALTER TABLE ${match[1]} ADD COLUMN ${match[3]}`);
  }
  const [bindingsColumn] = await connection.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM card_battle_ranking_entries LIKE 'collectible_bindings_json'");
  if (!bindingsColumn.length) await connection.query("ALTER TABLE card_battle_ranking_entries ADD COLUMN collectible_bindings_json JSON NULL");
  for (const id of ["owner", "other", "empty"]) await connection.query("INSERT INTO users(id,username,password,nickname) VALUES (?,?, 'unused',?)", [id, id, id]);
  const ids = ["a", "b", "c", "d", "e"];
  for (const id of [...ids, "normal", "missing", "disabled", "unbound"]) {
    await connection.query("INSERT INTO asset_cards(id,card_no,name,rarity,image_url,battle_role,status) VALUES (?,?,?,?, '/fixture','damage',?)",
      [id, id, id, id === "a" ? "legend" : ["normal", "missing", "disabled", "unbound"].includes(id) ? "normal" : "epic", id === "disabled" ? "inactive" : "active"]);
    if (ids.includes(id)) await saveCardBattleTiers(id, defaultCardBattleTiers().map(tier => ({ ...tier,
      maxHp: 1000, attack: 100, defense: 100, speed: 100, critDamage: 150.25,
      effects: [{ id: `${id}-${tier.starLevel}`, order: 0, condition: "energy_full", conditionValue: null, type: "damage_single", value: 1000, duration: null,
        additionalEffects: [{ type: "heal_self", value: 200, duration: null }] }],
    })), db);
  }
  for (const id of [...ids, "normal"]) await connection.query("INSERT INTO user_asset_cards(user_id,card_id,star_level,total_obtained,display_order) VALUES ('owner',?,?,999,?)", [id, ["a", "b", "normal"].includes(id) ? 3 : 0, id === "a" ? 0 : null]);
  for (const id of ids) await connection.query("INSERT INTO user_asset_cards(user_id,card_id,star_level) VALUES ('other',?,0)", [id]);
  const packCards: Record<string, string[]> = { full: ["a", "b", "normal", "disabled", "unbound"], overlap: ["a", "b"], incomplete: ["c", "missing"], lowStar: ["c", "d"], emptyPack: [], disabledOnly: ["disabled"] };
  for (const [packId, cardIds] of Object.entries(packCards)) {
    await connection.query("INSERT INTO asset_packs(id,name,cover_url,enabled) VALUES (?,?,'',0)", [packId, packId]);
    for (const id of cardIds) await connection.query("INSERT INTO asset_pack_cards(pack_id,card_id,probability,enabled) VALUES (?,?,0,?)", [packId, id, id === "unbound" ? 0 : 1]);
  }
  const all = await loadCardBattleCollectionBonuses(["owner", "other", "empty", "owner"], db);
  assert.equal(all.size, 3);
  assert.equal(all.get("owner")!.completePackCount, 3, "下架包计入；空包、缺卡包、全停用包不计入；重复卡不多算");
  assert.equal(all.get("owner")!.threeStarLegendCount, 1);
  assert.deepEqual([...all.get("owner")!.threeStarPackCardIds].sort(), ["a", "b", "normal"]);
  assert.equal(all.get("other")!.completePackCount, 2);
  assert.equal(all.get("other")!.threeStarPackCardIds.size, 0);
  assert.equal(all.get("empty")!.completePackCount, 0);
  assert.equal((await loadCardBattleCollectionBonuses([], db)).size, 0);

  await connection.query(`INSERT INTO collectibles(id,collectible_no,name,rarity,image_url,status,owner_user_id,battle_effect_type,battle_effect_value)
    VALUES ('relic','001','relic','epic','','owned','owner','attack',50)`);
  const bindings = [{ cardId: "a", collectibleId: "relic" }];
  const frozen = await buildCardBattlePlayerInput("owner", "owner", 1, ids, db, bindings);
  const selected = await loadEligibleBattleCards("owner", db);
  assert.equal(frozen.cards[0]!.tier.maxHp, 1045);
  assert.equal(frozen.cards[0]!.tier.attack, 105);
  assert.equal(frozen.cards[0]!.tier.effects[0]!.value, 1045);
  assert.equal(frozen.cards[0]!.tier.effects[0]!.additionalEffects![0]!.value, 209);
  assert.equal(frozen.cards[0]!.tier.critDamage, 152.25);
  assert.equal(frozen.cards[2]!.tier.attack, 102);
  assert.equal(publicFrozenCard(frozen.cards[0]!).stats.attack, 155, "收藏品在取整后相加");
  assert.equal(selected.find(card => card.id === "a")!.stats.attack, 105);
  const team = await buildCardBattlePlayerInput("owner", "owner", 1, ids.slice(0, 3), db, bindings, 1);
  assert.equal(team.cards[0]!.tier.attack, 105);
  const other = await buildCardBattlePlayerInput("other", "other", 2, ids, db);
  assert.equal(other.cards[0]!.tier.attack, 101);
  assert.equal(other.cards[0]!.tier.critDamage, 150.25);

  await connection.query("INSERT INTO card_battle_ranking_entries(rank_position,user_id,lineup_json,collectible_bindings_json,total_power) VALUES (1,'owner',?,?,0)", [JSON.stringify(ids), JSON.stringify(bindings)]);
  const ranking = await listCardBattleRanking(10, db, false);
  assert.equal(ranking[0]!.occupied && ranking[0]!.totalPower, frozen.cards.reduce((sum, card) => sum + calculateCardBattlePower(publicFrozenCard(card).stats), 0));

  pool.query = connection.query.bind(connection) as typeof pool.query;
  const routes = new Map<string, RequestHandler>();
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(method => [method, (path: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${path}`, handlers.at(-1)!)])) as unknown as Express;
  registerDigitalAssetRoutes(app, { requireAuth: async () => ({ id: "other", role: "user" }), requireAdmin: async () => null,
    sendError: (res, status, message) => res.status(status).json({ error: message }), sendStoredImage: async () => {} });
  let cabinet: { cards: Array<{ id: string; battleTier: { attack: number } | null }> } | undefined;
  const response = { setHeader: () => {}, json: (payload: { cabinet: typeof cabinet }) => { cabinet = payload.cabinet; } } as unknown as Response;
  await routes.get("get /api/users/:id/card-cabinet")!({ params: { id: "owner" }, query: {} } as unknown as Request, response, () => {});
  assert.equal(cabinet!.cards.find(card => card.id === "a")!.battleTier!.attack, 105, "他人查看卡柜用拥有者加成");
  await routes.get("get /api/me/card-cabinet")!({ query: {} } as Request, response, () => {});
  assert.equal(cabinet!.cards.find(card => card.id === "a")!.battleTier!.attack, 101);

  await connection.query("DELETE FROM user_asset_cards WHERE user_id='owner' AND card_id='normal'");
  const changed = await loadCardBattleCollectionBonus("owner", db);
  assert.equal(changed.completePackCount, 2);
  assert.equal(applyCardBattlePlayerCollection(frozen, changed).cards[0]!.tier.maxHp, 1040);
  assert.equal(frozen.cards[0]!.tier.maxHp, 1045, "已开战快照不被收藏变化修改");
  await connection.query("UPDATE user_asset_cards SET star_level=2 WHERE user_id='owner' AND card_id='a'");
  const retry = applyCardBattlePlayerCollection(frozen, await loadCardBattleCollectionBonus("owner", db));
  assert.equal(retry.cards[0]!.tier.maxHp, 1010);
  assert.equal(retry.cards[0]!.tier.critDamage, 150.25);
  console.log("PASS: ownership, pack completion, previews, ranking power, battle snapshots, BOSS teams and rematches; persistent rows unchanged");
} finally {
  pool.query = originalQuery;
  await connection.end();
  await pool.end();
}
