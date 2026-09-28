export const CARD_BATTLE_TRAIT_EFFECTS = [
    "attack", "skill_damage", "attack_skill_damage", "defense", "armor_break", "speed", "max_hp", "heal", "energy",
    "energy_required", "lifesteal_rate", "stun_rate", "extra_action_rate", "dodge_rate", "hit_rate", "counter_rate",
    "crit_rate", "crit_damage", "shield",
];
export const CARD_BATTLE_TRAIT_EFFECT_LABELS = {
    attack: "增加攻击力", skill_damage: "增加技能伤害", attack_skill_damage: "增加攻击力和技能伤害", defense: "增加防御力",
    armor_break: "增加伤害破防", speed: "增加速度", max_hp: "增加生命值上限", heal: "增加生命值", energy: "增加能量",
    energy_required: "减少能量上限", lifesteal_rate: "增加吸血率", stun_rate: "增加击晕率", extra_action_rate: "增加再动率",
    dodge_rate: "增加闪避率", hit_rate: "增加命中率", counter_rate: "增加反击率", crit_rate: "增加暴击率",
    crit_damage: "增加暴击伤害", shield: "增加护盾",
};
export const CARD_BATTLE_TRAIT_TARGETS = ["trait_allies", "all_allies", "trait_enemies", "all_enemies"];
export const CARD_BATTLE_TRAIT_TARGET_LABELS = {
    trait_allies: "拥有本特质的友军", all_allies: "所有友军", trait_enemies: "拥有本特质的敌军", all_enemies: "所有敌军",
};
export const CARD_BATTLE_TRAIT_PERCENT_ONLY = [
    "lifesteal_rate", "stun_rate", "extra_action_rate", "dodge_rate", "hit_rate", "counter_rate", "crit_rate", "crit_damage",
];
const cardBattleTraitPercentOnlySet = new Set(CARD_BATTLE_TRAIT_PERCENT_ONLY);
const cardBattleTraitIntegerOnlySet = new Set(["energy"]);
export function cardBattleTraitEffectError(effect) {
    if (!Number.isInteger(effect.requiredCount) || effect.requiredCount < 1 || effect.requiredCount > 5)
        return "特质要求上场张数须为1-5";
    if (!CARD_BATTLE_TRAIT_EFFECTS.includes(effect.type) || !CARD_BATTLE_TRAIT_TARGETS.includes(effect.target))
        return "特质效果类型或对象无效";
    if (!Number.isFinite(effect.value) || effect.value <= 0 || effect.value > 1_000_000)
        return "特质效果数值须大于0且不超过1000000";
    if (cardBattleTraitPercentOnlySet.has(effect.type) && effect.valueType !== "percent")
        return "当前效果只能填写百分比";
    if (effect.type === "energy" && effect.valueType !== "flat")
        return "增加能量仅支持数值类型";
    if (effect.type === "heal" && effect.cadence !== "round")
        return "增加生命值只能选择每回合生效特质";
    if (effect.cadence === "round" && (!Number.isInteger(effect.durationRounds) || effect.durationRounds < 1 || effect.durationRounds > 30))
        return "持续回合须为1-30";
    if (effect.cadence === "fixed" && effect.durationRounds != null)
        return "固定数值特质不能设置持续回合";
    if (effect.valueType === "percent" && effect.value > 10_000)
        return "百分比不能超过10000%";
    if (cardBattleTraitIntegerOnlySet.has(effect.type) && !Number.isInteger(effect.value))
        return "增加能量数值必须为整数";
    return null;
}
/** Return the highest configured threshold reached; effects at that threshold form one tier. */
export function activeCardBattleTraitEffects(trait, lineupCount) {
    const threshold = Math.max(0, ...trait.effects.map((effect) => effect.requiredCount).filter((count) => count <= lineupCount));
    return threshold ? trait.effects.filter((effect) => effect.requiredCount === threshold) : [];
}
