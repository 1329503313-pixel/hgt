export const HIDDEN_COLLECTIBLE_BADGES = [
  {
    id: "truth-crown",
    key: "legendary:truth-crown",
    collectibleNo: "001",
    name: "真相之冠",
    description: "答案从来不在问题里",
    requirement: "拥有编号001收藏品（如果失去则取消该徽章）",
    iconUrl: "/badges/truth-crown-legend.webp",
    achievementPoints: 300
  },
  {
    id: "illusory-eye",
    key: "legendary:illusory-eye",
    collectibleNo: "002",
    name: "虚妄之眼",
    description: "看破无法解开的谜题",
    requirement: "拥有编号002收藏品（如果失去则取消该徽章）",
    iconUrl: "/badges/illusory-eye-legend.webp",
    achievementPoints: 300
  },
  {
    id: "truth-scepter",
    key: "legendary:truth-scepter",
    collectibleNo: "003",
    name: "真相权杖",
    description: "知道所有故事真正的结局",
    requirement: "拥有编号003收藏品（如果失去则取消该徽章）",
    iconUrl: "/badges/truth-scepter-legend.webp",
    achievementPoints: 300
  }
] as const;

export const HIDDEN_COLLECTIBLE_BADGE_KEYS = HIDDEN_COLLECTIBLE_BADGES.map((badge) => badge.key);

export function hiddenCollectibleBadgeChanges(
  ownedCollectibleNumbers: ReadonlySet<string>,
  unlockedBadgeKeys: ReadonlySet<string>
) {
  return {
    grant: HIDDEN_COLLECTIBLE_BADGES.filter(
      (badge) => ownedCollectibleNumbers.has(badge.collectibleNo) && !unlockedBadgeKeys.has(badge.key)
    ),
    revoke: HIDDEN_COLLECTIBLE_BADGES.filter(
      (badge) => !ownedCollectibleNumbers.has(badge.collectibleNo) && unlockedBadgeKeys.has(badge.key)
    )
  };
}
