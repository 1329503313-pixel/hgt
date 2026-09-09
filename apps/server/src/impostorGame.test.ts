import assert from "node:assert/strict";
import test from "node:test";
import {
  IMPOSTOR_MISSION_SIZES,
  advanceExpiredImpostorGame,
  createImpostorGame,
  impostorAccusationResultMessages,
  impostorNightActionTargetCount,
  startImpostorAssassination,
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

function reachMission(state: ImpostorGameState, requestedTeam?: string[]) {
  const required = state.nomination!.required;
  const selected = requestedTeam ?? state.nomination!.candidateUserIds.slice(0, required);
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

test("侦探第一夜查验也可把自己作为两名不同目标之一", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const detective = state.players.find((player) => player.role === "detective")!;
  state = submitImpostorNightAction(state, detective.userId, {
    type: "investigate",
    targetUserIds: [detective.userId, impostor.userId],
  }, now, fixedRandom);
  state = submitImpostorNightAction(state, impostor.userId, { type: "skip", targetUserIds: [] }, now, fixedRandom);
  assert.deepEqual(state.investigations, {});
  state = advanceExpiredImpostorGame(state, new Date(now.getTime() + 30_001), fixedRandom);
  assert.equal(state.investigations[detective.userId]?.reportedHasImpostor, true);
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
  assert.deepEqual(IMPOSTOR_MISSION_SIZES.slice(1), [2, 2, 2, 2, 2]);
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

test("隔离与连续任务限制同时生效时仍保留两名任务候选人", () => {
  let state = reachMission(firstNightResolved(), ["u1", "u2"]);
  for (const userId of state.missionTeamUserIds) state = submitImpostorMissionChoice(state, userId, "protect", now);
  assert.equal(state.day, 2);
  state.nightActions = {
    u1: { type: "isolate", targetUserIds: ["u3"] },
    u2: { type: "isolate", targetUserIds: ["u4"] },
  };
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.phase, "day_ready");
  assert.deepEqual(state.isolatedUserIds, []);
  for (const userId of users) state = submitImpostorReady(state, userId, now);
  assert.deepEqual(state.nomination?.candidateUserIds.sort(), ["u3", "u4"]);
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

test("侦探和平民均可查验含自己的两名玩家，混乱判定后才生成各自结果", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const detective = state.players.find((player) => player.role === "detective")!;
  const civilian = state.players.find((player) => player.role === "civilian")!;
  state.day = 2;
  state.phase = "night";
  state.nightEligibleUserIds = [impostor.userId, detective.userId, civilian.userId];
  state.nightActions = {};
  state = submitImpostorNightAction(state, detective.userId, {
    type: "investigate",
    targetUserIds: [detective.userId, impostor.userId],
  }, now, fixedRandom);
  state = submitImpostorNightAction(state, civilian.userId, {
    type: "investigate",
    targetUserIds: [civilian.userId, detective.userId],
  }, now, fixedRandom);
  state = submitImpostorNightAction(state, impostor.userId, {
    type: "chaos",
    targetUserIds: [civilian.userId],
  }, now, fixedRandom);
  assert.deepEqual(state.investigations, {});
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.investigations[detective.userId]?.reportedHasImpostor, true);
  assert.equal(state.investigations[civilian.userId]?.reportedHasImpostor, true);
});

test("伪人参与并主动破坏任务仍获得下一夜技能，非守护时只选择一人", () => {
  let state = firstNightResolved();
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const teammate = state.nomination!.candidateUserIds.find((userId) => userId !== impostor.userId)!;
  state = reachMission(state, [impostor.userId, teammate]);
  state = submitImpostorMissionChoice(state, impostor.userId, "sabotage", now);
  state = submitImpostorMissionChoice(state, teammate, "protect", now);
  assert.equal(state.phase, "night");
  assert.ok(state.nightEligibleUserIds.includes(impostor.userId));
  assert.equal(impostorNightActionTargetCount(state, impostor.userId, "chaos"), 1);
});

test("伪人参与任务并超时自动守护时获得双目标夜间技能", () => {
  let state = firstNightResolved();
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const teammate = state.nomination!.candidateUserIds.find((userId) => userId !== impostor.userId)!;
  state = reachMission(state, [impostor.userId, teammate]);
  state.deadlineAt = new Date(now.getTime() - 1).toISOString();
  state = advanceExpiredImpostorGame(state, now, fixedRandom);
  assert.equal(state.successes, 1);
  assert.equal(state.phase, "night");
  assert.equal(state.day, 2);
  assert.deepEqual(state.nightEligibleUserIds, [impostor.userId]);
  assert.equal(impostorNightActionTargetCount(state, impostor.userId, "guard"), 2);
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

  assert.equal(state.phase, "accusation");
  assert.equal(state.successes, 3);
  assert.equal(state.failures, 2);
  assert.equal(state.deadlineAt, "2026-08-25T00:05:00.000Z");
  assert.deepEqual(state.history.map((item) => item.day), [1, 2, 3, 4, 5]);
  assert.ok(state.history.every((item) => item.missionTeamUserIds.length === 2));
  for (let index = 1; index < state.history.length; index += 1) {
    assert.ok(state.history[index].missionTeamUserIds.every((userId) => !state.history[index - 1].missionTeamUserIds.includes(userId)));
  }
});

test("伪人可在任意进行中阶段发起60秒刺杀并立即中止原进程", () => {
  let state = firstNightResolved();
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const detective = state.players.find((player) => player.role === "detective")!;
  assert.equal(state.phase, "day_vote");
  state = startImpostorAssassination(state, impostor.userId, now);
  assert.equal(state.phase, "assassination");
  assert.equal(state.deadlineAt, "2026-08-25T00:01:00.000Z");
  assert.equal(state.nomination, null);
  state = submitImpostorAssassination(state, impostor.userId, detective.userId);
  assert.equal(state.winner, "impostor");
});

test("刺杀错误或60秒超时均由好人获胜", () => {
  let state = createImpostorGame(users, 1, now, fixedRandom);
  const impostor = state.players.find((player) => player.role === "impostor")!;
  const civilian = state.players.find((player) => player.role === "civilian")!;
  state = startImpostorAssassination(state, impostor.userId, now);
  state = submitImpostorAssassination(state, impostor.userId, civilian.userId);
  assert.equal(state.winner, "good");

  state = startImpostorAssassination(createImpostorGame(users, 2, now, fixedRandom), impostor.userId, now);
  state = advanceExpiredImpostorGame(state, new Date(now.getTime() + 60_001), fixedRandom);
  assert.equal(state.winner, "good");
  assert.match(state.endReason ?? "", /60秒/);
});

test("四次任务成功时好人立即胜利，三次任务失败时伪人立即胜利", () => {
  let state = reachMission(firstNightResolved());
  state.successes = 3;
  for (const userId of state.missionTeamUserIds) state = submitImpostorMissionChoice(state, userId, "protect", now);
  assert.equal(state.winner, "good");
  assert.match(state.endReason ?? "", /四次成功/);

  state = reachMission(firstNightResolved());
  state.failures = 2;
  for (const [index, userId] of state.missionTeamUserIds.entries()) {
    state = submitImpostorMissionChoice(state, userId, index === 0 ? "sabotage" : "protect", now);
  }
  assert.equal(state.winner, "impostor");
  assert.match(state.endReason ?? "", /三次失败/);
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
  const firstResult = structuredClone(state.accusationResults![0]);
  assert.deepEqual(firstResult, { attempt: 1, voteCounts: [
    { userId: "u1", votes: 0 }, { userId: "u2", votes: 0 }, { userId: "u3", votes: 2 }, { userId: "u4", votes: 2 },
  ], abstainedCount: 0 });
  assert.equal(state.deadlineAt, "2026-08-25T00:05:00.000Z");
  state = submitImpostorAccusation(state, "u1", "u3", now);
  state = submitImpostorAccusation(state, "u2", "u4", now);
  state = submitImpostorAccusation(state, "u3", "u4", now);
  const beforeLastVote = state;
  state = submitImpostorAccusation(state, "u4", "u3", now);
  assert.equal(state.winner, "impostor");
  assert.match(state.endReason ?? "", /第二次/);
  assert.deepEqual(state.accusationResults, [firstResult, { ...firstResult, attempt: 2 }]);
  assert.deepEqual(impostorAccusationResultMessages(beforeLastVote, state, (id) => `${id.slice(1)}号 玩家${id.slice(1)}`), [
    "最终指认结果（第1局，第2轮）：1号 玩家1：0票；2号 玩家2：0票；3号 玩家3：2票；4号 玩家4：2票；弃权/超时弃票：0票。",
  ]);
  assert.deepEqual(impostorAccusationResultMessages(state, structuredClone(state), (id) => id), []);
});

test("最终指认完成后公开全部4-6名玩家得票，包含最后一票、零票与弃权", () => {
  for (const count of [4, 5, 6]) {
    const players = users.concat(["u5", "u6"]).slice(0, count);
    let state = createImpostorGame(players, 8, now, fixedRandom);
    const initial = structuredClone(state);
    const impostorId = state.players.find((player) => player.role === "impostor")!.userId;
    state.phase = "accusation";
    state.accusation = { attempt: 1, candidateUserIds: players, ballots: {} };
    for (const [index, userId] of players.entries()) {
      const before = state;
      state = submitImpostorAccusation(state, userId, userId === impostorId ? null : impostorId, now);
      if (index < count - 1) {
        assert.deepEqual(state.accusationResults, []);
        assert.deepEqual(impostorAccusationResultMessages(before, state, (id) => id), []);
      }
    }
    assert.equal(state.winner, "good");
    assert.equal(state.accusation, null);
    assert.deepEqual(state.accusationResults, [{ attempt: 1, voteCounts: players.map((userId) => ({ userId, votes: userId === impostorId ? count - 1 : 0 })), abstainedCount: 1 }]);
    const restored = JSON.parse(JSON.stringify(state)) as ImpostorGameState;
    const messages = impostorAccusationResultMessages(initial, restored, (id) => `${id.slice(1)}号 昵称${id.slice(1)}`);
    assert.equal(messages.length, 1);
    for (const userId of players) assert.ok(messages[0].includes(`${userId.slice(1)}号 昵称${userId.slice(1)}：${userId === impostorId ? count - 1 : 0}票`));
    assert.ok(messages[0].endsWith("弃权/超时弃票：1票。"));
    assert.deepEqual(createImpostorGame(players, 9, now, fixedRandom).accusationResults, []);
  }
});

test("最终指认超时和全员弃权仍公开所有玩家零票，兼容没有结果字段的旧存档", () => {
  for (const mode of ["partial", "timeout", "abstain"] as const) {
    let state = firstNightResolved();
    delete state.accusationResults;
    state.phase = "accusation";
    state.accusation = { attempt: 1, candidateUserIds: [...users], ballots: {} };
    const before = structuredClone(state);
    if (mode === "partial") state = submitImpostorAccusation(state, "u1", "u2", now);
    if (mode === "abstain") {
      for (const userId of users) state = submitImpostorAccusation(state, userId, null, now);
    } else {
      state.deadlineAt = now.toISOString();
      state = advanceExpiredImpostorGame(state, now, fixedRandom);
    }
    assert.equal(state.phase, "ended");
    assert.deepEqual(state.accusationResults, [{ attempt: 1, voteCounts: users.map((userId) => ({ userId, votes: mode === "partial" && userId === "u2" ? 1 : 0 })), abstainedCount: mode === "partial" ? 3 : 4 }]);
    assert.equal(impostorAccusationResultMessages(before, state, (id) => id).length, 1);
  }
});

test("最终指认被终止或刺杀打断时不公布尚未完成的票数", () => {
  let state = firstNightResolved();
  state.phase = "accusation";
  state.accusation = { attempt: 1, candidateUserIds: [...users], ballots: {} };
  state = submitImpostorAccusation(state, "u1", "u2", now);
  const impostorId = state.players.find((player) => player.role === "impostor")!.userId;
  for (const interrupted of [terminateImpostorGame(state), startImpostorAssassination(state, impostorId, now)]) {
    assert.deepEqual(interrupted.accusationResults, []);
    assert.deepEqual(impostorAccusationResultMessages(state, interrupted, (id) => id), []);
  }
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
