import type mysql from "mysql2/promise";

// Historical rarity comes from the immutable transfer snapshot, never from the
// item's editable present-day rarity. Current ownership covers legacy imports.
export const COLLECTIBLE_ACHIEVEMENT_STATS_SQL = `
  SELECT
    GREATEST(
      COALESCE((SELECT MAX(c.rarity = 'epic') FROM collectibles c
        WHERE c.owner_user_id = u.id AND c.status = 'owned' AND c.deleted_at IS NULL), 0),
      COALESCE((SELECT MAX(JSON_UNQUOTE(JSON_EXTRACT(t.collectible_snapshot, '$.rarity')) = 'epic')
        FROM collectible_transfers t WHERE t.to_user_id = u.id
          AND t.transfer_type IN ('grant', 'auction', 'draw')), 0)
    ) AS epicCollectibleAcquired,
    GREATEST(
      COALESCE((SELECT MAX(c.rarity = 'legend') FROM collectibles c
        WHERE c.owner_user_id = u.id AND c.status = 'owned' AND c.deleted_at IS NULL), 0),
      COALESCE((SELECT MAX(JSON_UNQUOTE(JSON_EXTRACT(t.collectible_snapshot, '$.rarity')) = 'legend')
        FROM collectible_transfers t WHERE t.to_user_id = u.id
          AND t.transfer_type IN ('grant', 'auction', 'draw')), 0)
    ) AS legendCollectibleAcquired,
    GREATEST(
      COALESCE((SELECT SUM(c.collectible_value) FROM collectibles c
        WHERE c.owner_user_id = u.id AND c.status = 'owned' AND c.deleted_at IS NULL), 0),
      COALESCE((SELECT MAX(GREATEST(e.holdings_value_before, e.holdings_value_after))
        FROM collectible_value_events e WHERE e.user_id = u.id), 0)
    ) AS highestCollectibleValue
  FROM users u WHERE u.id = ?
`;

export const COLLECTIBLE_ACHIEVEMENT_USERS_SQL = `
  SELECT owner_user_id AS user_id FROM collectibles
    WHERE owner_user_id IS NOT NULL AND status = 'owned' AND deleted_at IS NULL
  UNION
  SELECT to_user_id AS user_id FROM collectible_transfers
    WHERE to_user_id IS NOT NULL AND transfer_type IN ('grant', 'auction', 'draw')
  UNION
  SELECT user_id FROM collectible_value_events
    WHERE holdings_value_before > 50000 OR holdings_value_after > 50000
`;

export async function getCollectibleAchievementStats(db: mysql.Pool | mysql.PoolConnection, userId: string) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(COLLECTIBLE_ACHIEVEMENT_STATS_SQL, [userId]);
  return {
    epicCollectibleAcquired: Number(row?.epicCollectibleAcquired ?? 0),
    legendCollectibleAcquired: Number(row?.legendCollectibleAcquired ?? 0),
    highestCollectibleValue: Number(row?.highestCollectibleValue ?? 0),
  };
}

// Called inside the same transaction as the value change. A locking read sees
// committed concurrent holdings plus this transaction's writes, not an old MVCC
// snapshot. Persist both sides so a later reclaim cannot erase a reached tier.
export async function collectibleHoldingValueSnapshot(db: mysql.PoolConnection, userId: string, delta: number) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT collectible_value FROM collectibles
     WHERE owner_user_id = ? AND status = 'owned' AND deleted_at IS NULL FOR UPDATE`,
    [userId],
  );
  const after = rows.reduce((sum, row) => sum + Number(row.collectible_value), 0);
  return { before: Math.max(0, after - delta), after };
}
