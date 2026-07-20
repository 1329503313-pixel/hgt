import assert from "node:assert/strict";
import test from "node:test";
import {
  beijingTaskDate,
  calculateTaskReward,
  isEligibleOnlineSoupDuration,
  SHELL_DAILY_LIMIT,
  SHELL_TASKS
} from "./shellCurrency.js";

test("每日任务理论奖励为58，实际日上限为30", () => {
  const theoreticalMaximum = SHELL_TASKS.reduce((sum, task) => sum + task.reward * task.dailyLimit, 0);
  assert.equal(theoreticalMaximum, 58);
  assert.equal(SHELL_DAILY_LIMIT, 30);
});

test("任务奖励按剩余额度截断", () => {
  assert.equal(calculateTaskReward(0, 5), 5);
  assert.equal(calculateTaskReward(28, 5), 2);
  assert.equal(calculateTaskReward(30, 10), 0);
  assert.equal(calculateTaskReward(35, 3), 0);
});

test("任务日期使用北京时间自然日", () => {
  assert.equal(beijingTaskDate(new Date("2026-07-20T15:59:59.999Z")), "2026-07-20");
  assert.equal(beijingTaskDate(new Date("2026-07-20T16:00:00.000Z")), "2026-07-21");
});

test("玩汤时长必须严格大于5分钟", () => {
  const start = new Date("2026-07-20T00:00:00.000Z");
  assert.equal(isEligibleOnlineSoupDuration(start, new Date("2026-07-20T00:04:59.999Z")), false);
  assert.equal(isEligibleOnlineSoupDuration(start, new Date("2026-07-20T00:05:00.000Z")), false);
  assert.equal(isEligibleOnlineSoupDuration(start, new Date("2026-07-20T00:05:00.001Z")), true);
});

test("每日任务奖励和次数符合产品规划", () => {
  assert.deepEqual(
    SHELL_TASKS.map(({ type, reward, dailyLimit }) => ({ type, reward, dailyLimit })),
    [
      { type: "daily_login", reward: 5, dailyLimit: 1 },
      { type: "publish_soup", reward: 8, dailyLimit: 2 },
      { type: "like_soup", reward: 2, dailyLimit: 2 },
      { type: "favorite_soup", reward: 2, dailyLimit: 2 },
      { type: "publish_evaluation", reward: 3, dailyLimit: 1 },
      { type: "speak_circle", reward: 2, dailyLimit: 3 },
      { type: "join_online_soup", reward: 5, dailyLimit: 2 },
      { type: "host_online_soup", reward: 10, dailyLimit: 1 }
    ]
  );
});
