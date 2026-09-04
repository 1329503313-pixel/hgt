import type { CardBattleResult } from "./cardBattle.js";

export function resolveCardBattlePlaybackStates(
  result: CardBattleResult,
  completedSequence: number,
  status: string,
): CardBattleResult["initialStates"] {
  const complete = completedSequence >= result.events.length;
  if (complete || status === "aborted") return result.initialStates;
  return completedSequence > 0
    ? result.events[completedSequence - 1]!.states
    : result.initialStates;
}
