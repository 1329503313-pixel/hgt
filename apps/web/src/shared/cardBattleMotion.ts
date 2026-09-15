import { CARD_BATTLE_DEFENSE_EFFECT_LABELS, isCardBattleTrueDamage, isCardBattleShield } from "@hgt/shared";
import { CARD_BATTLE_CONTROL_LABELS, isCardBattleStun, isCardBattleRevivalBlock, isCardBattleImmunity } from "@hgt/shared";
import type { CardBattleEffectType } from "./digitalAssets";
import { CARD_BATTLE_DEBUFF_LABELS, type CardBattleStatusType } from "./cardBattleEffects";

export type BattleGlyphName = "fire" | "ice" | "bolt" | "heal" | "energy" | "shield" | "sword" | "arcane" | "wings" | "heart" | "phoenix" | "broken-shield" | "broken-heart" | "broken-sword" | "frozen-wings" | "heal-block" | "blood" | "blood-block" | "dizzy" | "dizzy-block" | "repeat" | "repeat-block";
export type BattleMotion = { glyph: BattleGlyphName; color: string; pattern: "single" | "random" | "front" | "rear" | "all" | "self" | "ally"; count: number; motion: "impact" | "rise" | "guard" | "flap" | "shatter" | "summon" | "orbit" | "drain" | "daze" | "reprise"; label: string };
const motion = (glyph: BattleGlyphName, color: string, pattern: BattleMotion["pattern"], animation: BattleMotion["motion"], label: string, count = 1): BattleMotion => ({ glyph, color, pattern, motion: animation, label, count });

const existing = {
  lifesteal_self: motion("blood", "#fb7185", "self", "drain", "嗜血回流"),
  lifesteal_all_allies: motion("blood", "#fda4af", "all", "drain", "群体血契", 5),
  stun_self: motion("dizzy", "#fde68a", "self", "daze", "震荡星环"),
  stun_all_allies: motion("dizzy", "#fcd34d", "all", "daze", "群体震慑", 5),
  extra_action_self: motion("repeat", "#67e8f9", "self", "reprise", "再动时轮"),
  extra_action_all_allies: motion("repeat", "#a5b4fc", "all", "reprise", "群体时流", 5),
  damage_single: motion("fire", "#fb923c", "single", "impact", "单体炎爆"),
  damage_rear: motion("ice", "#67e8f9", "rear", "impact", "后排冰枪"),
  damage_random: motion("bolt", "#c4b5fd", "random", "impact", "随机电弧"),
  damage_all_front: motion("fire", "#f97316", "front", "impact", "前排烈焰波", 2),
  damage_all_rear: motion("ice", "#a5f3fc", "rear", "orbit", "后排冰晶风暴", 3),
  damage_random_2: motion("bolt", "#a5b4fc", "random", "impact", "双重闪电", 2),
  damage_random_3: motion("arcane", "#d8b4fe", "random", "orbit", "三星追击", 3),
  damage_random_4: motion("bolt", "#e879f9", "random", "orbit", "四连雷链", 4),
  damage_all: motion("fire", "#fda4af", "all", "impact", "全场陨火", 5),
  heal_self: motion("heal", "#6ee7b7", "self", "rise", "自愈绿光"),
  heal_lowest_ally: motion("heal", "#a7f3d0", "ally", "orbit", "定向生命丝带"),
  heal_all_allies: motion("heal", "#34d399", "all", "rise", "群体生命雨", 5),
  energy_self: motion("energy", "#38bdf8", "self", "orbit", "自体聚能"),
  energy_lowest_ally: motion("energy", "#7dd3fc", "ally", "rise", "定向能量流"),
  energy_all_allies: motion("energy", "#22d3ee", "all", "orbit", "群体能量脉冲", 5),
  defense_self: motion("shield", "#7dd3fc", "self", "guard", "护盾展开"),
  defense_all_allies: motion("shield", "#38bdf8", "all", "guard", "群体盾阵", 5),
  attack_self: motion("sword", "#fbbf24", "self", "rise", "利剑升腾"),
  attack_all_allies: motion("sword", "#fcd34d", "all", "orbit", "群体剑阵", 5),
  attack_skill_damage_self: motion("arcane", "#e9d5ff", "self", "rise", "奥术剑锋"),
  attack_skill_damage_all_allies: motion("arcane", "#c084fc", "all", "orbit", "奥术剑阵", 5),
  speed_self: motion("wings", "#bae6fd", "self", "flap", "疾风双翼"),
  speed_all_allies: motion("wings", "#67e8f9", "all", "flap", "群体顺风", 5),
  max_hp_self: motion("heart", "#fb7185", "self", "guard", "生命核心扩张"),
  max_hp_all_allies: motion("heart", "#fda4af", "all", "guard", "群体生命祝福", 5),
  revive_self: motion("phoenix", "#fde68a", "self", "summon", "自身浴火重生"),
  revive_ally_1: motion("phoenix", "#fef3c7", "ally", "summon", "单体复苏光柱"),
  revive_ally_2: motion("phoenix", "#fcd34d", "ally", "summon", "双生羽翼", 2),
  revive_ally_3: motion("phoenix", "#a7f3d0", "ally", "summon", "三重复苏星环", 3),
  revive_ally_4: motion("phoenix", "#99f6e4", "ally", "summon", "四重重生阵", 4),
  revive_all_allies: motion("phoenix", "#ecfccb", "all", "summon", "全体复活天幕", 5),
} satisfies Partial<Record<CardBattleEffectType, BattleMotion>>;

const debuffs = Object.fromEntries(Object.entries(CARD_BATTLE_DEBUFF_LABELS).map(([type, label]) => {
  const pattern = type.slice(type.lastIndexOf("_") + 1) as BattleMotion["pattern"];
  const glyph: BattleGlyphName = type.startsWith("lifesteal_") ? "blood-block" : type.startsWith("stun_") ? "dizzy-block" : type.startsWith("extra_action_") ? "repeat-block" : type.startsWith("speed_") ? "frozen-wings" : type.startsWith("max_hp_") ? "broken-heart" : type.startsWith("defense_") ? "broken-shield" : type.startsWith("healing_received_") ? "heal-block" : "broken-sword";
  const color = glyph === "frozen-wings" ? "#93c5fd" : glyph === "heal-block" ? "#d8b4fe" : "#fda4af";
  return [type, motion(glyph, color, pattern, "shatter", label, pattern === "all" ? 5 : pattern === "front" ? 2 : pattern === "rear" ? 3 : 1)];
})) as Record<keyof typeof CARD_BATTLE_DEBUFF_LABELS, BattleMotion>;

const controls = Object.fromEntries(Object.entries(CARD_BATTLE_CONTROL_LABELS).map(([type, label]) => {
  const suffix = type.slice(type.lastIndexOf("_") + 1);
  const pattern: BattleMotion["pattern"] = type === "act_again" ? "self" : suffix === "damaged" ? "all" : suffix as BattleMotion["pattern"];
  const glyph: BattleGlyphName = type === "act_again" ? "repeat" : isCardBattleStun(type) ? "dizzy" : isCardBattleRevivalBlock(type) ? "broken-heart" : isCardBattleImmunity(type) ? "shield" : "heal";
  return [type, motion(glyph, isCardBattleRevivalBlock(type) ? "#fda4af" : "#a5b4fc", pattern,
    type === "act_again" ? "reprise" : isCardBattleStun(type) ? "daze" : isCardBattleImmunity(type) ? "guard" : "rise",
    label, pattern === "all" ? 5 : pattern === "front" ? 2 : pattern === "rear" ? 3 : 1)];
})) as Record<keyof typeof CARD_BATTLE_CONTROL_LABELS, BattleMotion>;

const defenseEffects = Object.fromEntries(Object.entries(CARD_BATTLE_DEFENSE_EFFECT_LABELS).map(([type, label]) => {
  const pattern: BattleMotion["pattern"] = type.includes("random") ? "random" : type.endsWith("_self") ? "self" : type.endsWith("_front") ? "front" : type.endsWith("_rear") ? "rear" : type.endsWith("_all") ? "all" : "single";
  const count = type.endsWith("_2") ? 2 : type.endsWith("_3") ? 3 : pattern === "all" ? 5 : pattern === "front" ? 2 : pattern === "rear" ? 3 : 1;
  return [type, motion(isCardBattleTrueDamage(type) ? "arcane" : isCardBattleShield(type) ? "shield" : type.startsWith("dodge_") ? "wings" : "sword", "#67e8f9", pattern, isCardBattleTrueDamage(type) ? "impact" : "guard", label, count)];
})) as Record<keyof typeof CARD_BATTLE_DEFENSE_EFFECT_LABELS, BattleMotion>;

/** Every supported effect has an explicit family and a scope/count-specific choreography. */
export const CARD_BATTLE_MOTIONS: Record<CardBattleEffectType, BattleMotion> = { ...existing, ...debuffs, ...controls, ...defenseEffects };
export const CARD_BATTLE_STATUS_GLYPHS: Record<CardBattleStatusType, BattleGlyphName> = {
  crit_rate_up: "sword", crit_damage_up: "arcane",
  shield: "shield", dodge_up: "wings", hit_up: "sword",
  lifesteal_up: "blood", stun_up: "dizzy", extra_action_up: "repeat", lifesteal_down: "blood-block", stun_down: "dizzy-block", extra_action_down: "repeat-block", stunned: "dizzy",
  immunity: "shield", revival_block: "broken-heart",
  debuff_resistance: "shield", invincible: "energy", death_protection: "heart",
  attack_up: "sword", skill_damage_up: "arcane", max_hp_up: "heart", defense_up: "shield", speed_up: "wings",
  speed_down: "frozen-wings", attack_skill_damage_down: "broken-sword", defense_down: "broken-shield", max_hp_down: "broken-heart", healing_received_down: "heal-block",
};

export const CARD_BATTLE_PROC_MOTIONS = {
  lifesteal: motion("blood", "#fb7185", "self", "drain", "吸血恢复"),
  stun: motion("dizzy", "#fde68a", "single", "daze", "眩晕星环"),
  extra_action: motion("repeat", "#67e8f9", "self", "reprise", "立即再动"),
};
