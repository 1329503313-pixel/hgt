export const COLLECTIBLE_RANKING_ELIGIBLE_ROLES = ["user", "vip", "backoffice_admin"] as const;
export const COLLECTIBLE_RANKING_ELIGIBLE_ROLES_SQL = COLLECTIBLE_RANKING_ELIGIBLE_ROLES
  .map((role) => `'${role}'`)
  .join(",");

export const CURRENT_COLLECTIBLE_HOLDINGS_SQL = `
  SELECT owner_user_id AS user_id,
    SUM(collectible_value) AS collectible_value,
    COUNT(*) AS collectible_count,
    MAX(updated_at) AS reached_at
  FROM collectibles
  WHERE owner_user_id IS NOT NULL
    AND status = 'owned'
    AND deleted_at IS NULL
  GROUP BY owner_user_id
`;
