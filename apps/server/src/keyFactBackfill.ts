import type mysql from "mysql2/promise";

export const AI_KEY_FACT_BACKFILL_INTERVAL_MS = 60 * 60 * 1000;

type Queryable = Pick<mysql.Pool, "query">;

/**
 * 补齐所有已开启 AI 主持、但尚无进度关键点或关键点提示内容的作品。
 * 不筛选审核状态，使待审核作品也能提前准备；生成器自身负责保护用户手动配置。
 */
export async function backfillMissingAiKeyFacts(
  db: Queryable,
  generate: (soupId: string) => Promise<void>,
  concurrency = 2,
) {
  const missingSql = `SELECT s.id
     FROM soups s
     JOIN users creator ON creator.id = s.creator_id
     WHERE s.enable_ai_game = 1
       AND creator.role IN ('super_admin','backoffice_admin','admin','vip')
       AND (
         s.key_facts IS NULL
         OR JSON_LENGTH(s.key_facts) = 0
         OR EXISTS (
           SELECT 1
           FROM JSON_TABLE(
             COALESCE(s.key_facts, JSON_ARRAY()),
             '$[*]' COLUMNS(hint_content VARCHAR(255) PATH '$.hintContent' NULL ON EMPTY)
           ) AS key_fact
           WHERE NULLIF(TRIM(key_fact.hint_content), '') IS NULL
         )
       )
     ORDER BY s.created_at ASC`;
  const [rows] = await db.query<mysql.RowDataPacket[]>(missingSql);
  const soupIds = [...new Set(rows.map((row) => String(row.id)).filter(Boolean))];
  if (soupIds.length === 0) return { checked: 0, remaining: 0, failed: [] as string[] };

  let cursor = 0;
  const failed: string[] = [];
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), soupIds.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < soupIds.length) {
      const soupId = soupIds[cursor];
      cursor += 1;
      try {
        await generate(soupId);
      } catch {
        failed.push(soupId);
      }
    }
  }));
  const [remainingRows] = await db.query<mysql.RowDataPacket[]>(missingSql);
  const remaining = new Set(remainingRows.map((row) => String(row.id)).filter(Boolean)).size;
  return { checked: soupIds.length, remaining, failed };
}

export type AiAtomicFactRebuildResult = {
  total: number;
  rebuilt: number;
  skipped: string[];
  failed: { soupId: string; error: string }[];
};

/**
 * 重建所有当前有效 AI 主持作品的内部原子事实。
 * 具体重建器必须保留 key_facts、key_facts_hash 与 key_facts_customized。
 */
export async function rebuildAllAiAtomicFacts(
  db: Queryable,
  rebuild: (soupId: string) => Promise<boolean>,
  concurrency = 2,
): Promise<AiAtomicFactRebuildResult> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT s.id
     FROM soups s
     JOIN users creator ON creator.id = s.creator_id
     WHERE s.enable_ai_game = 1
       AND creator.role IN ('super_admin','backoffice_admin','admin','vip')
     ORDER BY s.created_at ASC`,
  );
  const soupIds = [...new Set(rows.map((row) => String(row.id)).filter(Boolean))];
  let cursor = 0;
  let rebuilt = 0;
  const skipped: string[] = [];
  const failed: { soupId: string; error: string }[] = [];
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), Math.max(1, soupIds.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < soupIds.length) {
      const soupId = soupIds[cursor];
      cursor += 1;
      try {
        if (await rebuild(soupId)) rebuilt += 1;
        else skipped.push(soupId);
      } catch (error) {
        failed.push({
          soupId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }));

  return { total: soupIds.length, rebuilt, skipped, failed };
}
