import assert from "node:assert/strict";
import test from "node:test";
import { onlineSoupQuestionLimitState } from "./onlineSoupQuestionLimit.js";

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
