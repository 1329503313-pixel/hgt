import assert from "node:assert/strict";
import test from "node:test";
import { canCommitOnlineSoupAiQuestion, selectAllowedSupplementSurfaceIndices } from "./onlineSoupAiState.js";

test("只有当前 AI 回合中未撤回且版本一致的活跃提问可以提交终审", () => {
  const active = { aiStatus: "scoring", recalledAt: null, roundStatus: "playing", hostMode: "ai", aiVersion: 3 };
  assert.equal(canCommitOnlineSoupAiQuestion(active, 3), true);
  assert.equal(canCommitOnlineSoupAiQuestion({ ...active, recalledAt: new Date() }, 3), false);
  assert.equal(canCommitOnlineSoupAiQuestion({ ...active, aiStatus: "cancelled" }, 3), false);
  assert.equal(canCommitOnlineSoupAiQuestion({ ...active, roundStatus: "ended" }, 3), false);
  assert.equal(canCommitOnlineSoupAiQuestion({ ...active, hostMode: "human" }, 3), false);
  assert.equal(canCommitOnlineSoupAiQuestion(active, 4), false);
});

test("补充汤面只在安全进度区间按模型建议新增一条", () => {
  assert.deepEqual(selectAllowedSupplementSurfaceIndices([2, 1], [1], 3, 45), [2]);
  assert.deepEqual(selectAllowedSupplementSurfaceIndices([2], [], 3, 20), []);
  assert.deepEqual(selectAllowedSupplementSurfaceIndices([2], [], 3, 80), []);
  assert.deepEqual(selectAllowedSupplementSurfaceIndices([9, -1], [], 3, 45), []);
});
