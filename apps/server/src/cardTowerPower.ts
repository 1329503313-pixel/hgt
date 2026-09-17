import { applyBattleCollectibleStats, calculateCardBattlePower } from "@hgt/shared";
import type { CardBattlePlayerInput } from "./cardBattle.js";

/** Frozen tiers already include the opening collection bonus; apply only the frozen collectible. */
export function calculateCardTowerPower(players: readonly CardBattlePlayerInput[]): number {
  return players.filter((player) => player.seat === 1).reduce((total, player) =>
    total + player.cards.reduce((sum, card) =>
      sum + calculateCardBattlePower(applyBattleCollectibleStats(card.tier, card.collectible)), 0), 0);
}
