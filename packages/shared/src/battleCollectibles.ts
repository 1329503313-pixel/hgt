export const battleCollectibleEffectTypes = [
  "attack", "skill_damage", "attack_skill_damage", "defense", "max_hp", "speed", "energy_reduction",
  "crit_rate", "crit_damage", "healing", "healing_received", "debuff_resistance", "invincible", "death_protection",
  "single_skill_damage", "single_healing", "dodge_rate", "extra_action_rate", "lifesteal_rate", "stun_rate", "counter_rate", "hit_rate",
  "round_healing", "round_attack", "round_attack_skill_damage", "round_attack_single_skill_damage",
] as const;
export type BattleCollectibleEffectType = typeof battleCollectibleEffectTypes[number];
export const BATTLE_COLLECTIBLE_EFFECT_LABELS: Record<BattleCollectibleEffectType, string> = {
  attack: "增加攻击力", skill_damage: "增加技能伤害", attack_skill_damage: "增加攻击力和技能伤害",
  defense: "增加防御力", max_hp: "增加生命值上限", speed: "增加速度", energy_reduction: "减少能量上限",
  crit_rate: "增加暴击率", crit_damage: "增加暴击伤害", healing: "增加治疗量", healing_received: "增加受治疗量",
  debuff_resistance: "抵抗负面状态回合数", invincible: "无敌回合数", death_protection: "免死回合数",
  single_skill_damage: "单体技能伤害增加", single_healing: "单体治疗量增加", dodge_rate: "闪避率增加",
  extra_action_rate: "再动率增加", lifesteal_rate: "吸血率增加", stun_rate: "击晕率增加", counter_rate: "反击率增加", hit_rate: "命中率增加",
  round_healing: "每回合恢复生命值", round_attack: "每回合增加攻击力", round_attack_skill_damage: "每回合增加攻击力和技能伤害",
  round_attack_single_skill_damage: "每回合增加攻击力和单体技能伤害",
};
export const battleCollectibleRateTypes: readonly BattleCollectibleEffectType[] = ["crit_rate", "dodge_rate", "extra_action_rate", "lifesteal_rate", "stun_rate", "counter_rate", "hit_rate"];
export function battleCollectibleEffectUnit(type: BattleCollectibleEffectType | null) {
  if (type && (battleCollectibleRateTypes.includes(type) || ["crit_damage", "healing", "single_healing", "healing_received"].includes(type))) return "%";
  if (type && ["debuff_resistance", "invincible", "death_protection"].includes(type)) return "回合";
  return "点";
}
export type BattleCollectibleConfig = {
  battleEffects?: BattleCollectibleEffect[];
  battleEffectDescription: string;
  battleEffectType: BattleCollectibleEffectType | null;
  battleEffectValue: number | null;
};
export type BattleCollectibleEffect = { type: BattleCollectibleEffectType | null; value: number | null };

/** Old snapshots and records retain their original single effect until edited. */
export function battleCollectibleEffects(item?: Partial<BattleCollectibleConfig> | null): BattleCollectibleEffect[] {
  return item?.battleEffects ?? [{ type: item?.battleEffectType ?? null, value: item?.battleEffectValue ?? null }];
}

export function battleCollectibleEffectsError(item: Partial<BattleCollectibleConfig>): string | null {
  const effects = battleCollectibleEffects(item);
  if (!Array.isArray(effects) || !effects.length) return "至少保留一个效果";
  for (const effect of effects) {
    if (!effect || typeof effect !== "object" || !("type" in effect) || !("value" in effect)) return "卡牌对战效果无效";
    const error = battleCollectibleConfigError(effect.type, effect.value);
    if (error) return error;
  }
  return null;
}
export type BattleCollectible = BattleCollectibleConfig & {
  id: string;
  collectibleNo: string;
  name: string;
  imageUrl: string;
};
export type BattleCollectibleBinding = { cardId: string; collectibleId: string };

/** Shared client/server validation; description is display-only plain text. */
export function battleCollectibleConfigError(type: unknown, value: unknown): string | null {
  if (type == null) return value == null ? null : "未选择效果类型时不能填写效果属性";
  if (!battleCollectibleEffectTypes.includes(type as BattleCollectibleEffectType)) return "卡牌对战效果类型无效";
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return "效果属性必须大于 0 且不超过 1000000";
  const unit = battleCollectibleEffectUnit(type as BattleCollectibleEffectType);
  if (unit !== "%" && !Number.isInteger(value)) return "数值和回合数必须为正整数";
  if (unit === "回合" && value > 30) return "回合数不能超过 30";
  if (battleCollectibleRateTypes.includes(type as BattleCollectibleEffectType) && value > 100) return `${BATTLE_COLLECTIBLE_EFFECT_LABELS[type as BattleCollectibleEffectType]}不能超过 100%`;
  if (unit === "%" && Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) return "百分比最多保留两位小数";
  return null;
}

export function battleCollectibleBonus(item: BattleCollectibleConfig | null | undefined, type: BattleCollectibleEffectType) {
  return battleCollectibleEffects(item).reduce((sum, effect) => {
    const matches = effect.type === type || (effect.type === "attack_skill_damage" && (type === "attack" || type === "skill_damage"))
      || (effect.type === "round_attack_skill_damage" && type === "round_attack")
      || (effect.type === "round_attack_single_skill_damage" && type === "round_attack");
    return sum + (matches ? effect.value ?? 0 : 0);
  }, 0);
}

export function applyBattleCollectibleStats<T extends { maxHp: number; attack: number; defense: number; speed: number; energyRequired: number; critRate: number; critDamage: number }>(stats: T, item?: BattleCollectibleConfig | null): T {
  const rates: Record<string, number> = {};
  for (const [type, key] of [["dodge_rate", "dodgeRate"], ["hit_rate", "hitRate"], ["extra_action_rate", "extraActionRate"], ["lifesteal_rate", "lifestealRate"], ["stun_rate", "stunRate"], ["counter_rate", "counterRate"]] as const) {
    const bonus = battleCollectibleBonus(item, type);
    if (bonus) rates[key] = Math.min(100, ((stats as Record<string, number>)[key] ?? 0) + bonus);
  }
  return {
    ...stats,
    ...rates,
    maxHp: stats.maxHp + battleCollectibleBonus(item, "max_hp"),
    attack: stats.attack + battleCollectibleBonus(item, "attack"),
    defense: stats.defense + battleCollectibleBonus(item, "defense"),
    speed: stats.speed + battleCollectibleBonus(item, "speed"),
    energyRequired: battleCollectibleBonus(item, "energy_reduction") ? Math.max(10, stats.energyRequired - battleCollectibleBonus(item, "energy_reduction")) : stats.energyRequired,
    critRate: Math.min(100, (stats.critRate ?? 25) + battleCollectibleBonus(item, "crit_rate")),
    critDamage: (stats.critDamage ?? 150) + battleCollectibleBonus(item, "crit_damage"),
  };
}
