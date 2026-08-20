import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGENDARY_CARD_DRAW_COUNT_SQL,
  SYSTEM_BADGE_ACHIEVEMENT_POINTS,
  badgeUnlockNotificationContent,
  calculateBadgeShellReward,
  systemBadgeKeysWithPrerequisites
} from "./badgeRewards.js";

test("抽卡、慷慨和魅力成就使用产品配置的四阶成就点", () => {
  assert.deepEqual(
    ["normal", "rare", "epic", "legend"].map((tier) => SYSTEM_BADGE_ACHIEVEMENT_POINTS[`drawLuck:${tier}`]),
    [10, 20, 50, 150]
  );
  assert.deepEqual(
    ["normal", "rare", "epic", "legend"].map((tier) => SYSTEM_BADGE_ACHIEVEMENT_POINTS[`generosity:${tier}`]),
    [20, 50, 120, 250]
  );
  assert.deepEqual(
    ["normal", "rare", "epic", "legend"].map((tier) => SYSTEM_BADGE_ACHIEVEMENT_POINTS[`charm:${tier}`]),
    [30, 100, 200, 500]
  );
});

test("闪耀皇冠赠送双方的史诗成就均为 150 成就点", () => {
  assert.equal(SYSTEM_BADGE_ACHIEVEMENT_POINTS["shiningCrownReceived:epic"], 150);
  assert.equal(SYSTEM_BADGE_ACHIEVEMENT_POINTS["shiningCrownSent:epic"], 150);
});

test("VIP 荣耀成就按四档产品配置结算成就点", () => {
  assert.deepEqual(
    ["normal", "rare", "epic", "legend"].map((tier) => SYSTEM_BADGE_ACHIEVEMENT_POINTS[`vipHonor:${tier}`]),
    [50, 150, 350, 1000]
  );
});

test("后续获得徽章不再按成就点发放等量贝壳", () => {
  assert.equal(calculateBadgeShellReward(150, true, true), 0);
  assert.equal(calculateBadgeShellReward(150, true, false), 0);
  assert.equal(calculateBadgeShellReward(150, false, true), 0);
  assert.equal(calculateBadgeShellReward(35.9, true, true), 0);
  assert.equal(calculateBadgeShellReward(-10, true, true), 0);
});

test("成就通知不再追加贝壳奖励文案", () => {
  assert.equal(
    badgeUnlockNotificationContent("恭喜你获得徽章「熬汤新秀」", 10),
    "恭喜你获得徽章「熬汤新秀」"
  );
  assert.equal(
    badgeUnlockNotificationContent("恭喜你获得徽章「熬汤新秀」", 0),
    "恭喜你获得徽章「熬汤新秀」"
  );
});

test("传说降临徽章从永久卡牌累计数据统计，不依赖会被裁剪的抽卡历史", () => {
  assert.match(LEGENDARY_CARD_DRAW_COUNT_SQL, /SUM\(owned\.total_obtained\)/);
  assert.match(LEGENDARY_CARD_DRAW_COUNT_SQL, /FROM user_asset_cards owned/);
  assert.doesNotMatch(LEGENDARY_CARD_DRAW_COUNT_SQL, /asset_draw_(?:orders|results)/);
});

test("已有传说降临II但缺少I时会自动补齐前置徽章", () => {
  const definedKeys = ["legendCard:normal", "legendCard:rare", "legendCard:epic"];
  assert.deepEqual(
    systemBadgeKeysWithPrerequisites([], ["legendCard:rare"], definedKeys),
    ["legendCard:normal", "legendCard:rare"]
  );
  assert.deepEqual(
    systemBadgeKeysWithPrerequisites(["legendCard:epic"], [], definedKeys),
    definedKeys
  );
});
