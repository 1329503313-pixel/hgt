import assert from "node:assert/strict";
import test from "node:test";
import {
  beijingEntitlementDate,
  DEFAULT_ENTITLEMENT_PLANS,
  entitlementPlanSchema,
  entitlementTierForRole,
  nextBeijingEntitlementDate
} from "./entitlements.js";

test("后台管理员复用 VIP 权益，超级管理员不受计划限制", () => {
  assert.equal(entitlementTierForRole("user"), "user");
  assert.equal(entitlementTierForRole("vip"), "vip");
  assert.equal(entitlementTierForRole("backoffice_admin"), "vip");
  assert.equal(entitlementTierForRole("super_admin"), null);
});

test("默认配置兼容既有发布规则且不会自动发放资产", () => {
  assert.equal(DEFAULT_ENTITLEMENT_PLANS.user.dailySoupPublishLimit, 10);
  assert.equal(DEFAULT_ENTITLEMENT_PLANS.vip.dailySoupPublishLimit, null);
  assert.equal(DEFAULT_ENTITLEMENT_PLANS.user.dailyAutoShellGrant, 0);
  assert.equal(DEFAULT_ENTITLEMENT_PLANS.user.dailyAutoExperienceGrant, 0);
  assert.equal(DEFAULT_ENTITLEMENT_PLANS.user.dailyExtraFreeDraws, 0);
});

test("权益自然日按北京时间切换", () => {
  const beforeMidnight = new Date("2026-08-16T15:59:59.000Z");
  const midnight = new Date("2026-08-16T16:00:00.000Z");
  assert.equal(beijingEntitlementDate(beforeMidnight), "2026-08-16");
  assert.equal(nextBeijingEntitlementDate(beforeMidnight), "2026-08-17");
  assert.equal(beijingEntitlementDate(midnight), "2026-08-17");
  assert.equal(nextBeijingEntitlementDate(midnight), "2026-08-18");
});

test("次数限额支持无限，但自动资产赠送必须为有限非负整数", () => {
  assert.equal(entitlementPlanSchema.safeParse({
    ...DEFAULT_ENTITLEMENT_PLANS.user,
    dailyLikeLimit: null
  }).success, true);
  assert.equal(entitlementPlanSchema.safeParse({
    ...DEFAULT_ENTITLEMENT_PLANS.user,
    dailyAutoShellGrant: null
  }).success, false);
  assert.equal(entitlementPlanSchema.safeParse({
    ...DEFAULT_ENTITLEMENT_PLANS.user,
    dailyAutoExperienceGrant: -1
  }).success, false);
});
