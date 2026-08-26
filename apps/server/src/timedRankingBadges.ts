export const TIMED_RANKING_BADGES = {
  achievement: {
    id: "ranking-achievement-champion",
    name: "荣誉载身",
    description: "什么名声，我根本不在乎",
    requirement: "排行榜成就榜30日结算第一",
    iconUrl: "/badges/ranking-achievement-champion-epic.webp",
  },
  level: {
    id: "ranking-level-champion",
    name: "独自升级",
    description: "我独自升级",
    requirement: "排行榜等级榜30日结算第一",
    iconUrl: "/badges/ranking-level-champion-epic.webp",
  },
  collection: {
    id: "ranking-card-champion",
    name: "JOKER",
    description: "收藏卡牌只是一种喜好",
    requirement: "排行榜卡牌榜30日结算第一",
    iconUrl: "/badges/ranking-card-champion-epic.webp",
  },
  collectible: {
    id: "ranking-collectible-champion",
    name: "收藏大师",
    description: "黄金屋？说的是我家吗",
    requirement: "排行榜收藏品榜30日结算第一",
    iconUrl: "/badges/ranking-collectible-champion-epic.webp",
  },
  draws: {
    id: "ranking-draws-champion",
    name: "一发入魂",
    description: "我一发入魂这件事不要告诉其他人",
    requirement: "排行榜抽卡榜30日结算第一",
    iconUrl: "/badges/ranking-draws-champion-epic.webp",
  },
  charm: {
    id: "ranking-charm-champion",
    name: "魅力四射",
    description: "这该死的魅力……",
    requirement: "排行榜魅力榜30日结算第一",
    iconUrl: "/badges/ranking-charm-champion-epic.webp",
  },
  generosity: {
    id: "ranking-generosity-champion",
    name: "慷慨新贵",
    description: "我不是慷慨，我只是有一双发现美的眼睛",
    requirement: "排行榜慷慨榜30日结算第一",
    iconUrl: "/badges/ranking-generosity-champion-epic.webp",
  },
} as const;

export type TimedRankingBadgeBoard = keyof typeof TIMED_RANKING_BADGES;

export const TIMED_RANKING_BADGE_LIST = Object.entries(TIMED_RANKING_BADGES).map(([board, badge]) => ({
  board: board as TimedRankingBadgeBoard,
  ...badge,
  achievementPoints: 0,
  badgeType: "timed" as const,
  tier: "epic" as const,
}));
