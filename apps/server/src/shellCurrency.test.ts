import assert from "node:assert/strict";
import test from "node:test";
import {
  BEGINNER_TASKS,
  beijingTaskDate,
  calculateTaskReward,
  eligibleBeginnerTaskTypes,
  hasOtherEligibleOnlineSoupPlayer,
  isEligibleOnlineSoupDuration,
  SHELL_DAILY_LIMIT,
  SHELL_TASKS
} from "./shellCurrency.js";
import { calculateExperienceAdjustment, experienceProgress, levelForExperience, MAX_EXPERIENCE } from "./levelSystem.js";
import { calculateInviteMilestoneDelta } from "./inviteRewards.js";

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

test("管理员经验调整不能低于零或超过满级上限", () => {
  assert.equal(calculateExperienceAdjustment(100, "add", 50), 150);
  assert.equal(calculateExperienceAdjustment(100, "deduct", 40), 60);
  assert.throws(() => calculateExperienceAdjustment(10, "deduct", 11), /EXPERIENCE_INSUFFICIENT/);
  assert.throws(() => calculateExperienceAdjustment(MAX_EXPERIENCE, "add", 1), /EXPERIENCE_MAX_EXCEEDED/);
  assert.throws(() => calculateExperienceAdjustment(10, "add", 0), /EXPERIENCE_AMOUNT_INVALID/);
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

test("新手任务奖励与一次性任务清单符合产品规划", () => {
  assert.deepEqual(
    BEGINNER_TASKS.map(({ type, reward }) => ({ type, reward })),
    [
      { type: "upload_avatar", reward: 10 },
      { type: "complete_ten_draws", reward: 10 },
      { type: "equip_badge", reward: 10 },
      { type: "bind_email", reward: 25 },
      { type: "change_profile_background", reward: 10 }
    ]
  );
  assert.equal(BEGINNER_TASKS.reduce((sum, task) => sum + task.reward, 0), 65);
});

test("累计抽卡必须达到10次才满足新手任务", () => {
  const base = {
    hasAvatar: false,
    hasEquippedBadge: false,
    hasVerifiedEmail: false,
    hasProfileBackground: false
  };
  assert.equal(eligibleBeginnerTaskTypes({ ...base, completedDraws: 9 }).includes("complete_ten_draws"), false);
  assert.equal(eligibleBeginnerTaskTypes({ ...base, completedDraws: 10 }).includes("complete_ten_draws"), true);
});

test("邀请用户贝壳成长奖励按每名用户累计且保留余数", () => {
  assert.equal(calculateInviteMilestoneDelta(19, 0), 0);
  assert.equal(calculateInviteMilestoneDelta(20, 0), 1);
  assert.equal(calculateInviteMilestoneDelta(59, 1), 1);
  assert.equal(calculateInviteMilestoneDelta(100, 2), 3);
  assert.equal(calculateInviteMilestoneDelta(20, 1), 0);
});
