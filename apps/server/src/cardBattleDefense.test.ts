import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BATTLE_DEFENSE_EFFECT_CODES, CARD_BATTLE_ACCURACY_STATS, cardBattleDefenseNeedsDuration, cardBattleDodgeChance, isCardBattleTrueDamage } from "@hgt/shared";
import { simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleSkillEffect, type CardBattleTier } from "./cardBattle.js";
import { cardBattleTierSchema, cardBattleEffectSchema, defaultCardBattleTiers } from "./cardBattleConfig.js";
import { cardBattleEffectiveAccuracy, cardBattleStatuses } from "./cardBattleMath.js";
import { consumeCardBattleShields, cardBattleShieldValue } from "./cardBattleShields.js";

const effect = (type: CardBattleSkillEffect["type"], value: number | null = 1000, duration: number | null = null): CardBattleSkillEffect => ({ id: type, order: 0, condition: "energy_full", conditionValue: null, type, value, duration });
function side(prefix: string, stats: Partial<CardBattleTier> = {}): CardBattleDeckCard[] {
  return ([1, 2, 3, 4, 5] as const).map(slot => ({
    instanceId: `${prefix}${slot}`, cardId: `${prefix}${slot}`, cardNo: `${prefix}${slot}`, name: `${prefix}${slot}`, imageUrl: "", rarity: "epic", battleRole: "damage", slot, starLevel: 0,
    motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
    tier: { ...defaultCardBattleTiers("epic")[0]!, maxHp: 100000, attack: 0, defense: 0, speed: 10, critRate: 0, energyRequired: 100000, ...stats, effects: [] },
  }));
}
const inputs = (one: CardBattleDeckCard[], two: CardBattleDeckCard[]): CardBattlePlayerInput[] => [
  { userId: "u1", nickname: "one", seat: 1, cards: one }, { userId: "u2", nickname: "two", seat: 2, cards: two },
];
function opening(card: CardBattleDeckCard, effects: CardBattleSkillEffect[]) {
  card.tier.effects = effects.map((item, order) => ({ ...item, id: `opening-${order}`, order }));
  card.tier.bonds = [{ cardNos: [card.cardNo!], event: "energy_empty", actions: [{ target: "self", type: "skill", value: null, duration: null }] }];
}

test("新增属性旧值默认0、精度两位，所有新技能校验数值回合，真实伤害拒绝忽防", () => {
  for (const { key } of CARD_BATTLE_ACCURACY_STATS) {
    const tier = { ...defaultCardBattleTiers()[0]! }; delete tier[key];
    assert.equal(cardBattleTierSchema.parse(tier)[key], 0);
    for (const value of [0, 20.25, 100]) assert.equal(cardBattleTierSchema.parse({ ...tier, [key]: value })[key], value);
    for (const value of [-1, 100.01, 1.001]) assert.equal(cardBattleTierSchema.safeParse({ ...tier, [key]: value }).success, false);
  }
  for (const type of CARD_BATTLE_DEFENSE_EFFECT_CODES) {
    const value = effect(type, 20, cardBattleDefenseNeedsDuration(type) ? 2 : null);
    assert.ok(cardBattleEffectSchema.safeParse(value).success, type);
    assert.equal(cardBattleEffectSchema.safeParse({ ...value, value: null }).success, false);
    assert.equal(cardBattleEffectSchema.safeParse({ ...value, duration: value.duration ? null : 2 }).success, false);
    if (isCardBattleTrueDamage(type)) assert.equal(cardBattleEffectSchema.safeParse({ ...value, ignoreDefensePercent: 10 }).success, false);
  }
});

test("实际闪避先相减再限制0到100；概率增益全额叠加、到期层互不影响", () => {
  assert.equal(cardBattleDodgeChance(20, 10), 10);
  assert.equal(cardBattleDodgeChance(10, 20), 0);
  assert.equal(cardBattleDodgeChance(150, 20), 100);
  const buffs = [{ stat: "dodgeRate" as const, value: 40, expiresAfterRound: 1, independent: true }, { stat: "dodgeRate" as const, value: 30, expiresAfterRound: 2, independent: true }];
  assert.equal(cardBattleEffectiveAccuracy({ dodgeRate: 20 }, buffs, "dodgeRate"), 90);
  assert.equal(cardBattleEffectiveAccuracy({ dodgeRate: 20 }, buffs.filter(b => b.expiresAfterRound > 1), "dodgeRate"), 50);
  assert.ok(cardBattleStatuses(buffs, 1).every(s => s.multiplier === 1));
});

test("护盾优先消耗最早到期层、同期限按获得顺序，辅助贡献仅计实际吸收", () => {
  const shields = [{ remaining: 100, expiresAfterRound: 3, sourceId: "late", order: 1 }, { remaining: 40, expiresAfterRound: 1, sourceId: "early", order: 2 }, { remaining: 50, expiresAfterRound: 1, sourceId: "early2", order: 3 }];
  const credits: unknown[] = [];
  assert.equal(consumeCardBattleShields(shields, 60, (id, amount) => credits.push([id, amount])), 60);
  assert.deepEqual(credits, [["early", 40], ["early2", 20]]);
  assert.equal(cardBattleShieldValue(shields.filter(s => s.expiresAfterRound > 1)), 100);
  assert.equal(consumeCardBattleShields(shields, 999, () => {}), 130);
  assert.equal(cardBattleShieldValue(shields), 0);
});

test("100%闪避阻止普通伤害、回能、吸血、击晕和受伤羁绊，普攻羁绊仍触发", () => {
  const one = side("a", { attack: 100, lifestealRate: 100, stunRate: 100 }), two = side("b", { dodgeRate: 100 });
  one[0]!.tier.bonds = [{ cardNos: ["a1"], event: "attack", actions: [{ target: "self", type: "attack_up", value: 7, duration: 2 }] }];
  two[0]!.tier.bonds = [{ cardNos: ["b1", "b2"], event: "damaged", actions: [{ target: "self", type: "attack_up", value: 9, duration: 2 }] }];
  const result = simulateCardBattle(inputs(one, two), "all-dodge");
  const attack = result.events.find(e => e.kind === "attack" && e.actorId === "a1")!;
  assert.equal(attack.effects[0]!.dodged, true);
  const target = attack.states.find(s => s.instanceId === attack.effects[0]!.targetId)!;
  const prior = result.events[attack.sequence - 2]!.states.find(s => s.instanceId === target.instanceId)!;
  assert.equal(target.energy, prior.energy); assert.equal(target.hp, target.maxHp);
  assert.equal(attack.lifesteal ?? 0, 0); assert.equal(attack.effects[0]!.stunned, undefined);
  assert.ok(result.events.some(e => e.bond?.ownerId === "a1"));
  assert.ok(!result.events.some(e => e.bond?.ownerId === "b1"));
});

test("100%命中抵消100%闪避，每个群攻目标及每段伤害独立判定，独立增益照常执行", () => {
  const one = side("a", { hitRate: 100 }), two = side("b", { dodgeRate: 100 });
  opening(one[0]!, [{ ...effect("damage_all", 100), additionalEffects: [{ type: "damage_all", value: 100, duration: null }, { type: "hit_self", value: 20, duration: 2 }] }]);
  let result = simulateCardBattle(inputs(one, two), "multi-hit");
  const hits = result.events.filter(e => e.effectType === "damage_all" && e.round === 1);
  assert.equal(hits.length, 2); assert.ok(hits.every(e => e.effects.length === 5 && e.effects.every(hit => !hit.dodged && hit.amount! < 0)));
  one[0]!.tier.hitRate = 0; two[0]!.tier.dodgeRate = 0;
  result = simulateCardBattle(inputs(one, two), "multi-hit");
  const mixed = result.events.filter(e => e.effectType === "damage_all" && e.round === 1);
  assert.ok(mixed.every(e => e.effects.find(h => h.targetId === "b1")!.amount! < 0 && e.effects.filter(h => h.targetId !== "b1").every(h => h.dodged)));
  assert.ok(result.events.some(e => e.effectType === "hit_self"));
});

test("盾伤计入伤害、吸血和受伤羁绊；施盾触发羁绊且仅吸收部分计辅助", () => {
  const one = side("a", { attack: 100, lifestealRate: 100 }), two = side("b", { attack: 1000, speed: 100 });
  opening(two[0]!, [effect("shield_all", 10000, 3)]);
  two[1]!.tier.bonds = [
    { cardNos: ["b1", "b2"], event: "damaged", actions: [{ target: "self", type: "defense_up", value: 1, duration: 1 }] },
    { cardNos: ["b1"], event: "shielded", actions: [{ target: "self", type: "attack_up", value: 1, duration: 1 }] },
  ];
  const result = simulateCardBattle(inputs(one, two), "shield-lifesteal");
  const hit = result.events.find(e => e.kind === "attack" && e.actorId?.startsWith("a") && (e.effects[0]?.shieldDamage ?? 0) > 0 && (e.lifesteal ?? 0) > 0)!;
  assert.ok(hit); assert.equal(hit.effects[0]!.hpDamage, 0); assert.equal(hit.lifesteal, hit.effects[0]!.shieldDamage);
  assert.ok(result.events.some(e => e.bond?.ownerId === "b2" && e.visual === "buff"));
  assert.ok(result.events.some(e => e.bond?.ownerId === "b2" && e.effectType === "attack_self"));
  assert.ok(result.events.some(e => e.bond?.ownerId === "b2" && e.effectType === "defense_self"));
  const source = result.players[1]!.cards[0]!;
  assert.ok(source.supportBreakdown!.shield! > 0 && source.supportBreakdown!.shield! < 50000);
  const dealt = result.events.filter(e => e.actorId?.startsWith("a") && e.visual === "damage").reduce((sum, e) => sum - e.effects.reduce((n, h) => n + (h.amount ?? 0), 0), 0);
  assert.equal(result.players[0]!.cards.reduce((sum, c) => sum + c.damageDealt, 0), dealt);
});

test("真实伤害保留防御并跳过护盾，随机目标不重复，仍可被闪避", () => {
  for (const [type, count] of [["damage_true_single", 1], ["damage_true_random", 1], ["damage_true_random_2", 2], ["damage_true_random_3", 3], ["damage_true_all", 5]] as const) {
    const one = side("a", { defense: 50 }), two = side("b");
    opening(one[0]!, [effect("shield_all", 10000, 5)]);
    opening(two[0]!, [effect(type, 100)]);
    const result = simulateCardBattle(inputs(one, two), `true-${type}`);
    const hit = result.events.find(e => e.effectType === type)!;
    assert.equal(hit.effects.length, count); assert.equal(new Set(hit.effects.map(e => e.targetId)).size, count);
    assert.ok(hit.effects.every(h => h.shieldDamage === 0 && h.hpDamage! >= 48 && h.hpDamage! <= 52));
    assert.ok(hit.states.filter(s => s.seat === 1).every(s => s.shield === 10000));
    if (type === "damage_true_single") assert.ok(["a1", "a2"].includes(hit.effects[0]!.targetId));
    for (const card of one) card.tier.dodgeRate = 100;
    const dodged = simulateCardBattle(inputs(one, two), `true-${type}`).events.find(e => e.effectType === type)!;
    assert.ok(dodged.effects.every(h => h.dodged));
  }
});

test("护盾范围准确、独立过期不扣血；闪避与命中多层全额叠加", () => {
  for (const [type, count] of [["shield_self", 1], ["shield_front", 2], ["shield_rear", 3], ["shield_all", 5]] as const) {
    const one = side("a"), two = side("b");
    opening(one[0]!, [effect(type, 100, 1), effect(type, 70, 2), effect("dodge_all", 30, 1), effect("dodge_all", 40, 2), effect("hit_all", 20, 1), effect("hit_all", 30, 2)]);
    const result = simulateCardBattle(inputs(one, two), `expire-${type}`);
    assert.equal(result.events.find(e => e.effectType === type)!.effects.length, count);
    const round1 = result.events.filter(e => e.round === 1).at(-1)!.states.filter(s => s.seat === 1);
    assert.equal(round1.filter(s => s.shield === 170).length, count);
    assert.ok(round1.every(s => s.dodgeRate === 70 && s.hitRate === 50));
    const round2 = result.events.find(e => e.kind === "round" && e.round === 2)!.states.filter(s => s.seat === 1);
    assert.equal(round2.filter(s => s.shield === 70).length, count);
    assert.ok(round2.every(s => s.hp === s.maxHp && s.dodgeRate === 40 && s.hitRate === 30));
    const round3 = result.events.find(e => e.kind === "round" && e.round === 3)!.states.filter(s => s.seat === 1);
    assert.ok(round3.every(s => s.shield === 0 && s.hp === s.maxHp && s.dodgeRate === 0 && s.hitRate === 0));
  }
});

test("真实伤害击杀清空护盾，复活不恢复旧护盾", () => {
  const one = side("a", { maxHp: 100 }), two = side("b");
  opening(one[0]!, [effect("shield_all", 10000, 10)]);
  for (const card of one) card.tier.effects.push({ ...effect("revive_self", null), id: "revive", order: 1, condition: "self_death" });
  opening(two[0]!, [effect("damage_true_all", 1000)]);
  const result = simulateCardBattle(inputs(one, two), "death-shields");
  const death = result.events.find(e => e.effectType === "damage_true_all")!;
  assert.ok(death.states.filter(s => s.seat === 1).every(s => !s.alive && s.shield === 0));
  const revived = result.events.find(e => e.effectType === "revive_self")!;
  assert.ok(revived); assert.equal(revived.states.find(s => s.instanceId === revived.effects[0]!.targetId)!.shield, 0);
});

test("真实伤害仍计算技能增伤与暴击，且受无敌、免死保护", () => {
  for (const protection of [null, "invincible", "death_protection"] as const) {
    const one = side("a", { maxHp: protection ? 100 : 100000, defense: 50 }), two = side("b", { critRate: 100, critDamage: 200 });
    if (protection) for (const card of one) card.collectible = { id: card.cardId, collectibleNo: card.cardId, name: "保护", imageUrl: "", battleEffectDescription: "", battleEffectType: protection, battleEffectValue: 1 };
    opening(one[0]!, [effect("shield_all", 10000, 3)]);
    opening(two[0]!, [effect("attack_skill_damage_self", 50, 1), effect("damage_true_all", 100)]);
    const result = simulateCardBattle(inputs(one, two), "true-protection");
    const hit = result.events.find(e => e.effectType === "damage_true_all")!;
    for (const target of hit.effects) {
      assert.equal(target.critical, true); assert.equal(target.shieldDamage, 0);
      if (protection) assert.equal(target.hpDamage, protection === "invincible" ? 0 : 99);
      else assert.ok(target.hpDamage! >= 244 && target.hpDamage! <= 256);
    }
    assert.ok(hit.states.filter(s => s.seat === 1).every(s => s.shield === 10000 && s.alive));
  }
});

test("BOSS战友军范围包含队友，护盾触发队友羁绊，回放快照保留盾值", () => {
  const one = side("a").slice(0, 3), teammate = side("c").slice(0, 3), boss = side("b");
  opening(one[0]!, [effect("shield_all", 200, 2), effect("dodge_front", 20, 2), effect("hit_rear", 30, 2)]);
  teammate[0]!.tier.bonds = [{ cardNos: ["c1"], event: "shielded", actions: [{ type: "attack_up", target: "trigger", value: 7, duration: 1 }] }];
  const players: CardBattlePlayerInput[] = [{ userId: "u1", nickname: "a", seat: 1, cards: one }, { userId: "u3", nickname: "c", seat: 1, cards: teammate }, { userId: "boss", nickname: "b", seat: 2, cards: boss }];
  const result = simulateCardBattle(players, "team-shield", "boss");
  const shield = result.events.find(e => e.effectType === "shield_all")!;
  assert.equal(shield.effects.length, 6);
  assert.ok(result.events.some(e => e.bond?.ownerId === "c1"));
  for (const [type, row] of [["dodge_front", "front"], ["hit_rear", "rear"]] as const) {
    const event = result.events.find(e => e.effectType === type)!;
    assert.equal(event.effects.length, event.states.filter(s => s.seat === 1 && s.row === row).length);
    assert.ok(event.effects.every(h => event.states.some(s => s.instanceId === h.targetId && s.seat === 1 && s.row === row)));
  }
  const restored = JSON.parse(JSON.stringify(result));
  assert.deepEqual(restored.events.find((e: { effectType?: string }) => e.effectType === "shield_all").states.map((s: { shield?: number }) => s.shield), shield.states.map(s => s.shield));
  assert.deepEqual(result, simulateCardBattle(players, "team-shield", "boss"));
});
