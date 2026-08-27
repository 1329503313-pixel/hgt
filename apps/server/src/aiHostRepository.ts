import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import {
  compileRuntimeFacts,
  type AiFactDefinition,
  type AiFactState,
  type AiRoundFact,
  type FactTransition,
} from "./aiHostProtocol.js";
import type { AtomicFact, ProgressKeyFact } from "./gameLogic.js";
import type { AiCallAudit } from "./aiProvider.js";

type DbExecutor = mysql.Pool | mysql.PoolConnection;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function sourceHash(keyFacts: readonly ProgressKeyFact[], facts: readonly AiFactDefinition[]) {
  return createHash("sha256").update(JSON.stringify({ keyFacts, facts })).digest("hex");
}

export async function recordAiCallAudit(audit: AiCallAudit) {
  await pool.query(
    `INSERT INTO ai_call_logs
      (id, decision_id, call_type, provider, model, request_json, response_json, started_at,
       duration_ms, success, prompt_tokens, completion_tokens, total_tokens, error_kind, error_message, expires_at)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 30 DAY))`,
    [
      audit.id, audit.decisionId, audit.callType, audit.provider, audit.model,
      JSON.stringify(audit.requestBody), audit.responseBody == null ? "null" : JSON.stringify(audit.responseBody),
      audit.startedAt, audit.durationMs, audit.success ? 1 : 0, audit.promptTokens, audit.completionTokens,
      audit.totalTokens, audit.errorKind, audit.errorMessage, audit.startedAt,
    ],
  );
}

export async function cleanupExpiredAiCallLogs() {
  const [result] = await pool.query<mysql.ResultSetHeader>("DELETE FROM ai_call_logs WHERE expires_at < NOW() LIMIT 5000");
  return result.affectedRows;
}

async function loadFactVersion(versionId: string, db: DbExecutor = pool): Promise<AiRoundFact[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT facts.fact_id, facts.source_key_id, facts.content, facts.weight, facts.is_core,
       facts.is_must_have, facts.aliases_json, facts.discovery_condition, facts.hints_json,
       states.state
     FROM ai_soup_facts facts
     LEFT JOIN online_soup_round_fact_states states
       ON states.fact_version_id = facts.version_id AND states.fact_id = facts.fact_id
     WHERE facts.version_id = ? ORDER BY facts.fact_id`,
    [versionId],
  );
  return rows.map((row) => ({
    id: String(row.fact_id),
    sourceKeyId: Number(row.source_key_id),
    content: String(row.content),
    weight: Number(row.weight),
    core: Boolean(row.is_core),
    mustHave: Boolean(row.is_must_have),
    aliases: parseJson<string[]>(row.aliases_json, []),
    discoveryCondition: String(row.discovery_condition),
    hints: parseJson<[string, string, string]>(row.hints_json, ["", "", ""]),
    state: (["UNSEEN", "TOUCHED", "DISCOVERED"].includes(String(row.state)) ? String(row.state) : "UNSEEN") as AiFactState,
  }));
}

export async function ensureRoundAiFacts(input: {
  roundId: string;
  soupId: string;
  keyFacts: readonly ProgressKeyFact[];
  atomicFacts: readonly AtomicFact[];
  legacyRevealedAtomicFactIds: readonly number[];
}): Promise<{ versionId: string; facts: AiRoundFact[] }> {
  const compiled = compileRuntimeFacts(input.keyFacts, input.atomicFacts);
  if (compiled.length === 0 || compiled.reduce((sum, fact) => sum + fact.weight, 0) !== 100) {
    throw new Error("AI_FACT_VERSION_INVALID");
  }
  const hash = sourceHash(input.keyFacts, compiled);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[round]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT ai_fact_version_id FROM online_soup_rounds WHERE id = ? FOR UPDATE",
      [input.roundId],
    );
    if (!round) throw new Error("AI_ROUND_NOT_FOUND");
    let versionId = round.ai_fact_version_id ? String(round.ai_fact_version_id) : "";
    if (!versionId) {
      const [[existing]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM ai_soup_fact_versions WHERE soup_id = ? AND source_hash = ? LIMIT 1",
        [input.soupId, hash],
      );
      versionId = existing ? String(existing.id) : nanoid();
      if (!existing) {
        await connection.query(
          "INSERT INTO ai_soup_fact_versions (id, soup_id, source_hash, source_key_facts) VALUES (?, ?, ?, CAST(? AS JSON))",
          [versionId, input.soupId, hash, JSON.stringify(input.keyFacts)],
        );
        for (const fact of compiled) {
          await connection.query(
            `INSERT INTO ai_soup_facts
              (version_id, fact_id, source_key_id, content, weight, is_core, is_must_have,
               aliases_json, discovery_condition, hints_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))`,
            [versionId, fact.id, fact.sourceKeyId, fact.content, fact.weight, fact.core ? 1 : 0,
              fact.mustHave ? 1 : 0, JSON.stringify(fact.aliases), fact.discoveryCondition, JSON.stringify(fact.hints)],
          );
        }
        await connection.query(
          "UPDATE ai_soup_fact_versions SET status = 'superseded' WHERE soup_id = ? AND id <> ? AND status = 'active'",
          [input.soupId, versionId],
        );
      }
      await connection.query(
        `UPDATE online_soup_rounds
         SET ai_fact_version_id = ?, ai_phase = IF(status = 'playing', IF(ai_progress >= 80, 'READY_TO_SOLVE', 'PLAYING'), ai_phase)
         WHERE id = ?`,
        [versionId, input.roundId],
      );
    }

    const revealed = new Set(input.legacyRevealedAtomicFactIds.map((id) => `F${String(id).padStart(2, "0")}`));
    const [definitions] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT fact_id FROM ai_soup_facts WHERE version_id = ? ORDER BY fact_id",
      [versionId],
    );
    for (const definition of definitions) {
      const factId = String(definition.fact_id);
      await connection.query(
        `INSERT IGNORE INTO online_soup_round_fact_states (round_id, fact_version_id, fact_id, state)
         VALUES (?, ?, ?, ?)`,
        [input.roundId, versionId, factId, revealed.has(factId) ? "DISCOVERED" : "UNSEEN"],
      );
    }
    await connection.commit();
    const facts = await loadRoundFacts(input.roundId);
    return { versionId, facts };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function loadRoundFacts(roundId: string, db: DbExecutor = pool): Promise<AiRoundFact[]> {
  const [[round]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT ai_fact_version_id FROM online_soup_rounds WHERE id = ? LIMIT 1",
    [roundId],
  );
  if (!round?.ai_fact_version_id) return [];
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT facts.fact_id, facts.source_key_id, facts.content, facts.weight, facts.is_core,
       facts.is_must_have, facts.aliases_json, facts.discovery_condition, facts.hints_json, states.state
     FROM online_soup_round_fact_states states
     INNER JOIN ai_soup_facts facts
       ON facts.version_id = states.fact_version_id AND facts.fact_id = states.fact_id
     WHERE states.round_id = ? ORDER BY facts.fact_id`,
    [roundId],
  );
  return rows.map((row) => ({
    id: String(row.fact_id), sourceKeyId: Number(row.source_key_id), content: String(row.content),
    weight: Number(row.weight), core: Boolean(row.is_core), mustHave: Boolean(row.is_must_have),
    aliases: parseJson<string[]>(row.aliases_json, []), discoveryCondition: String(row.discovery_condition),
    hints: parseJson<[string, string, string]>(row.hints_json, ["", "", ""]), state: String(row.state) as AiFactState,
  }));
}

export async function persistFactTransitions(
  db: mysql.PoolConnection,
  roundId: string,
  transitions: readonly FactTransition[],
  userId: string,
  questionId: string,
) {
  for (const transition of transitions) {
    if (transition.after === "TOUCHED") {
      await db.query(
        `UPDATE online_soup_round_fact_states
         SET state = IF(state = 'UNSEEN', 'TOUCHED', state),
             first_touched_by = COALESCE(first_touched_by, ?),
             first_touched_question_id = COALESCE(first_touched_question_id, ?),
             first_touched_at = COALESCE(first_touched_at, NOW())
         WHERE round_id = ? AND fact_id = ? AND state = 'UNSEEN'`,
        [userId, questionId, roundId, transition.factId],
      );
    } else if (transition.after === "DISCOVERED") {
      await db.query(
        `UPDATE online_soup_round_fact_states
         SET state = 'DISCOVERED',
             first_touched_by = COALESCE(first_touched_by, ?),
             first_touched_question_id = COALESCE(first_touched_question_id, ?),
             first_touched_at = COALESCE(first_touched_at, NOW()),
             first_discovered_by = COALESCE(first_discovered_by, ?),
             first_discovered_question_id = COALESCE(first_discovered_question_id, ?),
             first_discovered_at = COALESCE(first_discovered_at, NOW())
         WHERE round_id = ? AND fact_id = ? AND state <> 'DISCOVERED'`,
        [userId, questionId, userId, questionId, roundId, transition.factId],
      );
    }
  }
}

export async function ensureAiDecision(input: {
  questionMessageId: string;
  roundId: string;
  normalizedQuestionHash: string;
  contextHash: string;
}): Promise<string> {
  const id = nanoid();
  await pool.query(
    `INSERT IGNORE INTO online_soup_ai_decisions
      (id, question_message_id, round_id, normalized_question_hash, context_hash)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.questionMessageId, input.roundId, input.normalizedQuestionHash, input.contextHash],
  );
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM online_soup_ai_decisions WHERE question_message_id = ? LIMIT 1",
    [input.questionMessageId],
  );
  const decisionId = String(row.id);
  await pool.query("UPDATE online_soup_messages SET ai_decision_id = ? WHERE id = ?", [decisionId, input.questionMessageId]);
  return decisionId;
}

export async function claimAiDecision(decisionId: string, status: "fast_answering" | "adjudicating") {
  const leaseToken = nanoid();
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE online_soup_ai_decisions
     SET status = ?, lease_token = ?, lease_expires_at = DATE_ADD(NOW(), INTERVAL 90 SECOND),
         attempt_count = attempt_count + 1, started_at = COALESCE(started_at, NOW()), error_kind = NULL, error_message = NULL
     WHERE id = ? AND status NOT IN ('completed','cancelled')
       AND (lease_expires_at IS NULL OR lease_expires_at < NOW())`,
    [status, leaseToken, decisionId],
  );
  return result.affectedRows === 1 ? leaseToken : null;
}

export async function savePreliminaryAiDecision(decisionId: string, answer: string) {
  await pool.query(
    "UPDATE online_soup_ai_decisions SET preliminary_answer = ?, status = 'adjudicating' WHERE id = ? AND status NOT IN ('completed','failed','cancelled')",
    [answer, decisionId],
  );
}

export async function resetAiDecisionForRetry(decisionId: string) {
  await pool.query(
    `UPDATE online_soup_ai_decisions
     SET status = 'queued', lease_token = NULL, lease_expires_at = NULL,
       preliminary_answer = NULL, final_answer = NULL, confidence = NULL,
       contains_unsupported_assumption = 0, injection_detected = 0, matched_facts_json = NULL,
       verifier_status = 'not_required', verifier_issues_json = NULL,
       error_kind = NULL, error_message = NULL, completed_at = NULL
     WHERE id = ? AND status = 'failed'`,
    [decisionId],
  );
}

export async function updateAiDecision(
  decisionId: string,
  changes: {
    status: "fast_answering" | "adjudicating" | "verifying" | "committing" | "completed" | "failed" | "cancelled";
    preliminaryAnswer?: string | null;
    finalAnswer?: string | null;
    confidence?: number | null;
    unsupported?: boolean;
    injection?: boolean;
    matchedFacts?: unknown;
    verifierStatus?: "not_required" | "pending" | "accepted" | "rejected" | "failed";
    verifierIssues?: unknown;
    errorKind?: string | null;
    errorMessage?: string | null;
  },
  db: DbExecutor = pool,
) {
  await db.query(
    `UPDATE online_soup_ai_decisions SET status = ?,
       preliminary_answer = COALESCE(?, preliminary_answer), final_answer = COALESCE(?, final_answer),
       confidence = COALESCE(?, confidence),
       contains_unsupported_assumption = COALESCE(?, contains_unsupported_assumption),
       injection_detected = COALESCE(?, injection_detected),
       matched_facts_json = COALESCE(CAST(? AS JSON), matched_facts_json),
       verifier_status = COALESCE(?, verifier_status),
       verifier_issues_json = COALESCE(CAST(? AS JSON), verifier_issues_json),
       error_kind = ?, error_message = ?, lease_token = NULL, lease_expires_at = NULL,
       completed_at = IF(? IN ('completed','failed','cancelled'), NOW(), completed_at)
     WHERE id = ?`,
    [
      changes.status, changes.preliminaryAnswer ?? null, changes.finalAnswer ?? null,
      changes.confidence ?? null, changes.unsupported == null ? null : changes.unsupported ? 1 : 0,
      changes.injection == null ? null : changes.injection ? 1 : 0,
      changes.matchedFacts == null ? null : JSON.stringify(changes.matchedFacts), changes.verifierStatus ?? null,
      changes.verifierIssues == null ? null : JSON.stringify(changes.verifierIssues), changes.errorKind ?? null,
      changes.errorMessage ?? null, changes.status, decisionId,
    ],
  );
}

export async function reusableAiDecision(roundId: string, questionHash: string, contextHash: string, excludingDecisionId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT final_answer, confidence, contains_unsupported_assumption, injection_detected, matched_facts_json,
       verifier_status, verifier_issues_json
     FROM online_soup_ai_decisions
     WHERE round_id = ? AND normalized_question_hash = ? AND context_hash = ?
       AND status = 'completed' AND id <> ?
     ORDER BY completed_at DESC LIMIT 1`,
    [roundId, questionHash, contextHash, excludingDecisionId],
  );
  if (!row?.final_answer) return null;
  return {
    finalAnswer: String(row.final_answer), confidence: Number(row.confidence),
    unsupported: Boolean(row.contains_unsupported_assumption), injection: Boolean(row.injection_detected),
    matchedFacts: parseJson<unknown[]>(row.matched_facts_json, []), verifierStatus: String(row.verifier_status),
    verifierIssues: parseJson<string[]>(row.verifier_issues_json, []),
  };
}
