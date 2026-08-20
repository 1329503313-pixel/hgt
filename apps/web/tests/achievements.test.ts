import assert from "node:assert/strict";
import test from "node:test";
import { resolveBadgeOwnership } from "../src/shared/badgeOwnership";

test("优秀作者徽章以永久拥有记录为准，不受作品当前统计影响", () => {
  const excellentAuthor = resolveBadgeOwnership({
    badgeKey: "excellentAuthor:epic",
    approvalBased: true,
    currentProgress: 0,
    progressTarget: 1,
    permanentlyOwnedBadgeKeys: new Set(["excellentAuthor:epic"]),
    unlockDates: {}
  });

  assert.equal(excellentAuthor.earned, true);
  assert.equal(excellentAuthor.progressCurrent, 1);
});

test("未通过审批时不能由作品统计推导出优秀作者徽章", () => {
  const excellentAuthor = resolveBadgeOwnership({
    badgeKey: "excellentAuthor:epic",
    approvalBased: true,
    currentProgress: 1_000_000,
    progressTarget: 1,
    permanentlyOwnedBadgeKeys: new Set(),
    unlockDates: {}
  });

  assert.equal(excellentAuthor.earned, false);
  assert.equal(excellentAuthor.progressCurrent, 0);
});

test("VIP7 会解锁荣耀成就前三阶并保留 VIP9 进度", () => {
  const vipHonor = [1, 5, 7, 9].map((progressTarget, index) => resolveBadgeOwnership({
    badgeKey: `vipHonor:${["normal", "rare", "epic", "legend"][index]}`,
    approvalBased: false,
    currentProgress: 7,
    progressTarget,
    permanentlyOwnedBadgeKeys: new Set(),
    unlockDates: {}
  }));

  assert.deepEqual(vipHonor.map((badge) => badge.earned), [true, true, true, false]);
  assert.equal(vipHonor[3]?.progressCurrent, 7);
});
