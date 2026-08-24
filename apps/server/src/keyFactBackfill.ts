import type mysql from "mysql2/promise";

export const AI_KEY_FACT_BACKFILL_INTERVAL_MS = 60 * 60 * 1000;

type Queryable = Pick<mysql.Pool, "query">;

/**
 * 补齐所有已开启 AI 主持、但尚无进度关键点的作品。
 * 不筛选审核状态，使待审核作品也能提前准备；生成器自身负责保护用户手动配置。
 */
export async function backfillMissingAiKeyFacts(
  db: Queryable,
  generate: (soupId: string) => Promise<void>,
  concurrency = 2,
) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT s.id
     FROM soups s
     JOIN users creator ON creator.id = s.creator_id
     WHERE s.enable_ai_game = 1
       AND creator.role IN ('super_admin','backoffice_admin','admin','vip')
       AND (s.key_facts IS NULL OR JSON_LENGTH(s.key_facts) = 0)
     ORDER BY s.created_at ASC`,
  );
  const soupIds = [...new Set(rows.map((row) => String(row.id)).filter(Boolean))];
  if (soupIds.length === 0) return 0;

  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), soupIds.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < soupIds.length) {
      const soupId = soupIds[cursor];
      cursor += 1;
      await generate(soupId);
    }
  }));
  return soupIds.length;
}
