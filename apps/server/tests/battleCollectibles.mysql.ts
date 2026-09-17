// Run explicitly with `npx tsx apps/server/tests/battleCollectibles.mysql.ts`.
// Only loopback MySQL is allowed. All writes target connection-local temporary tables.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RowDataPacket } from "mysql2/promise";
import type { Express, Request, Response, RequestHandler } from "express";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { loadBattleCollectibles } from "../src/battleCollectibles.js";
import { buildCardBattlePlayerInput, createSavedCardBattleDeck, loadSavedCardBattleDecks, saveCardBattleLineup, setCardBattleReady, updateSavedCardBattleDeck } from "../src/cardBattleRoom.js";
import { cardBattleRankingDetail, listCardBattleRanking } from "../src/cardBattleRanking.js";
import { registerCollectibleRoutes } from "../src/collectibles.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "This test requires loopback MySQL");
const connection = await pool.getConnection();
const originalQuery = pool.query;
const originalGetConnection = pool.getConnection;
const tables = ["collectibles", "collectible_number_sequences", "users", "user_card_battle_decks", "online_card_battle_seats", "asset_cards", "user_asset_cards", "asset_card_battle_tiers", "asset_card_battle_effects", "card_battle_ranking_entries"];
try {
  for (const table of tables) {
    await connection.query(`CREATE TEMPORARY TABLE fixture_${table} LIKE ${table}`);
    await connection.query(`ALTER TABLE fixture_${table} RENAME TO ${table}`);
  }
  const migrationSource = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
  async function ensureTemporaryColumn(table: string, column: string, definition: string) {
    const [rows] = await connection.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
    if (!rows.length) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
  // Apply the actual idempotent column definitions to temporary tables, including older local schemas.
  for (const match of migrationSource.matchAll(/ensureColumn\("([a-z_]+)", "([a-z_]+)", "([^"]+)"\)/g)) {
    if (tables.includes(match[1]!)) await ensureTemporaryColumn(match[1]!, match[2]!, match[3]!);
  }
  const bindingDefinition = migrationSource.match(/ensureColumn\(table, "collectible_bindings_json", "([^"]+)"\)/)?.[1];
  assert.ok(bindingDefinition);
  for (const table of ["user_card_battle_decks", "online_card_battle_seats", "card_battle_ranking_entries"]) {
    await ensureTemporaryColumn(table, "collectible_bindings_json", bindingDefinition);
    await ensureTemporaryColumn(table, "collectible_bindings_json", bindingDefinition);
  }
  await connection.query("INSERT INTO users (id,username,password,nickname) VALUES ('fixture-owner','fixture-owner','unused','测试玩家')");
  const cardIds = [1, 2, 3, 4, 5].map((n) => `fixture-card-${n}`);
  for (const [index, id] of cardIds.entries()) {
    await connection.query("INSERT INTO asset_cards (id,card_no,name,rarity,image_url,battle_role,status) VALUES (?,?,?,'epic','/fixture','damage','active')", [id, String(index + 1), `测试卡${index + 1}`]);
    await connection.query("INSERT INTO user_asset_cards (user_id,card_id,star_level) VALUES ('fixture-owner',?,0)", [id]);
    await connection.query("INSERT INTO asset_card_battle_tiers (card_id,star_level,max_hp,attack_value,defense_value,speed_value,energy_required) VALUES (?,0,1000,100,20,100,40)", [id]);
  }
  await connection.query(`INSERT INTO collectibles
    (id,collectible_no,name,rarity,image_url,status,owner_user_id,battle_effect_description,battle_effect_type,battle_effect_value)
    VALUES ('fixture-relic','001','测试收藏品','epic','/fixture','owned','fixture-owner',?,'energy_reduction',100)`, ["首行\n次行 <b>仍是纯文本</b>"]);
  await connection.query("INSERT INTO collectibles (id,collectible_no,name,rarity,image_url,status,owner_user_id) VALUES ('fixture-legacy','002','历史收藏品','epic','/fixture','owned','fixture-owner')");
  const owned = await loadBattleCollectibles("fixture-owner", connection);
  assert.equal(owned[0]!.battleEffectDescription, "首行\n次行 <b>仍是纯文本</b>");
  assert.equal(owned[0]!.battleEffectValue, 100);
  assert.equal(owned[1]!.battleEffectType, null);
  assert.equal(owned[1]!.battleEffectDescription, "");
  const bindings = [{ cardId: cardIds[0]!, collectibleId: "fixture-relic" }];
  const deck = await createSavedCardBattleDeck("fixture-owner", "装配队伍", cardIds, connection, bindings);
  assert.deepEqual(deck.collectibleBindings, bindings);
  await updateSavedCardBattleDeck("fixture-owner", deck.id, "改名保留装配", undefined, connection);
  assert.deepEqual((await loadSavedCardBattleDecks("fixture-owner", connection))[0]!.collectibleBindings, bindings);
  await connection.query("INSERT INTO online_card_battle_seats (room_id,seat_number,user_id,lineup_json) VALUES ('fixture-room',1,'fixture-owner',JSON_ARRAY())");
  await saveCardBattleLineup("fixture-room", "fixture-owner", cardIds, connection, bindings);
  await saveCardBattleLineup("fixture-room", "fixture-owner", [...cardIds].reverse(), connection);
  await setCardBattleReady("fixture-room", "fixture-owner", true, connection);
  await assert.rejects(saveCardBattleLineup("fixture-room", "fixture-owner", cardIds, connection, []), /取消准备/);
  const frozen = await buildCardBattlePlayerInput("fixture-owner", "测试玩家", 1, cardIds, connection, bindings);
  assert.equal(frozen.cards[0]!.collectible!.battleEffectValue, 100);
  assert.equal(frozen.cards[0]!.tier.energyRequired, 40, "冻结基础值，战斗运行时只叠加一次");
  await connection.query("INSERT INTO card_battle_ranking_entries (rank_position,user_id,lineup_json,collectible_bindings_json,total_power) VALUES (1,'fixture-owner',?,?,0)", [JSON.stringify(cardIds), JSON.stringify(bindings)]);
  pool.query = connection.query.bind(connection) as typeof pool.query;
  for (const [type, value, bonus] of [["energy_reduction", 100, 600], ["attack", 20, 40], ["attack_skill_damage", 20, 40], ["defense", 20, 60], ["max_hp", 20, 10], ["speed", 20, 60], ["crit_rate", 12.25, 184], ["crit_damage", 12.25, 61]] as const) {
    await connection.query("UPDATE collectibles SET battle_effect_type=?,battle_effect_value=? WHERE id='fixture-relic'", [type, value]);
    const list = await listCardBattleRanking(10);
    const detail = await cardBattleRankingDetail(1);
    assert.equal(list[0]!.occupied && list[0]!.totalPower, 885 * 5 + bonus, `${type}榜单战力`);
    assert.equal(detail!.totalPower, 885 * 5 + bonus, `${type}详情战力`);
    assert.equal(detail!.available, true);
  }
  await connection.query("UPDATE collectibles SET battle_effect_type='crit_rate',battle_effect_value=100 WHERE id='fixture-relic'");
  await connection.query("UPDATE asset_card_battle_tiers SET lifesteal_rate=12.25,extra_action_rate=0.01,dodge_rate=0.02,stun_rate=0.03");
  const procRanking = await listCardBattleRanking(10);
  assert.equal(procRanking[0]!.occupied && procRanking[0]!.totalPower, 1132 * 5 + 1125, "每张卡1131.8先取整为1132，暴击率装配后上限100%");
  assert.equal((await cardBattleRankingDetail(1))!.totalPower, 1132 * 5 + 1125);
  await connection.query("UPDATE collectibles SET owner_user_id=NULL,status='unowned' WHERE id='fixture-relic'");
  assert.equal((await loadSavedCardBattleDecks("fixture-owner", connection))[0]!.collectiblesAvailable, false);
  assert.equal((await cardBattleRankingDetail(1))!.available, false);
  await assert.rejects(setCardBattleReady("fixture-room", "fixture-owner", true, connection), /不再拥有/);
  await assert.rejects(buildCardBattlePlayerInput("fixture-owner", "测试玩家", 1, cardIds, connection, bindings), /不再拥有/);
  const leasedConnection = new Proxy(connection, { get(target, key) {
    if (key === "release") return () => {};
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  pool.getConnection = async () => leasedConnection;
  const routes = new Map<string, RequestHandler>();
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map((method) => [method, (path: string, ...handlers: RequestHandler[]) => { routes.set(`${method} ${path}`, handlers.at(-1)!); }])) as unknown as Express;
  const auth = async () => ({ id: "fixture-owner", role: "super_admin" as const });
  registerCollectibleRoutes(app, { requireAuth: auth, requireAdmin: auth,
    sendError: (res, status, message) => res.status(status).json({ error: message }), sendStoredImage: async () => {},
    emitUserEvent: () => {}, emitUnreadChanged: () => {}, broadcastEvent: () => {},
  });
  async function request(method: string, body: unknown, id?: string) {
    let status = 200, payload: Record<string, unknown> = {};
    const res = { status(next: number) { status = next; return this; }, json(next: Record<string, unknown>) { payload = next; return this; } };
    await routes.get(`${method} /api/admin/collectibles${id ? "/:id" : ""}`)!({ body, params: { id } } as unknown as Request, res as unknown as Response, () => {});
    return { status, payload };
  }
  const createBody = { name: "后台新增", collectibleNo: "009", rarity: "epic", collectibleType: "treasure", collectibleValue: 1, imageUrl: "/fixture",
    description: "原收藏品介绍", battleEffectDescription: "战斗描述\n原样保存", battleEffectType: "crit_rate", battleEffectValue: 12.25 };
  assert.equal((await request("post", { ...createBody, battleEffectType: "invincible", battleEffectValue: 1.5 })).status, 400);
  const created = await request("post", createBody);
  assert.equal(created.status, 201);
  const createdId = String(created.payload.id);
  assert.equal((await request("patch", { battleEffectDescription: "修改后\n<b>纯文本</b>" }, createdId)).status, 200);
  assert.equal((await request("patch", { battleEffectType: "invincible" }, createdId)).status, 400, "部分更新必须校验原有小数属性");
  const [[stored]] = await connection.query<RowDataPacket[]>("SELECT * FROM collectibles WHERE id=?", [createdId]);
  assert.equal(stored!.battle_effect_description, "修改后\n<b>纯文本</b>");
  assert.equal(stored!.description, "原收藏品介绍");
  assert.equal(stored!.battle_effect_type, "crit_rate");
  assert.equal(Number(stored!.battle_effect_value), 12.25);
  assert.equal((await request("patch", { battleEffectType: null, battleEffectValue: null }, createdId)).status, 200);
  const [[cleared]] = await connection.query<RowDataPacket[]>("SELECT battle_effect_type,battle_effect_value FROM collectibles WHERE id=?", [createdId]);
  assert.equal(cleared!.battle_effect_type, null); assert.equal(cleared!.battle_effect_value, null);
  console.log("PASS: local MySQL temporary-table migrations, admin create/partial-edit/clear validation, multiline/decimal fields, legacy defaults, deck round trip, ready lock, frozen equipment, ranking SQL and ownership revalidation");
} finally {
  pool.query = originalQuery;
  pool.getConnection = originalGetConnection;
  // Closing the connection destroys every temporary table, leaving persistent tables untouched.
  connection.destroy();
  await pool.end();
}
