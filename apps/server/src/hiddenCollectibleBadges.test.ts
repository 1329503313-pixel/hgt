import assert from "node:assert/strict";
import test from "node:test";
import { HIDDEN_COLLECTIBLE_BADGES, hiddenCollectibleBadgeChanges } from "./hiddenCollectibleBadges.js";

test("隐藏收藏品徽章与 001 至 003 一一对应", () => {
  assert.deepEqual(
    HIDDEN_COLLECTIBLE_BADGES.map(({ collectibleNo, achievementPoints }) => ({ collectibleNo, achievementPoints })),
    [
      { collectibleNo: "001", achievementPoints: 300 },
      { collectibleNo: "002", achievementPoints: 300 },
      { collectibleNo: "003", achievementPoints: 300 }
    ]
  );
  assert.equal(new Set(HIDDEN_COLLECTIBLE_BADGES.map((badge) => badge.key)).size, HIDDEN_COLLECTIBLE_BADGES.length);
});

test("只授予当前持有收藏品对应的隐藏徽章", () => {
  const changes = hiddenCollectibleBadgeChanges(new Set(["001", "003"]), new Set(["legendary:truth-scepter"]));
  assert.deepEqual(changes.grant.map((badge) => badge.key), ["legendary:truth-crown"]);
  assert.deepEqual(changes.revoke, []);
});

test("失去收藏品后回收对应隐藏徽章", () => {
  const changes = hiddenCollectibleBadgeChanges(new Set(["002"]), new Set([
    "legendary:truth-crown",
    "legendary:illusory-eye"
  ]));
  assert.deepEqual(changes.grant, []);
  assert.deepEqual(changes.revoke.map((badge) => badge.key), ["legendary:truth-crown"]);
});
