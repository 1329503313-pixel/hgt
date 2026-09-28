import type mysql from "mysql2/promise";

export const TEN_DRAW_SORTS = [
  "time-desc", "time-asc", "rainbow-desc", "rainbow-asc",
  "gold-desc", "gold-asc", "score-desc", "score-asc",
] as const;

export type TenDrawSort = typeof TEN_DRAW_SORTS[number];

export function tenDrawOrderBy(value: unknown): string {
  const drawnAt = "COALESCE(o.completed_at, o.created_at)";
  const recentFirst = `${drawnAt} DESC, o.id DESC`;
  switch (value) {
    case "time-asc": return `${drawnAt} ASC, o.id ASC`;
    case "rainbow-desc": return `rainbow_count DESC, score DESC, ${recentFirst}`;
    case "rainbow-asc": return `rainbow_count ASC, score DESC, ${recentFirst}`;
    case "gold-desc": return `gold_count DESC, score DESC, ${recentFirst}`;
    case "gold-asc": return `gold_count ASC, score DESC, ${recentFirst}`;
    case "score-desc": return `score DESC, ${recentFirst}`;
    case "score-asc": return `score ASC, ${recentFirst}`;
    default: return recentFirst;
  }
}

export async function listTenDrawRecords(
  db: mysql.Pool | mysql.PoolConnection,
  options: { limit: number; offset: number; keyword: string; sort: unknown },
) {
  const { limit, offset, keyword, sort } = options;
  const where = keyword
    ? "AND (u.nickname LIKE ? OR u.username LIKE ? OR p.name LIKE ?)"
    : "";
  const params = keyword ? [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`] : [];
  const [[totalRow], rows] = await Promise.all([
    db.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM asset_draw_orders o
       INNER JOIN users u ON u.id = o.user_id
       INNER JOIN asset_packs p ON p.id = o.pack_id
       WHERE o.draw_mode = 'ten' AND o.status = 'completed' ${where}`,
      params,
    ).then(([items]) => items),
    db.query<mysql.RowDataPacket[]>(
      `SELECT o.id, COALESCE(o.completed_at, o.created_at) AS drawn_at,
        u.id AS user_id, u.nickname, p.id AS pack_id, p.name AS pack_name,
        COALESCE(SUM(r.rarity = 'legend'), 0) AS rainbow_count,
        COALESCE(SUM(r.rarity = 'epic'), 0) AS gold_count,
        COALESCE(SUM(r.rarity = 'rare'), 0) AS purple_count,
        COALESCE(SUM(r.rarity = 'normal'), 0) AS blue_count,
        COALESCE(SUM(CASE r.rarity WHEN 'legend' THEN 15 WHEN 'epic' THEN 5
          WHEN 'rare' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END), 0) AS score
       FROM asset_draw_orders o
       INNER JOIN users u ON u.id = o.user_id
       INNER JOIN asset_packs p ON p.id = o.pack_id
       LEFT JOIN asset_draw_results r ON r.order_id = o.id
       WHERE o.draw_mode = 'ten' AND o.status = 'completed' ${where}
       GROUP BY o.id, o.completed_at, o.created_at, u.id, u.nickname, p.id, p.name
       ORDER BY ${tenDrawOrderBy(sort)} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ).then(([items]) => items),
  ]);
  return {
    total: Number(totalRow?.total ?? 0),
    records: rows.map((row) => ({
      id: String(row.id), drawnAt: new Date(row.drawn_at).toISOString(),
      userId: String(row.user_id), nickname: String(row.nickname),
      packId: String(row.pack_id), packName: String(row.pack_name),
      rainbowCount: Number(row.rainbow_count), goldCount: Number(row.gold_count),
      purpleCount: Number(row.purple_count), blueCount: Number(row.blue_count),
      score: Number(row.score),
    })),
  };
}
