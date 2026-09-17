import assert from "node:assert/strict";
import test from "node:test";
import { auditCardBattleFormula, calculateCardBattlePower, isCardBattleDamageEffect } from "@hgt/shared";
import { simulateCardBattle, cardBattleEffectCodes, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleSkillEffect, type CardBattleTier } from "./cardBattle.js";
import { cardBattleTierSchema, defaultCardBattleTiers, loadCardBattleTiers, saveCardBattleTiers } from "./cardBattleConfig.js";
import type { PoolConnection } from "mysql2/promise";

const effect = (type: CardBattleSkillEffect["type"], value: number | null = 100): CardBattleSkillEffect => ({ id: type, order: 0, condition: "energy_full", conditionValue: null, type, value, duration: null });
const formula = (source: string, type: CardBattleSkillEffect["type"] = "damage_all"): CardBattleSkillEffect => ({ ...effect(type, null), damageType: "formula", damageFormula: source });
function side(prefix: string, stats: Partial<CardBattleTier> = {}): CardBattleDeckCard[] {
  return ([1, 2, 3, 4, 5] as const).map(slot => ({
    instanceId: `${prefix}${slot}`, cardId: `${prefix}${slot}`, cardNo: `${prefix}${slot}`, name: `${prefix}${slot}`, imageUrl: "", rarity: "epic", battleRole: "damage", slot, starLevel: 0,
    motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
    tier: { ...defaultCardBattleTiers()[0]!, maxHp: 100000, attack: 100, defense: 0, speed: 10, critRate: 0, energyRequired: 100000, ...stats, effects: [] },
  }));
}
const inputs = (one: CardBattleDeckCard[], two: CardBattleDeckCard[]): CardBattlePlayerInput[] => [
  { userId: "u1", nickname: "one", seat: 1, cards: one }, { userId: "u2", nickname: "two", seat: 2, cards: two },
];
function opening(card: CardBattleDeckCard, effects: CardBattleSkillEffect[]) {
  card.tier.effects = effects.map((item, order) => ({ ...item, id: `opening-${order}`, order }));
  card.tier.bonds = [{ cardNos: [card.cardNo!], event: "energy_empty", actions: [{ target: "self", type: "skill", value: null, duration: null }] }];
}

test("公式优先级、中文括号、空格、小数和安全拒绝", () => {
  const values = { hp: 5000, attack: 1000, defense: 200, speed: 100, energy: 40 };
  assert.deepEqual(auditCardBattleFormula(" （ 攻击力 * 1.1 ） + 速度 * 5 ", values), { ok: true, value: 1600 });
  assert.deepEqual(auditCardBattleFormula("生命值/2-防御力+当前能量", values), { ok: true, value: 2340 });
  assert.deepEqual(auditCardBattleFormula(".5+1", values), { ok: true, value: 2 });
  for (const source of ["", "攻击力/0", "速度-生命值", "攻击力**2", "速度(2)", "(速度+2", "速度+)", "globalThis.alert(1)", "1e100", "9999999999999999999", "(".repeat(20) + "1" + ")".repeat(20)]) {
    const result = auditCardBattleFormula(source, values);
    assert.equal(result.ok, false, source);
    if (!result.ok) assert.ok(result.reason.length, source);
  }
});

test("全部伤害类型支持公式；主技能、附加技能及旧固定数值受同一保存校验", () => {
  const tier = defaultCardBattleTiers()[0]!;
  for (const type of cardBattleEffectCodes.filter(isCardBattleDamageEffect)) {
    assert.ok(cardBattleTierSchema.safeParse({ ...tier, effects: [formula("攻击力+当前能量", type)] }).success, type);
    assert.ok(cardBattleTierSchema.safeParse({ ...tier, effects: [{ ...effect("heal_self"), additionalEffects: [formula("速度*5", type)] }] }).success === false, "附加对象不得夹带条件字段");
    const { condition, conditionValue, order, id, ...action } = formula("速度*5", type);
    assert.ok(cardBattleTierSchema.safeParse({ ...tier, effects: [{ ...effect("heal_self"), additionalEffects: [action] }] }).success, type);
  }
  assert.ok(cardBattleTierSchema.safeParse({ ...tier, effects: [effect("damage_all")] }).success);
  for (const source of ["攻击力/0", "生命值**2", "1-2"]) {
    assert.equal(cardBattleTierSchema.safeParse({ ...tier, effects: [formula(source)] }).success, false);
    assert.equal(cardBattleTierSchema.safeParse({ ...tier, effects: [{ ...effect("heal_self"), additionalEffects: [{ type: "damage_all", value: null, duration: null, damageType: "formula", damageFormula: source }] }] }).success, false);
  }
  assert.equal(cardBattleTierSchema.safeParse({ ...tier, effects: [formula("1", "heal_self")] }).success, false);
});

test("反击战力系数为3000，旧缺省属性与显式0保持战斗完全一致", () => {
  const tier = defaultCardBattleTiers()[0]!;
  assert.equal(calculateCardBattlePower({ ...tier, counterRate: 10 }) - calculateCardBattlePower(tier), 300);
  const original = inputs(side("a"), side("b")), legacy = structuredClone(original);
  for (const player of legacy) for (const card of player.cards) delete card.tier.counterRate;
  assert.deepEqual(simulateCardBattle(original, "legacy-counter"), simulateCardBattle(legacy, "legacy-counter"));
});

test("100%反击立即用普攻回击后排伤害来源，双方无能量，不能连环反击或再动", () => {
  const one = side("a", { speed: 20, counterRate: 100 }), two = side("b", { counterRate: 100, extraActionRate: 100 });
  one[4]!.tier.speed = 100;
  const input = inputs(one, two), before = structuredClone(input);
  const result = simulateCardBattle(input, "counter-back-row");
  assert.deepEqual(input, before);
  assert.deepEqual(result, simulateCardBattle(input, "counter-back-row"));
  const first = result.events.find(e => e.kind === "attack")!;
  const counter = result.events[first.sequence]!;
  assert.equal(first.actorId, "a5");
  assert.equal(counter.counterattack, true);
  assert.equal(counter.actorId, first.effects[0]!.targetId);
  assert.equal(counter.effects[0]!.targetId, "a5");
  for (const event of result.events.filter(e => e.counterattack)) {
    const previous = result.events[event.sequence - 2]!;
    assert.equal(previous.counterattack, undefined);
    assert.equal(event.kind, "attack");
    assert.equal(result.events[event.sequence]?.kind === "extra_action" && result.events[event.sequence]?.actorId === event.actorId, false);
    for (const id of [event.actorId, event.effects[0]!.targetId]) {
      assert.equal(event.states.find(s => s.instanceId === id)!.energy, previous.states.find(s => s.instanceId === id)!.energy);
    }
  }
});

test("每段群攻和附加伤害逐目标独立反击，位于下一次伤害之前", () => {
  for (const rate of [100, 50]) {
    const one = side("a", { attack: 0 }), two = side("b", { counterRate: rate, attack: 1 });
    const owner = one[4]!;
    opening(owner, [{ ...effect("damage_all", 10), additionalEffects: [{ type: "damage_all", value: 10, duration: null }] }]);
    const result = simulateCardBattle(inputs(one, two), `counter-multi-${rate}`);
    const firstNormal = result.events.findIndex(e => e.kind === "attack" && !e.counterattack);
    const initial = result.events.slice(0, firstNormal);
    const counters = initial.filter(e => e.counterattack);
    assert.equal(initial.filter(e => e.effectType === "damage_all").reduce((sum, e) => sum + e.effects.length, 0), 10);
    if (rate === 100) assert.equal(counters.length, 10);
    else assert.ok(counters.length > 0 && counters.length < 10);
    for (const counter of counters) {
      const hit = result.events[counter.sequence - 2]!;
      assert.equal(hit.actorId, owner.instanceId);
      assert.equal(hit.effects.at(-1)!.targetId, counter.actorId);
      assert.equal(counter.effects[0]!.targetId, owner.instanceId);
    }
  }
});

test("零伤害、闪避、死亡、眩晕不反击，护盾受损可以反击", () => {
  for (const mode of ["blocked", "dodge", "dead", "stun", "shield"] as const) {
    const one = side("a", { speed: 100, attack: 100, stunRate: mode === "stun" ? 100 : 0 });
    const two = side("b", { counterRate: 100, defense: mode === "blocked" ? 1000 : 0, dodgeRate: mode === "dodge" ? 100 : 0, maxHp: mode === "dead" ? 1 : 100000 });
    if (mode === "shield") opening(two[0]!, [{ ...effect("shield_all", 1000), duration: 2 }]);
    const result = simulateCardBattle(inputs(one, two), `counter-${mode}`);
    const first = result.events.find(e => e.kind === "attack" && !e.counterattack)!;
    assert.equal(result.events[first.sequence]!.counterattack === true, mode === "shield", mode);
    if (mode === "shield") { assert.ok(first.effects[0]!.shieldDamage! > 0); assert.equal(first.effects[0]!.hpDamage, 0); }
  }
});

test("反击致死或击晕立即中断剩余群攻与附加效果", () => {
  for (const stun of [false, true]) {
    const one = side("a", { attack: 0, maxHp: 100 }), two = side("b", { counterRate: 100, attack: stun ? 1 : 1000, stunRate: stun ? 100 : 0 });
    opening(one[4]!, [{ ...effect("damage_all", 10), additionalEffects: [{ type: "heal_self", value: 100, duration: null }] }]);
    const result = simulateCardBattle(inputs(one, two), `counter-interrupt-${stun}`);
    const hit = result.events.find(e => e.effectType === "damage_all")!;
    const counter = result.events[hit.sequence]!;
    assert.equal(hit.effects.length, 1); assert.equal(counter.counterattack, true);
    assert.equal(result.events[hit.sequence + 1]?.effectType === "heal_self", false);
  }
});

test("群攻中途反击不提前执行原技能死亡触发，附加禁复活仍先结算", () => {
  const one = side("a", { attack: 0 }), two = side("b", { attack: 1, counterRate: 100 });
  two[0]!.tier.maxHp = 1;
  two[0]!.tier.effects = [{ ...effect("revive_self", null), condition: "self_death" }];
  opening(one[4]!, [{ ...effect("damage_all", 10), additionalEffects: [{ type: "revival_block_damaged", value: null, duration: 30 }] }]);
  const result = simulateCardBattle(inputs(one, two), "counter-keep-attachments");
  assert.ok(result.events.some(e => e.counterattack));
  assert.ok(result.events.some(e => e.effectType === "revival_block_damaged" && e.effects.some(v => v.targetId === "b1")));
  const ban = result.events.find(e => e.effectType === "revival_block_damaged")!;
  const revives = result.events.filter(e => e.actorId === "b1" && e.effectType === "revive_self");
  assert.ok(revives.length > 0);
  assert.ok(revives.every(e => e.sequence > ban.sequence && e.effects.every(v => v.blocked)));
});

test("反击保留暴击吸血击晕与普攻击杀条件，羁绊类型不变", () => {
  const one = side("a", { speed: 100, maxHp: 100, attack: 100 });
  const two = side("b", { counterRate: 100, attack: 1000, critRate: 100, critDamage: 150, lifestealRate: 100, stunRate: 100 });
  for (const card of two) card.tier.effects = [{ ...effect("defense_self", 3), duration: 2, condition: "normal_kill" }];
  const result = simulateCardBattle(inputs(one, two), "counter-procs");
  const counter = result.events.find(e => e.counterattack)!;
  assert.equal(counter.effects[0]!.critical, true);
  assert.ok(counter.lifesteal! > 0);
  assert.ok(result.events.some(e => e.actorId === counter.actorId && e.effectType === "defense_self"));
});

test("公式读取实时生命与增减益属性，能量取释放清空之前，羁绊释放同样生效", () => {
  for (const source of ["当前能量*100", "攻击力+防御力+速度", "生命值/100"] as const) {
    const one = side("a", { attack: 1000, speed: 100, defense: 100, energyRequired: 10 });
    const two = side("b", { attack: 100, speed: 200 });
    const owner = one[0]!;
    owner.tier.effects = [{ ...effect("attack_self", 500), duration: 2 }, { ...formula(source, "damage_true_all"), order: 1 }];
    const result = simulateCardBattle(inputs(one, two), `formula-source-${source}`);
    const hit = result.events.find(e => e.effectType === "damage_true_all")!;
    const state = hit.states.find(s => s.instanceId === "a1")!;
    const expected = source === "当前能量*100" ? 1000 : source === "生命值/100" ? Math.round(state.hp / 100) : state.attack + state.defense + state.speed;
    assert.ok(hit.effects.every(v => -v.amount! >= Math.round(expected * .98) && -v.amount! <= Math.round(expected * 1.02)), source);
  }
  const one = side("a", { attack: 1000 }), two = side("b", { attack: 0 });
  opening(one[0]!, [formula("攻击力*1.1+速度*5")]);
  const result = simulateCardBattle(inputs(one, two), "bond-formula");
  assert.ok(result.events.some(e => e.bond && e.effectType === "damage_all" && e.effects.every(v => -v.amount! >= 1127 && -v.amount! <= 1173)));
});

test("运行期除零或负值按零伤害处理，即使附带技能伤害增益也不造成伤害", () => {
  for (const source of ["攻击力/当前能量", "当前能量-1"]) {
    const one = side("a"), two = side("b");
    opening(one[0]!, [{ ...effect("attack_skill_damage_self", 500), duration: 2 }, formula(source)]);
    const result = simulateCardBattle(inputs(one, two), source);
    const hit = result.events.find(e => e.effectType === "damage_all")!;
    assert.ok(hit.effects.every(v => v.amount === 0));
  }
});

test("反击率、公式主效果和附加效果按四星级往返持久化，旧记录按固定数值", async () => {
  const tiersRows: Record<string, unknown>[] = [], effectsRows: Record<string, unknown>[] = [];
  const db = { query: async (sql: string, args: unknown[] = []) => {
    const insert = sql.match(/INSERT INTO (asset_card_battle_tiers|asset_card_battle_effects)\s*\(([^)]+)\)/);
    if (insert) {
      const columns = insert[2]!.split(",").map(s => s.trim()); assert.equal(columns.length, args.length);
      (insert[1] === "asset_card_battle_tiers" ? tiersRows : effectsRows).push(Object.fromEntries(columns.map((c, i) => [c, args[i]])));
    }
    if (sql.startsWith("SELECT * FROM asset_card_battle_tiers")) return [tiersRows];
    if (sql.startsWith("SELECT * FROM asset_card_battle_effects")) return [effectsRows];
    return [[]];
  } } as unknown as PoolConnection;
  const tiers = defaultCardBattleTiers().map((tier, star) => ({ ...tier, counterRate: star * 10.25, effects: [{ ...formula("攻击力*1.1"), additionalEffects: [{ type: "damage_true_all" as const, value: null, duration: null, damageType: "formula" as const, damageFormula: "速度*5" }] }] }));
  await saveCardBattleTiers("card", tiers, db);
  const loaded = await loadCardBattleTiers("card", db);
  loaded.forEach((tier, star) => {
    assert.equal(tier.counterRate, star * 10.25);
    assert.equal(tier.effects[0]!.damageType, "formula");
    assert.equal(tier.effects[0]!.damageFormula, "攻击力*1.1");
    assert.equal(tier.effects[0]!.additionalEffects![0]!.damageFormula, "速度*5");
  });
  delete effectsRows[0]!.damage_type; delete effectsRows[0]!.damage_formula; effectsRows[0]!.effect_value = 100;
  assert.equal((await loadCardBattleTiers("card", db))[0]!.effects[0]!.damageType, "fixed");
});
