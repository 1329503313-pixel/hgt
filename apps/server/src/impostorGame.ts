import { randomInt } from "node:crypto";

export const IMPOSTOR_MIN_PLAYERS = 4;
export const IMPOSTOR_MAX_PLAYERS = 6;
export const IMPOSTOR_MISSION_SIZES = [0, 2, 1, 3, 2, 3] as const;

export type ImpostorRole = "detective" | "civilian" | "impostor";
export type ImpostorPhase = "night" | "clue" | "day_vote" | "mission" | "assassination" | "accusation" | "ended";
export type ImpostorWinner = "good" | "impostor" | "draw";
export type ImpostorNightActionType = "chaos" | "isolate" | "guard" | "investigate" | "skip";
export type ImpostorMissionChoice = "protect" | "sabotage";

export type ImpostorPlayer = { userId: string; seat: number; role: ImpostorRole };
export type ImpostorNightAction = {
  type: ImpostorNightActionType;
  targetUserIds: string[];
};
export type ImpostorMissionSubmission = {
  choice: ImpostorMissionChoice;
  automatic: boolean;
  effectiveChoice: ImpostorMissionChoice;
};
export type ImpostorPublicClue = { role: ImpostorRole; content: string };
export type ImpostorDayHistory = {
  day: number;
  isolatedUserIds: string[];
  missionTeamUserIds: string[];
  result: "success" | "failure";
  missionChoices: Record<string, ImpostorMissionSubmission>;
  nightActions: Record<string, ImpostorNightAction>;
};

export type ImpostorGameState = {
  version: 1;
  gameNumber: number;
  players: ImpostorPlayer[];
  phase: ImpostorPhase;
  day: number;
  successes: number;
  failures: number;
  deadlineAt: string | null;
  nightEligibleUserIds: string[];
  nightActions: Record<string, ImpostorNightAction>;
  nightChaosCounts: Record<string, number>;
  isolatedUserIds: string[];
  investigation: { targetUserIds: string[]; reportedHasImpostor: boolean } | null;
  nomination: {
    attempt: number;
    lockedUserIds: string[];
    candidateUserIds: string[];
    required: number;
    ballots: Record<string, string[]>;
  } | null;
  missionTeamUserIds: string[];
  missionChoices: Record<string, ImpostorMissionSubmission>;
  clues: Record<string, string | null>;
  publicClues: ImpostorPublicClue[];
  accusation: {
    attempt: number;
    candidateUserIds: string[];
    ballots: Record<string, string | null>;
  } | null;
  assassinationTargetUserId: string | null;
  winner: ImpostorWinner | null;
  endReason: string | null;
  history: ImpostorDayHistory[];
};

export class ImpostorGameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImpostorGameRuleError";
  }
}

type RandomIndex = (upperExclusive: number) => number;
const defaultRandomIndex: RandomIndex = (upperExclusive) => randomInt(upperExclusive);

function cloneState(state: ImpostorGameState): ImpostorGameState {
  return JSON.parse(JSON.stringify(state)) as ImpostorGameState;
}

function deadline(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function shuffle<T>(values: T[], randomIndex: RandomIndex): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function playerIds(state: ImpostorGameState) {
  return state.players.map((player) => player.userId);
}

function roleOf(state: ImpostorGameState, userId: string) {
  return state.players.find((player) => player.userId === userId)?.role ?? null;
}

function assertPlayer(state: ImpostorGameState, userId: string) {
  if (!roleOf(state, userId)) throw new ImpostorGameRuleError("你不是本局游戏者");
}

function allSubmitted(state: ImpostorGameState, submitted: Record<string, unknown>, eligible = playerIds(state)) {
  return eligible.every((userId) => Object.prototype.hasOwnProperty.call(submitted, userId));
}

function missionSize(day: number) {
  return IMPOSTOR_MISSION_SIZES[day as 1 | 2 | 3 | 4 | 5] ?? 0;
}

function beginDayVote(state: ImpostorGameState, now: Date): ImpostorGameState {
  const next = cloneState(state);
  const candidates = playerIds(next).filter((userId) => !next.isolatedUserIds.includes(userId));
  const required = missionSize(next.day);
  if (candidates.length < required) throw new ImpostorGameRuleError("可执行任务人数不足");
  next.phase = "day_vote";
  next.deadlineAt = deadline(now, 90);
  next.nomination = { attempt: 1, lockedUserIds: [], candidateUserIds: candidates, required, ballots: {} };
  next.missionTeamUserIds = [];
  next.missionChoices = {};
  if (candidates.length === required) return beginMission(next, candidates, now);
  return next;
}

function beginMission(state: ImpostorGameState, team: string[], now: Date): ImpostorGameState {
  const next = cloneState(state);
  const seat = new Map(next.players.map((player) => [player.userId, player.seat]));
  next.phase = "mission";
  next.deadlineAt = deadline(now, 60);
  next.missionTeamUserIds = [...team].sort((a, b) => (seat.get(a) ?? 0) - (seat.get(b) ?? 0));
  next.missionChoices = {};
  next.nomination = null;
  return next;
}

function beginNight(state: ImpostorGameState, now: Date, eligibleUserIds: string[]): ImpostorGameState {
  const next = cloneState(state);
  next.phase = "night";
  next.deadlineAt = deadline(now, 60);
  next.nightEligibleUserIds = [...new Set(eligibleUserIds)];
  next.nightActions = {};
  next.nightChaosCounts = {};
  next.isolatedUserIds = [];
  next.investigation = null;
  if (next.nightEligibleUserIds.length === 0) return settleNight(next, now);
  return next;
}

function endGame(state: ImpostorGameState, winner: ImpostorWinner, reason: string): ImpostorGameState {
  const next = cloneState(state);
  next.phase = "ended";
  next.deadlineAt = null;
  next.winner = winner;
  next.endReason = reason;
  next.nomination = null;
  next.accusation = null;
  return next;
}

export function createImpostorGame(
  orderedUserIds: string[],
  gameNumber: number,
  now = new Date(),
  randomIndex: RandomIndex = defaultRandomIndex,
): ImpostorGameState {
  if (orderedUserIds.length < IMPOSTOR_MIN_PLAYERS || orderedUserIds.length > IMPOSTOR_MAX_PLAYERS) {
    throw new ImpostorGameRuleError(`需要 ${IMPOSTOR_MIN_PLAYERS}-${IMPOSTOR_MAX_PLAYERS} 名游戏者才能开始`);
  }
  if (new Set(orderedUserIds).size !== orderedUserIds.length) throw new ImpostorGameRuleError("游戏者不能重复");
  const roles = shuffle<ImpostorRole>([
    "impostor",
    "detective",
    ...Array.from({ length: orderedUserIds.length - 2 }, () => "civilian" as const),
  ], randomIndex);
  const players = orderedUserIds.map((userId, index) => ({ userId, seat: index + 1, role: roles[index] }));
  const firstNightActors = players.filter((player) => player.role !== "civilian").map((player) => player.userId);
  return beginNight({
    version: 1,
    gameNumber,
    players,
    phase: "night",
    day: 1,
    successes: 0,
    failures: 0,
    deadlineAt: null,
    nightEligibleUserIds: [],
    nightActions: {},
    nightChaosCounts: {},
    isolatedUserIds: [],
    investigation: null,
    nomination: null,
    missionTeamUserIds: [],
    missionChoices: {},
    clues: {},
    publicClues: [],
    accusation: null,
    assassinationTargetUserId: null,
    winner: null,
    endReason: null,
    history: [],
  }, now, firstNightActors);
}

function validateNightAction(state: ImpostorGameState, userId: string, action: ImpostorNightAction) {
  assertPlayer(state, userId);
  if (state.phase !== "night") throw new ImpostorGameRuleError("当前不是夜间行动阶段");
  if (!state.nightEligibleUserIds.includes(userId)) throw new ImpostorGameRuleError("你本夜没有行动资格");
  if (Object.prototype.hasOwnProperty.call(state.nightActions, userId)) throw new ImpostorGameRuleError("你已经提交过本夜行动");
  const role = roleOf(state, userId);
  const targetIds = [...new Set(action.targetUserIds)];
  if (targetIds.length !== action.targetUserIds.length) throw new ImpostorGameRuleError("行动目标不能重复");
  if (action.type === "skip") {
    if (targetIds.length) throw new ImpostorGameRuleError("跳过行动不能选择目标");
    return;
  }
  if (state.day === 1 && role === "detective") {
    if (action.type !== "investigate" || targetIds.length !== 2 || targetIds.includes(userId)) {
      throw new ImpostorGameRuleError("侦探第一夜只能调查两名不同的其他玩家");
    }
  } else {
    const allowed = state.day === 1 && role === "impostor"
      ? ["chaos", "isolate"]
      : ["chaos", "isolate", "guard"];
    if (!allowed.includes(action.type) || targetIds.length !== 1) throw new ImpostorGameRuleError("请选择有效的夜间行动");
    if (action.type !== "guard" && targetIds[0] === userId) throw new ImpostorGameRuleError("该技能不能对自己使用");
  }
  for (const targetId of targetIds) assertPlayer(state, targetId);
}

export function submitImpostorNightAction(
  state: ImpostorGameState,
  userId: string,
  action: ImpostorNightAction,
  now = new Date(),
  randomIndex: RandomIndex = defaultRandomIndex,
) {
  validateNightAction(state, userId, action);
  const next = cloneState(state);
  next.nightActions[userId] = { type: action.type, targetUserIds: [...action.targetUserIds] };
  return allSubmitted(next, next.nightActions, next.nightEligibleUserIds) ? settleNight(next, now, randomIndex) : next;
}

function settleNight(state: ImpostorGameState, now: Date, randomIndex: RandomIndex = defaultRandomIndex): ImpostorGameState {
  const next = cloneState(state);
  const guarded = new Set<string>();
  for (const action of Object.values(next.nightActions)) {
    if (action.type === "guard") guarded.add(action.targetUserIds[0]);
  }
  const chaosCounts: Record<string, number> = {};
  const isolateTargets = new Set<string>();
  for (const action of Object.values(next.nightActions)) {
    const target = action.targetUserIds[0];
    if (!target || guarded.has(target)) continue;
    if (action.type === "chaos") chaosCounts[target] = (chaosCounts[target] ?? 0) + 1;
    if (action.type === "isolate") isolateTargets.add(target);
  }
  next.nightChaosCounts = chaosCounts;
  const maxIsolations = Math.max(0, next.players.length - missionSize(next.day));
  next.isolatedUserIds = shuffle([...isolateTargets], randomIndex).slice(0, maxIsolations);
  const detective = next.players.find((player) => player.role === "detective");
  const detectiveAction = detective ? next.nightActions[detective.userId] : null;
  if (detective && detectiveAction?.type === "investigate") {
    const actual = detectiveAction.targetUserIds.some((targetId) => roleOf(next, targetId) === "impostor");
    const confused = (chaosCounts[detective.userId] ?? 0) % 2 === 1;
    next.investigation = { targetUserIds: [...detectiveAction.targetUserIds], reportedHasImpostor: confused ? !actual : actual };
  }
  if (next.day === 3) {
    next.phase = "clue";
    next.deadlineAt = deadline(now, 60);
    next.clues = {};
    return next;
  }
  return beginDayVote(next, now);
}

export function submitImpostorClue(state: ImpostorGameState, userId: string, content: string | null, now = new Date(), randomIndex: RandomIndex = defaultRandomIndex) {
  assertPlayer(state, userId);
  if (state.phase !== "clue") throw new ImpostorGameRuleError("当前不是线索提交阶段");
  if (Object.prototype.hasOwnProperty.call(state.clues, userId)) throw new ImpostorGameRuleError("你已经提交过线索");
  const normalized = content?.trim() || null;
  if (normalized && Array.from(normalized).length > 10) throw new ImpostorGameRuleError("线索不能超过10个字");
  const next = cloneState(state);
  next.clues[userId] = normalized;
  if (!allSubmitted(next, next.clues)) return next;
  return revealClues(next, now, randomIndex);
}

function revealClues(state: ImpostorGameState, now: Date, randomIndex: RandomIndex = defaultRandomIndex) {
  const next = cloneState(state);
  next.publicClues = shuffle(next.players.flatMap((player) => {
    const content = next.clues[player.userId];
    return content ? [{ role: player.role, content }] : [];
  }), randomIndex);
  return beginDayVote(next, now);
}

export function submitImpostorNomination(state: ImpostorGameState, userId: string, candidateUserIds: string[], now = new Date()) {
  assertPlayer(state, userId);
  if (state.phase !== "day_vote" || !state.nomination) throw new ImpostorGameRuleError("当前不是任务人选投票阶段");
  if (Object.prototype.hasOwnProperty.call(state.nomination.ballots, userId)) throw new ImpostorGameRuleError("你已经提交过本轮投票");
  const choices = [...new Set(candidateUserIds)];
  if (choices.length !== state.nomination.required) throw new ImpostorGameRuleError(`请选择 ${state.nomination.required} 名候选人`);
  if (choices.some((id) => !state.nomination?.candidateUserIds.includes(id))) throw new ImpostorGameRuleError("投票候选人无效");
  const next = cloneState(state);
  next.nomination!.ballots[userId] = choices;
  return allSubmitted(next, next.nomination!.ballots) ? settleNomination(next, now) : next;
}

function settleNomination(state: ImpostorGameState, now: Date): ImpostorGameState {
  const next = cloneState(state);
  const nomination = next.nomination!;
  const counts = new Map(nomination.candidateUserIds.map((id) => [id, 0]));
  for (const ballot of Object.values(nomination.ballots)) {
    for (const candidate of ballot) if (counts.has(candidate)) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cutoff = ranked[Math.max(0, nomination.required - 1)]?.[1] ?? 0;
  const definite = ranked.filter(([, count]) => count > cutoff).map(([id]) => id);
  const tied = ranked.filter(([, count]) => count === cutoff).map(([id]) => id);
  const remaining = nomination.required - definite.length;
  if (tied.length === remaining) return beginMission(next, [...nomination.lockedUserIds, ...definite, ...tied], now);
  next.nomination = {
    attempt: nomination.attempt + 1,
    lockedUserIds: [...nomination.lockedUserIds, ...definite],
    candidateUserIds: tied,
    required: remaining,
    ballots: {},
  };
  next.deadlineAt = deadline(now, 90);
  return next;
}

export function submitImpostorMissionChoice(state: ImpostorGameState, userId: string, choice: ImpostorMissionChoice, now = new Date()) {
  assertPlayer(state, userId);
  if (state.phase !== "mission") throw new ImpostorGameRuleError("当前不是任务执行阶段");
  if (!state.missionTeamUserIds.includes(userId)) throw new ImpostorGameRuleError("你不是本轮任务成员");
  if (Object.prototype.hasOwnProperty.call(state.missionChoices, userId)) throw new ImpostorGameRuleError("你已经提交过任务选择");
  const next = cloneState(state);
  next.missionChoices[userId] = missionSubmission(next, userId, choice, false);
  return allSubmitted(next, next.missionChoices, next.missionTeamUserIds) ? settleMission(next, now) : next;
}

function missionSubmission(state: ImpostorGameState, userId: string, choice: ImpostorMissionChoice, automatic: boolean): ImpostorMissionSubmission {
  const confused = (state.nightChaosCounts[userId] ?? 0) % 2 === 1;
  return {
    choice,
    automatic,
    effectiveChoice: confused ? (choice === "protect" ? "sabotage" : "protect") : choice,
  };
}

function settleMission(state: ImpostorGameState, now: Date): ImpostorGameState {
  const next = cloneState(state);
  const failed = Object.values(next.missionChoices).some((submission) => submission.effectiveChoice === "sabotage");
  if (failed) next.failures += 1;
  else next.successes += 1;
  next.history.push({
    day: next.day,
    isolatedUserIds: [...next.isolatedUserIds],
    missionTeamUserIds: [...next.missionTeamUserIds],
    result: failed ? "failure" : "success",
    missionChoices: cloneState(next).missionChoices,
    nightActions: cloneState(next).nightActions,
  });
  if (next.successes >= 3) {
    next.phase = "assassination";
    next.deadlineAt = deadline(now, 90);
    return next;
  }
  if (next.failures >= 3) {
    next.phase = "accusation";
    next.deadlineAt = deadline(now, 90);
    next.accusation = { attempt: 1, candidateUserIds: playerIds(next), ballots: {} };
    return next;
  }
  const bonusActors = next.players.flatMap((player) => {
    const submission = next.missionChoices[player.userId];
    if (!submission || submission.automatic) return [];
    if (player.role === "impostor" && submission.choice === "protect") return [player.userId];
    if (player.role !== "impostor" && submission.choice === "sabotage") return [player.userId];
    return [];
  });
  next.day += 1;
  return beginNight(next, now, bonusActors);
}

export function submitImpostorAssassination(state: ImpostorGameState, userId: string, targetUserId: string) {
  assertPlayer(state, userId);
  if (state.phase !== "assassination" || roleOf(state, userId) !== "impostor") throw new ImpostorGameRuleError("只有伪人可以进行刺杀");
  if (targetUserId === userId || !roleOf(state, targetUserId)) throw new ImpostorGameRuleError("请选择有效的刺杀目标");
  const next = cloneState(state);
  next.assassinationTargetUserId = targetUserId;
  return roleOf(next, targetUserId) === "detective"
    ? endGame(next, "impostor", "伪人成功刺杀侦探")
    : endGame(next, "good", "伪人未能刺杀侦探");
}

export function submitImpostorAccusation(state: ImpostorGameState, userId: string, targetUserId: string | null, now = new Date()) {
  assertPlayer(state, userId);
  if (state.phase !== "accusation" || !state.accusation) throw new ImpostorGameRuleError("当前不是最终指认阶段");
  if (Object.prototype.hasOwnProperty.call(state.accusation.ballots, userId)) throw new ImpostorGameRuleError("你已经提交过最终指认");
  if (targetUserId === userId) throw new ImpostorGameRuleError("不能指认自己");
  if (targetUserId && !state.accusation.candidateUserIds.includes(targetUserId)) throw new ImpostorGameRuleError("指认目标无效");
  const next = cloneState(state);
  next.accusation!.ballots[userId] = targetUserId;
  return allSubmitted(next, next.accusation!.ballots) ? settleAccusation(next, now) : next;
}

function settleAccusation(state: ImpostorGameState, now: Date): ImpostorGameState {
  const next = cloneState(state);
  const accusation = next.accusation!;
  const counts = new Map(accusation.candidateUserIds.map((id) => [id, 0]));
  for (const target of Object.values(accusation.ballots)) if (target && counts.has(target)) counts.set(target, (counts.get(target) ?? 0) + 1);
  const highest = Math.max(0, ...counts.values());
  if (highest === 0) return endGame(next, "impostor", "最终指认无人获得有效票");
  const leaders = [...counts.entries()].filter(([, count]) => count === highest).map(([id]) => id);
  if (leaders.length === 1) {
    return roleOf(next, leaders[0]) === "impostor"
      ? endGame(next, "good", "成功指认伪人")
      : endGame(next, "impostor", "最终指认错误");
  }
  if (accusation.attempt >= 2) return endGame(next, "impostor", "第二次最终指认仍然平票");
  next.accusation = { attempt: 2, candidateUserIds: leaders, ballots: {} };
  next.deadlineAt = deadline(now, 90);
  return next;
}

export function advanceExpiredImpostorGame(state: ImpostorGameState, now = new Date(), randomIndex: RandomIndex = defaultRandomIndex) {
  let next = cloneState(state);
  for (let guard = 0; guard < 12; guard += 1) {
    if (!next.deadlineAt || new Date(next.deadlineAt).getTime() > now.getTime() || next.phase === "ended") return next;
    if (next.phase === "night") {
      for (const userId of next.nightEligibleUserIds) if (!Object.prototype.hasOwnProperty.call(next.nightActions, userId)) next.nightActions[userId] = { type: "skip", targetUserIds: [] };
      next = settleNight(next, now, randomIndex);
    } else if (next.phase === "clue") {
      for (const userId of playerIds(next)) if (!Object.prototype.hasOwnProperty.call(next.clues, userId)) next.clues[userId] = null;
      next = revealClues(next, now, randomIndex);
    } else if (next.phase === "day_vote") {
      for (const userId of playerIds(next)) if (!Object.prototype.hasOwnProperty.call(next.nomination!.ballots, userId)) next.nomination!.ballots[userId] = [];
      next = settleNomination(next, now);
    } else if (next.phase === "mission") {
      for (const userId of next.missionTeamUserIds) if (!Object.prototype.hasOwnProperty.call(next.missionChoices, userId)) next.missionChoices[userId] = missionSubmission(next, userId, "protect", true);
      next = settleMission(next, now);
    } else if (next.phase === "assassination") {
      next = endGame(next, "good", "伪人刺杀超时");
    } else if (next.phase === "accusation") {
      for (const userId of playerIds(next)) if (!Object.prototype.hasOwnProperty.call(next.accusation!.ballots, userId)) next.accusation!.ballots[userId] = null;
      next = settleAccusation(next, now);
    }
  }
  return next;
}

export function terminateImpostorGame(state: ImpostorGameState) {
  if (state.phase === "ended") return cloneState(state);
  return endGame(state, "draw", "房主终止了本局游戏");
}

export function impostorRoleLabel(role: ImpostorRole) {
  return role === "detective" ? "侦探" : role === "impostor" ? "伪人" : "平民";
}
