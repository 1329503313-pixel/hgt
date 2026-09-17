export type CardBattlePowerStats = {
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
    energyRequired: number;
    critRate?: number;
    critDamage?: number;
    lifestealRate?: number;
    extraActionRate?: number;
    dodgeRate?: number;
    stunRate?: number;
    counterRate?: number;
};
/** Rates use percentage points (10 = 10%, 150 = 150% critical damage).
 * Missing fields in legacy snapshots use the battle engine's defaults.
 * Round only the final per-card sum; team power sums these rounded values.
 */
export declare function calculateCardBattlePower(stats: CardBattlePowerStats): number;
