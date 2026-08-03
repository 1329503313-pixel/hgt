import type { RankingRewardPeriod } from "./rankingRewards.js";

export function rankingRewardNotificationSummary(period: RankingRewardPeriod, boardCount: number) {
  const periodLabel = period === "weekly" ? "7日" : "30日";
  return {
    title: `${periodLabel}排行榜奖励`,
    content: `本次结算你在 ${boardCount} 个榜单进入前 10 名并获得奖励，点击查看各榜单名次与奖励。`
  };
}

export function mergedRankingRewardNotificationReadState(values: unknown[]) {
  return values.length > 0 && values.every((value) => Number(value) === 1);
}
