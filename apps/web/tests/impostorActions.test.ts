import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { impostorActionKey, impostorActionPaths, pendingImpostorAction, submittedImpostorGame } from "../src/shared/impostorActions";
import { impostorFixture } from "./fixtures/impostorGame";

test("七个行动阶段仅展示本人未提交且未超时的待办", () => {
  for (const phase of Object.keys(impostorActionPaths) as Array<keyof typeof impostorActionPaths>) {
    const game = impostorFixture(phase);
    assert.equal(pendingImpostorAction(game, "u1", Date.now()), phase);
    assert.equal(pendingImpostorAction(submittedImpostorGame(game), "u1", Date.now()), null);
    assert.equal(pendingImpostorAction({ ...game, me: null }, "u1", Date.now()), null);
    assert.equal(pendingImpostorAction(game, "spectator", Date.now()), null);
    assert.equal(pendingImpostorAction({ ...game, deadlineAt: new Date(Date.now() - 1000).toISOString() }, "u1", Date.now()), null);
    assert.equal(pendingImpostorAction(game, "u1", Date.now()), phase, "提交标记不能修改服务端原快照");
  }
});

test("无技能、非任务成员、不可刺杀、缺少选举及已结束时不提供入口", () => {
  const night = impostorFixture();night.me!.nightActionTypes = [];
  assert.equal(pendingImpostorAction(night, "u1", Date.now()), null);
  const mission = impostorFixture("mission");mission.missionTeamUserIds = ["u2", "u3"];
  assert.equal(pendingImpostorAction(mission, "u1", Date.now()), null);
  const assassination = impostorFixture("assassination");assassination.me!.canAssassinate = false;
  assert.equal(pendingImpostorAction(assassination, "u1", Date.now()), null);
  assert.equal(pendingImpostorAction({ ...impostorFixture("day_vote"), nomination: null }, "u1", Date.now()), null);
  assert.equal(pendingImpostorAction({ ...impostorFixture("accusation"), accusation: null }, "u1", Date.now()), null);
  assert.equal(pendingImpostorAction(impostorFixture("ended"), "u1", Date.now()), null);
  assert.equal(pendingImpostorAction(null, "u1", Date.now()), null);
});

test("草稿身份区分房间、用户、局号、天数、阶段及每次平票重投", () => {
  const game = impostorFixture("day_vote");
  const key = impostorActionKey("room1", "u1", game);
  for (const candidate of [
    impostorActionKey("room2", "u1", game), impostorActionKey("room1", "u2", game),
    impostorActionKey("room1", "u1", { ...game, gameNumber: 2 }), impostorActionKey("room1", "u1", { ...game, day: 2 }),
    impostorActionKey("room1", "u1", { ...game, phase: "mission" }),
    impostorActionKey("room1", "u1", { ...game, nomination: { ...game.nomination!, attempt: 2 } }),
    impostorActionKey("room1", "u1", { ...game, accusation: { ...game.accusation!, attempt: 2 } }),
  ]) assert.notEqual(candidate, key);
});

test("完整房间的聊天和更多弹框共享行动实例，桌面与手机共用菜单", () => {
  const source = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/<ImpostorChatActionCard actions=\{impostorActions\}/g) ?? []).length, 2);
  assert.match(source, /<ImpostorActionDialog actions=\{impostorActions\}/);
  assert.match(source, /impostorActions\.pending && <FloatingAction/);
  assert.match(source, /renderHostActions\(\)/);
  assert.match(source, /renderHostActions\(true\)/);
});
