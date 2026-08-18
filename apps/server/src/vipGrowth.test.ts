import assert from "node:assert/strict";
import test from "node:test";
import { vipBenefitValue, vipGrowthMultiplier, vipLevelForGrowth, isVipActiveRow } from "./vipGrowth.js";

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
  assert.equal(isVipActiveRow({ role: "vip", vip_expires_at: "2026-08-17T00:00:00.000Z" }, now), false);
  assert.equal(isVipActiveRow({ role: "user", vip_expires_at: "2026-08-19T00:00:00.000Z" }, now), false);
});
