import assert from "node:assert/strict";
import test from "node:test";
import { COLLECTIBLE_ACHIEVEMENTS } from "@hgt/shared";
import { systemBadgeKeysWithPrerequisites, SYSTEM_BADGE_ACHIEVEMENT_POINTS } from "./badgeRewards.js";

const defined = COLLECTIBLE_ACHIEVEMENTS.map((badge) => badge.key);
test("收藏品品质独立解锁，传说藏品不会自动授予史诗藏品成就", () => {
  assert.deepEqual(systemBadgeKeysWithPrerequisites(["legendCollectible:epic"], [], defined), ["legendCollectible:epic"]);
  assert.deepEqual(systemBadgeKeysWithPrerequisites(["epicCollectible:rare"], [], defined), ["epicCollectible:rare"]);
});

test("收藏品价值严格超过门槛才解锁，一次超过100万补齐四档", () => {
  const valueBadges = COLLECTIBLE_ACHIEVEMENTS.filter((badge) => badge.series === "collectibleValue");
  for (const [index, threshold] of [50_000, 150_000, 300_000, 1_000_000].entries()) {
    assert.equal(valueBadges.filter((badge) => threshold >= badge.target).length, index);
    assert.equal(valueBadges.filter((badge) => threshold + 1 >= badge.target).length, index + 1);
  }
  assert.deepEqual(systemBadgeKeysWithPrerequisites(["collectibleValue:legend"], [], defined), valueBadges.map((badge) => badge.key));
});

test("已解锁的收藏品成就永久保留，成就点沿用同类档位", () => {
  assert.deepEqual(systemBadgeKeysWithPrerequisites([], ["collectibleValue:epic"], defined), [
    "collectibleValue:normal", "collectibleValue:rare", "collectibleValue:epic",
  ]);
  assert.deepEqual(defined.map((key) => SYSTEM_BADGE_ACHIEVEMENT_POINTS[key]), [35, 150, 15, 35, 150, 500]);
});
