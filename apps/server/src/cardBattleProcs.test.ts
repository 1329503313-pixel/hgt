import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BATTLE_PROC_BUFF_CODES, CARD_BATTLE_PROC_DEBUFF_CODES, CARD_BATTLE_PROC_STATS, cardBattleProcStat } from "@hgt/shared";
import { simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleSkillEffect, type CardBattleTier } from "./cardBattle.js";
import { cardBattleEffectiveProc, cardBattleLifesteal, cardBattleStatuses, rollCardBattleDamage, type CardBattleBuff } from "./cardBattleMath.js";
import { cardBattleEffectSchema, cardBattleTierSchema, defaultCardBattleTiers, loadCardBattleTiers, saveCardBattleTiers } from "./cardBattleConfig.js";
import { resolveCardBattleSettlementPlayers } from "./cardBattleSettlement.js";
import { surrenderCardBattleResult } from "./cardBattlePlayback.js";
import type { PoolConnection } from "mysql2/promise";

const effect = (type: CardBattleSkillEffect["type"], value = 10, duration: number | null = 2): CardBattleSkillEffect => ({ id: type, order: 0, condition: "energy_full", conditionValue: null, type, value, duration });
function side(prefix: string, stats: Partial<CardBattleTier> = {}, effects: CardBattleSkillEffect[] = []): CardBattleDeckCard[] {
  return ([1, 2, 3, 4, 5] as const).map(slot => ({
    instanceId: `${prefix}${slot}`, cardId: `${prefix}${slot}`, name: `${prefix}${slot}`, imageUrl: "", rarity: "epic", battleRole: "damage", slot, starLevel: 0,
    motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
    tier: { ...defaultCardBattleTiers("epic")[0]!, maxHp: 100000, attack: 0, defense: 0, speed: 10, critRate: 0, ...stats, effects },
  }));
}
const inputs = (one: CardBattleDeckCard[], two: CardBattleDeckCard[]): CardBattlePlayerInput[] => [
  { userId: "u1", nickname: "one", seat: 1, cards: one }, { userId: "u2", nickname: "two", seat: 2, cards: two },
];

test("新属性各星级默认0%，范围0-100且最多两位小数，旧快照缺字段按0", () => {
  for (const rarity of ["epic", "legend"] as const) for (const tier of defaultCardBattleTiers(rarity)) {
    for (const { key } of CARD_BATTLE_PROC_STATS) {
      assert.equal(tier[key], 0);
      for (const value of [0, 10.25, 100]) assert.ok(cardBattleTierSchema.safeParse({ ...tier, [key]: value }).success);
      for (const value of [-1, 100.01, .001, NaN]) assert.equal(cardBattleTierSchema.safeParse({ ...tier, [key]: value }).success, false);
      assert.equal(cardBattleTierSchema.parse({ ...tier, [key]: undefined })[key], 0);
      assert.equal(cardBattleEffectiveProc({}, [], key), 0);
    }
  }
});

test("21种技能全需数值与回合数，目标范围和独立状态正确且属性增益不暴击", () => {
  const codes = [...CARD_BATTLE_PROC_BUFF_CODES, ...CARD_BATTLE_PROC_DEBUFF_CODES];
  assert.equal(codes.length, 21);
  for (const type of codes) {
    const skill = effect(type);
    assert.ok(cardBattleEffectSchema.safeParse(skill).success, type);
    for (const value of [null, 0, 101]) assert.equal(cardBattleEffectSchema.safeParse({ ...skill, value }).success, false);
    for (const duration of [null, 0, 1.5]) assert.equal(cardBattleEffectSchema.safeParse({ ...skill, duration }).success, false);
    assert.equal(cardBattleEffectSchema.safeParse({ ...skill, duration: 365 }).success, true);
    const one = side("a", { speed: 20, critRate: 100, critDamage: 1000, energyRequired: 10 });
    one[0]!.tier.effects = [skill];
    const two = side("b");
    const result = simulateCardBattle(inputs(one, two), type);
    const event = result.events.find(event => event.effectType === type)!;
    assert.ok(event, type);
    const down = type.includes("_down_");
    const expectedTargets = type.endsWith("_all") || type.endsWith("_all_allies") ? 5 : type.endsWith("_front") ? 2 : type.endsWith("_rear") ? 3 : 1;
    assert.equal(event.effects.length, expectedTargets, type);
    for (const visual of event.effects) {
      const target = event.states.find(state => state.instanceId === visual.targetId)!;
      assert.equal(target.seat, down ? 2 : 1);
      if (type.endsWith("_front") || type.endsWith("_single")) assert.ok(target.slot <= 2);
      if (type.endsWith("_rear")) assert.ok(target.slot >= 3);
      if (type.endsWith("_self")) assert.equal(target.instanceId, event.actorId);
      assert.ok(target.statuses!.some(status => status.remainingRounds === 2 && status.value === 10 && status.multiplier === 1), type);
      assert.equal(target[cardBattleProcStat(type)!], down ? 0 : 10);
      assert.equal(visual.critical, undefined);
    }
  }
});

test("百分点增减、正负独立半效叠加和到期首层提升，状态同类不合并", () => {
  for (const { key } of CARD_BATTLE_PROC_STATS) {
    const buffs: CardBattleBuff[] = [
      { stat: key, value: 10, expiresAfterRound: 1 }, { stat: key, value: 15, expiresAfterRound: 3 },
      { stat: key, value: 20, expiresAfterRound: 2, debuff: true }, { stat: key, value: 10, expiresAfterRound: 3, debuff: true },
    ];
    assert.equal(cardBattleEffectiveProc({ [key]: 20 }, [{ stat: key, value: 10, expiresAfterRound: 2, debuff: true }], key), 10);
    assert.equal(cardBattleEffectiveProc({ [key]: 20 }, buffs, key), 12.5);
    const next = buffs.filter(buff => buff.expiresAfterRound > 1);
    assert.equal(cardBattleEffectiveProc({ [key]: 20 }, next, key), 10);
    assert.equal(cardBattleStatuses(buffs, 1).length, 4);
    assert.equal(cardBattleStatuses(next, 2).find(status => status.type.endsWith("_up"))!.multiplier, 1);
    assert.equal(cardBattleEffectiveProc({ [key]: 99.99 }, [{ stat: key, value: 20, expiresAfterRound: 3 }], key), 100);
    assert.equal(cardBattleEffectiveProc({}, [{ stat: key, value: 20, expiresAfterRound: 3, debuff: true }], key), 0);
  }
});

test("吸血使用减防、剩余HP截断后的实际扣血且四舍五入", () => {
  assert.equal(cardBattleLifesteal(rollCardBattleDamage(800, 500, 10000, () => .5).damage, 10), 30);
  assert.equal(cardBattleLifesteal(305, 10), 31);
  assert.equal(cardBattleLifesteal(304, 10), 30);
  assert.equal(cardBattleLifesteal(rollCardBattleDamage(800, 500, 5, () => .5).damage, 10), 1);
  assert.equal(cardBattleLifesteal(0, 100), 0);
  const one = side("a", { maxHp: 50000, attack: 800, defense: 500, speed: 5, lifestealRate: 10 });
  const two = side("b", { maxHp: 50000, attack: 800, defense: 500, speed: 10 });
  one[0]!.tier.effects = [effect("damage_all", 800, null)];
  one[0]!.tier.energyRequired = 10;
  const input = inputs(one, two), beforeInput = structuredClone(input);
  const result = simulateCardBattle(input, "lifesteal-per-hit");
  assert.deepEqual(input, beforeInput);
  assert.deepEqual(result, simulateCardBattle(input, "lifesteal-per-hit"));
  assert.ok(result.events.some(event => (event.lifesteal ?? 0) > 0 && event.kind === "attack"));
  assert.ok(result.events.some(event => (event.lifesteal ?? 0) > 0 && event.effectType === "damage_all"));
  for (const event of result.events.filter(event => event.visual === "damage" && event.actorId?.startsWith("a"))) {
    const prev = (result.events[event.sequence - 2]?.states ?? result.initialStates).find(state => state.instanceId === event.actorId)!;
    const expected = Math.min(prev.maxHp - prev.hp, event.effects.reduce((sum, visual) => sum + cardBattleLifesteal(-visual.amount!, 10), 0));
    assert.equal(event.lifesteal, expected);
    assert.equal(event.states.find(state => state.instanceId === event.actorId)!.hp - prev.hp, expected);
  }
  for (const state of result.finalStates) {
    assert.equal(state.healingDone, result.events.filter(event => event.actorId === state.instanceId).reduce((sum, event) => sum + (event.lifesteal ?? 0), 0));
  }
  const legacy = structuredClone(result);
  for (const player of legacy.players) for (const card of player.cards) delete card.healingDone;
  assert.deepEqual(resolveCardBattleSettlementPlayers(legacy), result.players);
  const healed = result.events.find(event => (event.lifesteal ?? 0) > 0)!;
  const cutoff = result.events.slice(0, healed.sequence - 1).reduce((sum, event) => sum + event.durationMs, 0) + Math.round(healed.durationMs * .55);
  const started = new Date("2026-09-08T00:00:00Z");
  const surrender = surrenderCardBattleResult(result, "u1", started, started.getTime() + cutoff)!;
  const total = surrender.players.flatMap(player => player.cards).reduce((sum, card) => sum + card.healingDone!, 0);
  assert.equal(total, surrender.events.reduce((sum, event) => sum + (event.lifesteal ?? 0), 0));
});

test("吸血不额外暴击，100%禁疗可完全阻断吸血", () => {
  const one = side("a", { maxHp: 100000, attack: 100, speed: 5, lifestealRate: 100, critRate: 100, critDamage: 200 });
  const two = side("b", { attack: 1000, speed: 20, energyRequired: 10 }, [effect("healing_received_down_all", 100, 30)]);
  const result = simulateCardBattle(inputs(one, two), "lifesteal-block");
  let examined = 0;
  for (const event of result.events.filter(event => event.kind === "attack" && event.actorId?.startsWith("a"))) {
    const actor = event.states.find(state => state.instanceId === event.actorId)!;
    if (actor.statuses!.some(status => status.type === "healing_received_down")) { assert.equal(event.lifesteal, 0); examined++; }
    else assert.ok((event.lifesteal ?? 0) <= -event.effects[0]!.amount!, "不二次乘暴击");
  }
  assert.ok(examined > 0);
});

test("100%击晕在格挡时依然判定，仅阻止本回合剩余行动，下回合清除", () => {
  const result = simulateCardBattle(inputs(side("a", { attack: 0, stunRate: 100, speed: 100 }), side("b", { attack: 0, defense: 100 })), "stun-blocked");
  const hits = result.events.filter(event => event.round === 1 && event.kind === "attack" && event.actorId?.startsWith("a"));
  assert.equal(hits.length, 5);
  for (const event of hits) {
    assert.equal(event.effects[0]!.blocked, true);
    assert.equal(event.effects[0]!.stunned, true);
    const target = event.effects[0]!.targetId;
    assert.ok(result.events.some(next => next.round === 1 && next.actorId === target && next.kind === "stun"));
    assert.ok(!result.events.some(next => next.round === 1 && next.actorId === target && ["skill", "attack"].includes(next.kind)));
  }
  assert.ok(result.events.find(event => event.kind === "round" && event.round === 2)!.states.every(state => !state.statuses!.some(status => status.type === "stunned")));
});

test("群体伤害逐目标独立击晕，未击晕不误加状态，抵抗负面状态可抵抗击晕", () => {
  const one = side("a", { stunRate: 50, energyRequired: 10, speed: 100 }, [effect("damage_all", 10, null)]);
  const two = side("b");
  const result = simulateCardBattle(inputs(one, two), "independent-stun");
  assert.ok(result.events.some(event => event.effectType === "damage_all" && event.effects.some(v => v.stunned) && event.effects.some(v => !v.stunned)));
  for (const card of two) card.collectible = { id: card.cardId, collectibleNo: "001", name: "抗性", imageUrl: "", battleEffectDescription: "", battleEffectType: "debuff_resistance", battleEffectValue: 30 };
  for (const card of one) card.tier.stunRate = 100;
  const immune = simulateCardBattle(inputs(one, two), "stun-immunity");
  assert.ok(immune.events.some(event => event.effects.some(v => v.stunResisted)));
  assert.ok(immune.events.every(event => event.effects.every(v => !v.stunned)));
});

test("普攻与所有非伤害施法均可立即再动，再动整条触发链不再次触发", () => {
  for (const skill of [null, effect("heal_self", 10, null), effect("energy_self", 10, null), effect("defense_self"), effect("lifesteal_self"), effect("stun_down_all")]) {
    const one = side("a", { extraActionRate: 100, speed: 100, energyRequired: 10 }, skill ? [skill] : []);
    for (const caster of one) caster.battleRole = "support";
    const result = simulateCardBattle(inputs(one, side("b")), skill?.type ?? "basic-extra");
    const extras = result.events.filter(event => event.kind === "extra_action");
    assert.ok(extras.length > 0);
    for (const event of extras) {
      const next = result.events[event.sequence]!;
      assert.equal(next.actorId, event.actorId);
      assert.ok(["attack", "skill"].includes(next.kind));
      assert.equal(next.extraAction, true);
      const prev = result.events[event.sequence - 2]!;
      assert.notEqual(prev.extraAction, true, "再动不能递归触发再动");
    }
    if (skill) assert.ok(result.events.some(event => event.kind === "extra_action" && result.events[event.sequence - 2]?.effectType === skill.type));
    assert.ok(result.events.length <= 400);
  }
  const reactive = side("a", { attack: 100, extraActionRate: 100 }, [{ ...effect("heal_self", 10, null), condition: "self_hp_below_percent", conditionValue: 100 }]);
  const result = simulateCardBattle(inputs(reactive, side("b", { attack: 100, speed: 100 })), "reactive-extra");
  assert.ok(result.events.some(event => event.kind === "extra_action" && result.events[event.sequence - 2]?.visual === "heal"));
});

test("新字段保存和读取按原值往返，不丢失零或小数", async () => {
  const saved: unknown[][] = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes("INSERT INTO asset_card_battle_tiers")) saved.push(args);
    if (sql.startsWith("SELECT * FROM asset_card_battle_tiers")) return [[{ star_level: 0, lifesteal_rate: "12.25", stun_rate: "0.00", extra_action_rate: "99.99" }]];
    return [[]];
  } } as unknown as PoolConnection;
  await saveCardBattleTiers("card", defaultCardBattleTiers().map(tier => ({ ...tier, lifestealRate: 12.25, stunRate: 0, extraActionRate: 99.99 })), db);
  assert.equal(saved.length, 4);
  for (const args of saved) assert.deepEqual(args.slice(12, 15), [12.25, 0, 99.99]);
  const loaded = (await loadCardBattleTiers("card", db))[0]!;
  assert.deepEqual(CARD_BATTLE_PROC_STATS.map(({ key }) => loaded[key]), [12.25, 0, 99.99, 0]);
});
