import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomPage = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");
const dockContext = readFileSync(new URL("../src/context/OnlineSoupDockContext.tsx", import.meta.url), "utf8");

test("完整房间和迷你房间按提问消息自身快照展示剩余次数", () => {
  assert.match(roomPage, /剩余提问次数：\{message\.remainingQuestionCountAfter\}/);
  assert.match(dockContext, /剩余提问次数：\{message\.remainingQuestionCountAfter\}/);
  assert.doesNotMatch(roomPage, /remainingQuestionCount=\{snapshot\.room\.remainingQuestionCount\}/);
  assert.doesNotMatch(dockContext, /remainingQuestionCount=\{session\.snapshot\.room\.remainingQuestionCount\}/);
});
