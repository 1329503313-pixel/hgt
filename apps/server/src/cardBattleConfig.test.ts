import assert from "node:assert/strict";
import test from "node:test";
import {
  cardBattleConditionNeedsValue,
  cardBattleEffectNeedsDuration,
  cardBattleEffectNeedsValue,
  cardBattleEffectSchema,
  cardBattleTiersSchema,
  defaultCardBattleTiers,
} from "./cardBattleConfig.js";

test("历史传说卡的四层默认战斗值完全符合产品约定", () => {
  assert.deepEqual(defaultCardBattleTiers().map(({ maxHp, attack, defense, speed, energyRequired, canAttackRear }) => (
    { maxHp, attack, defense, speed, energyRequired, canAttackRear }
  )), [
    { maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50, canAttackRear: false },
    { maxHp: 1500, attack: 750, defense: 150, speed: 150, energyRequired: 50, canAttackRear: false },
    { maxHp: 2000, attack: 1000, defense: 200, speed: 200, energyRequired: 50, canAttackRear: false },
    { maxHp: 3000, attack: 1500, defense: 300, speed: 300, energyRequired: 50, canAttackRear: false },
  ]);
  assert.equal(cardBattleTiersSchema.safeParse(defaultCardBattleTiers()).success, true);
});

test("史诗卡的四层默认战斗值完全符合产品约定", () => {
  assert.deepEqual(defaultCardBattleTiers("epic").map(({ maxHp, attack, defense, speed, energyRequired, canAttackRear }) => (
    { maxHp, attack, defense, speed, energyRequired, canAttackRear }
  )), [
    { maxHp: 800, attack: 250, defense: 30, speed: 80, energyRequired: 40, canAttackRear: false },
    { maxHp: 1200, attack: 375, defense: 60, speed: 95, energyRequired: 40, canAttackRear: false },
    { maxHp: 1500, attack: 500, defense: 90, speed: 110, energyRequired: 40, canAttackRear: false },
    { maxHp: 1900, attack: 625, defense: 120, speed: 125, energyRequired: 40, canAttackRear: false },
  ]);
  assert.equal(cardBattleTiersSchema.safeParse(defaultCardBattleTiers("epic")).success, true);
});

test("四个星级必须齐全且不能重复", () => {
  const tiers = defaultCardBattleTiers();
  assert.equal(cardBattleTiersSchema.safeParse(tiers.slice(0, 3)).success, false);
  assert.equal(cardBattleTiersSchema.safeParse([...tiers.slice(0, 3), { ...tiers[2]!, effects: [] }]).success, false);
});

test("四个星级共用技能名称，但技能描述和效果保持独立", () => {
  const tiers = defaultCardBattleTiers().map((tier) => ({
    ...tier,
    skillName: "星潮",
    skillDescription: `${tier.starLevel} 星描述`,
  }));
  assert.equal(cardBattleTiersSchema.safeParse(tiers).success, true);
  assert.equal(cardBattleTiersSchema.safeParse(tiers.map((tier) => tier.starLevel === 2 ? { ...tier, skillName: "另一个名字" } : tier)).success, false);
});

test("生命阈值、数值效果和临时增益分别强制所需字段", () => {
  const base = { order: 0, condition: "energy_full" as const, conditionValue: null, type: "damage_single" as const, value: 100, duration: null };
  assert.equal(cardBattleEffectSchema.safeParse(base).success, true);
  assert.equal(cardBattleEffectSchema.safeParse({ ...base, condition: "self_hp_below_percent", conditionValue: null }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...base, type: "revive_self", value: 100 }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...base, type: "attack_all_allies", duration: null }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...base, type: "attack_all_allies", duration: 1 }).success, true);
  assert.equal(cardBattleConditionNeedsValue("self_hp_below_percent_energy_full"), true);
  assert.equal(cardBattleEffectNeedsValue("attack_self"), true);
  assert.equal(cardBattleEffectNeedsValue("revive_all_allies"), false);
  assert.equal(cardBattleEffectNeedsDuration("attack_all_allies"), true);
  assert.equal(cardBattleEffectNeedsValue("attack_skill_damage_self"), true);
  assert.equal(cardBattleEffectNeedsDuration("attack_skill_damage_self"), true);
  assert.equal(cardBattleEffectSchema.safeParse({ ...base, type: "attack_skill_damage_all_allies", duration: 2 }).success, true);
  assert.equal(cardBattleEffectNeedsDuration("max_hp_all_allies"), false);
});

test("复活自己只能绑定本卡片死亡条件，避免满能量时空放技能", () => {
  const invalid = { order: 0, condition: "energy_full" as const, conditionValue: null, type: "revive_self" as const, value: null, duration: null };
  const valid = { ...invalid, condition: "self_death" as const };
  assert.equal(cardBattleEffectSchema.safeParse(invalid).success, false);
  assert.equal(cardBattleEffectSchema.safeParse(valid).success, true);
});
