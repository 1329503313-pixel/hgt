import type { CardBattleResult } from "./cardBattle.js";
import { resolveCardBattleSettlementPlayers } from "./cardBattleSettlement.js";

/** All viewers share the persisted start time. Client acknowledgements never advance it. */
export function resolveCardBattlePlayback(result: CardBattleResult, startedAt: Date | string, status: string, nowMs: number) {
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) throw new Error("战斗时间记录不可用");
  let offset = 0;
  let completedSequence = 0;
  const elapsed = Math.max(0, nowMs - startMs);
  const terminated = status === "ended" || status === "aborted" || result.endReason === "surrender";
  for (const event of result.events) {
    if (!terminated && elapsed < offset + event.durationMs) break;
    offset += event.durationMs;
    completedSequence++;
  }
  const complete = completedSequence >= result.events.length;
  const activeEvent = complete ? null : result.events[completedSequence]!;
  return {
    completedSequence, totalEvents: result.events.length, complete,
    states: resolveCardBattlePlaybackStates(result, completedSequence, status),
    activeEvent,
    activeEventStartedAt: activeEvent ? new Date(startMs + offset).toISOString() : null,
    activeEventElapsedMs: activeEvent ? Math.max(0, elapsed - offset) : 0,
    serverNow: new Date(nowMs).toISOString(),
  };
}

export function surrenderCardBattleResult(result: CardBattleResult, userId: string, startedAt: Date | string, nowMs: number): CardBattleResult | null {
  const loser = result.players.find((player) => player.userId === userId);
  const playback = resolveCardBattlePlayback(result, startedAt, "playing", nowMs);
  if (!loser || playback.complete) return null;
  const appliedCurrent = playback.activeEvent && playback.activeEventElapsedMs >= Math.max(120, Math.round(playback.activeEvent.durationMs * .55));
  const events = result.events.slice(0, playback.completedSequence + (appliedCurrent ? 1 : 0));
  const states = events.at(-1)?.states ?? result.initialStates;
  const forfeited: CardBattleResult = {
    ...result, winnerSeat: loser.seat === 1 ? 2 : 1, endReason: "surrender",
    rounds: events.at(-1)?.round ?? 0, events, finalStates: states,
    playbackDurationMs: Math.max(0, nowMs - new Date(startedAt).getTime()),
    players: result.players.map((player) => ({ ...player, cards: player.cards.map((card) => {
      const state = states.find((state) => state.userId === player.userId && state.slot === card.slot);
      // Never use the precomputed future settlement after an early surrender.
      return { ...card, damageDealt: state?.damageDealt ?? 0, damageTaken: state?.damageTaken ?? 0, healingDone: state?.healingDone,
        supportDone: state?.supportDone, supportBreakdown: state?.supportBreakdown, score: undefined };
    }) })),
  };
  return { ...forfeited, players: resolveCardBattleSettlementPlayers(forfeited) };
}

export function resolveCardBattlePlaybackStates(
  result: CardBattleResult,
  completedSequence: number,
  status: string,
): CardBattleResult["initialStates"] {
  const complete = completedSequence >= result.events.length;
  // Keep the last tower squad visible while the room loads its settlement.
  if (complete && status !== "aborted" && result.mode === "tower") return result.finalStates;
  if (complete || status === "aborted") return result.initialStates;
  return completedSequence > 0
    ? result.events[completedSequence - 1]!.states
    : result.initialStates;
}
