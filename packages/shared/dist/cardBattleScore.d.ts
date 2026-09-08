/** One-decimal, half-up score. Integer weights avoid floating-point tie errors. */
export declare function calculateCardBattleScore(damageDealt: number, damageTaken: number, supportDone?: number): number;
