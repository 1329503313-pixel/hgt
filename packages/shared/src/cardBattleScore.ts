/** One-decimal, half-up score. Integer weights avoid floating-point tie errors. */
export function calculateCardBattleScore(damageDealt: number, damageTaken: number, supportDone = 0): number {
  return Math.round((damageDealt * 15 + damageTaken * 10 + supportDone * 7) / 1000) / 10;
}
