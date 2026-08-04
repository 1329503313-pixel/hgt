import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAtomicProgress,
  completedProgressKeyIds,
  gameSessionStatus,
  normalizeAtomicFacts,
  normalizeFactMatches,
  normalizeHintDimension,
  normalizeOrdinaryGameAnswer,
  renderSafeHint,
  toPublicGameMessages,
} from "./gameLogic.js";

test("AI 玩汤公开消息只返回 answer，不暴露关键事实", () => {
  const messages = toPublicGameMessages([
    { role: "system", content: "完整汤底" },
    { role: "assistant", content: "欢迎开始推理" },
    { role: "user", content: "他认识死者吗？" },
    {
      role: "assistant",
      content: JSON.stringify({
        answer: "是",
        progress: 20,
        keyFacts: [{ id: 1, content: "不能公开的关键事实", weight: 20, revealed: false }],
      }),
    },
  ]);

  assert.deepEqual(messages, [
    { role: "assistant", content: "欢迎开始推理" },
    { role: "user", content: "他认识死者吗？" },
    { role: "assistant", content: "是" },
  ]);
  assert.equal(JSON.stringify(messages).includes("不能公开"), false);
});

test("普通 AI 回答严格限制为五种结论", () => {
  assert.equal(normalizeOrdinaryGameAnswer("是，因为他们认识", false), "是");
  assert.equal(normalizeOrdinaryGameAnswer("是也不是，方向接近", false), "是也不是");
  assert.equal(normalizeOrdinaryGameAnswer("完整汤底是秘密", false), null);
  assert.equal(normalizeOrdinaryGameAnswer("完整汤底是秘密", true), "完整汤底是秘密");
});

test("提示只接受固定维度并由服务端生成文案", () => {
  assert.equal(normalizeHintDimension("动机"), "动机");
  assert.equal(normalizeHintDimension("凶手是父亲"), null);
  assert.equal(renderSafeHint("动机"), "可以从人物的动机继续推理，关注促使事件发生的原因。");
});

test("原子事实权重按作者进度关键点确定性分摊", () => {
  const atoms = normalizeAtomicFacts([
    { keyId: 10, content: "人物真实身份是医生" },
    { keyId: 10, content: "人物隐瞒了职业" },
    { keyId: 20, content: "事件发生在过去" },
  ], [
    { id: 10, content: "人物身份与隐瞒行为", weight: 55 },
    { id: 20, content: "时间线发生在过去", weight: 45 },
  ]);

  assert.deepEqual(atoms.map((fact) => fact.weight), [28, 27, 45]);
  assert.equal(calculateAtomicProgress([1], atoms), 28);
  assert.deepEqual(completedProgressKeyIds([1], atoms), []);
  assert.deepEqual(completedProgressKeyIds([1, 2], atoms), [10]);
});

test("缺失的原子事实安全回退为原进度关键点", () => {
  const atoms = normalizeAtomicFacts([], [{ id: 7, content: "关键道具是一封信", weight: 100 }]);
  assert.deepEqual(atoms, [{ id: 1, keyId: 7, content: "关键道具是一封信", weight: 100 }]);
});

test("只有 DIRECT 和 STRONG 匹配可用于计分", () => {
  const matches = normalizeFactMatches([
    { factId: 1, grade: "weak" },
    { factId: 1, grade: "DIRECT" },
    { factId: 2, grade: "STRONG" },
    { factId: 3, grade: "NONE" },
    { factId: 99, grade: "DIRECT" },
  ], [1, 2, 3]);
  assert.deepEqual(matches, [
    { factId: 1, grade: "DIRECT" },
    { factId: 2, grade: "STRONG" },
    { factId: 3, grade: "NONE" },
  ]);
  assert.deepEqual(matches.filter((match) => match.grade === "DIRECT" || match.grade === "STRONG").map((match) => match.factId), [1, 2]);
});

test("会话状态明确区分推理、待复述和完成", () => {
  assert.equal(gameSessionStatus(89, false), "active");
  assert.equal(gameSessionStatus(90, false), "awaiting_retell");
  assert.equal(gameSessionStatus(100, true), "completed");
});
