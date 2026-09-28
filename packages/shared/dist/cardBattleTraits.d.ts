export declare const CARD_BATTLE_TRAIT_EFFECTS: readonly ["attack", "skill_damage", "attack_skill_damage", "defense", "armor_break", "speed", "max_hp", "heal", "energy", "energy_required", "lifesteal_rate", "stun_rate", "extra_action_rate", "dodge_rate", "hit_rate", "counter_rate", "crit_rate", "crit_damage", "shield"];
export type CardBattleTraitEffectType = typeof CARD_BATTLE_TRAIT_EFFECTS[number];
export declare const CARD_BATTLE_TRAIT_EFFECT_LABELS: Record<CardBattleTraitEffectType, string>;
export declare const CARD_BATTLE_TRAIT_TARGETS: readonly ["trait_allies", "all_allies", "trait_enemies", "all_enemies"];
export type CardBattleTraitTarget = typeof CARD_BATTLE_TRAIT_TARGETS[number];
export declare const CARD_BATTLE_TRAIT_TARGET_LABELS: Record<CardBattleTraitTarget, string>;
export type CardBattleTraitEffect = {
    requiredCount: number;
    type: CardBattleTraitEffectType;
    target: CardBattleTraitTarget;
    valueType: "flat" | "percent";
    value: number;
    cadence: "fixed" | "round";
    durationRounds: number | null;
};
export type CardBattleTrait = {
    id: string;
    name: string;
    description: string;
    effects: CardBattleTraitEffect[];
};
export type CardBattleTraitSummary = Pick<CardBattleTrait, "id" | "name" | "description" | "effects">;
export declare const CARD_BATTLE_TRAIT_PERCENT_ONLY: readonly CardBattleTraitEffectType[];
export declare function cardBattleTraitEffectError(effect: CardBattleTraitEffect): string | null;
/** Return the highest configured threshold reached; effects at that threshold form one tier. */
export declare function activeCardBattleTraitEffects(trait: CardBattleTrait, lineupCount: number): CardBattleTraitEffect[];
