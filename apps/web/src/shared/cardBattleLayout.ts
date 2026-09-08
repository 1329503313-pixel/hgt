/** Two 5:7 rows; narrow screens also reserve space below the player identity. */
export function cardBattleFormationSize(width: number, height: number) {
  const columnGap = Math.min(64, Math.max(12, Math.floor(width * .055)));
  const reservedHeight = width <= 600 ? 64 : 48;
  const cardWidth = Math.max(48, Math.min(160,
    Math.floor((width - 32 - columnGap * 2) / 3),
    Math.floor((height - reservedHeight) / 2.8),
  ));
  return { cardWidth, columnGap };
}
