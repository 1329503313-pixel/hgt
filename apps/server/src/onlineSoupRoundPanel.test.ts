import assert from "node:assert/strict";
import test from "node:test";
import { canViewOnlineSoupHostMaterials, finalizeOnlineSoupRoundPanelPage, ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS, onlineSoupAiFinishDecision, onlineSoupAiProgressChange, onlineSoupAiProgressEvents, requiredOnlineSoupFinishVotes } from "./onlineSoupRoundPanel.js";

test("回合面板分页保留整页并返回下一游标", () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ message_sequence: index + 1, value: index + 1 }));
  const page = finalizeOnlineSoupRoundPanelPage(rows, 100, (row) => row.message_sequence);
  assert.equal(page.items.length, 100);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "100");
  assert.equal(rows.length, 101);
});

test("回合面板最后一页不生成多余游标", () => {
  const page = finalizeOnlineSoupRoundPanelPage([{ message_sequence: "8" }], 100, (row) => row.message_sequence);
  assert.equal(page.items.length, 1);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});

test("AI 主持模式下房主也不能查看私密主持资料", () => {
  assert.equal(canViewOnlineSoupHostMaterials(true, "human"), true);
  assert.equal(canViewOnlineSoupHostMaterials(true, "ai"), false);
  assert.equal(canViewOnlineSoupHostMaterials(false, "human"), false);
});

test("AI 问题进度只记录非负增量并以持久化累计值为准", () => {
  assert.deepEqual(onlineSoupAiProgressChange(35, 52), { delta: 17, after: 52 });
  assert.deepEqual(onlineSoupAiProgressChange(52, 40), { delta: 0, after: 52 });
  assert.deepEqual(onlineSoupAiProgressChange(95, 120), { delta: 5, after: 100 });
});

test("AI 房间 80% 按正式玩家半数投票结束，100% 无条件结束", () => {
  assert.equal(ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS, 80);
  assert.equal(requiredOnlineSoupFinishVotes(1), 1);
  assert.equal(requiredOnlineSoupFinishVotes(3), 2);
  assert.equal(requiredOnlineSoupFinishVotes(4), 2);
  assert.equal(onlineSoupAiFinishDecision(79, 4, 4), null);
  assert.equal(onlineSoupAiFinishDecision(80, 4, 1), null);
  assert.equal(onlineSoupAiFinishDecision(80, 4, 2), "vote");
  assert.equal(onlineSoupAiFinishDecision(100, 4, 0), "progress");
});

test("AI 进度跨越多个节点时先按升序发布里程碑，最后才发布 100% 完成", () => {
  assert.deepEqual(onlineSoupAiProgressEvents(0, 100), [
    { type: "milestone", progress: 20 },
    { type: "milestone", progress: 40 },
    { type: "milestone", progress: 60 },
    { type: "milestone", progress: 80 },
    { type: "completion", progress: 100 },
  ]);
  assert.deepEqual(onlineSoupAiProgressEvents(79, 100), [
    { type: "milestone", progress: 80 },
    { type: "completion", progress: 100 },
  ]);
  assert.deepEqual(onlineSoupAiProgressEvents(100, 80), []);
});
