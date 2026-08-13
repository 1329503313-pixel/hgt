import assert from "node:assert/strict";
import test from "node:test";
import {
  roleAfterAdminRemoval,
  roleAfterVipGrant,
  roleAfterVipRemoval,
  formatVipOrderNumber,
  vipBalanceDays,
  vipExpiryAfterGrant,
  vipExpiryAfterReduction,
  vipGrantDays,
  VIP_YEAR_DAYS
} from "./vip.js";

test("VIP durations use fixed 31-day months and a reserved 366-day year", () => {
  assert.equal(vipGrantDays({ unit: "day", value: 15 }), 15);
  assert.equal(vipGrantDays({ unit: "month", value: 3 }), 93);
  assert.equal(VIP_YEAR_DAYS, 366);
});

test("VIP order numbers use the Beijing calendar date and a six-digit daily sequence", () => {
  assert.equal(formatVipOrderNumber("20260507", 9), "20260507000009");
  assert.throws(() => formatVipOrderNumber("20260507", 1_000_000), /VIP_ORDER_NUMBER_INVALID/);
});

test("VIP grants extend active time and restart expired time from now", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");
  assert.equal(
    vipExpiryAfterGrant(new Date("2026-08-20T00:00:00.000Z"), 3, now).toISOString(),
    "2026-08-23T00:00:00.000Z"
  );
  assert.equal(
    vipExpiryAfterGrant(new Date("2026-08-01T00:00:00.000Z"), 3, now).toISOString(),
    "2026-08-15T00:00:00.000Z"
  );
});

test("VIP reduction floors at zero without producing negative balances", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");
  const expiresAt = vipExpiryAfterReduction(new Date("2026-08-15T00:00:00.000Z"), 30, now);
  assert.equal(expiresAt.toISOString(), now.toISOString());
  assert.equal(vipBalanceDays(expiresAt, now), 0);
});

test("administrator identity takes priority while VIP is retained underneath", () => {
  assert.equal(roleAfterVipGrant("super_admin"), "super_admin");
  assert.equal(roleAfterVipGrant("backoffice_admin"), "backoffice_admin");
  assert.equal(roleAfterVipGrant("user"), "vip");
  assert.equal(roleAfterVipRemoval("backoffice_admin"), "backoffice_admin");
  assert.equal(roleAfterVipRemoval("vip"), "user");
  assert.equal(roleAfterAdminRemoval("backoffice_admin", true), "vip");
  assert.equal(roleAfterAdminRemoval("backoffice_admin", false), "user");
});
