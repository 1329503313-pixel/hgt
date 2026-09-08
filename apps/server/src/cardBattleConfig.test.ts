import assert from "node:assert/strict";
import test from "node:test";
import { cardBattleDebuffCodes } from "./cardBattleStatus.js";

test("全部37种减益必须填写1至100的比例及持续回合", () => {
  assert.equal(cardBattleDebuffCodes.length, 37);
  for (const type of cardBattleDebuffCodes) {
    const effect = { order: 0, condition: "energy_full", conditionValue: null, type, value: 25, duration: 2 };
    assert.equal(cardBattleEffectSchema.safeParse(effect).success, true, type);
    for (const value of [null, 0, 101]) assert.equal(cardBattleEffectSchema.safeParse({ ...effect, value }).success, false);
    for (const duration of [null, 0]) assert.equal(cardBattleEffectSchema.safeParse({ ...effect, duration }).success, false);
    assert.equal(cardBattleEffectNeedsDuration(type), true);
    assert.equal(cardBattleEffectNeedsValue(type), true);
  }
});
import {
  cardBattleConditionNeedsValue,
  cardBattleEffectNeedsDuration,
  cardBattleEffectNeedsValue,
  cardBattleEffectSchema,
  cardBattleTiersSchema,
  defaultCardBattleTiers,
  loadCardBattleTiers,
  saveCardBattleTiers,
} from "./cardBattleConfig.js";
import type { PoolConnection } from "mysql2/promise";

test("所有品质四星级默认25%/150%，百分比范围和精度受校验", () => {
  for (const rarity of ["epic", "legend"] as const) {
    const tiers = defaultCardBattleTiers(rarity);
    assert.ok(tiers.every((tier) => tier.critRate === 25 && tier.critDamage === 150));
    for (const critRate of [0, 25.25, 100]) assert.equal(cardBattleTiersSchema.safeParse(tiers.map((tier) => ({ ...tier, critRate }))).success, true);
    for (const critRate of [-1, 100.01, NaN]) assert.equal(cardBattleTiersSchema.safeParse(tiers.map((tier) => ({ ...tier, critRate }))).success, false);
    assert.equal(cardBattleTiersSchema.safeParse(tiers.map((tier) => ({ ...tier, critDamage: 99 }))).success, false);
  }
});

test("配置持久化写入暴击字段，读取保留0%和百分比小数", async () => {
  const inserts: unknown[][] = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes("INSERT INTO asset_card_battle_tiers")) inserts.push(args);
    if (sql.startsWith("SELECT * FROM asset_card_battle_tiers")) return [[{ star_level: 0, max_hp: 1000, attack_value: 100, defense_value: 10, speed_value: 80, energy_required: 40, crit_rate: "0.00", crit_damage: "175.25" }]];
    return [[]];
  } } as unknown as PoolConnection;
  await saveCardBattleTiers("card", defaultCardBattleTiers().map((tier) => ({ ...tier, critRate: 0, critDamage: 175.25 })), db);
  assert.equal(inserts.length, 4);
  assert.ok(inserts.every((args) => args.length === 15 && args[10] === 0 && args[11] === 175.25));
  const loaded = await loadCardBattleTiers("card", db);
  assert.equal(loaded[0]!.critRate, 0);
  assert.equal(loaded[0]!.critDamage, 175.25);
});

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
