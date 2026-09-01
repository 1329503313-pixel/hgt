import assert from "node:assert/strict";
import test from "node:test";
import { onlineSoupQuestionLimitStartNotice, onlineSoupQuestionLimitState, remainingQuestionCountAfterAcceptedQuestion } from "./onlineSoupQuestionLimit.js";

test("有限提问按全局有效正式提问数量计算剩余次数", () => {
  assert.deepEqual(onlineSoupQuestionLimitState(10, 3, 1), {
    limit: 10,
    used: 3,
    remaining: 7,
    resolutionRequired: false
  });
});

test("达到上限后必须等待所有未撤回提问回答完再触发结算", () => {
  assert.equal(onlineSoupQuestionLimitState(3, 3, 1).resolutionRequired, false);
  assert.equal(onlineSoupQuestionLimitState(3, 3, 0).resolutionRequired, true);
});

test("撤回未回答提问后有效数量减少并重新释放额度", () => {
  assert.deepEqual(onlineSoupQuestionLimitState(3, 2, 0), {
    limit: 3,
    used: 2,
    remaining: 1,
    resolutionRequired: false
  });
});

test("不限制模式不产生剩余次数或自动结算", () => {
  assert.deepEqual(onlineSoupQuestionLimitState(null, 99, 0), {
    limit: null,
    used: 99,
    remaining: null,
    resolutionRequired: false
  });
});

test("每条正式提问保存各自发送成功后的剩余次数快照", () => {
  assert.equal(remainingQuestionCountAfterAcceptedQuestion(10, 0), 9);
  assert.equal(remainingQuestionCountAfterAcceptedQuestion(10, 1), 8);
  assert.equal(remainingQuestionCountAfterAcceptedQuestion(10, 9), 0);
  assert.equal(remainingQuestionCountAfterAcceptedQuestion(null, 3), null);
});

test("真人主持开局时明确提示本局提问次数规则", () => {
  assert.equal(onlineSoupQuestionLimitStartNotice(null), "本局游戏不限次数");
  assert.equal(onlineSoupQuestionLimitStartNotice(40), "本局游戏限40次");
});
