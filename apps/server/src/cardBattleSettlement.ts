import { calculateCardBattleScore } from "@hgt/shared";
import type { CardBattleResult } from "./cardBattle.js";

/** Older saved games already record effective healing in each heal event. */
export function resolveCardBattleSettlementPlayers(result: CardBattleResult) {
  const healingByActor = new Map<string, number>();
  for (const event of result.events) {
    if (event.actorId && event.lifesteal) healingByActor.set(event.actorId, (healingByActor.get(event.actorId) ?? 0) + event.lifesteal);
    if (event.visual !== "heal" || !event.actorId) continue;
    const healing = event.effects.reduce((sum, effect) => sum + Math.max(0, effect.amount ?? 0), 0);
    healingByActor.set(event.actorId, (healingByActor.get(event.actorId) ?? 0) + healing);
  }
  return result.players.map((player) => ({ ...player, cards: player.cards.map((card) => {
    const instance = result.initialStates.find((state) => state.userId === player.userId && state.slot === card.slot);
    const healingDone = card.healingDone ?? (instance ? healingByActor.get(instance.instanceId) ?? 0 : 0);
    return { ...card, healingDone, score: calculateCardBattleScore(card.damageDealt, card.damageTaken, healingDone) };
  }) }));
}
