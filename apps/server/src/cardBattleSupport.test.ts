import assert from "node:assert/strict";
import test from "node:test";
import { calculateCardBattleScore, type CardBattleSupportKind } from "@hgt/shared";
import { simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleSkillEffect, type CardBattleTier } from "./cardBattle.js";
import { cardBattleSupportShares } from "./cardBattleSupport.js";
import { cardBattleEffectiveStat, type CardBattleBuff } from "./cardBattleMath.js";
import { surrenderCardBattleResult } from "./cardBattlePlayback.js";
import { resolveCardBattleSettlementPlayers } from "./cardBattleSettlement.js";

function effect(type: CardBattleSkillEffect["type"], value = 100, duration = 2): CardBattleSkillEffect {
  return { id: type, order: 0, condition: "energy_full", conditionValue: null, type, value, duration };
}
function side(prefix: string, stats: Partial<CardBattleTier> = {}): CardBattleDeckCard[] {
  return ([1, 2, 3, 4, 5] as const).map((slot) => ({
    instanceId: `${prefix}${slot}`, cardId: `${prefix}${slot}`, name: `${prefix}${slot}`, slot,
    imageUrl: "", rarity: "epic", battleRole: "support", starLevel: 0,
    motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
    tier: { starLevel: 0, maxHp: 100000, attack: 100, defense: 0, speed: 10, energyRequired: 10,
      critRate: 0, critDamage: 150, canAttackRear: false, skillName: "辅助技能", skillDescription: "", effects: [], ...stats },
  }));
}
const inputs = (one: CardBattleDeckCard[], two: CardBattleDeckCard[]): CardBattlePlayerInput[] => [
  { userId: "u1", nickname: "one", seat: 1, cards: one }, { userId: "u2", nickname: "two", seat: 2, cards: two },
];
const total = (result: ReturnType<typeof simulateCardBattle>, kind: CardBattleSupportKind, prefix = "a") => result.finalStates
  .filter((state) => state.instanceId.startsWith(prefix)).reduce((sum, state) => sum + (state.supportBreakdown?.[kind] ?? 0), 0);

test("忽防基于增减益后的有效防御，增防与减防辅助仅归属其实际收益", () => {
  for (const ignoreDefensePercent of [0, 50, 100]) {
    const one = side("a", { attack: 0, speed: 30 });
    // Rear caster avoids receiving energy from round-one enemy attacks.
    one[2]!.tier.effects = [effect("defense_down_all", 25), { ...effect("damage_all", 2000), order: 1, ignoreDefensePercent }];
    const two = side("b", { attack: 0, defense: 1000, speed: 40 });
    two[0]!.tier.effects = [effect("defense_all_allies", 200)];
    const result = simulateCardBattle(inputs(one, two), "ignore-defense-support");
    const first = result.events.find((event) => event.actorId === "a3" && event.effectType === "damage_all")!;
    assert.ok(first);
    const previous = result.events[result.events.indexOf(first) - 1]!.states;
    for (const hit of first.effects) {
      const state = first.states.find((item) => item.instanceId === hit.targetId)!;
      const before = previous.find((item) => item.instanceId === hit.targetId)!;
      assert.equal(state.defense, 900, "先结算(1000+200)×75%");
      const incoming = state.damageTaken! - before.damageTaken!;
      assert.equal(hit.amount, -(incoming - 900 * (1 - ignoreDefensePercent / 100)));
    }
    assert.equal(first.states.find((state) => state.instanceId === "b1")!.supportBreakdown?.damageReduction ?? 0,
      150 * 5 * (1 - ignoreDefensePercent / 100), "100%忽防不为防御增益虚增辅助");
    assert.equal(first.states.find((state) => state.instanceId === "a3")!.supportBreakdown?.damageBoost ?? 0,
      300 * 5 * (1 - ignoreDefensePercent / 100), "100%忽防不为防御减益虚增辅助");
  }
});

test("同类增益按施加顺序分摊净增量，半效、首层到期、减益与生命截断均参与反事实", () => {
  const buffs: CardBattleBuff[] = [
    { stat: "attack", value: 100, expiresAfterRound: 1, sourceId: "a", sourceOrder: 1 },
    { stat: "attack", value: 100, expiresAfterRound: 3, sourceId: "b", sourceOrder: 2 },
    { stat: "attack", value: 50, expiresAfterRound: 3, debuff: true, sourceId: "enemy", sourceOrder: 3 },
  ];
  const shares = (list: CardBattleBuff[], hp: number) => cardBattleSupportShares([{ buffs: list, accepts: (buff) => !buff.debuff }],
    ([active]) => Math.min(hp, cardBattleEffectiveStat(100, active!, "attack")));
  assert.deepEqual(shares(buffs, 10000), [{ sourceId: "a", amount: 50 }, { sourceId: "b", amount: 25 }]);
  assert.deepEqual(shares(buffs, 60), [{ sourceId: "a", amount: 10 }]);
  assert.deepEqual(shares(buffs, 1), []);
  assert.deepEqual(shares(buffs.filter((buff) => buff.expiresAfterRound > 1), 10000), [{ sourceId: "b", amount: 50 }]);
});

test("速度、回能与生命上限只按本次实际生效值计分，全体逐个累计", () => {
  for (const [type, kind, multiplier] of [
    ["speed_all_allies", "speed", 100], ["energy_all_allies", "energy", 100], ["max_hp_all_allies", "maxHp", 1],
  ] as const) {
    const one = side("a", { speed: 30 });
    one[0]!.tier.effects = [effect(type, 20)];
    const result = simulateCardBattle(inputs(one, side("b")), type);
    const expected = result.events.filter((event) => event.effectType === type)
      .reduce((sum, event) => sum + event.effects.reduce((sum, visual) => sum + (visual.amount ?? 0) * multiplier, 0), 0);
    assert.ok(expected > 0, type);
    assert.equal(total(result, kind), expected, type);
    assert.ok(result.finalStates.filter((state) => state.instanceId !== "a1").every((state) => !state.supportBreakdown?.[kind]));
  }
});

test("有效治疗计入施法者，回血增益计入增益施法者，吸血不重复计入", () => {
  const one = side("a", { speed: 30, lifestealRate: 10 });
  one[0]!.tier.effects = [effect("lifesteal_all_allies", 50), effect("heal_all_allies", 50)];
  const result = simulateCardBattle(inputs(one, side("b", { attack: 500, speed: 40 })), "support-healing");
  assert.ok(total(result, "healingBoost") > 0);
  const actual = result.finalStates.filter((state) => state.seat === 1).reduce((sum, state) => sum + state.healingDone!, 0);
  assert.equal(total(result, "healing") + total(result, "healingBoost"), actual);
  assert.ok(result.finalStates.filter((state) => state.instanceId !== "a1").every((state) => !state.supportBreakdown?.healingBoost));
  const fullHealth = simulateCardBattle(inputs(side("a", { attack: 0, effects: [effect("heal_all_allies")] }), side("b", { attack: 0 })), "overheal");
  assert.equal(total(fullHealth, "healing"), 0);
});

test("攻击、技能伤害与防御增益在有效期内计入原施法者，原施法者无伤害也可得分", () => {
  for (const [type, kind] of [["attack_skill_damage_all_allies", "damageBoost"], ["defense_all_allies", "damageReduction"]] as const) {
    const one = side("a", { speed: 20 });
    one[0]!.tier.attack = 0;
    one[0]!.tier.speed = 100;
    one[0]!.tier.effects = [effect(type, 40, 1)];
    one[1]!.tier.effects = [effect("damage_all", 100)];
    const result = simulateCardBattle(inputs(one, side("b")), type);
    assert.ok(total(result, kind) > 0, type);
    assert.equal(result.finalStates[0]!.damageDealt, 0);
    assert.ok(result.finalStates.filter((state) => state.instanceId !== "a1").every((state) => !state.supportBreakdown?.[kind]));
    let prior = result.initialStates;
    for (const event of result.events) {
      const delta = (event.states[0]!.supportBreakdown?.[kind] ?? 0) - (prior[0]!.supportBreakdown?.[kind] ?? 0);
      if (delta > 0) assert.equal(event.visual, "damage");
      prior = event.states;
    }
  }
});

test("减攻、减防、减速、禁疗、降低吸血与削减生命上限均产生实际辅助", () => {
  for (const [type, kind] of [
    ["attack_skill_damage_down_all", "damageReduction"], ["defense_down_all", "damageBoost"],
    ["speed_down_all", "speed"], ["healing_received_down_all", "healingReduction"],
    ["lifesteal_down_all", "healingReduction"], ["max_hp_down_all", "maxHp"],
  ] as const) {
    const one = side("a", { speed: 30, attack: 300 });
    one[0]!.tier.effects = [effect(type, 50)];
    const result = simulateCardBattle(inputs(one, side("b", { defense: 100, lifestealRate: 50 })), type);
    assert.ok(total(result, kind) > 0, type);
  }
  const one = side("a", { speed: 30, effects: [effect("defense_down_all")] });
  const result = simulateCardBattle(inputs(one, side("b", { defense: 0 })), "zero-defense");
  assert.equal(total(result, "damageBoost"), 0);
});

test("额外再动只归因于增益新增触发，累计该再动的伤害及有效治疗", () => {
  for (const baseRate of [0, 100]) {
    const one = side("a", { speed: 30, extraActionRate: baseRate });
    one[0]!.tier.effects = [effect("extra_action_all_allies", 100, 30)];
    one[1]!.tier.effects = [effect("heal_all_allies", 30)];
    const result = simulateCardBattle(inputs(one, side("b", { speed: 40, attack: 300 })), "support-extra");
    const expected = result.events.filter((event) => event.extraAction && event.actorId?.startsWith("a"))
      .reduce((sum, event) => sum + (event.lifesteal ?? 0) + (["damage", "heal"].includes(event.visual)
        ? event.effects.reduce((sum, visual) => sum + Math.abs(visual.amount ?? 0), 0) : 0), 0);
    if (baseRate === 0) { assert.ok(expected > 0); assert.equal(total(result, "extraAction"), expected); }
    else assert.equal(total(result, "extraAction"), 0, "基础100%再动不应归给增益");
  }
});

test("眩晕只计增益新增且实际跳过的回合，重复叠加或基础100%不重复得分", () => {
  for (const baseRate of [0, 100]) {
    const one = side("a", { speed: 30, stunRate: baseRate });
    one[0]!.tier.speed = 100;
    one[0]!.tier.effects = [effect("stun_all_allies", 100, 30)];
    const result = simulateCardBattle(inputs(one, side("b")), "support-stun");
    const casts = result.events.filter((event) => event.effectType === "stun_all_allies");
    assert.ok(casts.length > 0);
    const skips = result.events.filter((event) => event.kind === "stun" && event.actorId?.startsWith("b") && event.sequence > casts[0]!.sequence);
    if (baseRate === 0) { assert.ok(skips.length > 0); assert.equal(total(result, "stun"), skips.length * 1000); }
    else assert.equal(total(result, "stun"), 0);
  }
  const one = side("a", { speed: 5, effects: [effect("stun_self", 100, 1)] });
  const late = simulateCardBattle(inputs(one, side("b", { speed: 30 })), "late-stun");
  assert.equal(total(late, "stun"), 0, "敌人已经行动后的眩晕不会虚算一个控制回合");
});

test("阻止再动按实际随机判定计次，全抑制也生效，基础0%无收益", () => {
  for (const baseRate of [0, 100]) {
    const one = side("a", { speed: 30 });
    one[0]!.tier.effects = [effect("extra_action_down_all", 100, 30)];
    const result = simulateCardBattle(inputs(one, side("b", { extraActionRate: baseRate })), "suppress-extra");
    if (baseRate === 0) assert.equal(total(result, "extraActionPrevention"), 0);
    else { assert.ok(total(result, "extraActionPrevention") > 0); assert.equal(total(result, "extraActionPrevention") % 1000, 0); }
  }
});

test("降低击晕概率只在成功保住行动时计分，抵抗本已免疫或基础0%不得虚算", () => {
  for (const baseRate of [0, 100]) for (const immune of [false, true]) {
    const one = side("a", { speed: 10 });
    one[0]!.tier.speed = 100;
    one[0]!.tier.effects = [effect("stun_down_all", 100, 30)];
    if (immune) for (const card of one) card.collectible = { id: card.cardId, collectibleNo: "001", name: "抵抗", imageUrl: "",
      battleEffectDescription: "", battleEffectType: "debuff_resistance", battleEffectValue: 30 };
    const result = simulateCardBattle(inputs(one, side("b", { speed: 30, stunRate: baseRate })), "prevent-stun");
    if (baseRate === 0 || immune) assert.equal(total(result, "stun"), 0);
    else assert.ok(total(result, "stun") > 0);
  }
});

test("增益施放者死亡后仍获得存续状态贡献，状态到期后立即停止", () => {
  const one = side("a", { speed: 30 });
  one[0]!.tier.maxHp = 200;
  one[0]!.tier.effects = [{ ...effect("attack_all_allies", 80, 2), condition: "self_death" }];
  const result = simulateCardBattle(inputs(one, side("b", { speed: 50, attack: 300 })), "dead-support-owner");
  const cast = result.events.find((event) => event.effectType === "attack_all_allies")!;
  assert.ok(cast);
  assert.equal(cast.states[0]!.alive, false);
  assert.ok(total(result, "damageBoost") > 0);
  const expiration = result.events.find((event) => event.round === cast.round + 2)!;
  assert.ok(expiration);
  const scoreAtExpiration = expiration.states[0]!.supportDone;
  assert.ok(result.events.filter((event) => event.sequence >= expiration.sequence).every((event) => event.states[0]!.supportDone === scoreAtExpiration));
});

test("无敌、免死与致死溢出约束实际增伤减伤，不能凭原始攻击防御数值刷辅助", () => {
  const one = side("a", { speed: 30, attack: 100 });
  one[0]!.tier.effects = [effect("attack_all_allies", 500)];
  const two = side("b", { attack: 0 });
  for (const card of two) card.collectible = { id: card.cardId, collectibleNo: "001", name: "无敌", imageUrl: "",
    battleEffectDescription: "", battleEffectType: "invincible", battleEffectValue: 30 };
  assert.equal(total(simulateCardBattle(inputs(one, two), "invulnerable-support"), "damageBoost"), 0);
  for (const card of two) { card.tier.maxHp = 1; card.collectible!.battleEffectType = "death_protection"; }
  assert.equal(total(simulateCardBattle(inputs(one, two), "death-protection-support"), "damageBoost"), 0);
});

test("复活只累计本条复活生命的伤害与原口径承伤，死亡后的技能不计入旧复活", () => {
  const one = side("a", { maxHp: 500, attack: 120, speed: 30 });
  one[0]!.tier.effects = [{ ...effect("revive_all_allies"), condition: "ally_death" }];
  one[0]!.tier.maxHp = 100000;
  one[1]!.tier.effects = [{ ...effect("damage_all", 20), condition: "self_death" }];
  const result = simulateCardBattle(inputs(one, side("b", { attack: 300 })), "support-revival");
  const revivers = new Map<string, string>();
  let expected = 0;
  let previous = result.initialStates;
  for (const event of result.events) {
    for (const state of event.states) {
      const prior = previous.find((item) => item.instanceId === state.instanceId)!;
      if (revivers.get(state.instanceId) === "a1") {
        expected += (state.damageDealt! - prior.damageDealt!) + (state.damageTaken! - prior.damageTaken!);
      }
      if (!state.alive) revivers.delete(state.instanceId);
    }
    if (event.visual === "revive") for (const visual of event.effects) revivers.set(visual.targetId, event.actorId!);
    previous = event.states;
  }
  assert.ok(expected > 0);
  assert.equal(result.finalStates[0]!.supportBreakdown?.revival, expected);
});

test("辅助快照持久化一致，认输以命中时间截断，不计未来加分", () => {
  const one = side("a", { speed: 30 });
  one[0]!.tier.effects = [effect("speed_all_allies", 20)];
  const result = simulateCardBattle(inputs(one, side("b")), "support-surrender");
  assert.deepEqual(resolveCardBattleSettlementPlayers(JSON.parse(JSON.stringify(result))), result.players);
  let offset = 0;
  for (const event of result.events.slice(0, 30)) {
    for (const hit of [false, true]) {
      const now = offset + (hit ? Math.max(120, Math.round(event.durationMs * .55)) : 0);
      const surrendered = surrenderCardBattleResult(result, "u1", new Date(0), now)!;
      const expected = (hit ? event.states : result.events[event.sequence - 2]?.states) ?? result.initialStates;
      for (const player of surrendered.players) for (const card of player.cards) {
        const state = expected.find((state) => state.userId === player.userId && state.slot === card.slot)!;
        assert.equal(card.supportDone, state.supportDone);
        assert.deepEqual(card.supportBreakdown, state.supportBreakdown);
        assert.equal(card.score, calculateCardBattleScore(card.damageDealt, card.damageTaken, card.supportDone));
      }
    }
    offset += event.durationMs;
  }
  for (const state of result.finalStates) assert.equal(state.supportDone, Object.values(state.supportBreakdown!).reduce((sum, value) => sum + value, 0));
  assert.ok(result.initialStates.every((state) => state.supportDone === 0 && Object.keys(state.supportBreakdown!).length === 0));
});

test("BOSS同阵营不同玩家相同卡位的收益仍按实例归属于施放者", () => {
  const a = side("a", { speed: 40 }).slice(0, 3), b = side("b", { speed: 30 }).slice(0, 3);
  a[0]!.tier.effects = [effect("speed_all_allies", 20)];
  const result = simulateCardBattle([
    { userId: "u1", nickname: "one", seat: 1, cards: a }, { userId: "u2", nickname: "two", seat: 1, cards: b },
    { userId: "boss", nickname: "boss", seat: 2, cards: side("boss") },
  ], "boss-support", "boss");
  assert.ok(result.players[0]!.cards[0]!.supportDone! > 0);
  assert.equal(result.players[1]!.cards[0]!.supportDone, 0);
  const cast = result.events.find((event) => event.effectType === "speed_all_allies")!;
  assert.equal(cast.effects.length, 6);
  assert.deepEqual(resolveCardBattleSettlementPlayers(result), result.players);
});
