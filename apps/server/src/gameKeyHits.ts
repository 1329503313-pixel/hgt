import type mysql from "mysql2/promise";

type DbExecutor = Pick<mysql.Pool, "query"> | Pick<mysql.PoolConnection, "query">;

// Count completed source keys, never individual atomic facts or a room's progress percentage.
export async function recordKeyHits(userId: string, soupId: string, keyIds: readonly unknown[], db: DbExecutor) {
  const uniqueIds = [...new Set(keyIds
    .filter((id) => typeof id === "number" || (typeof id === "string" && id.trim() !== ""))
    .map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!uniqueIds.length) return 0;
  const [result] = await db.query<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO game_key_hits (user_id, soup_id, key_id) VALUES ${uniqueIds.map(() => "(?, ?, ?)").join(", ")}`,
    uniqueIds.flatMap((keyId) => [userId, soupId, keyId]),
  );
  return result.affectedRows;
}

// A key belongs to the player whose committed question discovered its last atomic fact.
// Require attribution for EVERY fact: migrated/unattributed states cannot prove an owner.
// Message sequence resolves same-second discoveries without guessing from timestamps.
export const ONLINE_SOUP_KEY_HITS_BACKFILL_SQL = `
  INSERT IGNORE INTO game_key_hits (user_id, soup_id, key_id)
  SELECT completed.user_id, completed.soup_id, completed.key_id
  FROM (
    SELECT rounds.soup_id, facts.source_key_id AS key_id, states.first_discovered_by AS user_id,
      COUNT(*) OVER key_facts AS fact_count,
      SUM(CASE WHEN states.state = 'DISCOVERED' AND questions.ai_status = 'completed'
        AND questions.message_type = 'question'
        AND questions.sender_id = states.first_discovered_by
        AND COALESCE(questions.ai_scoring_degraded, 0) = 0 THEN 1 ELSE 0 END) OVER key_facts AS proven_count,
      ROW_NUMBER() OVER (PARTITION BY rounds.id, facts.source_key_id
        ORDER BY questions.message_sequence DESC, facts.fact_id DESC) AS completion_order
    FROM online_soup_rounds rounds
    JOIN ai_soup_facts facts ON facts.version_id = rounds.ai_fact_version_id
    LEFT JOIN online_soup_round_fact_states states
      ON states.round_id = rounds.id AND states.fact_version_id = facts.version_id AND states.fact_id = facts.fact_id
    LEFT JOIN online_soup_messages questions
      ON questions.id = states.first_discovered_question_id AND questions.round_id = rounds.id
    WHERE rounds.host_mode = 'ai' AND facts.source_key_id > 0
      AND JSON_CONTAINS(COALESCE(rounds.ai_revealed_keys, JSON_ARRAY()), CAST(facts.source_key_id AS JSON))
    WINDOW key_facts AS (PARTITION BY rounds.id, facts.source_key_id)
  ) completed
  JOIN users ON users.id = completed.user_id
  WHERE completed.completion_order = 1 AND completed.fact_count = completed.proven_count
`;

export async function backfillOnlineSoupKeyHits(db: DbExecutor) {
  const [result] = await db.query<mysql.ResultSetHeader>(ONLINE_SOUP_KEY_HITS_BACKFILL_SQL);
  return result.affectedRows;
}
