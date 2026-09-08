import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  cardBattleConditionCodes,
  cardBattleEffectCodes,
  type CardBattleSkillEffect,
  type CardBattleTier,
} from "./cardBattle.js";
import { pool } from "./db.js";
import { cardBattleDebuffCodes, isCardBattleDebuff } from "./cardBattleStatus.js";
import { CARD_BATTLE_PROC_BUFF_CODES, cardBattleProcStat } from "@hgt/shared";

const numericValueEffects = new Set([
  ...CARD_BATTLE_PROC_BUFF_CODES,
  ...cardBattleDebuffCodes,
  "damage_single", "damage_rear", "damage_random", "damage_all_front", "damage_all_rear",
  "damage_random_2", "damage_random_3", "damage_random_4", "damage_all",
  "heal_self", "heal_lowest_ally", "energy_self", "energy_lowest_ally", "heal_all_allies", "energy_all_allies",
  "defense_self", "defense_all_allies", "speed_self", "speed_all_allies", "max_hp_self", "max_hp_all_allies",
  "attack_self", "attack_all_allies",
  "attack_skill_damage_self", "attack_skill_damage_all_allies",
]);
const durationEffects = new Set([
  ...CARD_BATTLE_PROC_BUFF_CODES,
  ...cardBattleDebuffCodes,
  "attack_self", "attack_all_allies", "defense_self", "defense_all_allies", "speed_self", "speed_all_allies",
  "attack_skill_damage_self", "attack_skill_damage_all_allies",
]);
const thresholdConditions = new Set(["self_hp_below_percent", "self_hp_below_percent_energy_full"]);
const selfDeathConditions = new Set(["self_death", "self_death_energy_full"]);

export const cardBattleEffectSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  order: z.number().int().min(0).max(999),
  condition: z.enum(cardBattleConditionCodes),
  conditionValue: z.number().int().min(1).max(100).nullable(),
  type: z.enum(cardBattleEffectCodes),
  value: z.number().int().min(1).max(1_000_000_000).nullable(),
  duration: z.number().int().min(1).max(30).nullable(),
}).superRefine((value, context) => {
  if (cardBattleProcStat(value.type) && (value.value == null || value.value > 100)) {
    context.addIssue({ code: "custom", path: ["value"], message: "吸血、击晕与再动属性技能必须填写1-100" });
  }
  if (isCardBattleDebuff(value.type) && (value.value == null || value.value > 100)) {
    context.addIssue({ code: "custom", path: ["value"], message: "减益比例必须填写1-100（%）" });
  }
  if (thresholdConditions.has(value.condition) && value.conditionValue == null) {
    context.addIssue({ code: "custom", path: ["conditionValue"], message: "生命值百分比条件必须填写 1-100" });
  }
  if (!thresholdConditions.has(value.condition) && value.conditionValue != null) {
    context.addIssue({ code: "custom", path: ["conditionValue"], message: "当前条件不需要条件数值" });
  }
  if (numericValueEffects.has(value.type) && value.value == null) {
    context.addIssue({ code: "custom", path: ["value"], message: "当前技能类型必须填写技能数值" });
  }
  if (!numericValueEffects.has(value.type) && value.value != null) {
    context.addIssue({ code: "custom", path: ["value"], message: "当前技能类型不需要技能数值" });
  }
  if (durationEffects.has(value.type) && value.duration == null) {
    context.addIssue({ code: "custom", path: ["duration"], message: "属性提升与所有减益状态必须填写持续回合" });
  }
  if (!durationEffects.has(value.type) && value.duration != null) {
    context.addIssue({ code: "custom", path: ["duration"], message: "当前技能类型不需要持续回合" });
  }
  if (value.type === "revive_self" && !selfDeathConditions.has(value.condition)) {
    context.addIssue({ code: "custom", path: ["type"], message: "复活自己只能绑定本卡片死亡条件" });
  }
});

export const cardBattleTierSchema = z.object({
  starLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  maxHp: z.number().int().min(1).max(1_000_000_000),
  attack: z.number().int().min(0).max(1_000_000_000),
  defense: z.number().int().min(0).max(1_000_000_000),
  speed: z.number().int().min(0).max(1_000_000_000),
  energyRequired: z.number().int().min(1).max(1_000_000),
  critRate: z.number().min(0).max(100).multipleOf(.01).default(25),
  critDamage: z.number().min(100).max(10000).multipleOf(.01).default(150),
  lifestealRate: z.number().min(0).max(100).multipleOf(.01).default(0),
  stunRate: z.number().min(0).max(100).multipleOf(.01).default(0),
  extraActionRate: z.number().min(0).max(100).multipleOf(.01).default(0),
  canAttackRear: z.boolean(),
  skillName: z.string().trim().max(50),
  skillDescription: z.string().trim().max(500),
  effects: z.array(cardBattleEffectSchema).max(50),
});

export const cardBattleTiersSchema = z.array(cardBattleTierSchema).length(4).superRefine((tiers, context) => {
  const stars = new Set(tiers.map((tier) => tier.starLevel));
  if (stars.size !== 4 || ![0, 1, 2, 3].every((star) => stars.has(star as 0 | 1 | 2 | 3))) {
    context.addIssue({ code: "custom", message: "必须完整配置 0-3 星四层战斗数值" });
  }
  if (new Set(tiers.map((tier) => tier.skillName.trim())).size > 1) {
    context.addIssue({ code: "custom", path: [0, "skillName"], message: "0-3 星必须使用同一个技能名称" });
  }
  for (const [tierIndex, tier] of tiers.entries()) {
    const orders = new Set<number>();
    for (const [effectIndex, effect] of tier.effects.entries()) {
      if (orders.has(effect.order)) context.addIssue({ code: "custom", path: [tierIndex, "effects", effectIndex, "order"], message: "同星级技能顺序不能重复" });
      orders.add(effect.order);
    }
  }
});

export const defaultCardBattleTiers = (rarity: "epic" | "legend" = "legend"): CardBattleTier[] => rarity === "epic" ? [
  { starLevel: 0, maxHp: 800, attack: 250, defense: 30, speed: 80, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 1, maxHp: 1200, attack: 375, defense: 60, speed: 95, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 2, maxHp: 1500, attack: 500, defense: 90, speed: 110, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 3, maxHp: 1900, attack: 625, defense: 120, speed: 125, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
] : [
  { starLevel: 0, maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 1, maxHp: 1500, attack: 750, defense: 150, speed: 150, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 2, maxHp: 2000, attack: 1000, defense: 200, speed: 200, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 3, maxHp: 3000, attack: 1500, defense: 300, speed: 300, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, skillName: "", skillDescription: "", effects: [] },
];

export type CardBattleTierInput = Omit<CardBattleTier, "effects"> & {
  effects: Array<Omit<CardBattleSkillEffect, "id"> & { id?: string }>;
};

export async function loadCardBattleTiers(cardId: string, db: mysql.Pool | mysql.PoolConnection = pool): Promise<CardBattleTier[]> {
  const [tierRows] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM asset_card_battle_tiers WHERE card_id = ? ORDER BY star_level ASC",
    [cardId],
  );
  if (!tierRows.length) return [];
  const [effectRows] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM asset_card_battle_effects WHERE card_id = ? ORDER BY star_level ASC, effect_order ASC",
    [cardId],
  );
  return tierRows.map((row) => ({
    starLevel: Number(row.star_level) as 0 | 1 | 2 | 3,
    maxHp: Number(row.max_hp),
    attack: Number(row.attack_value),
    defense: Number(row.defense_value),
    speed: Number(row.speed_value),
    energyRequired: Number(row.energy_required),
    critRate: Number(row.crit_rate ?? 25),
    critDamage: Number(row.crit_damage ?? 150),
    lifestealRate: Number(row.lifesteal_rate ?? 0),
    stunRate: Number(row.stun_rate ?? 0),
    extraActionRate: Number(row.extra_action_rate ?? 0),
    canAttackRear: Boolean(row.can_attack_rear),
    skillName: String(row.skill_name ?? ""),
    skillDescription: String(row.skill_description ?? ""),
    effects: effectRows.filter((effect) => Number(effect.star_level) === Number(row.star_level)).map((effect): CardBattleSkillEffect => ({
      id: String(effect.id),
      order: Number(effect.effect_order),
      condition: String(effect.condition_code) as CardBattleSkillEffect["condition"],
      conditionValue: effect.condition_value == null ? null : Number(effect.condition_value),
      type: String(effect.effect_code) as CardBattleSkillEffect["type"],
      value: effect.effect_value == null ? null : Number(effect.effect_value),
      duration: effect.duration_rounds == null ? null : Number(effect.duration_rounds),
    })),
  }));
}

export async function saveCardBattleTiers(cardId: string, tiers: CardBattleTierInput[], db: mysql.PoolConnection) {
  const sharedSkillName = tiers[0]?.skillName.trim() || null;
  await db.query("DELETE FROM asset_card_battle_effects WHERE card_id = ?", [cardId]);
  await db.query("DELETE FROM asset_card_battle_tiers WHERE card_id = ?", [cardId]);
  for (const tier of [...tiers].sort((left, right) => left.starLevel - right.starLevel)) {
    await db.query(
      `INSERT INTO asset_card_battle_tiers
        (card_id, star_level, max_hp, attack_value, defense_value, speed_value, energy_required, can_attack_rear, skill_name, skill_description, crit_rate, crit_damage, lifesteal_rate, stun_rate, extra_action_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cardId, tier.starLevel, tier.maxHp, tier.attack, tier.defense, tier.speed, tier.energyRequired,
        tier.canAttackRear ? 1 : 0, sharedSkillName, tier.skillDescription || null, tier.critRate ?? 25, tier.critDamage ?? 150,
        tier.lifestealRate ?? 0, tier.stunRate ?? 0, tier.extraActionRate ?? 0],
    );
    for (const [index, effect] of [...tier.effects].sort((left, right) => left.order - right.order).entries()) {
      await db.query(
        `INSERT INTO asset_card_battle_effects
          (id, card_id, star_level, effect_order, condition_code, condition_value, effect_code, effect_value, duration_rounds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [effect.id || nanoid(), cardId, tier.starLevel, index, effect.condition, effect.conditionValue,
          effect.type, effect.value, effect.duration],
      );
    }
  }
}

export const cardBattleEffectNeedsValue = (type: string) => numericValueEffects.has(type);
export const cardBattleEffectNeedsDuration = (type: string) => durationEffects.has(type);
export const cardBattleConditionNeedsValue = (condition: string) => thresholdConditions.has(condition);
