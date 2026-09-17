import { CARD_BATTLE_PROC_DEBUFF_CODES } from "@hgt/shared";

export const cardBattleDebuffCodes = [
  ...CARD_BATTLE_PROC_DEBUFF_CODES,
  "speed_down_single", "speed_down_random", "speed_down_all", "speed_down_front", "speed_down_rear",
  "max_hp_down_single", "max_hp_down_random", "max_hp_down_all", "max_hp_down_front", "max_hp_down_rear",
  "defense_down_single", "defense_down_random", "defense_down_all", "defense_down_front", "defense_down_rear",
  "healing_received_down_single", "healing_received_down_random", "healing_received_down_all", "healing_received_down_front", "healing_received_down_rear",
  "attack_skill_damage_down_single", "attack_skill_damage_down_random", "attack_skill_damage_down_all", "attack_skill_damage_down_front", "attack_skill_damage_down_rear",
] as const;

export const cardBattleStatusOrder = [
  "shield", "dodge_up", "hit_up", "crit_rate_up", "crit_damage_up", "attack_up", "skill_damage_up", "max_hp_up", "defense_up", "speed_up",
  "speed_down", "attack_skill_damage_down", "defense_down", "max_hp_down", "healing_received_down",
  "debuff_resistance", "invincible", "death_protection",
  "lifesteal_up", "stun_up", "extra_action_up", "counter_up", "lifesteal_down", "stun_down", "extra_action_down", "counter_down", "stunned", "immunity", "revival_block",
] as const;
export type CardBattleStatusType = typeof cardBattleStatusOrder[number];
export type CardBattleStatus = {
  type: CardBattleStatusType;
  category?: import("@hgt/shared").CardBattleStatusCategory;
  value: number;
  remainingRounds: number | null;
  multiplier: number;
  flat?: boolean;
};

const debuffSet = new Set<string>(cardBattleDebuffCodes);
export function isCardBattleDebuff(type: string): type is typeof cardBattleDebuffCodes[number] {
  return debuffSet.has(type);
}

export function cardBattleDebuff(type: string) {
  if (!isCardBattleDebuff(type)) return null;
  const split = type.lastIndexOf("_");
  const status = type.slice(0, split) as Extract<CardBattleStatusType, `${string}_down`>;
  const target = type.slice(split + 1) as "single" | "random" | "all" | "front" | "rear";
  const label = { speed_down: "速度", max_hp_down: "生命上限", defense_down: "防御", healing_received_down: "受治疗量", attack_skill_damage_down: "攻击与技能伤害", lifesteal_down: "吸血比例", stun_down: "击晕概率", counter_down: "反击率", extra_action_down: "再动概率" }[status];
  return { status, target, label };
}
