export const battleCollectibleEffectTypes = [
    "attack", "skill_damage", "attack_skill_damage", "defense", "max_hp", "speed", "energy_reduction",
    "crit_rate", "crit_damage", "healing", "healing_received", "debuff_resistance", "invincible", "death_protection",
];
export const BATTLE_COLLECTIBLE_EFFECT_LABELS = {
    attack: "增加攻击力", skill_damage: "增加技能伤害", attack_skill_damage: "增加攻击力和技能伤害",
    defense: "增加防御力", max_hp: "增加生命值上限", speed: "增加速度", energy_reduction: "减少能量",
    crit_rate: "增加暴击率", crit_damage: "增加暴击伤害", healing: "增加治疗量", healing_received: "增加受治疗量",
    debuff_resistance: "抵抗负面状态回合数", invincible: "无敌回合数", death_protection: "免死回合数",
};
export function battleCollectibleEffectUnit(type) {
    if (type && ["crit_rate", "crit_damage", "healing", "healing_received"].includes(type))
        return "%";
    if (type && ["debuff_resistance", "invincible", "death_protection"].includes(type))
        return "回合";
    return "点";
}
/** Shared client/server validation; description is display-only plain text. */
export function battleCollectibleConfigError(type, value) {
    if (type == null)
        return value == null ? null : "未选择效果类型时不能填写效果属性";
    if (!battleCollectibleEffectTypes.includes(type))
        return "卡牌对战效果类型无效";
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000)
        return "效果属性必须大于 0 且不超过 1000000";
    const unit = battleCollectibleEffectUnit(type);
    if (unit !== "%" && !Number.isInteger(value))
        return "数值和回合数必须为正整数";
    if (unit === "回合" && value > 30)
        return "回合数不能超过 30";
    if (type === "crit_rate" && value > 100)
        return "增加暴击率不能超过 100%";
    if (unit === "%" && Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)
        return "百分比最多保留两位小数";
    return null;
}
export function battleCollectibleBonus(item, type) {
    const matches = item?.battleEffectType === type || (item?.battleEffectType === "attack_skill_damage" && (type === "attack" || type === "skill_damage"));
    return matches ? item?.battleEffectValue ?? 0 : 0;
}
export function applyBattleCollectibleStats(stats, item) {
    return {
        ...stats,
        maxHp: stats.maxHp + battleCollectibleBonus(item, "max_hp"),
        attack: stats.attack + battleCollectibleBonus(item, "attack"),
        defense: stats.defense + battleCollectibleBonus(item, "defense"),
        speed: stats.speed + battleCollectibleBonus(item, "speed"),
        energyRequired: battleCollectibleBonus(item, "energy_reduction") ? Math.max(10, stats.energyRequired - battleCollectibleBonus(item, "energy_reduction")) : stats.energyRequired,
        critRate: Math.min(100, (stats.critRate ?? 25) + battleCollectibleBonus(item, "crit_rate")),
        critDamage: (stats.critDamage ?? 150) + battleCollectibleBonus(item, "crit_damage"),
    };
}
