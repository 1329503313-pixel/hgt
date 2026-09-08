import { calculateCardBattleScore } from "@hgt/shared";
import type { CardBattleResult } from "./cardBattle.js";

/** Old games can recover healing, but lack the source/roll data for other support. */
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
    const finalState = result.finalStates.find((state) => state.userId === player.userId && state.slot === card.slot);
    const supportDone = card.supportDone ?? finalState?.supportDone ?? healingDone;
    const supportBreakdown = card.supportBreakdown ?? finalState?.supportBreakdown ?? (supportDone === healingDone && healingDone > 0 ? { healing: healingDone } : {});
    return { ...card, healingDone, supportDone, supportBreakdown, score: calculateCardBattleScore(card.damageDealt, card.damageTaken, supportDone) };
  }) }));
}
