import { isCardBattleTrueDamage } from "@hgt/shared";
import assert from "node:assert/strict";
import test from "node:test";
import { cardBattleDebuffCodes } from "./cardBattleStatus.js";

test("全部38种减益必须填写1至100的比例及持续回合", () => {
  assert.equal(cardBattleDebuffCodes.length, 38);
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
import { isCardBattleDamageEffect, isCardBattleAttachedOnly } from "@hgt/shared";
import { cardBattleEffectCodes } from "./cardBattle.js";
import { bossCardSchema } from "./cardBattleBossRules.js";

test("战斗开始前可作为无阈值技能条件", () => {
  const effect = { order: 0, condition: "battle_start", conditionValue: null,
    type: "defense_self", value: 10, duration: 1 };
  assert.equal(cardBattleEffectSchema.safeParse(effect).success, true);
  assert.equal(cardBattleConditionNeedsValue("battle_start"), false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...effect, conditionValue: 50 }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...effect, type: "revive_self", value: null, duration: null }).success, false);
});

test("只有恢复自身能量允许负数，主技能和附加效果均可配置", () => {
  const energy = { order: 0, condition: "energy_full", conditionValue: null, type: "energy_self", value: -10, duration: null };
  assert.equal(cardBattleEffectSchema.safeParse(energy).success, true);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, value: 10 }).success, true);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, value: 0 }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, value: -1_000_000_001 }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, type: "energy_all_allies" }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, type: "damage_single" }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, type: "heal_self" }).success, false);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, type: "energy_all_allies", value: 10,
    additionalEffects: [{ type: "energy_self", value: -7, duration: null }] }).success, true);
  assert.equal(cardBattleEffectSchema.safeParse({ ...energy, type: "energy_all_allies", value: 10,
    additionalEffects: [{ type: "energy_lowest_ally", value: -7, duration: null }] }).success, false);
});

test("自身能量负值保存后读取保持原值", async () => {
  const tierRows: Record<string, unknown>[] = [];
  const effectRows: Record<string, unknown>[] = [];
  const db = { query: async (sql: string, args: unknown[] = []) => {
    const insert = sql.match(/INSERT INTO (asset_card_battle_tiers|asset_card_battle_effects)\s*\(([^)]+)\)/);
    if (insert) {
      const columns = insert[2]!.split(",").map((column) => column.trim());
      (insert[1] === "asset_card_battle_tiers" ? tierRows : effectRows).push(Object.fromEntries(columns.map((column, index) => [column, args[index]])));
    }
    if (sql.startsWith("SELECT * FROM asset_card_battle_tiers")) return [tierRows];
    if (sql.startsWith("SELECT * FROM asset_card_battle_effects")) return [effectRows];
    return [[]];
  } } as unknown as PoolConnection;
  const tiers = defaultCardBattleTiers().map((tier, star) => ({ ...tier, effects: star !== 0 ? [] : [
    { order: 0, condition: "energy_full" as const, conditionValue: null,
      type: "energy_self" as const, value: -10, duration: null,
      additionalEffects: [{ type: "energy_self" as const, value: -5, duration: null }] },
  ] }));
  await saveCardBattleTiers("signed-energy-card", tiers, db);
  assert.equal(effectRows[0]!.effect_value, -10);
  assert.equal(JSON.parse(String(effectRows[0]!.additional_effects))[0].value, -5);
  const loaded = await loadCardBattleTiers("signed-energy-card", db);
  assert.equal(loaded[0]!.effects[0]!.value, -10);
  assert.equal(loaded[0]!.effects[0]!.additionalEffects?.[0]?.value, -5);
});

test("复制零星技能的重复ID可保存，重复提交不丢失星级、顺序及附加效果", async () => {
  const rows = new Map<string, unknown[]>();
  const db = { query: async (sql: string, args: unknown[]) => {
    if (sql.startsWith("DELETE FROM asset_card_battle_effects")) rows.clear();
    if (sql.includes("INSERT INTO asset_card_battle_effects")) {
      const id = String(args[0]);
      assert.ok(!rows.has(id), `Duplicate entry '${id}' for key 'asset_card_battle_effects.PRIMARY'`);
      rows.set(id, args);
    }
    return [[]];
  } } as unknown as PoolConnection;
  const tiers = defaultCardBattleTiers().map((tier) => ({ ...tier, effects: [
    { id: "copied-effect", order: 1, condition: "energy_full" as const, conditionValue: null,
      type: "damage_single" as const, value: 100 + tier.starLevel, duration: null,
      additionalEffects: [{ id: "addition", type: "heal_self" as const, value: 30, duration: null }] },
    { id: `unique-${tier.starLevel}`, order: 0, condition: "self_death" as const, conditionValue: null,
      type: "damage_all" as const, value: 50, duration: null },
  ] }));
  const original = structuredClone(tiers);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await saveCardBattleTiers("card", tiers, db);
    assert.equal(rows.size, 8);
    for (const tier of tiers) {
      const saved = [...rows.values()].filter(row => row[2] === tier.starLevel);
      assert.deepEqual(saved.map(row => [row[3], row[6], row[7]]), [[0, "damage_all", 50], [1, "damage_single", 100 + tier.starLevel]]);
      assert.deepEqual(JSON.parse(String(saved[1]![11])), tier.effects[0]!.additionalEffects);
      assert.ok(rows.has(`unique-${tier.starLevel}`));
    }
    assert.ok(rows.has("copied-effect"));
    assert.deepEqual(tiers, original, "保存不能修改调用方的编辑数据");
  }
});

test("所有直接伤害技能默认忽防0%，允许0至100%的两位小数，非伤害技能不能配置忽防", () => {
  const damageTypes = cardBattleEffectCodes.filter(type => isCardBattleDamageEffect(type) && !isCardBattleTrueDamage(type));
  assert.ok(damageTypes.length >= 9);
  for (const type of damageTypes) {
    const effect = { order: 0, condition: "energy_full", conditionValue: null, type, value: 800, duration: null };
    assert.equal(cardBattleEffectSchema.parse(effect).ignoreDefensePercent, 0, type);
    assert.equal(cardBattleEffectNeedsValue(type), true, type);
    for (const ignoreDefensePercent of [0, 0.01, 12.25, 50, 99.99, 100]) {
      assert.equal(cardBattleEffectSchema.parse({ ...effect, ignoreDefensePercent }).ignoreDefensePercent, ignoreDefensePercent, type);
    }
    for (const ignoreDefensePercent of [-1, 100.01, 1.001, NaN, Infinity, null, "50"]) {
      assert.equal(cardBattleEffectSchema.safeParse({ ...effect, ignoreDefensePercent }).success, false, `${type}: ${ignoreDefensePercent}`);
    }
  }
  for (const type of cardBattleEffectCodes.filter((type) => !isCardBattleDamageEffect(type) && !isCardBattleAttachedOnly(type))) {
    const effect = { order: 0, condition: "self_death", conditionValue: null, type,
      value: cardBattleEffectNeedsValue(type) ? 25 : null, duration: cardBattleEffectNeedsDuration(type) ? 2 : null };
    assert.equal(cardBattleEffectSchema.safeParse(effect).success, true, type);
    assert.equal(cardBattleEffectSchema.safeParse({ ...effect, ignoreDefensePercent: 50 }).success, false, type);
  }
  assert.equal(isCardBattleDamageEffect("damage_future_target"), true);
  assert.equal(cardBattleEffectNeedsValue("damage_future_target"), true);
  assert.equal(isCardBattleDamageEffect("attack_skill_damage_self"), false);
});

test("忽防比例按星级和技能行持久化，读取保留0%、小数、100%并兼容旧记录", async () => {
  const tierRows: Record<string, unknown>[] = [];
  const effectRows: Record<string, unknown>[] = [];
  const db = { query: async (sql: string, args: unknown[] = []) => {
    const insert = sql.match(/INSERT INTO (asset_card_battle_tiers|asset_card_battle_effects)\s*\(([^)]+)\)/);
    if (insert) {
      const columns = insert[2]!.split(",").map((column) => column.trim());
      assert.equal(columns.length, args.length);
      (insert[1] === "asset_card_battle_tiers" ? tierRows : effectRows).push(Object.fromEntries(columns.map((column, index) => [column, args[index]])));
    }
    if (sql.startsWith("SELECT * FROM asset_card_battle_tiers")) return [tierRows];
    if (sql.startsWith("SELECT * FROM asset_card_battle_effects")) return [effectRows];
    return [[]];
  } } as unknown as PoolConnection;
  const percentages = [undefined, 0, 12.25, 100];
  const tiers = defaultCardBattleTiers().map((tier, star) => ({ ...tier, effects: [
    { order: 0, condition: "energy_full" as const, conditionValue: null, type: "damage_all" as const,
      value: 800, duration: null, ignoreDefensePercent: percentages[star] },
    { order: 1, condition: "energy_full" as const, conditionValue: null, type: "damage_single" as const,
      value: 400, duration: null, ignoreDefensePercent: 25.5 },
  ] }));
  await saveCardBattleTiers("card", tiers, db);
  // mysql2 returns DECIMAL columns as strings.
  for (const row of effectRows) row.ignore_defense_percent = Number(row.ignore_defense_percent).toFixed(2);
  let loaded = await loadCardBattleTiers("card", db);
  assert.deepEqual(loaded.map((tier) => tier.effects.map((effect) => effect.ignoreDefensePercent)), [[0, 25.5], [0, 25.5], [12.25, 25.5], [100, 25.5]]);
  delete effectRows[0]!.ignore_defense_percent;
  loaded = await loadCardBattleTiers("card", db);
  assert.equal(loaded[0]!.effects[0]!.ignoreDefensePercent, 0);
  const boss = { name: "BOSS", imageUrl: `/api/online-soup/card-battle-boss/covers/${"a".repeat(64)}`, tier: loaded[3] };
  assert.equal(bossCardSchema.parse(boss).tier.effects[0]!.ignoreDefensePercent, 100);
  assert.equal(bossCardSchema.safeParse({ ...boss, tier: { ...loaded[3], effects: [{ ...loaded[3]!.effects[0], ignoreDefensePercent: 101 }] } }).success, false);
});

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
  assert.ok(inserts.every((args) => args.length === 19 && args[10] === 0 && args[11] === 175.25 && args[18] === 0));
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
