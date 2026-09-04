export const CARD_BATTLE_LINEUP_SIZE = 5;

export function reorderCardBattleLineup(
  cardIds: Array<string | null>,
  fromSlot: number,
  toSlot: number,
) {
  const next = Array.from({ length: CARD_BATTLE_LINEUP_SIZE }, (_, index) => {
    const cardId = cardIds[index];
    return typeof cardId === "string" && cardId ? cardId : null;
  });
  if (!Number.isInteger(fromSlot) || !Number.isInteger(toSlot)
    || fromSlot < 1 || fromSlot > CARD_BATTLE_LINEUP_SIZE
    || toSlot < 1 || toSlot > CARD_BATTLE_LINEUP_SIZE
    || fromSlot === toSlot) return next;
  [next[fromSlot - 1], next[toSlot - 1]] = [next[toSlot - 1], next[fromSlot - 1]];
  return next;
}
