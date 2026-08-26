import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceExpiredImpostorGame,
  createImpostorGame,
  submitImpostorAccusation,
  submitImpostorAssassination,
  submitImpostorClue,
  submitImpostorMissionChoice,
  submitImpostorNightAction,
  submitImpostorNomination,
  submitImpostorReady,
  terminateImpostorGame,
  type ImpostorGameState,
} from "./impostorGame.js";

const users = ["u1", "u2", "u3", "u4"];
const fixedRandom = () => 0;
const now = new Date("2026-08-25T00:00:00.000Z");

function firstNightResolved() {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const detective = state.players.find((player) => player.role === "detective")!;
  state = submitImpostorNightAction(state, impostor.userId, { type: "skip", targetUserIds: [] }, now, fixedRandom);
  state = submitImpostorNightAction(state, detective.userId, { type: "skip", targetUserIds: [] }, now, fixedRandom);
  state = advanceExpiredImpostorGame(state, new Date(now.getTime() + 30_001), fixedRandom);
  for (const userId of users) state = submitImpostorReady(state, userId, now);
  return state;
}

function reachMission(state: ImpostorGameState) {
  const required = state.nomination!.required;
  const selected = state.nomination!.candidateUserIds.slice(0, required);
  for (const userId of users) state = submitImpostorNomination(state, userId, selected, now);
  return state;
}

test("4-6 人可创建且固定一名侦探、一名伪人", () => {
  for (const count of [4, 5, 6]) {
    const state = createImpostorGame(users.concat(["u5", "u6"]).slice(0, count), 1, now, fixedRandom);
    assert.equal(state.players.filter((player) => player.role === "detective").length, 1);
    assert.equal(state.players.filter((player) => player.role === "impostor").length, 1);
    assert.equal(state.players.filter((player) => player.role === "civilian").length, count - 2);
  }
  assert.throws(() => createImpostorGame(users.slice(0, 3), 1, now, fixedRandom), /需要 4-6 名/);
});

test("第一夜固定持续30秒，行动全部提交也不会提前结束", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const detective = state.players.find((player) => player.role === "detective")!;
  state = submitImpostorNightAction(state, impostor.userId, { type: "skip", targetUserIds: [] }, now, fixedRandom);
  state = submitImpostorNightAction(state, detective.userId, { type: "skip", targetUserIds: [] }, now, fixedRandom);
  assert.equal(state.phase, "night");
  assert.equal(state.deadlineAt, "2026-08-25T00:00:30.000Z");
  state = advanceExpiredImpostorGame(state, new Date(now.getTime() + 30_001), fixedRandom);
  assert.equal(state.phase, "day_ready");
  assert.equal(state.deadlineAt, null);
  assert.equal(state.day, 1);
});

test("白天不设倒计时，全部游戏者准备后才进入任务投票", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.phase, "day_ready");
  assert.equal(state.deadlineAt, null);
  for (const userId of users.slice(0, -1)) state = submitImpostorReady(state, userId, now);
  assert.equal(state.phase, "day_ready");
  state = submitImpostorReady(state, users.at(-1)!, now);
  assert.equal(state.phase, "day_vote");
  assert.equal(state.nomination?.required, 2);
  assert.equal(state.deadlineAt, "2026-08-25T00:01:00.000Z");
});

test("任务人选截断位平票时只对平票候选重投", () => {
  let state = firstNightResolved();
  state = submitImpostorNomination(state, "u1", ["u1", "u2"], now);
  state = submitImpostorNomination(state, "u2", ["u1", "u3"], now);
  state = submitImpostorNomination(state, "u3", ["u1", "u4"], now);
  state = submitImpostorNomination(state, "u4", ["u2", "u3"], now);
  assert.equal(state.phase, "day_vote");
  assert.deepEqual(state.nomination?.lockedUserIds, ["u1"]);
  assert.deepEqual(state.nomination?.candidateUserIds, ["u2", "u3"]);
  assert.equal(state.nomination?.required, 1);
  assert.equal(state.deadlineAt, "2026-08-25T00:01:00.000Z");
  for (const userId of users) state = submitImpostorNomination(state, userId, ["u2"], now);
  assert.equal(state.phase, "mission");
  assert.deepEqual(state.missionTeamUserIds, ["u1", "u2"]);
});

test("平票重投后拒绝旧投票界面的迟到提交", () => {
  let state = firstNightResolved();
  state = submitImpostorNomination(state, "u1", ["u1", "u2"], now, 1);
  state = submitImpostorNomination(state, "u2", ["u1", "u3"], now, 1);
  state = submitImpostorNomination(state, "u3", ["u1", "u4"], now, 1);
  state = submitImpostorNomination(state, "u4", ["u2", "u3"], now, 1);
  assert.equal(state.nomination?.attempt, 2);
  assert.throws(
    () => submitImpostorNomination(state, "u1", ["u2"], now, 1),
    /投票轮次已更新/,
  );

  state.phase = "accusation";
  state.accusation = { attempt: 2, candidateUserIds: ["u2", "u3"], ballots: {} };
  assert.throws(
    () => submitImpostorAccusation(state, "u1", "u2", now, 1),
    /公投轮次已更新/,
  );
});

test("偶数次混乱抵消，奇数次混乱反转任务选择", () => {
  let state = firstNightResolved();
  state = reachMission(state);
  const target = state.missionTeamUserIds[0];
  state.nightChaosCounts[target] = 2;
  for (const userId of state.missionTeamUserIds) state = submitImpostorMissionChoice(state, userId, "protect", now);
  assert.equal(state.successes, 1);

  state = firstNightResolved();
  state = reachMission(state);
  const oddTarget = state.missionTeamUserIds[0];
  state.nightChaosCounts[oddTarget] = 3;
  for (const userId of state.missionTeamUserIds) state = submitImpostorMissionChoice(state, userId, "protect", now);
  assert.equal(state.failures, 1);
});

test("隔离人数被限制，四人局第三天始终保留三名候选人", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  state.day = 3;
  state.nightEligibleUserIds = [...users];
  state.nightActions = {};
  state.phase = "night";
  for (let index = 0; index < users.length; index += 1) {
    state = submitImpostorNightAction(state, users[index], { type: "isolate", targetUserIds: [users[(index + 1) % users.length]] }, now, fixedRandom);
  }
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.phase, "clue");
  assert.equal(state.isolatedUserIds.length, 1);
});

test("守护同时抵消目标受到的混乱和隔离", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  state.day = 2;
  state.nightEligibleUserIds = ["u1", "u2", "u3"];
  state.nightActions = {};
  state.phase = "night";
  state = submitImpostorNightAction(state, "u1", { type: "chaos", targetUserIds: ["u4"] }, now, fixedRandom);
  state = submitImpostorNightAction(state, "u2", { type: "isolate", targetUserIds: ["u4"] }, now, fixedRandom);
  state = submitImpostorNightAction(state, "u3", { type: "guard", targetUserIds: ["u4"] }, now, fixedRandom);
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.phase, "day_ready");
  assert.equal(state.nightChaosCounts.u4, undefined);
  assert.deepEqual(state.isolatedUserIds, []);
});

test("任务超时自动守护且不授予伪人奖励行动", () => {
  let state = reachMission(firstNightResolved());
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.successes, 1);
  assert.equal(state.phase, "night");
  assert.equal(state.day, 2);
  assert.equal(state.nightEligibleUserIds.length, 0);
  assert.ok(Object.values(state.history[0].missionChoices).every((choice) => choice.automatic));
});

test("完整五天可依次经过夜晚、准备、投票、任务与第三夜线索", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  const expireNight = () => {
    state = advanceExpiredImpostorGame(state, new Date(now.getTime() + 30_001), fixedRandom);
  };
  const readyAll = () => {
    for (const userId of users) state = submitImpostorReady(state, userId, now);
  };
  const nominate = () => {
    const selected = state.nomination!.candidateUserIds.slice(0, state.nomination!.required);
    const attempt = state.nomination!.attempt;
    for (const userId of users) state = submitImpostorNomination(state, userId, selected, now, attempt);
  };
  const completeMission = (result: "success" | "failure") => {
    for (const [index, userId] of state.missionTeamUserIds.entries()) {
      state = submitImpostorMissionChoice(state, userId, result === "failure" && index === 0 ? "sabotage" : "protect", now);
    }
  };

  expireNight(); readyAll(); nominate(); completeMission("success");
  assert.equal(state.day, 2);
  assert.equal(state.phase, "night");

  expireNight(); readyAll(); nominate(); completeMission("failure");
  assert.equal(state.day, 3);
  assert.equal(state.phase, "night");

  expireNight();
  assert.equal(state.phase, "clue");
  for (const userId of users) state = submitImpostorClue(state, userId, userId === "u1" ? "注意票型" : null, now, fixedRandom);
  assert.equal(state.phase, "day_ready");
  assert.equal(state.publicClues.length, 1);
  readyAll(); nominate(); completeMission("success");

  assert.equal(state.day, 4);
  expireNight(); readyAll(); nominate(); completeMission("failure");
  assert.equal(state.day, 5);
  expireNight(); readyAll(); nominate(); completeMission("success");

  assert.equal(state.phase, "assassination");
  assert.equal(state.successes, 3);
  assert.equal(state.failures, 2);
  assert.deepEqual(state.history.map((item) => item.day), [1, 2, 3, 4, 5]);
});

test("三次成功进入刺杀，刺中侦探则伪人获胜", () => {
  let state = firstNightResolved();
  state.successes = 2;
  state = reachMission(state);
  for (const userId of state.missionTeamUserIds) state = submitImpostorMissionChoice(state, userId, "protect", now);
  assert.equal(state.phase, "assassination");
  assert.equal(state.deadlineAt, "2026-08-25T00:01:30.000Z");
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const detective = state.players.find((player) => player.role === "detective")!;
  state = submitImpostorAssassination(state, impostor.userId, detective.userId);
  assert.equal(state.winner, "impostor");
});

test("最终指认第二次仍平票时伪人胜利", () => {
  let state = firstNightResolved();
  state.phase = "accusation";
  state.accusation = { attempt: 1, candidateUserIds: [...users], ballots: {} };
  state = submitImpostorAccusation(state, "u1", "u3", now);
  state = submitImpostorAccusation(state, "u2", "u4", now);
  state = submitImpostorAccusation(state, "u3", "u4", now);
  state = submitImpostorAccusation(state, "u4", "u3", now);
  assert.equal(state.accusation?.attempt, 2);
  assert.equal(state.deadlineAt, "2026-08-25T00:01:00.000Z");
  state = submitImpostorAccusation(state, "u1", "u3", now);
  state = submitImpostorAccusation(state, "u2", "u4", now);
  state = submitImpostorAccusation(state, "u3", "u4", now);
  state = submitImpostorAccusation(state, "u4", "u3", now);
  assert.equal(state.winner, "impostor");
  assert.match(state.endReason ?? "", /第二次/);
});

test("投票超时未提交者按弃票结算", () => {
  let state = firstNightResolved();
  state = submitImpostorNomination(state, "u1", ["u1", "u2"], now);
  state = submitImpostorNomination(state, "u2", ["u1", "u2"], now);
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.phase, "mission");
  assert.deepEqual(state.missionTeamUserIds, ["u1", "u2"]);

  state = firstNightResolved();
  state.phase = "accusation";
  state.accusation = { attempt: 1, candidateUserIds: [...users], ballots: { u1: "u2", u2: "u2" } };
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.phase, "ended");
  assert.match(state.endReason ?? "", /指认/);
});

test("已经结算的对局不能被终止操作改写为平局", () => {
  let state = firstNightResolved();
  state.phase = "assassination";
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const detective = state.players.find((player) => player.role === "detective")!;
  state = submitImpostorAssassination(state, impostor.userId, detective.userId);
  const terminated = terminateImpostorGame(state);
  assert.equal(terminated.winner, "impostor");
  assert.match(terminated.endReason ?? "", /刺杀/);
});
