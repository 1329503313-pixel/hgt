import type { OnlineImpostorGame } from "./types";

export type ImpostorActionPhase = Exclude<OnlineImpostorGame["phase"], "ended">;
export const impostorActionLabels: Record<ImpostorActionPhase, string> = {
  night: "夜间行动", clue: "匿名留言", day_ready: "准备", day_vote: "任务投票",
  mission: "执行任务", assassination: "刺杀目标", accusation: "最终公投",
};
export const impostorActionPaths: Record<ImpostorActionPhase, string> = {
  night: "impostor/night-action", clue: "impostor/clue", day_ready: "impostor/ready", day_vote: "impostor/nomination",
  mission: "impostor/mission", assassination: "impostor/assassinate", accusation: "impostor/accuse",
};

export function impostorActionKey(roomId: string, userId: string, game: OnlineImpostorGame | null | undefined) {
  return JSON.stringify([roomId, userId, game?.gameNumber, game?.day, game?.phase, game?.nomination?.attempt, game?.accusation?.attempt]);
}

export function pendingImpostorAction(game: OnlineImpostorGame | null | undefined, userId: string, now: number): ImpostorActionPhase | null {
  if (!game?.me || game.phase === "ended" || !game.playerSeats.some((seat) => seat.userId === userId)) return null;
  if (game.deadlineAt && new Date(game.deadlineAt).getTime() <= now) return null;
  const me = game.me;
  switch (game.phase) {
    case "night": return !me.nightSubmitted && me.nightActionTypes.length > 0 ? "night" : null;
    case "clue": return !me.clueSubmitted ? "clue" : null;
    case "day_ready": return !me.readySubmitted ? "day_ready" : null;
    case "day_vote": return game.nomination && !me.nominationSubmitted ? "day_vote" : null;
    case "mission": return game.missionTeamUserIds.includes(userId) && !me.missionChoiceSubmitted ? "mission" : null;
    case "assassination": return me.canAssassinate ? "assassination" : null;
    case "accusation": return game.accusation && !me.accusationSubmitted ? "accusation" : null;
  }
}

// Keep both action surfaces submitted even if the next state fetch is delayed.
export function submittedImpostorGame(game: OnlineImpostorGame): OnlineImpostorGame {
  if (!game.me) return game;
  const me = { ...game.me };
  switch (game.phase) {
    case "night": me.nightSubmitted = true; break;
    case "clue": me.clueSubmitted = true; break;
    case "day_ready": me.readySubmitted = true; break;
    case "day_vote": me.nominationSubmitted = true; break;
    case "mission": me.missionChoiceSubmitted = true; break;
    case "assassination": me.canAssassinate = false; break;
    case "accusation": me.accusationSubmitted = true; break;
  }
  return { ...game, me };
}
