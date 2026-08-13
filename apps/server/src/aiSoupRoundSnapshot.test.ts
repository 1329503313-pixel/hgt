import assert from "node:assert/strict";
import test from "node:test";
import { parseAiSoupRoundSnapshot } from "./aiSoupRoundSnapshot.js";

const validSnapshot = {
  soupId: "soup-1",
  title: "测试汤",
  type: "本格",
  surface: "汤面",
  bottom: "汤底",
  manual: "主持手册",
  supplementalSurfaces: ["补充汤面"],
  supplementalBottoms: ["补充汤底"],
  keyFacts: [{ id: 1, content: "关键事实", weight: 100 }],
  atomicFacts: [{ id: 1, keyId: 1, content: "原子事实", weight: 100 }],
  contentHash: "hash",
};

test("AI 回合快照只接受完整且严格的冻结数据", () => {
  assert.deepEqual(parseAiSoupRoundSnapshot(JSON.stringify(validSnapshot)), validSnapshot);
  assert.equal(parseAiSoupRoundSnapshot({ ...validSnapshot, soupId: "" }), null);
  assert.equal(parseAiSoupRoundSnapshot({ ...validSnapshot, atomicFacts: [] }), null);
  assert.equal(parseAiSoupRoundSnapshot({ ...validSnapshot, unexpected: true }), null);
  assert.equal(parseAiSoupRoundSnapshot("not-json"), null);
});
