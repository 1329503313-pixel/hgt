import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyEntitlementGrantAmounts,
  beijingEntitlementDate,
  DEFAULT_ENTITLEMENT_PLANS,
  entitlementPlanSchema,
  entitlementPlanForUserState,
  entitlementTierForRole,
  entitlementTierForUserState,
  nextBeijingEntitlementDate,
  scopedEntitlementUsageMetric
} from "./entitlements.js";
import { MAX_EXPERIENCE } from "./levelSystem.js";

test("后台管理员复用 VIP 权益，超级管理员不受计划限制", () => {
  assert.equal(entitlementTierForRole("user"), "user");
  assert.equal(entitlementTierForRole("vip"), "vip");
  assert.equal(entitlementTierForRole("backoffice_admin"), "vip");
  assert.equal(entitlementTierForRole("super_admin"), null);
});

test("VIP权益跟随数据库实时有效状态，管理员不会获得无限经济权益", () => {
  assert.equal(entitlementTierForUserState("vip", false), "user");
  assert.equal(entitlementTierForUserState("backoffice_admin", false), "user");
  assert.equal(entitlementTierForUserState("backoffice_admin", true), "vip");
  assert.equal(entitlementTierForUserState("super_admin", false), null);
  assert.equal(entitlementTierForUserState("super_admin", false, true), "user");
  assert.equal(entitlementTierForUserState("super_admin", true, true), "vip");
});

test("VIP失效后立即回收未使用经济权益且不依赖会话旧角色", () => {
  const now = new Date("2026-08-19T00:00:00.000Z");
  const plans = {
    user: { ...DEFAULT_ENTITLEMENT_PLANS.user },
    vip: {
      ...DEFAULT_ENTITLEMENT_PLANS.vip,
      dailyAutoShellGrant: 10,
      dailyAutoExperienceGrant: 20,
      dailyExtraFreeDraws: 3
    }
  };
  const activeAdmin = entitlementPlanForUserState(plans, {
    role: "super_admin",
    vip_expires_at: "2026-08-20T00:00:00.000Z",
    vip_growth_value: 5
  }, "super_admin", now, true);
  assert.equal(activeAdmin.tier, "vip");
  assert.equal(activeAdmin.plan?.dailyExtraFreeDraws, 3);
  assert.equal(activeAdmin.plan?.dailyAutoShellGrant, 10);

  const expiredAdmin = entitlementPlanForUserState(plans, {
    role: "super_admin",
    vip_expires_at: "2026-08-18T00:00:00.000Z",
    vip_growth_value: 5
  }, "super_admin", now, true);
  assert.equal(expiredAdmin.tier, "user");
  assert.equal(expiredAdmin.plan?.dailyExtraFreeDraws, 0);
  assert.equal(expiredAdmin.plan?.dailyAutoShellGrant, 0);

  const cancelledUserWithStaleSession = entitlementPlanForUserState(plans, {
    role: "user",
    vip_expires_at: "2026-08-19T00:00:00.000Z",
    vip_growth_value: 5
  }, "vip", now, true);
  assert.equal(cancelledUserWithStaleSession.tier, "user");
  assert.equal(cancelledUserWithStaleSession.plan?.dailyExtraFreeDraws, 0);
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

test("每日权益补发按未处理目标差额真实增加贝壳和经验", () => {
  assert.deepEqual(dailyEntitlementGrantAmounts({
    plan: { dailyAutoShellGrant: 18, dailyAutoExperienceGrant: 30 },
    shellTargetProcessed: 10,
    experienceTargetProcessed: 12,
    shellBalance: 100,
    experience: 200
  }), {
    requestedShell: 8,
    requestedExperience: 18,
    shellGranted: 8,
    experienceGranted: 18,
    shellBalance: 108,
    experience: 218
  });
});

test("每日权益补发在贝壳和经验上限处只记录实际可到账数量", () => {
  const result = dailyEntitlementGrantAmounts({
    plan: { dailyAutoShellGrant: 10, dailyAutoExperienceGrant: 10 },
    shellTargetProcessed: 0,
    experienceTargetProcessed: 0,
    shellBalance: 4_294_967_292,
    experience: MAX_EXPERIENCE - 2
  });
  assert.equal(result.shellGranted, 3);
  assert.equal(result.experienceGranted, 2);
  assert.equal(result.shellBalance, 4_294_967_295);
  assert.equal(result.experience, MAX_EXPERIENCE);
});

test("VIP额外免费抽卡按卡包使用独立且稳定的每日计数键", () => {
  const packA = scopedEntitlementUsageMetric("extra_free_draw", "pack-a");
  const packB = scopedEntitlementUsageMetric("extra_free_draw", "pack-b");
  assert.equal(packA, scopedEntitlementUsageMetric("extra_free_draw", "pack-a"));
  assert.notEqual(packA, packB);
  assert.ok(packA.length <= 48);
  assert.equal(scopedEntitlementUsageMetric("extra_free_draw"), "extra_free_draw");
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
