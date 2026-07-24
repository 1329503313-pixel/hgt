import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGENDARY_CARD_DRAW_COUNT_SQL,
  badgeUnlockNotificationContent,
  calculateBadgeShellReward,
  systemBadgeKeysWithPrerequisites
} from "./badgeRewards.js";

test("徽章贝壳奖励只按首次创建的奖励记录发放", () => {
  assert.equal(calculateBadgeShellReward(150, true, true), 150);
  assert.equal(calculateBadgeShellReward(150, true, false), 0);
  assert.equal(calculateBadgeShellReward(150, false, true), 0);
});

test("徽章奖励取首次获取时的非负整数成就值", () => {
  assert.equal(calculateBadgeShellReward(35.9, true, true), 35);
  assert.equal(calculateBadgeShellReward(-10, true, true), 0);
});

test("通知仅在实际发放贝壳时追加奖励文案", () => {
  assert.equal(
    badgeUnlockNotificationContent("恭喜你获得徽章「熬汤新秀」", 10),
    "恭喜你获得徽章「熬汤新秀」，同时获得 10 贝壳。"
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
