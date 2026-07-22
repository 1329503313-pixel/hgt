import assert from "node:assert/strict";
import test from "node:test";
import {
  beijingTaskDate,
  calculateTaskReward,
  hasOtherEligibleOnlineSoupPlayer,
  isEligibleOnlineSoupDuration,
  SHELL_DAILY_LIMIT,
  SHELL_TASKS
} from "./shellCurrency.js";
import { experienceProgress, levelForExperience, MAX_EXPERIENCE } from "./levelSystem.js";

test("等级门槛按累计经验计算并在 Lv40 封顶", () => {
  assert.equal(levelForExperience(0), 0);
  assert.equal(levelForExperience(9), 0);
  assert.equal(levelForExperience(10), 1);
  assert.equal(levelForExperience(99_999_999), 39);
  assert.equal(levelForExperience(MAX_EXPERIENCE), 40);
  assert.equal(levelForExperience(MAX_EXPERIENCE + 1), 40);
});

test("等级进度按本级区间计算", () => {
  assert.deepEqual(experienceProgress(55), {
    level: 1,
    experience: 55,
    levelStartExperience: 10,
    nextLevelExperience: 100,
    currentLevelExperience: 45,
    experienceForNextLevel: 90,
    remainingExperience: 45,
    progressPercent: 50,
    isMaxLevel: false
  });
  assert.equal(experienceProgress(MAX_EXPERIENCE).isMaxLevel, true);
});

test("每日任务理论奖励为138，实际日上限为60", () => {
  const theoreticalMaximum = SHELL_TASKS.reduce((sum, task) => sum + task.reward * task.dailyLimit, 0);
  assert.equal(theoreticalMaximum, 138);
  assert.equal(SHELL_DAILY_LIMIT, 60);
});

test("任务奖励按剩余额度截断", () => {
  assert.equal(calculateTaskReward(0, 5), 5);
  assert.equal(calculateTaskReward(58, 5), 2);
  assert.equal(calculateTaskReward(60, 10), 0);
  assert.equal(calculateTaskReward(65, 3), 0);
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

test("作品完整玩汤奖励必须有作者之外的有效玩家", () => {
  assert.equal(hasOtherEligibleOnlineSoupPlayer("creator", []), false);
  assert.equal(hasOtherEligibleOnlineSoupPlayer("creator", ["creator"]), false);
  assert.equal(hasOtherEligibleOnlineSoupPlayer("creator", ["creator", "player"]), true);
});

test("每日任务奖励和次数符合产品规划", () => {
  assert.deepEqual(
    SHELL_TASKS.map(({ type, reward, dailyLimit }) => ({ type, reward, dailyLimit })),
    [
      { type: "daily_login", reward: 5, dailyLimit: 1 },
      { type: "publish_soup", reward: 10, dailyLimit: 3 },
      { type: "like_soup", reward: 2, dailyLimit: 3 },
      { type: "favorite_soup", reward: 2, dailyLimit: 3 },
      { type: "publish_evaluation", reward: 3, dailyLimit: 1 },
      { type: "speak_circle", reward: 2, dailyLimit: 3 },
      { type: "join_online_soup", reward: 5, dailyLimit: 2 },
      { type: "host_online_soup", reward: 10, dailyLimit: 1 },
      { type: "receive_soup_like", reward: 2, dailyLimit: 3 },
      { type: "receive_soup_favorite", reward: 2, dailyLimit: 3 },
      { type: "receive_soup_evaluation", reward: 5, dailyLimit: 3 },
      { type: "soup_ai_played", reward: 5, dailyLimit: 3 },
      { type: "soup_online_completed", reward: 10, dailyLimit: 2 }
    ]
  );
});
