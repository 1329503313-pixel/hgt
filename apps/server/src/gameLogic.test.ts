import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAtomicProgress,
  canRequestRoomAiHint,
  compactRoomAiHistory,
  completedProgressKeyIds,
  gameSessionStatus,
  normalizeAtomicFacts,
  normalizeFactMatches,
  normalizeHintDimension,
  normalizeOrdinaryGameAnswer,
  renderProgressiveHint,
  renderSafeHint,
  roomAiQuestionRisks,
  roomAiProgressFeedback,
  shouldPublishRoomAiStallHint,
  toPublicGameMessages,
  trimRoomAiHistory,
} from "./gameLogic.js";

test("AI 主持公开消息只返回 answer，不暴露关键事实", () => {
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

test("多人房间提示按请求次数逐层收窄但不直接泄底", () => {
  assert.equal(renderProgressiveHint("动机", 1), renderSafeHint("动机"));
  assert.match(renderProgressiveHint("动机", 2), /谁最希望/);
  assert.match(renderProgressiveHint("动机", 3), /利益、情感、恐惧和误解/);
  assert.equal(renderProgressiveHint("动机", 99), renderProgressiveHint("动机", 3));
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

test("90% 不再要求复述，只有 100% 才完成", () => {
  assert.equal(gameSessionStatus(89, false), "active");
  assert.equal(gameSessionStatus(90, false), "active");
  assert.equal(gameSessionStatus(100, true), "completed");
});

test("房间 AI 只携带最近十二轮上下文", () => {
  const history = Array.from({ length: 30 }, (_, index) => index + 1);
  assert.deepEqual(trimRoomAiHistory(history), history.slice(6));
  assert.deepEqual(trimRoomAiHistory(history, 4), [27, 28, 29, 30]);
});

test("房间 AI 压缩历史只保留最近五轮并移除内部计分字段", () => {
  const history = Array.from({ length: 14 }, (_, index) => index % 2 === 0
    ? { role: "user" as const, content: `问题 ${index}` }
    : { role: "assistant" as const, content: JSON.stringify({ answer: "是", progress: index, revealedKeyIds: [1, 2] }) });
  const compacted = compactRoomAiHistory(history);
  assert.equal(compacted.length, 10);
  assert.deepEqual(compacted.at(-1), { role: "assistant", content: "是" });
  assert.equal(JSON.stringify(compacted).includes("revealedKeyIds"), false);
});

test("可以识别复杂否定、多重判断与含糊指代风险", () => {
  assert.deepEqual(roomAiQuestionRisks("死者认识凶手吗？"), []);
  assert.deepEqual(roomAiQuestionRisks("他认识死者吗？"), ["ambiguous_reference"]);
  assert.ok(roomAiQuestionRisks("他不是没有见过死者吗？").includes("negation"));
  assert.ok(roomAiQuestionRisks("他认识死者吗？他同时拿走了钥匙吗？").includes("multiple_claims"));
});

test("每次进度核对都会产生可行动的正反馈", () => {
  assert.equal(roomAiProgressFeedback(12, 1, 0).text, "确认了新的关键信息，进度 +12%");
  assert.equal(roomAiProgressFeedback(0, 1, 0).kind, "duplicate");
  assert.equal(roomAiProgressFeedback(0, 0, 1).kind, "close");
  assert.equal(roomAiProgressFeedback(0, 0, 0, ["multiple_claims"]).kind, "ambiguous");
  assert.equal(roomAiProgressFeedback(0, 0, 0).kind, "off_track");
});

test("连续 10 题无进展时只发布一次方向提示", () => {
  assert.equal(shouldPublishRoomAiStallHint(Array(9).fill(0)), false);
  assert.equal(shouldPublishRoomAiStallHint(Array(10).fill(0)), true);
  assert.equal(shouldPublishRoomAiStallHint(Array(11).fill(0)), false);
  assert.equal(shouldPublishRoomAiStallHint([...Array(10).fill(0), 5]), true);
});

test("房间 AI 提示仅在有效推理进度内开放", () => {
  assert.equal(canRequestRoomAiHint(19), false);
  assert.equal(canRequestRoomAiHint(20), true);
  assert.equal(canRequestRoomAiHint(99), true);
  assert.equal(canRequestRoomAiHint(100), false);
  assert.equal(canRequestRoomAiHint(Number.NaN), false);
});
