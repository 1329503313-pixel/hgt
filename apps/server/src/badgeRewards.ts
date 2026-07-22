export const SYSTEM_BADGE_ACHIEVEMENT_POINTS: Record<string, number> = {
  "publish:normal": 10, "publish:rare": 30, "publish:epic": 100,
  "insight:normal": 10, "insight:rare": 35, "insight:epic": 120,
  "favorite:normal": 10, "favorite:rare": 30, "favorite:epic": 100,
  "like:normal": 10, "like:rare": 30, "like:epic": 100,
  "login:normal": 10, "login:rare": 45, "login:epic": 100,
  "creatorLike:normal": 10, "creatorLike:rare": 40, "creatorLike:epic": 150,
  "creatorFavorite:normal": 10, "creatorFavorite:rare": 30, "creatorFavorite:epic": 120,
  "receivedComment:normal": 10, "receivedComment:rare": 40, "receivedComment:epic": 100,
  "commenter:normal": 10, "commenter:rare": 30, "commenter:epic": 100,
  "aiClear:normal": 10, "aiClear:rare": 35, "aiClear:epic": 120,
  "heat:normal": 20, "heat:rare": 50, "heat:epic": 150, "heat:legend": 450,
  "collectionValue:normal": 15, "collectionValue:rare": 35, "collectionValue:epic": 150, "collectionValue:legend": 500,
  "cardCollector:normal": 15, "cardCollector:rare": 35, "cardCollector:epic": 150, "cardCollector:legend": 500,
  "legendCard:normal": 10, "legendCard:rare": 50, "legendCard:epic": 180,
  "threeStarEpic:epic": 180, "threeStarLegend:legend": 500,
  "packCompletion:normal": 15, "packCompletion:rare": 35, "packCompletion:epic": 150, "packCompletion:legend": 500,
  "packAllThreeStar:legend": 800,
  "shellWealth:normal": 15, "shellWealth:rare": 40, "shellWealth:epic": 150, "shellWealth:legend": 1000,
  "shellBalance:epic": 150,
  "excellentAuthor:epic": 150
};

export function calculateBadgeShellReward(
  achievementPoints: number,
  rewardEligible: boolean,
  rewardRecordCreated: boolean
) {
  if (!rewardEligible || !rewardRecordCreated) return 0;
  return Math.max(0, Math.floor(achievementPoints));
}

export function badgeUnlockNotificationContent(content: string, shellReward: number) {
  return shellReward > 0 ? `${content}，同时获得 ${shellReward} 贝壳。` : content;
}
