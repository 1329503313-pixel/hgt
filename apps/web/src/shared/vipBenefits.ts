import type { VipBenefitPlan } from "./types";

export type QuotaBenefit = { key: keyof VipBenefitPlan; label: string; unit: string; detail?: string };

export const VIP_BENEFIT_SECTIONS: Array<{ title: string; items: QuotaBenefit[] }> = [
  {
    title: "创作与互动",
    items: [
      { key: "dailySoupPublishLimit", label: "每日发布海龟汤", unit: "篇" },
      { key: "dailyEvaluationLimit", label: "每日发表评论", unit: "条" },
      { key: "dailyLikeLimit", label: "每日点赞", unit: "次" },
      { key: "dailyFavoriteLimit", label: "每日收藏", unit: "次" }
    ]
  },
  {
    title: "游戏与资产",
    items: [
      { key: "dailyDrawLimit", label: "每日抽卡", unit: "抽" },
      { key: "dailyAiQuestionLimit", label: "每日 AI 主持提问", unit: "次" },
      { key: "dailyAiHintLimit", label: "每日 AI 提示", unit: "次" },
      { key: "dailyMysteryQuestionLimit", label: "每日谜局提问", unit: "次" },
      { key: "dailyGiftSendShellValueLimit", label: "每日可送出礼物价值", unit: "贝壳" },
      { key: "dailyGiftReceiveShellLimit", label: "每日通过礼物获取贝壳", unit: "贝壳" },
      { key: "dailyCharmReceiveLimit", label: "每日可获取魅力", unit: "魅力" }
    ]
  },
  {
    title: "每日赠送",
    items: [
      { key: "dailyAutoShellGrant", label: "自动赠送贝壳", unit: "贝壳" },
      { key: "dailyAutoExperienceGrant", label: "自动赠送经验", unit: "经验" },
      { key: "dailyExtraFreeDraws", label: "额外免费单抽", unit: "次/卡包", detail: "每个卡包单独计算" }
    ]
  }
];

export function formatVipBenefitValue(plan: VipBenefitPlan, item: QuotaBenefit) {
  const value = plan[item.key];
  return value == null ? "无限" : `${Number(value).toLocaleString()} ${item.unit}`;
}
