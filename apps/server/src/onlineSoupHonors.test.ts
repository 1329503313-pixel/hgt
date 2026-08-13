import assert from "node:assert/strict";
import test from "node:test";
import { parseOnlineSoupAiHonors, selectOnlineSoupAiHonors, type OnlineSoupHonorQuestion } from "./onlineSoupHonors.js";

function question(overrides: Partial<OnlineSoupHonorQuestion> = {}): OnlineSoupHonorQuestion {
  return {
    id: "q1",
    sequence: "1",
    questionNumber: 1,
    senderId: "u1",
    senderNickname: "甲",
    senderAvatar: "/api/media/users/u1/avatar",
    content: "问题一？",
    answer: "yes",
    progressDelta: 10,
    ...overrides,
  };
}

test("MVP 按用户累计进度评选，最佳提问按单题进度评选", () => {
  const honors = selectOnlineSoupAiHonors([
    question(),
    question({ id: "q2", sequence: "2", questionNumber: 2, progressDelta: 12 }),
    question({ id: "q3", sequence: "3", questionNumber: 3, senderId: "u2", senderNickname: "乙", progressDelta: 20 }),
  ]);
  assert.equal(honors?.mvp.userId, "u1");
  assert.equal(honors?.mvp.progressContribution, 22);
  assert.equal(honors?.bestQuestion.messageId, "q3");
  assert.equal(honors?.bestQuestion.progressDelta, 20);
});

test("累计或单题进度平分时优先更早取得有效进度者", () => {
  const honors = selectOnlineSoupAiHonors([
    question({ id: "late", sequence: "20", senderId: "u2", senderNickname: "乙", progressDelta: 15 }),
    question({ id: "early", sequence: "10", senderId: "u1", senderNickname: "甲", progressDelta: 15 }),
  ]);
  assert.equal(honors?.mvp.userId, "u1");
  assert.equal(honors?.bestQuestion.messageId, "early");
});

test("零进度或没有最终 AI 回答的提问不参与评选", () => {
  assert.equal(selectOnlineSoupAiHonors([
    question({ progressDelta: 0 }),
    question({ id: "pending", answer: "", progressDelta: 30 }),
  ]), null);
});

test("持久化评选快照可以安全解析，损坏内容返回空", () => {
  const honors = selectOnlineSoupAiHonors([question()]);
  assert.deepEqual(parseOnlineSoupAiHonors(JSON.stringify(honors)), honors);
  assert.equal(parseOnlineSoupAiHonors("not-json"), null);
});
