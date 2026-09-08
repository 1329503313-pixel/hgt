import { applyBattleCollectibleStats, type BattleCollectible } from "@hgt/shared";
import type { OnlineCardBattleCard, OnlineCardBattleDeck } from "./types";

export function battleDeckCollectible(deck: OnlineCardBattleDeck, cardId: string | null) {
  const id = deck.collectibleBindings?.find((b) => b.cardId === cardId)?.collectibleId;
  return deck.collectibles?.find((item) => item.id === id) ?? null;
}

export function battleCardWithCollectible(card: OnlineCardBattleCard, collectible: BattleCollectible | null): OnlineCardBattleCard {
  const stats = applyBattleCollectibleStats(card.stats, collectible);
  return { ...card, collectible, stats, combatPower: stats.maxHp + stats.attack * 3 + stats.defense * 4 + stats.speed * 7 - stats.energyRequired * 10 };
}
