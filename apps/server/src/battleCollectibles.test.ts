import test from "node:test";
import assert from "node:assert/strict";
import type { PoolConnection } from "mysql2/promise";
import { applyBattleCollectibleStats, battleCollectibleConfigError, battleCollectibleEffectsError, battleCollectibleEffectTypes, type BattleCollectible, type BattleCollectibleEffectType } from "@hgt/shared";
import { simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleSkillEffect } from "./cardBattle.js";
import { parseBattleCollectibleBindings, resolveBattleCollectibles, validateBattleCollectibleBindings } from "./battleCollectibles.js";
import { createSavedCardBattleDeck, loadSavedCardBattleDecks, saveCardBattleLineup, setCardBattleReady, updateSavedCardBattleDeck } from "./cardBattleRoom.js";
import { promoteCardBattleRankingEntries } from "./cardBattleRanking.js";

function relic(type: BattleCollectibleEffectType | null, value: number | null): BattleCollectible {
  return { id: "relic", collectibleNo: "001", name: "测试收藏品", imageUrl: "/image", battleEffectDescription: "第一行\n第二行", battleEffectType: type, battleEffectValue: value };
}
function card(id: string, slot: number, stats: Partial<CardBattleDeckCard["tier"]> = {}, collectible?: BattleCollectible): CardBattleDeckCard {
  return { instanceId: id, cardId: id, name: id, imageUrl: "/card", rarity: "epic", battleRole: "damage", starLevel: 0,
    slot: slot as 1, motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null, collectible,
    tier: { starLevel: 0, maxHp: 100000, attack: 100, defense: 0, speed: 100, energyRequired: 40, critRate: 0, critDamage: 150, canAttackRear: true, skillName: "技能", skillDescription: "", effects: [], ...stats } };
}
function team(prefix: string, stats: Partial<CardBattleDeckCard["tier"]> = {}, collectible?: BattleCollectible) {
  return [1, 2, 3, 4, 5].map((slot) => card(`${prefix}${slot}`, slot, stats, collectible));
}
function simulate(one: CardBattleDeckCard[], two: CardBattleDeckCard[], seed = "collectibles") {
  const players: CardBattlePlayerInput[] = [{ userId: "one", nickname: "一", seat: 1, cards: one }, { userId: "two", nickname: "二", seat: 2, cards: two }];
  return simulateCardBattle(players, seed);
}
function effect(type: CardBattleSkillEffect["type"], value = 100, condition: CardBattleSkillEffect["condition"] = "energy_full"): CardBattleSkillEffect {
  return { id: type, order: 0, type, value, condition, conditionValue: 100, duration: 2 };
}

test("26种效果统一校验单位、空值、非法类型、精度及回合边界", () => {
  assert.equal(battleCollectibleEffectTypes.length, 26);
  for (const type of battleCollectibleEffectTypes) assert.equal(battleCollectibleConfigError(type, 2), null);
  assert.equal(battleCollectibleConfigError(null, null), null);
  assert.equal(battleCollectibleConfigError("crit_rate", 12.25), null);
  for (const [type, value] of [[null, 1], ["unknown", 1], ["attack", 1.5], ["attack", -1], ["speed", Infinity], ["crit_rate", 101], ["crit_rate", 1.001], ["invincible", 31], ["death_protection", null]]) {
    assert.ok(battleCollectibleConfigError(type, value));
  }
});

test("全部基础数值加成、组合加成、暴击百分点及能量下限10准确且不修改原配置", () => {
  const base = card("a", 1).tier;
  const mappings = { attack: "attack", defense: "defense", max_hp: "maxHp", speed: "speed" } as const;
  for (const [type, stat] of Object.entries(mappings)) {
    const changed = applyBattleCollectibleStats(base, relic(type as BattleCollectibleEffectType, 20));
    assert.equal(changed[stat], base[stat] + 20);
  }
  assert.equal(applyBattleCollectibleStats(base, relic("attack_skill_damage", 20)).attack, 120);
  assert.equal(applyBattleCollectibleStats(base, relic("energy_reduction", 10)).energyRequired, 30);
  assert.equal(applyBattleCollectibleStats(base, relic("energy_reduction", 1000)).energyRequired, 10);
  assert.equal(applyBattleCollectibleStats({ ...base, critRate: 25 }, relic("crit_rate", 10)).critRate, 35);
  assert.equal(applyBattleCollectibleStats({ ...base, critRate: 95 }, relic("crit_rate", 10)).critRate, 100);
  assert.equal(applyBattleCollectibleStats(base, relic("crit_damage", 20)).critDamage, 170);
  assert.equal(base.energyRequired, 40);
});

test("纯文本描述及无效果收藏品不改变任何战斗结果", () => {
  const one = team("a"), two = team("b");
  const equipped = one.map((c) => ({ ...c, collectible: { ...relic(null, null), battleEffectDescription: "增加攻击力999999\n免死30回合 <script>" } }));
  assert.deepEqual(simulate(equipped, two), simulate(one, two));
});

test("收藏品攻击与技能伤害直接增加基础值，后续第一个技能增益仍全效", () => {
  const one = team("a", { attack: 0 });
  one[0] = card("a1", 1, { attack: 100, energyRequired: 10, effects: [effect("attack_self", 40), { ...effect("damage_all", 100), order: 1 }] }, relic("attack_skill_damage", 50));
  const result = simulate(one, team("b", { attack: 0 }));
  assert.equal(result.initialStates[0]!.attack, 150);
  const buff = result.events.find((e) => e.effectType === "attack_self")!;
  assert.equal(buff.effects[0]!.amount, 40);
  assert.equal(buff.states[0]!.attack, 190);
  const damage = result.events.find((e) => e.effectType === "damage_all")!;
  assert.ok(damage.effects.every((e) => -e.amount! >= 147 && -e.amount! <= 153));
});

test("单独增加技能伤害不改变普攻或治疗，技能会受到既有减益影响", () => {
  const one = team("a", { energyRequired: 10, effects: [effect("damage_all", 100)] }, relic("skill_damage", 50));
  const result = simulate(one, team("b", { attack: 0 }));
  assert.ok(result.initialStates.filter((c) => c.seat === 1).every((c) => c.attack === 100));
  assert.ok(result.events.find((e) => e.effectType === "damage_all")!.effects.every((e) => -e.amount! >= 147 && -e.amount! <= 153));
  const down = team("b", { speed: 200, energyRequired: 10, effects: [effect("attack_skill_damage_down_all", 50)] });
  const debuffed = simulate(one, down);
  const reduced = debuffed.events.find((e) => e.actorId?.startsWith("a") && e.effectType === "damage_all" && e.states.find((c) => c.instanceId === e.actorId)?.statuses?.some((s) => s.type === "attack_skill_damage_down"));
  assert.ok(reduced);
  assert.ok(reduced.effects.every((e) => -e.amount! <= 77));
});

test("治疗输出与受治疗增幅相乘，随后兼容受治疗减益与缺血上限", () => {
  const one = team("a", { attack: 0 });
  one[0] = card("a1", 1, { attack: 0, energyRequired: 10, effects: [effect("heal_all_allies", 100)] }, relic("healing", 50));
  one[1]!.collectible = relic("healing_received", 30);
  const two = team("b", { speed: 200, attack: 1000, energyRequired: 10, effects: [effect("damage_all", 1000)] });
  const result = simulate(one, two);
  const heal = result.events.find((e) => e.visual === "heal" && e.effects.some((v) => v.targetId === "a2"))!;
  assert.ok(heal);
  assert.equal(heal.effects.find((e) => e.targetId === "a2")!.amount, 195);
  assert.equal(heal.effects.find((e) => e.targetId === "a1")!.amount, 150);
  assert.ok(result.events.every((e) => e.states.every((c) => c.hp <= c.maxHp)));
});

test("五类减益的抵抗只在开局N回合有效，不吞掉其他目标的效果", () => {
  const types = ["speed_down_all", "max_hp_down_all", "defense_down_all", "healing_received_down_all", "attack_skill_damage_down_all"] as const;
  for (const type of types) {
    const one = team("a", { speed: 200, energyRequired: 10, effects: [effect(type, 10)] });
    const two = team("b"); two[0]!.collectible = relic("debuff_resistance", 2);
    const result = simulate(one, two, type);
    const early = result.events.filter((e) => e.effectType === type && e.round <= 2);
    assert.ok(early.length);
    assert.ok(early.every((e) => e.effects.find((v) => v.targetId === "b1")?.label === "抵抗负面状态"));
    assert.ok(early.some((e) => e.states.find((c) => c.instanceId === "b2")!.statuses!.some((s) => s.type.endsWith("_down"))));
    assert.ok(result.events.some((e) => e.round > 2 && e.states.find((c) => c.instanceId === "b1")!.statuses!.some((s) => s.type.endsWith("_down"))));
  }
});

test("无敌期间普攻与技能扣血为0，承伤及命中回能保留，到期恢复扣血", () => {
  const result = simulate(team("a", { speed: 200, energyRequired: 10, effects: [effect("damage_all", 1000)] }), team("b", {}, relic("invincible", 2)));
  const early = result.events.filter((e) => e.round <= 2 && e.visual === "damage" && e.actorId?.startsWith("a"));
  assert.ok(early.some((e) => e.kind === "attack")); assert.ok(early.some((e) => e.kind === "skill"));
  assert.ok(early.every((e) => e.effects.every((v) => v.amount === 0 && v.label === "无敌")));
  assert.ok(early.some((e) => e.states.some((c) => c.seat === 2 && c.energy > 0 && c.damageTaken! > 0)));
  assert.ok(result.events.some((e) => e.round > 2 && e.actorId?.startsWith("a") && e.effects.some((v) => v.amount! < 0)));
});

test("免死可重复保留1点生命且不触发死亡技能，到期后复活不重置保护", () => {
  const two = team("b", { maxHp: 100, attack: 0, effects: [effect("revive_self", 0, "self_death")] }, relic("death_protection", 2));
  const result = simulate(team("a", { speed: 200, attack: 10000 }), two);
  assert.ok(result.events.filter((e) => e.round <= 2).every((e) => e.states.filter((c) => c.seat === 2).every((c) => c.alive && c.hp >= 1)));
  assert.ok(!result.events.some((e) => e.round <= 2 && e.visual === "revive"));
  assert.ok(result.events.some((e) => e.round > 2 && e.visual === "revive"));
  assert.ok(result.events.filter((e) => e.round > 2).every((e) => e.states.every((c) => !c.statuses?.some((s) => s.type === "death_protection"))));
});

test("伤害技能忽防包含收藏品加防，100%忽防仍遵守无敌与免死保护", () => {
  for (const protection of ["defense", "invincible", "death_protection"] as const) {
    const one = team("a", { attack: 0, speed: 200, energyRequired: 10, effects: [{ ...effect("damage_all", 1000), ignoreDefensePercent: 100 }] });
    const two = team("b", { attack: 0, defense: 2000, maxHp: 100 }, relic(protection, protection === "defense" ? 1000 : 30));
    const result = simulate(one, two);
    const hit = result.events.find((event) => event.actorId?.startsWith("a") && event.effectType === "damage_all")!;
    assert.ok(hit);
    const expectedDamage = protection === "invincible" ? 0 : protection === "death_protection" ? 99 : 100;
    assert.ok(hit.effects.every((visual) => visual.amount === -expectedDamage));
    if (protection !== "defense") assert.ok(hit.effects.every((visual) => visual.label === (protection === "invincible" ? "无敌" : "免死")));
  }
});

test("复活后仍恢复收藏品增加的生命上限", () => {
  const two = team("b", { maxHp: 100, attack: 0, effects: [effect("revive_self", 0, "self_death")] }, relic("max_hp", 200));
  const result = simulate(team("a", { speed: 200, attack: 10000 }), two);
  const revives = result.events.filter((e) => e.visual === "revive");
  assert.ok(revives.length);
  assert.ok(revives.every((e) => e.effects.every((v) => e.states.find((c) => c.instanceId === v.targetId)?.hp === 300)));
});

test("绑定拒绝重复卡牌、重复收藏品、非在场卡与失去归属，并兼容历史空绑定", async () => {
  assert.deepEqual(parseBattleCollectibleBindings(null), []);
  assert.throws(() => parseBattleCollectibleBindings('{"bad":true}'));
  const binding = { cardId: "a", collectibleId: "r" };
  validateBattleCollectibleBindings(["a"], [binding], new Set(["r"]));
  for (const bindings of [[binding, binding], [binding, { cardId: "b", collectibleId: "r" }], [{ cardId: "c", collectibleId: "r" }]]) {
    assert.throws(() => validateBattleCollectibleBindings(["a", "b"], bindings, new Set(["r"])));
  }
  const db = { query: async () => [[]] } as unknown as PoolConnection;
  await assert.rejects(resolveBattleCollectibles("owner", ["a"], [binding], db, true), /不再拥有/);
});

test("卡组保存/重命名/加载保留绑定，换位随卡移动，换下解除，准备再次校验归属", async () => {
  let owned = true;
  const ids = ["a1", "a2", "a3", "a4", "a5"];
  let row: Record<string, unknown> = { id: "deck", name: "旧卡组", lineup_json: ids, collectible_bindings_json: null };
  let seat: Record<string, unknown> = { seat_number: 1, lineup_json: ids, collectible_bindings_json: null, is_ready: 0 };
  const db = { query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM card_battle_ranking_challenges")) return [[]];
    if (sql.includes("SELECT card_battle_mode FROM online_soup_rooms")) return [[{ card_battle_mode: "1v1" }]];
    if (sql.includes("FROM collectibles")) return [owned ? [{ id: "r", name: "收藏品", collectible_no: "001", battle_effect_type: "attack", battle_effect_value: 20 }] : []];
    if (sql.includes("FROM user_asset_cards")) return [ids.map((id) => ({ id }))];
    if (sql.startsWith("INSERT INTO user_card_battle_decks")) row = { id: params[0], name: params[2], lineup_json: params[3], collectible_bindings_json: params[4] };
    if (sql.startsWith("UPDATE user_card_battle_decks")) row = { ...row, name: params[0], lineup_json: params[1] ?? row.lineup_json, collectible_bindings_json: params[2] ?? row.collectible_bindings_json };
    if (sql.startsWith("SELECT") && sql.includes("user_card_battle_decks")) return [[row]];
    if (sql.startsWith("SELECT") && sql.includes("online_card_battle_seats")) return [[seat]];
    if (sql.startsWith("UPDATE online_card_battle_seats SET lineup_json")) seat = { ...seat, lineup_json: params[0], collectible_bindings_json: params[1] };
    return [{ affectedRows: 1 }];
  } } as unknown as PoolConnection;
  const bindings = [{ cardId: "a1", collectibleId: "r" }];
  const saved = await createSavedCardBattleDeck("u", "装备队", ids, db, bindings);
  assert.deepEqual(saved.collectibleBindings, bindings);
  await updateSavedCardBattleDeck("u", saved.id, "改名", undefined, db);
  const loaded = (await loadSavedCardBattleDecks("u", db))[0]!;
  assert.deepEqual(loaded.collectibleBindings, bindings); assert.equal(loaded.name, "改名");
  await saveCardBattleLineup("room", "u", ids, db, bindings);
  await saveCardBattleLineup("room", "u", [...ids].reverse(), db);
  assert.deepEqual(parseBattleCollectibleBindings(seat.collectible_bindings_json), bindings);
  owned = false;
  await assert.rejects(setCardBattleReady("room", "u", true, db), /不再拥有/);
  seat.is_ready = 1;
  await assert.rejects(saveCardBattleLineup("room", "u", ids, db, []), /取消准备/);
  seat.is_ready = 0;
  await saveCardBattleLineup("room", "u", [], db);
  assert.deepEqual(parseBattleCollectibleBindings(seat.collectible_bindings_json), []);
});

test("榜位顺延保留全部收藏品绑定", () => {
  const entry = (userId: string, rank: number) => ({ userId, rank, lineup: [userId], collectibleBindings: [{ cardId: userId, collectibleId: `r-${userId}` }], totalPower: 1, achievedAt: new Date() });
  const next = promoteCardBattleRankingEntries([entry("a", 1), entry("b", 2)], entry("c", 8), 1);
  assert.deepEqual(next.map((e) => [e.userId, e.rank, e.collectibleBindings![0]!.collectibleId]), [["c", 1, "r-c"], ["a", 2, "r-a"], ["b", 3, "r-b"]]);
});

function multi(...effects: Array<[BattleCollectibleEffectType, number]>): BattleCollectible {
  return { ...relic(null, null), battleEffects: effects.map(([type, value]) => ({ type, value })) };
}

test("多效果叠加且不会重复计算兼容字段，空列表和非法行不能保存", () => {
  const item = { ...multi(["attack", 20], ["attack_skill_damage", 30], ["energy_reduction", 100]), battleEffectType: "attack" as const, battleEffectValue: 20 };
  const stats = applyBattleCollectibleStats(card("a", 1).tier, item);
  assert.equal(stats.attack, 150);
  assert.equal(stats.energyRequired, 10);
  assert.equal(battleCollectibleEffectsError(item), null);
  assert.ok(battleCollectibleEffectsError({ battleEffects: [] }));
  assert.ok(battleCollectibleEffectsError(multi(["attack", 2], ["dodge_rate", 101])));
  assert.equal(battleCollectibleEffectsError(multi(["single_healing", 12.25])), null);
});

test("收藏品六种概率增加百分点，叠加封顶并实际触发闪避、命中、吸血、击晕、再动与反击", () => {
  const rates = multi(["dodge_rate", 100], ["hit_rate", 100], ["lifesteal_rate", 100], ["stun_rate", 100], ["extra_action_rate", 100], ["counter_rate", 100]);
  const base = card("a", 1, { dodgeRate: 20, hitRate: 10, lifestealRate: 20, stunRate: 20, extraActionRate: 20, counterRate: 20 }).tier;
  const changed = applyBattleCollectibleStats(base, rates);
  for (const key of ["dodgeRate", "hitRate", "lifestealRate", "stunRate", "extraActionRate", "counterRate"] as const) assert.equal(changed[key], 100);
  const dodge = simulate(team("a"), team("b", {}, multi(["dodge_rate", 100])));
  assert.ok(dodge.events.filter(e => e.kind === "attack" && e.actorId?.startsWith("a")).every(e => e.effects.every(v => v.dodged)));
  const hit = simulate(team("a", {}, multi(["hit_rate", 100])), team("b", {}, multi(["dodge_rate", 100])));
  assert.ok(hit.events.some(e => e.actorId?.startsWith("a") && e.effects.some(v => v.amount! < 0)));
  const procs = simulate(team("a", { speed: 50 }, multi(["lifesteal_rate", 100], ["stun_rate", 100], ["extra_action_rate", 100], ["counter_rate", 100])), team("b"));
  assert.ok(procs.events.some(e => e.actorId?.startsWith("a") && e.lifesteal! > 0));
  assert.ok(procs.events.some(e => e.actorId?.startsWith("a") && e.effects.some(v => v.stunned)));
  assert.ok(procs.events.some(e => e.actorId?.startsWith("a") && e.extraAction));
  assert.ok(procs.events.some(e => e.actorId?.startsWith("a") && e.counterattack));
});

test("单体伤害加成覆盖前后排、随机与真实伤害，不误加到仅剩一个目标的群攻", () => {
  for (const type of ["damage_single", "damage_rear", "damage_random", "damage_true_single", "damage_all", "damage_random_2"] as const) {
    const one = team("a", { attack: 0 });
    one[0] = card("a1", 1, { attack: 0, energyRequired: 10, effects: [effect(type, 100)] }, multi(["skill_damage", 20], ["single_skill_damage", 50]));
    const two = team("b", { attack: 10 });
    // Other targets die immediately, leaving group targeting with just one survivor.
    for (const target of two.slice(1)) target.tier.maxHp = 1;
    const result = simulate(one, two);
    const hits = result.events.filter(e => e.actorId === "a1" && e.effectType === type && e.effects.some(v => v.targetId === "b1" && v.amount! < 0));
    assert.ok(hits.length, type);
    const single = !["damage_all", "damage_random_2"].includes(type);
    for (const event of hits) {
      const damage = -event.effects.find(v => v.targetId === "b1")!.amount!;
      assert.ok(damage >= (single ? 166 : 117) && damage <= (single ? 174 : 123), type + ": " + damage);
    }
  }
});

test("单体治疗量与通用治疗相加，群体治疗不享受单体加成", () => {
  for (const type of ["heal_self", "heal_lowest_ally", "heal_all_allies"] as const) {
    const one = team("a", { attack: 0 });
    one[0] = card("a1", 1, { attack: 0, energyRequired: 10, effects: [effect(type, 100)] }, multi(["healing", 20], ["single_healing", 50]));
    const result = simulate(one, team("b", { speed: 200, energyRequired: 10, effects: [effect("damage_all", 1000)] }));
    const heal = result.events.find(e => e.actorId === "a1" && e.effectType === type && e.round >= 3 && e.effects.length)!;
    assert.ok(heal, type);
    assert.ok(heal.effects.every(v => v.amount === (type === "heal_all_allies" ? 120 : 170)), JSON.stringify({ type, effects: heal.effects }));
  }
});

test("每回合恢复受缺血及受治疗效果约束，每回合成长叠加且不受再动次数影响", () => {
  const one = team("a", { attack: 0 });
  one[0] = card("a1", 1, { energyRequired: 10, effects: [effect("damage_single", 100), { ...effect("damage_all", 100), order: 1 }] }, multi(["round_healing", 100], ["healing_received", 50], ["round_attack", 10], ["round_attack_skill_damage", 20], ["round_attack_single_skill_damage", 30], ["extra_action_rate", 100]));
  const result = simulate(one, team("b", { speed: 200, energyRequired: 10, effects: [effect("damage_all", 1000)] }));
  const growth = result.events.filter(e => e.actorId === "a1" && e.skillName === "收藏品回合效果");
  assert.ok(growth.length >= 2);
  assert.equal(new Set(growth.map(e => e.round)).size, growth.length);
  for (const event of growth) assert.equal(event.states.find(c => c.instanceId === "a1")!.attack, 100 + 60 * event.round);
  const heals = result.events.filter(e => e.actorId === "a1" && e.skillName === "收藏品回合恢复");
  assert.ok(heals.length);
  assert.ok(heals.every(e => e.round >= 2 && e.effects[0]!.amount! > 0 && e.effects[0]!.amount! <= 150), JSON.stringify(heals.map(e => [e.round, e.effects])));
  assert.ok(heals.some(e => e.effects[0]!.amount === 150));
  for (const type of ["damage_single", "damage_all"] as const) {
    const event = result.events.find(e => e.actorId === "a1" && e.effectType === type)!;
    const base = 100 + event.round * (type === "damage_single" ? 50 : 20);
    assert.ok(event.effects.every(v => -v.amount! >= Math.floor(base * .98) && -v.amount! <= Math.ceil(base * 1.02)));
  }
  assert.equal(one[0].tier.attack, 100, "不修改冻结卡牌");
  assert.ok(result.events.every(e => e.states.every(c => c.hp <= c.maxHp)));
});
