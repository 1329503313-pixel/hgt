export type CollectibleAchievementStat = "epicCollectibleAcquired" | "legendCollectibleAcquired" | "highestCollectibleValue";

export interface CollectibleAchievementDefinition {
  key: string;
  series: string;
  tier: "normal" | "rare" | "epic" | "legend";
  tierIndex: number;
  name: string;
  description: string;
  requirement: string;
  iconUrl: string;
  stat: CollectibleAchievementStat;
  target: number;
  achievementPoints: number;
  nextBadgeLabel?: string;
}

// Acquisition badges deliberately have separate series: a legendary collectible
// does not imply that an epic collectible has ever been acquired.
export const COLLECTIBLE_ACHIEVEMENTS: readonly CollectibleAchievementDefinition[] = [
  {
    key: "epicCollectible:rare", series: "epicCollectible", tier: "rare", tierIndex: 1,
    name: "奇珍入藏", description: "寻得一件奇珍，为我的收藏添上一抹光。",
    requirement: "获得1件史诗级收藏品", iconUrl: "/badges/epic-collectible-rare.webp",
    stat: "epicCollectibleAcquired", target: 1, achievementPoints: 35,
  },
  {
    key: "legendCollectible:epic", series: "legendCollectible", tier: "epic", tierIndex: 1,
    name: "传世之藏", description: "曾经仰望的传说，如今珍藏于我手。",
    requirement: "获得1件传说级收藏品", iconUrl: "/badges/legend-collectible-epic.webp",
    stat: "legendCollectibleAcquired", target: 1, achievementPoints: 150,
  },
  {
    key: "collectibleValue:normal", series: "collectibleValue", tier: "normal", tierIndex: 1,
    name: "小有珍藏", description: "小小藏匣里，装着我精心寻来的宝贝。",
    requirement: "持有的收藏品总价值超过5万", iconUrl: "/badges/collectible-value-normal.webp",
    stat: "highestCollectibleValue", target: 50_001, achievementPoints: 15, nextBadgeLabel: "琳琅满阁",
  },
  {
    key: "collectibleValue:rare", series: "collectibleValue", tier: "rare", tierIndex: 2,
    name: "琳琅满阁", description: "推开藏阁，每一处都有值得驻足的光彩。",
    requirement: "持有的收藏品总价值超过15万", iconUrl: "/badges/collectible-value-rare.webp",
    stat: "highestCollectibleValue", target: 150_001, achievementPoints: 35, nextBadgeLabel: "奇珍宝库",
  },
  {
    key: "collectibleValue:epic", series: "collectibleValue", tier: "epic", tierIndex: 3,
    name: "奇珍宝库", description: "珍宝汇聚于此，我的收藏已自成一座宝库。",
    requirement: "持有的收藏品总价值超过30万", iconUrl: "/badges/collectible-value-epic.webp",
    stat: "highestCollectibleValue", target: 300_001, achievementPoints: 150, nextBadgeLabel: "万宝之主",
  },
  {
    key: "collectibleValue:legend", series: "collectibleValue", tier: "legend", tierIndex: 4,
    name: "万宝之主", description: "万千珍宝交相辉映，这座典藏殿堂由我守护。",
    requirement: "持有的收藏品总价值超过100万", iconUrl: "/badges/collectible-value-legend.webp",
    stat: "highestCollectibleValue", target: 1_000_001, achievementPoints: 500,
  },
];

export const COLLECTIBLE_ACHIEVEMENT_POINTS: Record<string, number> = Object.fromEntries(
  COLLECTIBLE_ACHIEVEMENTS.map((badge) => [badge.key, badge.achievementPoints]),
);

export const COLLECTIBLE_ACHIEVEMENT_NAMES: Record<string, string> = Object.fromEntries(
  COLLECTIBLE_ACHIEVEMENTS.map((badge) => [badge.key, badge.name]),
);
