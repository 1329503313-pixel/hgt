import { applyBattleCollectibleStats, calculateCardBattlePower, type BattleCollectible } from "@hgt/shared";
import type { OnlineCardBattleCard, OnlineCardBattleDeck } from "./types";

export function battleDeckCollectible(deck: OnlineCardBattleDeck, cardId: string | null) {
  const id = deck.collectibleBindings?.find((b) => b.cardId === cardId)?.collectibleId;
  return deck.collectibles?.find((item) => item.id === id) ?? null;
}

export function battleCardWithCollectible(card: OnlineCardBattleCard, collectible: BattleCollectible | null): OnlineCardBattleCard {
  const stats = applyBattleCollectibleStats(card.stats, collectible);
  return { ...card, collectible, stats, combatPower: calculateCardBattlePower(stats) };
}
