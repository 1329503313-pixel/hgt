import { CARD_BATTLE_PROC_DEBUFF_LABELS } from "@hgt/shared";
export const CARD_BATTLE_DEBUFF_LABELS = {
  ...CARD_BATTLE_PROC_DEBUFF_LABELS,
  speed_down_single: "降低一名敌方速度", speed_down_random: "降低随机一名敌方速度", speed_down_all: "降低全体敌方速度", speed_down_front: "降低敌方前排速度", speed_down_rear: "降低敌方后排速度",
  max_hp_down_single: "降低一名敌方生命上限", max_hp_down_random: "降低随机一名敌方生命上限", max_hp_down_all: "降低全体敌方生命上限", max_hp_down_front: "降低敌方前排生命上限", max_hp_down_rear: "降低敌方后排生命上限",
  defense_down_single: "降低一名敌方防御力", defense_down_random: "降低随机一名敌方防御力", defense_down_all: "降低全体敌方防御力", defense_down_front: "降低敌方前排防御力", defense_down_rear: "降低敌方后排防御力",
  healing_received_down_single: "降低一名敌方受到治疗量", healing_received_down_random: "降低随机一名敌方受到治疗量", healing_received_down_all: "降低全体敌方受到治疗量", healing_received_down_front: "降低敌方前排受到治疗量", healing_received_down_rear: "降低敌方后排受到治疗量",
  attack_skill_damage_down_single: "降低一名敌方攻击与技能伤害", attack_skill_damage_down_random: "降低随机一名敌方攻击与技能伤害", attack_skill_damage_down_all: "降低全体敌方攻击与技能伤害", attack_skill_damage_down_front: "降低敌方前排攻击与技能伤害", attack_skill_damage_down_rear: "降低敌方后排攻击与技能伤害",
} as const;
export type CardBattleDebuffType = keyof typeof CARD_BATTLE_DEBUFF_LABELS;
export const isCardBattleDebuff = (type: string): type is CardBattleDebuffType => Object.hasOwn(CARD_BATTLE_DEBUFF_LABELS, type);

export const CARD_BATTLE_STATUS_ORDER = ["attack_up", "skill_damage_up", "max_hp_up", "defense_up", "speed_up", "speed_down", "attack_skill_damage_down", "defense_down", "max_hp_down", "healing_received_down", "debuff_resistance", "invincible", "death_protection", "lifesteal_up", "stun_up", "extra_action_up", "lifesteal_down", "stun_down", "extra_action_down", "stunned"] as const;
export type CardBattleStatusType = typeof CARD_BATTLE_STATUS_ORDER[number];
export type CardBattleStatus = { type: CardBattleStatusType; value: number; remainingRounds: number | null; multiplier: number };
export const CARD_BATTLE_STATUS_LABELS: Record<CardBattleStatusType, string> = {
  lifesteal_up: "吸血比例提升", stun_up: "击晕概率提升", extra_action_up: "再动概率提升",
  lifesteal_down: "吸血比例降低", stun_down: "击晕概率降低", extra_action_down: "再动概率降低", stunned: "眩晕",
  debuff_resistance: "抵抗负面状态", invincible: "无敌", death_protection: "免死",
  attack_up: "攻击提升", skill_damage_up: "技能伤害提升", max_hp_up: "生命上限提升", defense_up: "防御提升", speed_up: "速度提升",
  speed_down: "速度降低", attack_skill_damage_down: "攻击与技能伤害降低", defense_down: "防御降低", max_hp_down: "生命上限降低", healing_received_down: "受治疗量降低",
};

export function cardBattleStatusText(status: CardBattleStatus) {
  if (status.type === "stunned") return "眩晕：仅本回合有效，无法执行本回合剩余行动";
  if (["debuff_resistance", "invincible", "death_protection"].includes(status.type)) return `${CARD_BATTLE_STATUS_LABELS[status.type]}：剩余${status.remainingRounds}回合（收藏品效果）`;
  const remaining = status.remainingRounds === null ? "持续本条生命" : `剩余${status.remainingRounds}回合`;
  const unit = /^(lifesteal|stun|extra_action)_/.test(status.type) ? "个百分点" : status.type.endsWith("_down") ? "%" : "点";
  return `${CARD_BATTLE_STATUS_LABELS[status.type]}：${status.value}${unit}，本层${status.multiplier === .5 ? "半效50%" : "全效100%"}，${remaining}`;
}
