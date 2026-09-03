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
  "drawLuck:normal": 10, "drawLuck:rare": 20, "drawLuck:epic": 50, "drawLuck:legend": 150,
  "generosity:normal": 20, "generosity:rare": 50, "generosity:epic": 120, "generosity:legend": 250,
  "charm:normal": 30, "charm:rare": 100, "charm:epic": 200, "charm:legend": 500,
  "legendCard:normal": 10, "legendCard:rare": 50, "legendCard:epic": 180,
  "threeStarEpic:epic": 180, "threeStarLegend:legend": 500,
  "packCompletion:normal": 15, "packCompletion:rare": 35, "packCompletion:epic": 150, "packCompletion:legend": 500,
  "packAllThreeStar:legend": 800,
  "shellWealth:normal": 15, "shellWealth:rare": 40, "shellWealth:epic": 150, "shellWealth:legend": 1000,
  "shellBalance:epic": 150,
  "vipHonor:normal": 50, "vipHonor:rare": 150, "vipHonor:epic": 350, "vipHonor:legend": 1000,
  "excellentAuthor:epic": 150,
  "shiningCrownReceived:epic": 150,
  "shiningCrownSent:epic": 150
};

// 抽卡订单只保留最近 10 条，徽章累计进度必须读取不会随历史清理丢失的持有卡牌总数。
export const LEGENDARY_CARD_DRAW_COUNT_SQL = `
  SELECT COALESCE(SUM(owned.total_obtained), 0) AS count
  FROM user_asset_cards owned
  INNER JOIN asset_cards card ON card.id = owned.card_id
  WHERE owned.user_id = ? AND card.rarity = 'legend'
`;

// AI 主持曾有独立单人存档与现行游戏房间两套入口。成就累计必须合并两者，
// 但游戏房间只统计确实由 AI 主持的回合，不能把真人主持通关算入汤灵系列。
export const AI_COMPLETION_COUNT_SQL = `
  SELECT
    (SELECT COUNT(*) FROM game_completions legacy WHERE legacy.user_id = ?)
    +
    (SELECT COUNT(*)
     FROM online_soup_completions online_completion
     INNER JOIN online_soup_rounds online_round ON online_round.id = online_completion.round_id
     WHERE online_completion.user_id = ? AND online_round.host_mode = 'ai') AS count
`;

// 仅返回达到任一汤灵徽章门槛但仍缺少对应永久解锁记录的历史用户。
// 启动补发完成后该查询自然返回空集，因此可以安全重复执行。
export const AI_COMPLETION_BADGE_BACKFILL_USERS_SQL = `
  SELECT completion_stats.user_id
  FROM (
    SELECT completions.user_id, COUNT(*) AS completion_count
    FROM (
      SELECT legacy.user_id, CONCAT('legacy:', legacy.session_id) AS completion_key
      FROM game_completions legacy
      UNION ALL
      SELECT online_completion.user_id,
        CONCAT('online:', online_completion.round_id, ':', online_completion.user_id) AS completion_key
      FROM online_soup_completions online_completion
      INNER JOIN online_soup_rounds online_round ON online_round.id = online_completion.round_id
      WHERE online_round.host_mode = 'ai'
    ) completions
    GROUP BY completions.user_id
  ) completion_stats
  LEFT JOIN user_badge_unlocks normal_unlock
    ON normal_unlock.user_id = completion_stats.user_id AND normal_unlock.badge_key = 'aiClear:normal'
  LEFT JOIN user_badge_unlocks rare_unlock
    ON rare_unlock.user_id = completion_stats.user_id AND rare_unlock.badge_key = 'aiClear:rare'
  LEFT JOIN user_badge_unlocks epic_unlock
    ON epic_unlock.user_id = completion_stats.user_id AND epic_unlock.badge_key = 'aiClear:epic'
  WHERE (completion_stats.completion_count >= 1 AND normal_unlock.user_id IS NULL)
     OR (completion_stats.completion_count >= 10 AND rare_unlock.user_id IS NULL)
     OR (completion_stats.completion_count >= 50 AND epic_unlock.user_id IS NULL)
`;

export const SHINING_CROWN_BADGE_BACKFILL_USERS_SQL = `
  SELECT DISTINCT affected.user_id, affected.badge_key, users.badges_initialized
  FROM (
    SELECT sends.sender_id AS user_id, 'shiningCrownSent:epic' AS badge_key
    FROM gift_sends sends
    LEFT JOIN gifts gift ON gift.id = sends.gift_id
    WHERE TRIM(sends.gift_name_snapshot) IN ('闪耀皇冠', '传说皇冠')
       OR TRIM(gift.name) IN ('闪耀皇冠', '传说皇冠')
       OR EXISTS (
         SELECT 1 FROM system_reward_gift_bindings bindings
         WHERE bindings.reward_key = 'achievement:shining_crown'
           AND bindings.gift_id = sends.gift_id
       )
    UNION ALL
    SELECT sends.recipient_id AS user_id, 'shiningCrownReceived:epic' AS badge_key
    FROM gift_sends sends
    LEFT JOIN gifts gift ON gift.id = sends.gift_id
    WHERE TRIM(sends.gift_name_snapshot) IN ('闪耀皇冠', '传说皇冠')
       OR TRIM(gift.name) IN ('闪耀皇冠', '传说皇冠')
       OR EXISTS (
         SELECT 1 FROM system_reward_gift_bindings bindings
         WHERE bindings.reward_key = 'achievement:shining_crown'
           AND bindings.gift_id = sends.gift_id
       )
  ) affected
  INNER JOIN users ON users.id = affected.user_id
  LEFT JOIN user_badge_unlocks unlocks
    ON unlocks.user_id = affected.user_id AND unlocks.badge_key = affected.badge_key
  WHERE unlocks.user_id IS NULL
`;

const BADGE_TIER_ORDER = ["normal", "rare", "epic", "legend"] as const;

export function systemBadgeKeysWithPrerequisites(
  earnedKeys: string[],
  unlockedKeys: Iterable<string>,
  definedKeys: string[]
) {
  const qualified = new Set([...earnedKeys, ...unlockedKeys]);
  const highestTierBySeries = new Map<string, number>();
  for (const key of qualified) {
    const [series, tier] = key.split(":");
    const tierIndex = BADGE_TIER_ORDER.indexOf(tier as (typeof BADGE_TIER_ORDER)[number]);
    if (!series || tierIndex < 0) continue;
    highestTierBySeries.set(series, Math.max(highestTierBySeries.get(series) ?? -1, tierIndex));
  }
  return definedKeys.filter((key) => {
    const [series, tier] = key.split(":");
    const tierIndex = BADGE_TIER_ORDER.indexOf(tier as (typeof BADGE_TIER_ORDER)[number]);
    return qualified.has(key) || (tierIndex >= 0 && tierIndex <= (highestTierBySeries.get(series) ?? -1));
  });
}

export function calculateBadgeShellReward(
  _achievementPoints: number,
  _rewardEligible: boolean,
  _rewardRecordCreated: boolean
) {
  return 0;
}

export function badgeUnlockNotificationContent(content: string, _shellReward: number) {
  return content;
}

export function isShiningCrownGift(input: { name: unknown; rewardBindingMatched: unknown }) {
  return Boolean(input.rewardBindingMatched)
    || ["闪耀皇冠", "传说皇冠"].includes(String(input.name ?? "").trim());
}
