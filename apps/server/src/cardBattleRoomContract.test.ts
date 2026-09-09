import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CardBattleResult } from "./cardBattle.js";
import { resolveCardBattlePlayback, resolveCardBattlePlaybackStates, surrenderCardBattleResult } from "./cardBattlePlayback.js";
import { deleteSavedCardBattleDeck, forfeitCardBattle, updateSavedCardBattleDeck } from "./cardBattleRoom.js";
import type { PoolConnection } from "mysql2/promise";

const roomSource = readFileSync(new URL("./cardBattleRoom.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("./onlineSoup.ts", import.meta.url), "utf8");
const rankingSource = readFileSync(new URL("./cardBattleRanking.ts", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const digitalAssetsSource = readFileSync(new URL("./digitalAssets.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

const start = new Date("2026-09-08T00:00:00.000Z");

function savedDeckFixture(mode: "1v1" | "boss" = "1v1") {
  const cardIds = mode === "boss" ? ["c1", "c2", "c3"] : ["c1", "c2", "c3", "c4", "c5"];
  let row: Record<string, unknown> | null = { id: "deck1", user_id: "u1", mode, name: "原卡组", lineup_json: JSON.stringify(cardIds), collectible_bindings_json: JSON.stringify([{ cardId: "c1", collectibleId: "item1" }]) };
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const db = { query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_asset_cards")) return [params.slice(1).filter((id) => id !== "unowned").map((id) => ({ id }))];
    if (sql.includes("FROM collectibles")) return [[{ id: "item1", name: "测试收藏品", collectible_no: "1", battle_effect_type: null, battle_effect_value: null }]];
    if (sql.startsWith("SELECT * FROM user_card_battle_decks")) return [row && params[0] === row.id && params[1] === row.user_id && (params.length < 3 || params[2] === row.mode) ? [{ ...row }] : []];
    writes.push({ sql, params });
    if (sql.startsWith("DELETE FROM user_card_battle_decks")) {
      assert.match(sql, /WHERE id = \? AND user_id = \? AND mode = \?/);
      const matches = row && params[0] === row.id && params[1] === row.user_id && params[2] === row.mode;
      if (matches) row = null;
      return [{ affectedRows: matches ? 1 : 0 }];
    }
    if (sql.startsWith("UPDATE user_card_battle_decks") && row) {
      assert.match(sql, /WHERE id = \? AND user_id = \? AND mode = \?/);
      assert.deepEqual(params.slice(3), [row.id, row.user_id, row.mode]);
      if (params[0] === "同名卡组") throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      row.name = params[0];
      if (params[1] != null) row.lineup_json = params[1];
      if (params[2] != null) row.collectible_bindings_json = params[2];
      return [{ affectedRows: 1 }];
    }
    throw new Error("Unexpected deck SQL: " + sql);
  } } as unknown as PoolConnection;
  return { db, cardIds, writes, getRow: () => row };
}

test("删除卡组仅删除本人对应模式记录，拒绝越权、跨模式与重复删除", async () => {
  for (const mode of ["1v1", "boss"] as const) {
    const fixture = savedDeckFixture(mode);
    await assert.rejects(deleteSavedCardBattleDeck("u2", "deck1", fixture.db, mode), /不存在或已被删除/);
    await assert.rejects(deleteSavedCardBattleDeck("u1", "deck1", fixture.db, mode === "boss" ? "1v1" : "boss"), /不存在或已被删除/);
    assert.ok(fixture.getRow());
    await deleteSavedCardBattleDeck("u1", "deck1", fixture.db, mode);
    assert.equal(fixture.getRow(), null);
    await assert.rejects(deleteSavedCardBattleDeck("u1", "deck1", fixture.db, mode), /不存在或已被删除/);
    assert.ok(fixture.writes.every(({ sql }) => sql.startsWith("DELETE FROM user_card_battle_decks")));
  }
});

test("卡组改名保持卡牌和收藏品绑定，只更新名称，重名失败保留原数据", async () => {
  const fixture = savedDeckFixture();
  const before = { ...fixture.getRow() };
  const renamed = await updateSavedCardBattleDeck("u1", "deck1", "新名称", undefined, fixture.db);
  assert.equal(renamed.name, "新名称");
  assert.deepEqual(renamed.cardIds, fixture.cardIds);
  assert.equal(fixture.getRow()!.lineup_json, before.lineup_json);
  assert.equal(fixture.getRow()!.collectible_bindings_json, before.collectible_bindings_json);
  assert.deepEqual(fixture.writes[0]!.params.slice(0, 3), ["新名称", null, null]);
  await assert.rejects(updateSavedCardBattleDeck("u1", "deck1", "同名卡组", undefined, fixture.db), /已有同名卡组/);
  assert.equal(fixture.getRow()!.name, "新名称");
});

test("编辑卡组拒绝越权、跨模式、重复卡牌和不可参战卡牌", async () => {
  const fixture = savedDeckFixture();
  await assert.rejects(updateSavedCardBattleDeck("u2", "deck1", "偷改", undefined, fixture.db), /不存在或已被删除/);
  await assert.rejects(updateSavedCardBattleDeck("u1", "deck1", "错模式", undefined, fixture.db, undefined, "boss"), /不存在或已被删除/);
  await assert.rejects(updateSavedCardBattleDeck("u1", "deck1", "重复", ["c1", "c1", "c3", "c4", "c5"], fixture.db), /不同卡牌/);
  await assert.rejects(updateSavedCardBattleDeck("u1", "deck1", "不可用", ["unowned", "c2", "c3", "c4", "c5"], fixture.db), /未拥有/);
  assert.equal(fixture.writes.length, 0);
});

test("普通与 BOSS 卡组按槽位换卡，换下卡牌解除绑定且保留其他卡位", async () => {
  for (const mode of ["1v1", "boss"] as const) {
    const fixture = savedDeckFixture(mode);
    const next = ["c6", ...fixture.cardIds.slice(1)];
    const updated = await updateSavedCardBattleDeck("u1", "deck1", "换卡后", next, fixture.db, undefined, mode);
    assert.deepEqual(updated.cardIds, next);
    assert.deepEqual(updated.collectibleBindings, []);
    assert.equal(fixture.writes.length, 1);
  }
});
function playbackFixture(): CardBattleResult {
  const initialStates = ([1, 2] as const).map((seat) => ({ instanceId: `c${seat}`, userId: `u${seat}`, seat, slot: 1 as const, row: "front" as const, hp: 1000, maxHp: 1000, energy: 0, energyRequired: 40, attack: 800, defense: 600, speed: 100, alive: true, damageDealt: 0, damageTaken: 0 }));
  const first = initialStates.map((state) => ({ ...state, hp: state.seat === 2 ? 800 : 1000, damageDealt: state.seat === 1 ? 200 : 0, damageTaken: state.seat === 2 ? 800 : 0 }));
  const second = first.map((state) => ({ ...state, hp: state.seat === 2 ? 600 : 1000, damageDealt: state.seat === 1 ? 400 : 0, damageTaken: state.seat === 2 ? 1600 : 0 }));
  const events = [first, second].map((states, index) => ({ sequence: index + 1, round: index + 1, kind: "attack" as const, visual: "damage" as const, actorId: "c1", skillName: null, effects: [{ targetId: "c2", amount: -200 }], durationMs: index === 0 ? 1000 : 2000, text: "攻击", states }));
  return { version: 1, winnerSeat: 1, endReason: "elimination", rounds: 2, initialStates, finalStates: second, events, playbackDurationMs: 3000, players: ([1, 2] as const).map((seat) => ({ userId: `u${seat}`, nickname: `玩家${seat}`, seat, cards: [{ slot: 1, cardId: `c${seat}`, name: `卡${seat}`, damageDealt: seat === 1 ? 400 : 0, damageTaken: seat === 2 ? 1600 : 0 }] })) };
}

test("共享时间轴按事件边界定位，迟到、断网或后台停顿直接定位最新事件", () => {
  const result = playbackFixture();
  for (const [ms, completed, elapsed] of [[0, 0, 0], [999, 0, 999], [1000, 1, 0], [2500, 1, 1500]]) {
    const state = resolveCardBattlePlayback(result, start, "playing", start.getTime() + ms!);
    assert.equal(state.completedSequence, completed);
    assert.equal(state.activeEventElapsedMs, elapsed);
    assert.equal(state.activeEvent?.sequence, completed! + 1);
  }
  assert.deepEqual(resolveCardBattlePlayback(result, start, "playing", start.getTime() + 2500), resolveCardBattlePlayback(result, start, "playing", start.getTime() + 2500));
  for (const status of ["playing", "ended", "aborted"]) {
    const state = resolveCardBattlePlayback(result, start, status, start.getTime() + 3000);
    assert.equal(state.complete, true);
    assert.equal(state.activeEvent, null);
    assert.equal(state.states, result.initialStates);
  }
});

test("双方任一对战者退出都立即认输，重入只取得结束态且不计未来伤害", () => {
  const result = playbackFixture();
  for (const user of ["u1", "u2"]) {
    const forfeited = surrenderCardBattleResult(result, user, start, start.getTime() + 1500)!;
    assert.equal(forfeited.endReason, "surrender");
    assert.equal(forfeited.winnerSeat, user === "u1" ? 2 : 1);
    assert.equal(forfeited.events.length, 1);
    assert.equal(forfeited.players[0]!.cards[0]!.damageDealt, 200);
    assert.equal(forfeited.players[1]!.cards[0]!.damageTaken, 800);
    const rejoined = resolveCardBattlePlayback(forfeited, start, "ended", start.getTime() + 1600);
    assert.equal(rejoined.complete, true);
    assert.equal(rejoined.activeEvent, null);
    assert.equal(rejoined.states, result.initialStates);
    assert.equal(surrenderCardBattleResult(forfeited, user, start, start.getTime() + 1600), null);
  }
  assert.equal(surrenderCardBattleResult(result, "spectator", start, start.getTime() + 1500), null);
  assert.equal(surrenderCardBattleResult(result, "u1", start, start.getTime() + 3000), null);
  assert.equal(surrenderCardBattleResult(result, "u1", start, start.getTime())!.players[0]!.cards[0]!.damageDealt, 0);
  assert.equal(surrenderCardBattleResult(result, "u1", start, start.getTime() + 2200)!.players[0]!.cards[0]!.damageDealt, 400);
});

test("认输持久化仅使用调用方事务，释放退出者席位且重复退出不覆盖胜负", async () => {
  let playing = true;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = { query: async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.startsWith("SELECT")) return [playing ? [{ id: "g1", result_json: playbackFixture(), started_at: start, db_now: new Date(start.getTime() + 1500) }] : []];
    if (sql.startsWith("UPDATE online_card_battles")) playing = false;
    return [{ affectedRows: 1 }];
  } } as unknown as PoolConnection;
  assert.equal(await forfeitCardBattle("r1", "spectator", db), false);
  assert.equal(queries.length, 1);
  assert.equal(await forfeitCardBattle("r1", "u1", db), true);
  const update = queries.find((item) => item.sql.startsWith("UPDATE online_card_battles"))!;
  assert.equal(JSON.parse(String(update.params[0])).winnerSeat, 2);
  assert.ok(queries.some((item) => item.sql.startsWith("DELETE FROM online_card_battle_seats") && item.params[1] === "u1"));
  assert.equal(await forfeitCardBattle("r1", "u2", db), false);
  assert.equal(queries.filter((item) => item.sql.startsWith("UPDATE online_card_battles")).length, 1);
  const leave = routesSource.slice(routesSource.indexOf('router.post("/rooms/:roomId/leave"'), routesSource.indexOf('router.post("/rooms/:roomId/leave"') + 12500);
  assert.equal((leave.match(/await forfeitCardBattle/g) ?? []).length, 2, "房主与非房主退出均在房间锁中认输");
  const ranking = readFileSync(new URL("./cardBattleRanking.ts", import.meta.url), "utf8");
  assert.match(ranking, /await forfeitCardBattle\(roomId, userId, db\)/);
});

test("暴击迁移为全部既有星级一次性设默认值，不在重启时重置已有值", () => {
  assert.ok(dbSource.includes('ensureColumn("asset_card_battle_tiers", "crit_rate", "crit_rate DECIMAL(5,2) NOT NULL DEFAULT 25")'));
  assert.ok(dbSource.includes('ensureColumn("asset_card_battle_tiers", "crit_damage", "crit_damage DECIMAL(7,2) NOT NULL DEFAULT 150")'));
  assert.doesNotMatch(dbSource, /UPDATE asset_card_battle_tiers SET crit_/);
  assert.match(roomSource, /critRate: Number\(row.crit_rate \?\? 25\)/);
  assert.match(digitalAssetsSource, /critDamage: Number\(row.battle_crit_damage \?\? 150\)/);
});

test("参战资格和后台战斗配置同时允许史诗与传说卡", () => {
  const eligibilitySource = roomSource.slice(roomSource.indexOf("export async function eligibleCardCount"), roomSource.indexOf("export async function claimCardBattleSeat"));
  assert.match(eligibilitySource, /tiers\.star_level = owned\.star_level/);
  assert.match(eligibilitySource, /owned\.user_id = \? AND cards\.status = 'active' AND cards\.rarity IN \('epic','legend'\)/);
  assert.match(roomSource, /if \(await eligibleCardCount\(userId, db\) < \(mode === "boss" \? 3 : CARD_BATTLE_LINEUP_SIZE\)\) return null/);
  assert.ok((roomSource.match(/cards\.rarity IN \('epic','legend'\)/g) ?? []).length >= 5);
  assert.doesNotMatch(roomSource, /cards\.rarity = 'legend'/);
  assert.match(routesSource, /至少拥有\$\{isBossRoom\(room\) \? "三" : "五"\}张启用中的史诗或传说卡才能进入对战席/);
  assert.match(digitalAssetsSource, /const cardRaritySupportsBattle = \(rarity: string\) => rarity === "epic" \|\| rarity === "legend"/);
  assert.match(digitalAssetsSource, /cardRaritySupportsBattle\(String\(row\.rarity\)\) \? await loadCardBattleTiers/);
  assert.match(digitalAssetsSource, /if \(!cardRaritySupportsBattle\(finalRarity\)\) \{\s*await connection\.query\("DELETE FROM asset_card_battle_tiers/s);
  assert.match(dbSource, /DELETE battle_tiers[\s\S]*WHERE cards\.rarity NOT IN \('epic', 'legend'\)/);
  assert.match(dbSource, /800 AS max_hp, 250 AS attack_value, 30 AS defense_value, 80 AS speed_value[\s\S]*WHERE cards\.rarity = 'epic'/);
  assert.match(dbSource, /defaults\.speed_value, 40, 0[\s\S]*WHERE cards\.rarity = 'epic'/);
  assert.match(dbSource, /WHERE cards\.rarity = 'legend'/);
});

test("用户卡组保存名称、五张卡牌及其固定位置", () => {
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS user_card_battle_decks/);
  assert.match(dbSource, /lineup_json JSON NOT NULL/);
  assert.match(dbSource, /UNIQUE KEY uq_user_card_battle_deck_name \(user_id, name\)/);
  assert.match(routesSource, /card-battle\/decks/);
  assert.match(routesSource, /\.length\(isBossRoom\(context.room\) \? 3 : 5/);
  assert.match(roomSource, /卡组必须包含 \$\{size\} 张不同卡牌/);
  assert.match(roomSource, /ORDER BY updated_at DESC/);
});

test("卡牌对战榜使用隐藏临时房间并冻结守榜卡组", () => {
  assert.match(dbSource, /room_scope ENUM\('public','ranking_challenge'\)/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS card_battle_ranking_entries/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS card_battle_ranking_challenges/);
  assert.match(routesSource, /r\.room_scope = 'public'/);
  assert.match(routesSource, /打榜房间不允许邀请其他用户/);
  assert.match(routesSource, /card-battle-rankings\/:rank\/challenge/);
  assert.match(routesSource, /card-battle\/ranking\/confirm-win/);
  assert.match(routesSource, /card-battle-rankings\/:rank\/deck/);
  assert.match(rankingSource, /INSERT INTO notifications[\s\S]*card_battle_rank_defeated/);
  assert.match(rankingSource, /replaceCardBattleRankingDeck/);
  assert.match(routesSource, /res\.json\(await cardBattleRankingSnapshot\(user\.id, limit\)\)/);
  assert.match(indexSource, /row\.type === "card_battle_rank_defeated"[\s\S]*\/mine\/rankings\?tab=card_battle/);
  assert.match(roomSource, /defender_snapshot_json/);
  assert.match(roomSource, /榜单对手阵容快照不可用/);
});

test("战力由服务端计算并随备战及冻结卡牌统一返回", () => {
  assert.match(roomSource, /calculateCardBattlePower\(stats\)/);
  assert.match(roomSource, /combatPower:/);
});

test("对战定位仅属于可参战卡，历史卡默认输出并随冻结阵容返回", () => {
  assert.match(dbSource, /battle_role ENUM\('damage','tank','support'\) NULL/);
  assert.match(dbSource, /SET battle_role = 'damage' WHERE rarity IN \('epic','legend'\) AND battle_role IS NULL/);
  assert.match(dbSource, /SET battle_role = NULL WHERE rarity NOT IN \('epic','legend'\)/);
  assert.match(digitalAssetsSource, /史诗或传说卡必须选择对战定位/);
  assert.match(digitalAssetsSource, /仅参与卡牌对战的卡牌可选择对战定位/);
  assert.match(roomSource, /battleRole: String\(row\.battle_role \?\? "damage"\)/);
});

test("二星且已配置动态卡面的参战卡才取得战场动态媒体", () => {
  assert.match(roomSource, /const unlocked = starLevel >= 2 && Boolean\(row\.motion_mp4_path\)/);
  assert.match(roomSource, /motionMp4Url: `\/api\/media\/assets\/cards\/\$\{cardId\}\/motion\/mp4\?v=\$\{version\}`/);
  assert.match(roomSource, /\.\.\.battleMotionPayload\(row, starLevel\)/);
});

test("备战阶段只公开本人新阵容，对手新阵容不会沿用上一局公开状态", () => {
  assert.doesNotMatch(roomSource, /frozenStillSelected/);
  assert.match(roomSource, /const gamePublic = Boolean\(result && String\(currentGame\?\.status\) === "playing"\)/);
  assert.match(roomSource, /const canSee = ownSeat \|\| gamePublic/);
});

test("所有浏览者按数据库共享时间轴取得当前事件，旧确认接口不能推进", () => {
  assert.match(roomSource, /NOW\(3\) AS db_now/);
  assert.match(roomSource, /resolveCardBattlePlayback\(result, game.started_at/);
  assert.match(roomSource, /return \(await readCardBattlePlayback\(roomId\)\).playback/);
  assert.doesNotMatch(roomSource, /online_card_battle_playback_progress/);
  assert.doesNotMatch(roomSource, /events:\s*result\.events/);
  assert.match(routesSource, /router.get\("\/rooms\/:roomId\/card-battle\/playback"/);
  assert.match(roomSource, /settlement: playback!\.complete && gameStatus !== "aborted"/);
});

test("对局动画结束或中止后恢复初始卡牌状态但继续保留结算", () => {
  const initialStates = [{ instanceId: "card-1", hp: 1000, energy: 0, alive: true }];
  const damagedStates = [{ instanceId: "card-1", hp: 475, energy: 20, alive: true }];
  const defeatedStates = [{ instanceId: "card-1", hp: 0, energy: 30, alive: false }];
  const result = {
    initialStates,
    events: [{ states: damagedStates }, { states: defeatedStates }],
  } as unknown as CardBattleResult;

  assert.equal(resolveCardBattlePlaybackStates(result, 0, "playing"), initialStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 1, "ended"), damagedStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended"), initialStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 0, "aborted"), initialStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended")[0]?.hp, 1000);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended")[0]?.energy, 0);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended")[0]?.alive, true);
  assert.match(roomSource, /resolveCardBattlePlayback\(result, currentGame.started_at/);
  assert.match(roomSource, /settlement: playback!\.complete && gameStatus !== "aborted"/);
});

test("下一局和打榜确认只检查服务器时间轴，不等待逐用户进度", () => {
  assert.match(roomSource, /上一局服务器时间轴尚未结束/);
  assert.match(roomSource, /!resolveCardBattlePlayback\(previousResult/);
  const ranking = readFileSync(new URL("./cardBattleRanking.ts", import.meta.url), "utf8");
  assert.match(ranking, /!resolveCardBattlePlayback\(result/);
  assert.doesNotMatch(ranking, /online_card_battle_playback_progress/);
});

test("阵容、准备和席位切换在房间行锁内重验状态，并让已结束房间回到备战", () => {
  for (const route of ["lineup", "ready", "member-role"]) {
    const start = routesSource.indexOf(`/rooms/:roomId/card-battle/${route}`);
    assert.notEqual(start, -1, `${route} route should exist`);
    const end = routesSource.indexOf("router.", start + 20);
    const body = routesSource.slice(start, end === -1 ? undefined : end);
    assert.match(body, /FOR UPDATE/);
    assert.match(body, /status = IF\(status = 'ended', 'preparing', status\)/);
  }
});
