import assert from "node:assert/strict";
import test from "node:test";
import { applyBattleCollectibleStats } from "@hgt/shared";
import { cardBattleEffectCodes, simulateCardBattle, type CardBattlePlayerInput, type CardBattleSkillEffect } from "./cardBattle.js";
import { defaultCardBattleTiers } from "./cardBattleConfig.js";
import { applyCardBattleCollectionStats, applyCardBattleCollectionTier, applyCardBattlePlayerCollection, type CardBattleCollectionBonus } from "./cardBattleCollection.js";

const bonus = (completePackCount = 10, threeStarLegendCount = 2, cardIds = ["a"]): CardBattleCollectionBonus => ({ completePackCount, threeStarLegendCount, threeStarPackCardIds: new Set(cardIds) });
const base = () => ({ ...defaultCardBattleTiers()[0]!, maxHp: 1000, attack: 100, defense: 100, speed: 100 });

test("全局与本包百分比加法累计，跨包3%只一次，暴伤按百分点且无上限", () => {
  const stats = applyCardBattleCollectionStats(base(), "a", bonus(10, 2, ["a", "a"]));
  assert.deepEqual([stats.maxHp, stats.attack, stats.defense, stats.speed, stats.critDamage], [1080, 108, 108, 108, 154]);
  assert.equal(applyCardBattleCollectionStats(base(), "b", bonus()).attack, 105);
  assert.equal(applyCardBattleCollectionStats(base(), "b", bonus(1, 0, [])).attack, 101, "0.5临界四舍五入，不受1.005浮点误差影响");
  assert.equal(applyCardBattleCollectionStats({ ...base(), attack: 0, critDamage: 150.25 }, "a", bonus()).critDamage, 154.25);
  assert.equal(applyCardBattleCollectionStats({ ...base(), attack: 0 }, "a", bonus()).attack, 0);
  assert.equal(applyCardBattleCollectionStats(base(), "a", bonus(1000, 6000)).critDamage, 12150);
  assert.deepEqual(applyCardBattleCollectionStats(base(), "a", bonus(0, 0, [])), base());
});

test("收藏百分比先取整再叠加收藏品，不改变能量及其他概率", () => {
  const stats = applyBattleCollectibleStats(applyCardBattleCollectionStats(base(), "a", bonus()), {
    battleEffectType: "attack", battleEffectValue: 50, battleEffectDescription: "",
  });
  assert.equal(stats.attack, 158);
  for (const key of ["energyRequired", "critRate", "lifestealRate", "stunRate", "extraActionRate", "dodgeRate", "hitRate"] as const) assert.equal(stats[key], base()[key]);
});

test("所有目标范围的伤害含真伤、治疗、四属性及复合增益的主附加技能数值参与，其他字段和羁绊保持原值", () => {
  const expected = new Set([
    "heal_self", "heal_lowest_ally", "heal_all_allies", "max_hp_self", "max_hp_all_allies",
    "defense_self", "defense_all_allies", "speed_self", "speed_all_allies", "attack_self", "attack_all_allies",
    "attack_skill_damage_self", "attack_skill_damage_all_allies",
  ]);
  const actions = cardBattleEffectCodes.map((type, order): CardBattleSkillEffect => ({
    id: type, type, order, condition: "self_hp_below_percent", conditionValue: 50,
    value: 100, duration: 3, probability: 25, ignoreDefensePercent: 40,
  }));
  const tier = { ...base(), effects: actions.map(action => ({ ...action, additionalEffects: actions })),
    bonds: [{ cardNos: ["001"], event: "energy_empty" as const, actions: [{ type: "attack_up" as const, target: "self" as const, value: 100, duration: 3 }] }],
  };
  const before = structuredClone(tier);
  const result = applyCardBattleCollectionTier(tier, "a", bonus());
  for (const effect of result.effects) {
    assert.equal(effect.value, effect.type.startsWith("damage_") || expected.has(effect.type) ? 108 : 100, effect.type);
    assert.deepEqual({ ...effect, value: 100, additionalEffects: undefined }, { ...actions[effect.order], additionalEffects: undefined });
    for (const attached of effect.additionalEffects!) assert.equal(attached.value, attached.type.startsWith("damage_") || expected.has(attached.type) ? 108 : 100, attached.type);
  }
  assert.deepEqual(result.bonds, before.bonds);
  assert.deepEqual(tier, before, "不修改基础配置");
  const nullable = { ...base(), effects: [{ ...actions[0]!, value: null }] };
  assert.equal(applyCardBattleCollectionTier(nullable, "a", bonus()).effects[0]!.value, null);
});

function player(userId: string, seat: 1 | 2, size = 5): CardBattlePlayerInput {
  return { userId, nickname: userId, seat, cards: Array.from({ length: size }, (_, index) => ({
    cardId: index === 0 ? "a" : `card-${index}`, cardNo: String(index + 1), name: "卡", imageUrl: "", rarity: "legend", battleRole: "damage", starLevel: 0,
    instanceId: `${userId}:${index}`, slot: (index + 1) as 1 | 2 | 3 | 4 | 5,
    motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null, tier: base(),
  })) };
}

test("冻结与重赛从原配置重新计算，重复调用不累乘，旧快照兼容", () => {
  const original = player("owner", 1);
  const frozen = applyCardBattlePlayerCollection(original, bonus());
  const snapshot = JSON.parse(JSON.stringify(frozen)) as CardBattlePlayerInput;
  assert.deepEqual(applyCardBattlePlayerCollection(snapshot, bonus()), snapshot);
  const next = applyCardBattlePlayerCollection(snapshot, bonus(0, 0, []));
  assert.equal(next.cards[0]!.tier.attack, 100);
  assert.equal(snapshot.cards[0]!.tier.attack, 108);
  assert.equal(original.cards[0]!.tier.attack, 100);
});

test("普通、BOSS、闯关均使用冻结属性；同款卡按拥有者独立计算，系统敌方不继承", () => {
  for (const mode of ["1v1", "boss", "tower"] as const) {
    const owner = applyCardBattlePlayerCollection(player("owner", 1, mode === "boss" ? 3 : 5), bonus());
    const opponent = player("opponent", 2);
    const team = mode === "boss" ? [owner, applyCardBattlePlayerCollection({ ...player("ally", 1, 3), playerSeat: 2 }, bonus(0, 0, [])), opponent] : [owner, opponent];
    const result = simulateCardBattle(team, "collection", mode);
    const initial = result.initialStates.find(card => card.instanceId === "owner:0")!;
    assert.equal(initial.maxHp, 1080);
    assert.equal(initial.critDamage, 154);
    assert.equal(result.initialStates.find(card => card.instanceId === "opponent:0")!.maxHp, 1000);
    if (mode === "boss") assert.equal(result.initialStates.find(card => card.instanceId === "ally:0")!.maxHp, 1000);
    assert.deepEqual(result, simulateCardBattle(team, "collection", mode));
  }
});

test("战斗执行加成后的主伤害、附加攻击与技能伤害，羁绊触发技能不重复放大", () => {
  const owner = player("owner", 1);
  const opponent = player("opponent", 2);
  for (const card of [...owner.cards, ...opponent.cards]) Object.assign(card.tier, { maxHp: 100000, defense: 0, attack: 0, critRate: 0 });
  const caster = owner.cards[0]!;
  caster.tier.effects = [{ id: "damage", order: 0, condition: "energy_full", conditionValue: null, type: "damage_single", value: 1000, duration: null,
    additionalEffects: [{ type: "attack_skill_damage_self", value: 100, duration: 3 }] }];
  caster.tier.bonds = [{ cardNos: [caster.cardNo!], event: "energy_empty", actions: [{ type: "skill", target: "self", value: null, duration: null }] }];
  const result = simulateCardBattle([applyCardBattlePlayerCollection(owner, bonus()), opponent], "collection-skill");
  const damage = result.events.find(event => event.actorId === "owner:0" && event.visual === "damage")!;
  assert.ok(damage);
  assert.ok(-damage.effects[0]!.amount! >= 1058 && -damage.effects[0]!.amount! <= 1102, "1080基础伤害，仅叠加既有98%-102%浮动");
  const buff = result.events.find(event => event.actorId === "owner:0" && event.effects.some(effect => effect.amount === 108))!;
  assert.ok(buff, "组合技能实际使用108点而非原始100点");
  const statuses = buff.states.find(card => card.instanceId === "owner:0")!.statuses!;
  assert.ok(statuses.some(status => status.type === "attack_up" && status.value === 108));
  assert.ok(statuses.some(status => status.type === "skill_damage_up" && status.value === 108));
});
