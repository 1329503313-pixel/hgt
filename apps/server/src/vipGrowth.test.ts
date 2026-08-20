import assert from "node:assert/strict";
import test from "node:test";
import { vipBenefitValue, vipGrowthDateKey, vipGrowthMultiplier, vipLevelForGrowth, isVipActiveRow } from "./vipGrowth.js";

test("VIP growth thresholds map to the nine configured levels", () => {
  assert.equal(vipLevelForGrowth(0), 0);
  assert.equal(vipLevelForGrowth(5), 1);
  assert.equal(vipLevelForGrowth(300), 2);
  assert.equal(vipLevelForGrowth(1499), 3);
  assert.equal(vipLevelForGrowth(15000), 9);
});

test("VIP benefit multipliers apply from VIP2 and round half up", () => {
  assert.equal(vipGrowthMultiplier(1), 1);
  assert.equal(vipGrowthMultiplier(2), 1.2);
  assert.equal(vipGrowthMultiplier(9), 2.6);
  assert.equal(vipBenefitValue(10, 2), 12);
  assert.equal(vipBenefitValue(5, 9), 13);
});

test("VIP activity respects legacy and expiring identities", () => {
  const now = new Date("2026-08-18T00:00:00.000Z");
  assert.equal(isVipActiveRow({ role: "vip", vip_legacy_active: 1 }, now), true);
  assert.equal(isVipActiveRow({ role: "vip", vip_expires_at: "2026-08-19T00:00:00.000Z" }, now), true);
  assert.equal(isVipActiveRow({ role: "backoffice_admin", vip_expires_at: "2026-08-19T00:00:00.000Z" }, now), true);
  assert.equal(isVipActiveRow({ role: "super_admin", vip_expires_at: "2026-08-19T00:00:00.000Z" }, now), true);
  assert.equal(isVipActiveRow({ role: "super_admin" }, now), false);
  assert.equal(isVipActiveRow({ role: "vip", vip_expires_at: "2026-08-17T00:00:00.000Z" }, now), false);
  assert.equal(isVipActiveRow({ role: "user", vip_expires_at: "2026-08-19T00:00:00.000Z" }, now), false);
});

test("VIP settlement dates normalize MySQL DATE values returned as Date objects", () => {
  assert.equal(vipGrowthDateKey(new Date("2026-08-19T00:00:00.000Z")), "2026-08-19");
  assert.equal(vipGrowthDateKey("2026-08-19"), "2026-08-19");
  assert.equal(vipGrowthDateKey("2026-08-19T00:00:00.000Z"), "2026-08-19");
  assert.equal(vipGrowthDateKey("Wed Aug 19 2026"), null);
});
