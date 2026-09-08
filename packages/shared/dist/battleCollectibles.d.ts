export declare const battleCollectibleEffectTypes: readonly ["attack", "skill_damage", "attack_skill_damage", "defense", "max_hp", "speed", "energy_reduction", "crit_rate", "crit_damage", "healing", "healing_received", "debuff_resistance", "invincible", "death_protection"];
export type BattleCollectibleEffectType = typeof battleCollectibleEffectTypes[number];
export declare const BATTLE_COLLECTIBLE_EFFECT_LABELS: Record<BattleCollectibleEffectType, string>;
export declare function battleCollectibleEffectUnit(type: BattleCollectibleEffectType | null): "%" | "回合" | "点";
export type BattleCollectibleConfig = {
    battleEffectDescription: string;
    battleEffectType: BattleCollectibleEffectType | null;
    battleEffectValue: number | null;
};
export type BattleCollectible = BattleCollectibleConfig & {
    id: string;
    collectibleNo: string;
    name: string;
    imageUrl: string;
};
export type BattleCollectibleBinding = {
    cardId: string;
    collectibleId: string;
};
/** Shared client/server validation; description is display-only plain text. */
export declare function battleCollectibleConfigError(type: unknown, value: unknown): string | null;
export declare function battleCollectibleBonus(item: BattleCollectibleConfig | null | undefined, type: BattleCollectibleEffectType): number;
export declare function applyBattleCollectibleStats<T extends {
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
    energyRequired: number;
    critRate: number;
    critDamage: number;
}>(stats: T, item?: BattleCollectibleConfig | null): T;
