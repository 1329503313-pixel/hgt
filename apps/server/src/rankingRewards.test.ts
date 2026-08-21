import assert from "node:assert/strict";
import test from "node:test";
import {
  nextMonthlyRankingSettlement,
  nextRankingPeriodEnd,
  nextWeeklyRankingSettlement,
  rankPositiveValues,
  rankingPeriodStart,
  rankingRewardFor
} from "./rankingRewards.js";
import {
  mergedRankingRewardNotificationReadState,
  rankingRewardNotificationSummary
} from "./rankingRewardNotifications.js";

test("排行榜周结算固定为北京时间周一零点", () => {
  assert.equal(
    nextWeeklyRankingSettlement(new Date("2026-08-02T15:59:59.999Z")).toISOString(),
    "2026-08-02T16:00:00.000Z"
  );
  assert.equal(
    nextWeeklyRankingSettlement(new Date("2026-08-02T16:00:00.000Z")).toISOString(),
    "2026-08-09T16:00:00.000Z"
  );
});

test("排行榜月结算固定为北京时间每月首日零点", () => {
  assert.equal(
    nextMonthlyRankingSettlement(new Date("2026-07-28T12:00:00.000Z")).toISOString(),
    "2026-07-31T16:00:00.000Z"
  );
  assert.equal(
    nextRankingPeriodEnd("monthly", new Date("2026-07-31T16:00:00.000Z")).toISOString(),
    "2026-08-31T16:00:00.000Z"
  );
});

test("排行榜结算周期使用精确滚动7日和30日", () => {
  const end = new Date("2026-07-31T16:00:00.000Z");
  assert.equal(rankingPeriodStart("weekly", end).toISOString(), "2026-07-24T16:00:00.000Z");
  assert.equal(rankingPeriodStart("monthly", end).toISOString(), "2026-07-01T16:00:00.000Z");
});

test("7日排行榜货币与礼物奖励符合名次梯度", () => {
  assert.deepEqual(rankingRewardFor("weekly", "level", 1), { type: "currency", experience: 100, shell: 50 });
  assert.deepEqual(rankingRewardFor("weekly", "charm", 3), { type: "currency", experience: 60, shell: 30 });
  assert.deepEqual(rankingRewardFor("weekly", "generosity", 5), { type: "currency", experience: 40, shell: 20 });
  assert.deepEqual(rankingRewardFor("weekly", "level", 10), { type: "currency", experience: 30, shell: 15 });
  assert.deepEqual(rankingRewardFor("weekly", "achievement", 1), { type: "gift", giftName: "月亮小船", quantity: 1 });
  assert.deepEqual(rankingRewardFor("weekly", "collection", 3), { type: "gift", giftName: "智慧水晶球", quantity: 2 });
  assert.deepEqual(rankingRewardFor("weekly", "collectible", 3), { type: "gift", giftName: "智慧水晶球", quantity: 2 });
  assert.deepEqual(rankingRewardFor("weekly", "draws", 5), { type: "gift", giftName: "神秘钥匙", quantity: 3 });
  assert.deepEqual(rankingRewardFor("weekly", "achievement", 10), { type: "gift", giftName: "神秘钥匙", quantity: 2 });
});

test("30日排行榜货币与礼物奖励符合名次梯度", () => {
  assert.deepEqual(rankingRewardFor("monthly", "level", 1), { type: "currency", experience: 500, shell: 200 });
  assert.deepEqual(rankingRewardFor("monthly", "charm", 3), { type: "currency", experience: 300, shell: 100 });
  assert.deepEqual(rankingRewardFor("monthly", "generosity", 5), { type: "currency", experience: 200, shell: 80 });
  assert.deepEqual(rankingRewardFor("monthly", "level", 10), { type: "currency", experience: 100, shell: 50 });
  assert.deepEqual(rankingRewardFor("monthly", "achievement", 1), { type: "gift", giftName: "深海明珠", quantity: 1 });
  assert.deepEqual(rankingRewardFor("monthly", "collection", 3), { type: "gift", giftName: "月亮小船", quantity: 2 });
  assert.deepEqual(rankingRewardFor("monthly", "collectible", 3), { type: "gift", giftName: "月亮小船", quantity: 2 });
  assert.deepEqual(rankingRewardFor("monthly", "draws", 5), { type: "gift", giftName: "月亮小船", quantity: 1 });
  assert.deepEqual(rankingRewardFor("monthly", "achievement", 10), { type: "gift", giftName: "月亮小船", quantity: 1 });
  assert.equal(rankingRewardFor("monthly", "level", 11), null);
});

test("排行榜排除零值并按达到时间处理同分", () => {
  assert.deepEqual(
    rankPositiveValues([
      { userId: "zero", value: 0, reachedAt: 1, createdAt: 1 },
      { userId: "later", value: 10, reachedAt: 20, createdAt: 1 },
      { userId: "earlier", value: 10, reachedAt: 10, createdAt: 2 },
      { userId: "highest", value: 20, reachedAt: 30, createdAt: 3 }
    ]),
    [
      { userId: "highest", value: 20, rank: 1 },
      { userId: "earlier", value: 10, rank: 2 },
      { userId: "later", value: 10, rank: 3 }
    ]
  );
});

test("同一次排行榜结算汇总为一条通知", () => {
  assert.deepEqual(rankingRewardNotificationSummary("weekly", 3), {
    title: "7日排行榜奖励",
    content: "本次结算你在 3 个榜单进入前 10 名并获得奖励，点击查看各榜单名次与奖励。"
  });
  assert.equal(mergedRankingRewardNotificationReadState([1, true, "1"]), true);
  assert.equal(mergedRankingRewardNotificationReadState([1, 0]), false);
});
