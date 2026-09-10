import assert from "node:assert/strict";
import test from "node:test";
import type { PoolConnection } from "mysql2/promise";
import { CARD_BATTLE_CONTROL_CODES, cardBattleControlNeedsDuration, isCardBattleAttachedOnly, isCardBattleCleanse, isCardBattleStun, cardBattleStatusCategory } from "@hgt/shared";
import { simulateCardBattle, type CardBattleSkillAction, type CardBattleSkillEffect, type CardBattleDeckCard, type CardBattleEffectCode } from "./cardBattle.js";
import { cardBattleEffectSchema, defaultCardBattleTiers, loadCardBattleTiers, saveCardBattleTiers } from "./cardBattleConfig.js";
import { cardBattleDebuffCodes } from "./cardBattleStatus.js";
import { cardBattleStatuses } from "./cardBattleMath.js";
import { bossCardSchema } from "./cardBattleBossRules.js";

function action(type: CardBattleEffectCode, extra: Partial<CardBattleSkillAction> = {}): CardBattleSkillAction {
  return { type, value: type.startsWith("damage_") ? 100 : isCardBattleCleanse(type) ? 1 : null,
    duration: cardBattleControlNeedsDuration(type) ? 1 : null, ...extra };
}
function skill(type: CardBattleEffectCode, additions: CardBattleSkillAction[] = [], extra: Partial<CardBattleSkillEffect> = {}): CardBattleSkillEffect {
  return { ...action(type), id: "skill-" + type, order: 0, condition: "energy_full", conditionValue: null,
    additionalEffects: additions, ...extra };
}
function side(prefix: string): CardBattleDeckCard[] {
  return ([1, 2, 3, 4, 5] as const).map((slot) => ({
    instanceId: prefix + slot, cardId: prefix + slot, name: prefix + slot, imageUrl: "", rarity: "epic",
    battleRole: "support", starLevel: 0, slot, motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
    tier: { ...defaultCardBattleTiers("epic")[0]!, maxHp: 100000, attack: 0, defense: 0, speed: 10, energyRequired: 1, critRate: 0 },
  }));
}
function setup(own: CardBattleSkillEffect[], opposing: CardBattleSkillEffect[] = []) {
  const one = side("a"), two = side("b");
  one[0]!.tier = { ...one[0]!.tier, speed: 100, effects: own };
  two[0]!.tier = { ...two[0]!.tier, speed: 200, effects: opposing };
  const run = (seed = "control-effects") => simulateCardBattle([
    { userId: "a", nickname: "a", seat: 1, cards: one },
    { userId: "b", nickname: "b", seat: 2, cards: two },
  ], seed);
  return { one, two, run };
}

test("19种新增类型、附加限制、独立概率及超过30回合均受后端校验", () => {
  assert.equal(CARD_BATTLE_CONTROL_CODES.length, 19);
  for (const type of CARD_BATTLE_CONTROL_CODES) {
    const input = isCardBattleAttachedOnly(type) ? skill("damage_all", [action(type)]) : skill(type);
    assert.ok(cardBattleEffectSchema.safeParse(input).success, type);
    if (cardBattleControlNeedsDuration(type)) {
      for (const duration of [31, 365, 5_000_000_000]) {
        const next = isCardBattleAttachedOnly(type) ? skill("damage_all", [action(type, { duration })]) : skill(type, [], { duration });
        assert.ok(cardBattleEffectSchema.safeParse(next).success, type + ":" + duration);
      }
      assert.equal(cardBattleEffectSchema.safeParse(isCardBattleAttachedOnly(type) ? skill("damage_all", [action(type, { duration: 0 })]) : skill(type, [], { duration: 0 })).success, false);
    }
    if (isCardBattleStun(type)) {
      assert.equal(cardBattleEffectSchema.parse(input).probability, 100);
      for (const probability of [0, 12.25, 100]) assert.ok(cardBattleEffectSchema.safeParse({ ...input, probability }).success);
      for (const probability of [-1, 100.01, 12.345]) assert.equal(cardBattleEffectSchema.safeParse({ ...input, probability }).success, false);
    }
  }
  for (const type of ["act_again", "revival_block_damaged"] as const) assert.equal(cardBattleEffectSchema.safeParse(skill(type)).success, false);
  assert.equal(cardBattleEffectSchema.safeParse(skill("immunity_self", [action("revival_block_damaged")])).success, false);
  assert.ok(cardBattleEffectSchema.safeParse(skill("immunity_self", [action("revival_block_damaged"), action("damage_all")])).success);
  assert.equal(cardBattleEffectSchema.safeParse(skill("immunity_self", [action("revive_self")])).success, false);
  assert.equal(cardBattleEffectSchema.safeParse(skill("damage_all", [{ ...action("immunity_self"), additionalEffects: [] } as CardBattleSkillAction])).success, false);
  const boss = { name: "boss", imageUrl: "/api/online-soup/card-battle-boss/covers/" + "a".repeat(64),
    tier: { ...defaultCardBattleTiers()[3], effects: [skill("damage_all", [action("stun_enemy_all", { duration: 60, probability: 50 }), action("act_again")])] } };
  assert.ok(bossCardSchema.safeParse(boss).success);
});

test("主技能及附加类型的概率、超长回合、忽防比例持久化，并兼容旧行", async () => {
  const tiers: Record<string, unknown>[] = [], effects: Record<string, unknown>[] = [];
  const db = { query: async (sql: string, args: unknown[] = []) => {
    const insert = sql.match(/INSERT INTO (asset_card_battle_tiers|asset_card_battle_effects)\s*\(([^)]+)\)/);
    if (insert) {
      const columns = insert[2]!.split(",").map((item) => item.trim());
      assert.equal(columns.length, args.length);
      (insert[1] === "asset_card_battle_tiers" ? tiers : effects).push(Object.fromEntries(columns.map((column, index) => [column, args[index]])));
    }
    return [sql.startsWith("SELECT * FROM asset_card_battle_tiers") ? tiers : sql.startsWith("SELECT * FROM asset_card_battle_effects") ? effects : []];
  } } as unknown as PoolConnection;
  const input = defaultCardBattleTiers().map((tier) => ({ ...tier, effects: [
    skill("stun_enemy_all", [action("damage_all", { ignoreDefensePercent: 65.25 }), action("revival_block_damaged", { duration: 365 }), action("act_again")], { duration: 5_000_000_000, probability: 12.25 }),
  ] }));
  await saveCardBattleTiers("control", input, db);
  const loaded = await loadCardBattleTiers("control", db);
  for (const tier of loaded) {
    const saved = tier.effects[0]!;
    assert.equal(saved.probability, 12.25);
    assert.equal(saved.duration, 5_000_000_000);
    assert.equal(saved.additionalEffects?.[0]?.ignoreDefensePercent, 65.25);
    assert.equal(saved.additionalEffects?.[1]?.duration, 365);
    assert.ok(cardBattleEffectSchema.safeParse(saved).success);
  }
  delete effects[0]!.additional_effects;
  delete effects[0]!.probability;
  assert.equal((await loadCardBattleTiers("control", db))[0]!.effects[0]!.additionalEffects, undefined);
});

test("眩晕五种范围独立施加、0%不生效、指定单体前排优先且可持续超过30回合", () => {
  for (const [type, count] of [["stun_enemy_single", 1], ["stun_enemy_front", 2], ["stun_enemy_rear", 3], ["stun_enemy_all", 5], ["stun_enemy_random", 1]] as const) {
    const fixture = setup([skill(type, [], { duration: 60, probability: 100 })]);
    fixture.one[0]!.tier.canAttackRear = true;
    const result = fixture.run(type);
    const event = result.events.find((item) => item.effectType === type)!;
    assert.equal(event.effects.length, count, type);
    for (const hit of event.effects) {
      const state = event.states.find((item) => item.instanceId === hit.targetId)!;
      assert.equal(state.statuses?.find((item) => item.type === "stunned")?.remainingRounds, 60);
      assert.equal(state.statuses?.find((item) => item.type === "stunned")?.category, "debuff");
      if (type === "stun_enemy_single" || type === "stun_enemy_front") assert.equal(state.row, "front");
      if (type === "stun_enemy_rear") assert.equal(state.row, "rear");
    }
    assert.ok(result.events.some((item) => item.kind === "stun" && item.round > event.round));
  }
  const result = setup([skill("stun_enemy_all", [], { probability: 0 })]).run();
  assert.ok(result.events.filter((item) => item.effectType === "stun_enemy_all").every((item) => item.effects.every((effect) => !effect.stunned)));
});

test("同一技能所有伤害命中的并集先被禁止复活，包含击杀对象，不跨独立技能行", () => {
  const group = skill("damage_all_front", [action("revival_block_damaged", { duration: 60 }), action("damage_all_rear", { value: 200000 })], { value: 200000 });
  const fixture = setup([group]);
  for (const target of fixture.two) target.tier.effects = [skill("revive_self", [], { condition: "self_death" })];
  const result = fixture.run();
  const ban = result.events.find((item) => item.effectType === "revival_block_damaged")!;
  assert.equal(ban.effects.length, 5);
  assert.ok(ban.states.filter((item) => item.seat === 2).every((item) => !item.alive && item.statuses?.some((status) => status.type === "revival_block")));
  assert.ok(result.events.filter((item) => item.effectType === "revive_self").every((item) => item.sequence > ban.sequence && item.effects.every((effect) => effect.blocked)));
  assert.equal(result.winnerSeat, 1);
  const separate = setup([skill("damage_all_front", [action("revival_block_damaged")]), skill("damage_all_rear", [], { id: "separate", order: 1 })]).run();
  assert.ok(separate.events.find((item) => item.effectType === "revival_block_damaged")!.effects.every((effect) => ["b1", "b2"].includes(effect.targetId)));
});

test("零扣血目标不被附加禁止复活，复活禁令覆盖指定排与已经死亡的单位", () => {
  const blocked = setup([skill("damage_all", [action("revival_block_damaged")])]);
  blocked.two.forEach((target) => target.tier.defense = 1000);
  assert.equal(blocked.run().events.find((item) => item.effectType === "revival_block_damaged")!.effects.length, 0);
  for (const [type, count] of [["revival_block_all", 5], ["revival_block_front", 2], ["revival_block_rear", 3]] as const) {
    const result = setup([skill("damage_all_front", [], { value: 200000 }), skill(type, [], { id: "ban", order: 1 })]).run();
    const event = result.events.find((item) => item.effectType === type)!;
    assert.equal(event.effects.length, count);
    if (type !== "revival_block_rear") assert.ok(event.effects.some((effect) => !event.states.find((state) => state.instanceId === effect.targetId)!.alive));
  }
});

test("免疫阻止全部旧减益、技能眩晕及禁止复活，已有减益保留", () => {
  for (const type of [...cardBattleDebuffCodes, "stun_enemy_all", "revival_block_all"] as const) {
    const effect = skill(type, [], { value: cardBattleDebuffCodes.includes(type as typeof cardBattleDebuffCodes[number]) ? 25 : null, duration: 60 });
    const fixture = setup([effect], [skill("immunity_all", [], { duration: 60 })]);
    fixture.one[0]!.tier.energyRequired = 20;
    const result = fixture.run(type);
    const event = result.events.find((item) => item.effectType === type)!;
    assert.ok(event.effects.length > 0, type);
    assert.ok(event.effects.every((item) => item.label === "抵抗负面状态"), type);
    assert.ok(event.states.filter((item) => item.seat === 2).every((item) => item.statuses?.every((status) => status.category === "buff")), type);
  }
  const fixture = setup([skill("immunity_all")], [skill("defense_down_all", [], { value: 25, duration: 60 })]);
  const event = fixture.run().events.find((item) => item.effectType === "immunity_all")!;
  assert.ok(event.states.filter((item) => item.seat === 1).every((item) => item.statuses?.some((status) => status.type === "defense_down") && item.statuses.some((status) => status.type === "immunity")));
});

test("免疫四种范围正确，且不阻止敌方吸血和再动", () => {
  for (const [type, count] of [["immunity_self", 1], ["immunity_front", 2], ["immunity_rear", 3], ["immunity_all", 5]] as const) {
    const event = setup([skill(type)]).run().events.find((item) => item.effectType === type)!;
    assert.equal(event.effects.length, count, type);
  }
  const fixture = setup([skill("damage_all")], [skill("immunity_all", [], { duration: 60 })]);
  fixture.one[0]!.tier.lifestealRate = 100;
  fixture.one[0]!.tier.extraActionRate = 100;
  fixture.two.forEach((target) => target.tier.attack = 100);
  const result = fixture.run();
  const immunity = result.events.find((item) => item.effectType === "immunity_all")!;
  assert.ok(result.events.some((item) => item.sequence > immunity.sequence && item.actorId === "a1" && item.lifesteal! > 0));
  assert.ok(result.events.some((item) => item.sequence > immunity.sequence && item.actorId === "a1" && item.kind === "extra_action"));
});

test("净化逐目标按最早层清除，组合减益计一次并保留增益，清除生命上限减益不回血", () => {
  const enemy = skill("attack_skill_damage_down_all", [
    action("defense_down_all", { value: 20, duration: 60 }), action("max_hp_down_all", { value: 50, duration: 60 }),
  ], { value: 25, duration: 60 });
  const own = skill("attack_all_allies", [action("cleanse_all")], { value: 100, duration: 60 });
  const result = setup([own], [enemy]).run();
  const cleansed = result.events.find((item) => item.effectType === "cleanse_all")!;
  assert.ok(cleansed.effects.every((item) => item.amount === 1));
  assert.ok(cleansed.states.filter((item) => item.seat === 1).every((item) =>
    item.attack === 100 && !item.statuses?.some((status) => status.type === "attack_skill_damage_down")
    && item.statuses?.some((status) => status.type === "defense_down") && item.statuses.some((status) => status.type === "attack_up")));
  const all = setup([skill("cleanse_all", [], { value: 99 })], [enemy]).run().events.find((item) => item.effectType === "cleanse_all")!;
  assert.ok(all.effects.every((item) => item.amount === 3));
  assert.ok(all.states.filter((item) => item.seat === 1).every((item) => item.maxHp === 100000 && item.hp === 50000 && !item.statuses?.some((status) => status.category === "debuff")));
});

test("净化五种范围、重复层计数及禁止复活可净化，阵亡单位不在净化目标内", () => {
  for (const [type, count] of [["cleanse_self", 1], ["cleanse_random", 1], ["cleanse_front", 2], ["cleanse_rear", 3], ["cleanse_all", 5]] as const) {
    const enemy = skill("revival_block_all", [action("defense_down_all", { value: 20, duration: 60 }), action("defense_down_all", { value: 30, duration: 60 })], { duration: 60 });
    const event = setup([skill(type, [], { value: 2 })], [enemy]).run().events.find((item) => item.effectType === type)!;
    assert.equal(event.effects.length, count);
    for (const hit of event.effects) {
      assert.equal(hit.amount, 2);
      const statuses = event.states.find((item) => item.instanceId === hit.targetId)!.statuses!;
      assert.deepEqual(statuses.filter((item) => item.category === "debuff").map((item) => [item.type, item.value, item.multiplier]), [["defense_down", 30, 1]]);
    }
  }
  const fixture = setup([skill("cleanse_all")], [skill("damage_all_rear", [], { value: 200000 })]);
  const event = fixture.run().events.find((item) => item.effectType === "cleanse_all")!;
  assert.deepEqual(event.effects.map((item) => item.targetId), ["a1", "a2"]);
});

test("保证再动在全部附加效果后执行，与概率再动合并且整条额外行动链禁止递归", () => {
  const fixture = setup([skill("energy_self", [action("act_again"), action("attack_self", { value: 100, duration: 60 })], { value: 1 })]);
  fixture.one[0]!.tier.extraActionRate = 100;
  const result = fixture.run();
  const energy = result.events.find((item) => item.effectType === "energy_self" && !item.extraAction)!;
  const sequence = result.events.slice(energy.sequence, energy.sequence + 4);
  assert.deepEqual(sequence.map((item) => item.effectType ?? item.kind), ["attack_self", "extra_action", "energy_self", "attack_self"]);
  assert.equal(result.events.filter((item) => item.actorId === "a1" && item.kind === "extra_action" && item.round === energy.round).length, 1);
  const guaranteed = setup([skill("energy_self", [action("act_again")], { value: 1 })]).run();
  assert.ok(guaranteed.events.some((item) => item.actorId === "a1" && item.kind === "extra_action"));
  assert.deepEqual(guaranteed, setup([skill("energy_self", [action("act_again")], { value: 1 })]).run());
});

test("眩晕及免疫重复层各自到期，不叠加回合；所有公开状态带buff/debuff分类", () => {
  const statuses = cardBattleStatuses([
    { stat: "stunned", value: 1, debuff: true, expiresAfterRound: 60 },
    { stat: "stunned", value: 1, debuff: true, expiresAfterRound: 100 },
    { stat: "immunity", value: 1, expiresAfterRound: 365 },
  ], 30);
  assert.deepEqual(statuses.map((item) => item.remainingRounds), [31, 71, 336]);
  assert.ok(statuses.every((item) => item.category === cardBattleStatusCategory(item.type)));
});
