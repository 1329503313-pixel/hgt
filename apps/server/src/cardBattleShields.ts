export type CardBattleShield = { remaining: number; expiresAfterRound: number; sourceId: string; order: number; traitKey?: string };
export const cardBattleShieldValue = (shields: readonly CardBattleShield[]) => shields.reduce((total, shield) => total + shield.remaining, 0);

/** Consume earliest-expiring layers first; insertion order breaks ties. */
export function consumeCardBattleShields(shields: CardBattleShield[], amount: number, credit: (sourceId: string, absorbed: number) => void) {
  let remaining = Math.max(0, amount);
  for (const shield of [...shields].sort((a, b) => a.expiresAfterRound - b.expiresAfterRound || a.order - b.order)) {
    const absorbed = Math.min(shield.remaining, remaining);
    shield.remaining -= absorbed;
    remaining -= absorbed;
    if (absorbed > 0) credit(shield.sourceId, absorbed);
    if (remaining <= 0) break;
  }
  return amount - remaining;
}
