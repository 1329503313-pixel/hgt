export const onlineSoupEligibleSources = [
  "recommended",
  "random",
  "latest",
  "liked",
  "favorited",
  "played",
  "mine"
] as const;

export type OnlineSoupEligibleSource = (typeof onlineSoupEligibleSources)[number];

const HEAT_ORDER_EXPRESSION = `ROUND(
  (COALESCE((SELECT AVG(eligible_heat_eval.total) FROM evaluations eligible_heat_eval WHERE eligible_heat_eval.soup_id = s.id), 0) + 1)
  * (
    s.view_count
    + ((SELECT COUNT(*) FROM soup_likes eligible_heat_like WHERE eligible_heat_like.soup_id = s.id) + 1) * 15
    + ((SELECT COUNT(*) FROM soup_favorites eligible_heat_favorite WHERE eligible_heat_favorite.soup_id = s.id) + 1) * 20
    + ((SELECT COUNT(*) FROM evaluations eligible_heat_count WHERE eligible_heat_count.soup_id = s.id) + 1) * 25
  ) - 60
)`;

export type OnlineSoupEligibleSourceSql = {
  conditions: string[];
  conditionParams: Array<string | number>;
  orderBy: string;
  orderParams: Array<string | number>;
};

export function onlineSoupEligibleSourceSql(
  source: OnlineSoupEligibleSource,
  userId: string,
  randomSeed: string
): OnlineSoupEligibleSourceSql {
  if (source === "random") {
    return {
      conditions: [],
      conditionParams: [],
      orderBy: "CRC32(CONCAT(s.id, ?)) ASC, s.id ASC",
      orderParams: [randomSeed]
    };
  }
  if (source === "latest") {
    return { conditions: [], conditionParams: [], orderBy: "s.created_at DESC, s.id DESC", orderParams: [] };
  }
  if (source === "liked") {
    return {
      conditions: ["EXISTS (SELECT 1 FROM soup_likes eligible_like WHERE eligible_like.soup_id = s.id AND eligible_like.user_id = ?)"],
      conditionParams: [userId],
      orderBy: "(SELECT eligible_like_order.created_at FROM soup_likes eligible_like_order WHERE eligible_like_order.soup_id = s.id AND eligible_like_order.user_id = ?) DESC, s.id DESC",
      orderParams: [userId]
    };
  }
  if (source === "favorited") {
    return {
      conditions: ["EXISTS (SELECT 1 FROM soup_favorites eligible_favorite WHERE eligible_favorite.soup_id = s.id AND eligible_favorite.user_id = ?)"],
      conditionParams: [userId],
      orderBy: "(SELECT eligible_favorite_order.created_at FROM soup_favorites eligible_favorite_order WHERE eligible_favorite_order.soup_id = s.id AND eligible_favorite_order.user_id = ?) DESC, s.id DESC",
      orderParams: [userId]
    };
  }
  if (source === "played") {
    const playedCondition = `(
      EXISTS (SELECT 1 FROM game_completions eligible_ai_played WHERE eligible_ai_played.soup_id = s.id AND eligible_ai_played.user_id = ?)
      OR EXISTS (SELECT 1 FROM online_soup_completions eligible_online_played WHERE eligible_online_played.soup_id = s.id AND eligible_online_played.user_id = ?)
      OR EXISTS (SELECT 1 FROM soup_access_grants eligible_legacy_played WHERE eligible_legacy_played.soup_id = s.id AND eligible_legacy_played.user_id = ? AND eligible_legacy_played.id LIKE 'online-%')
    )`;
    const playedOrder = `GREATEST(
      COALESCE((SELECT MAX(eligible_ai_played_order.completed_at) FROM game_completions eligible_ai_played_order WHERE eligible_ai_played_order.soup_id = s.id AND eligible_ai_played_order.user_id = ?), '1000-01-01'),
      COALESCE((SELECT MAX(eligible_online_played_order.completed_at) FROM online_soup_completions eligible_online_played_order WHERE eligible_online_played_order.soup_id = s.id AND eligible_online_played_order.user_id = ?), '1000-01-01'),
      COALESCE((SELECT MAX(eligible_legacy_played_order.created_at) FROM soup_access_grants eligible_legacy_played_order WHERE eligible_legacy_played_order.soup_id = s.id AND eligible_legacy_played_order.user_id = ? AND eligible_legacy_played_order.id LIKE 'online-%'), '1000-01-01')
    ) DESC, s.id DESC`;
    return {
      conditions: [playedCondition],
      conditionParams: [userId, userId, userId],
      orderBy: playedOrder,
      orderParams: [userId, userId, userId]
    };
  }
  if (source === "mine") {
    return {
      conditions: ["s.creator_id = ?"],
      conditionParams: [userId],
      orderBy: "s.created_at DESC, s.id DESC",
      orderParams: []
    };
  }
  return {
    conditions: [],
    conditionParams: [],
    orderBy: `${HEAT_ORDER_EXPRESSION} DESC, s.created_at DESC, s.id DESC`,
    orderParams: []
  };
}
