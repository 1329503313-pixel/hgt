import assert from "node:assert/strict";
import test from "node:test";
import type { VipBenefitPlan } from "../src/shared/types.js";
import { formatVipBenefitValue, VIP_BENEFIT_SECTIONS } from "../src/shared/vipBenefits.js";

const expectedKeys: Array<keyof VipBenefitPlan> = [
  "dailySoupPublishLimit",
  "dailyEvaluationLimit",
  "dailyAutoShellGrant",
  "dailyAutoExperienceGrant",
  "dailyLikeLimit",
  "dailyFavoriteLimit",
  "dailyDrawLimit",
  "dailyAiQuestionLimit",
  "dailyAiHintLimit",
  "dailyMysteryQuestionLimit",
  "dailyGiftSendShellValueLimit",
  "dailyGiftReceiveShellLimit",
  "dailyCharmReceiveLimit",
  "dailyExtraFreeDraws"
];

test("VIP 权益弹窗完整覆盖服务端全部实时权益字段", () => {
  const renderedKeys = VIP_BENEFIT_SECTIONS.flatMap((section) => section.items.map((item) => item.key));
  assert.deepEqual([...renderedKeys].sort(), [...expectedKeys].sort());
  assert.equal(new Set(renderedKeys).size, expectedKeys.length);
});

test("VIP 权益数值按实际配置展示有限值和无限状态", () => {
  const plan = Object.fromEntries(expectedKeys.map((key) => [key, 0])) as VipBenefitPlan;
  plan.dailyAiHintLimit = null;
  plan.dailyExtraFreeDraws = 3;
  const hint = VIP_BENEFIT_SECTIONS.flatMap((section) => section.items).find((item) => item.key === "dailyAiHintLimit")!;
  const freeDraw = VIP_BENEFIT_SECTIONS.flatMap((section) => section.items).find((item) => item.key === "dailyExtraFreeDraws")!;
  assert.equal(formatVipBenefitValue(plan, hint), "无限");
  assert.equal(formatVipBenefitValue(plan, freeDraw), "3 次/卡包");
});
