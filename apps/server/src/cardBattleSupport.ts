import type { CardBattleBuff } from "./cardBattleMath.js";

type BuffGroup = { buffs: readonly CardBattleBuff[]; accepts: (buff: CardBattleBuff) => boolean };
export type CardBattleSupportShare = { sourceId: string; amount: number };

/**
 * Reapply only the relevant skill layers, in casting order, using the SAME hit
 * roll, HP cap and other modifiers. Marginal shares telescope to the net benefit;
 * stacked skills cannot each claim the entire gain. Expired layers are absent.
 * This function never mutates combat state or consumes a combat random draw.
 */
export function cardBattleSupportShares(
  groups: BuffGroup[],
  measure: (buffs: CardBattleBuff[][]) => number,
  direction: 1 | -1 = 1,
): CardBattleSupportShare[] {
  const candidates = groups.flatMap((group) => group.buffs.filter((buff) => buff.sourceId && group.accepts(buff)))
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  if (!candidates.length) return [];
  const excluded = new Set(candidates);
  const active = () => groups.map((group) => group.buffs.filter((buff) => !excluded.has(buff)));
  let previous = measure(active());
  const shares: CardBattleSupportShare[] = [];
  for (const buff of candidates) {
    excluded.delete(buff);
    const next = measure(active());
    const amount = Math.max(0, (next - previous) * direction);
    if (amount > 0) shares.push({ sourceId: buff.sourceId!, amount });
    previous = next;
  }
  return shares;
}
