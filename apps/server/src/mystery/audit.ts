import type mysql from "mysql2/promise";
import { pool } from "../db.js";

export type MysteryRunAuditStatus = "active" | "completed" | "superseded" | "abandoned";

export function normalizeMysteryAuditPagination(input: { page?: unknown; limit?: unknown }) {
  const rawPage = Number(input.page ?? 1);
  const rawLimit = Number(input.limit ?? 20);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
  return { page, limit, offset: (page - 1) * limit };
}

function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function iso(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

export function mysteryRunAuditSummary(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    storyId: String(row.story_id),
    storyVersionId: String(row.story_version_id),
    versionNumber: Number(row.version_number),
    owner: { id: String(row.owner_user_id), nickname: String(row.owner_nickname) },
    room: row.room_id ? {
      id: String(row.room_id),
      code: row.room_code ? String(row.room_code) : null,
      name: row.room_name ? String(row.room_name) : null,
      status: row.room_status ? String(row.room_status) : null,
    } : null,
    status: String(row.status) as MysteryRunAuditStatus,
    isCurrentSave: Boolean(row.is_current_save),
    stateVersion: Number(row.state_version),
    turnSequence: Number(row.turn_sequence),
    eventSequence: Number(row.event_sequence),
    worldTimeSeconds: Number(row.current_world_time_seconds),
    finalEndingId: row.final_ending_id ? String(row.final_ending_id) : null,
    keyNodeCount: Number(row.key_node_count ?? 0),
    failedTurnCount: Number(row.failed_turn_count ?? 0),
    startedAt: iso(row.started_at)!,
    updatedAt: iso(row.updated_at)!,
    completedAt: iso(row.completed_at),
  };
}

const runAuditSelect = `
  SELECT runs.*, versions.version_number, users.nickname AS owner_nickname,
    rooms.room_code, rooms.name AS room_name, rooms.status AS room_status,
    EXISTS(SELECT 1 FROM mystery_save_slots slots WHERE slots.current_run_id = runs.id) AS is_current_save,
    (SELECT COUNT(*) FROM mystery_world_events events WHERE events.run_id = runs.id AND events.is_key_node = 1) AS key_node_count,
    (SELECT COUNT(*) FROM mystery_turns turns WHERE turns.run_id = runs.id AND turns.status = 'failed') AS failed_turn_count
  FROM mystery_runs runs
  JOIN mystery_story_versions versions ON versions.id = runs.story_version_id
  JOIN users ON users.id = runs.owner_user_id
  LEFT JOIN online_soup_rooms rooms ON rooms.id = runs.room_id`;

export async function mysteryStoryExists(storyId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM mystery_stories WHERE id = ? LIMIT 1",
    [storyId],
  );
  return Boolean(row);
}

export async function mysteryRunExists(storyId: string, runId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM mystery_runs WHERE id = ? AND story_id = ? LIMIT 1",
    [runId, storyId],
  );
  return Boolean(row);
}

export async function listMysteryRunAudits(input: {
  storyId: string;
  status?: MysteryRunAuditStatus;
  page?: unknown;
  limit?: unknown;
}) {
  const pagination = normalizeMysteryAuditPagination(input);
  const statusSql = input.status ? "AND runs.status = ?" : "";
  const params = input.status ? [input.storyId, input.status] : [input.storyId];
  const [[countRow], [rows]] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM mystery_runs runs WHERE runs.story_id = ? ${statusSql}`,
      params,
    ),
    pool.query<mysql.RowDataPacket[]>(
      `${runAuditSelect}
       WHERE runs.story_id = ? ${statusSql}
       ORDER BY runs.updated_at DESC, runs.id DESC LIMIT ? OFFSET ?`,
      [...params, pagination.limit, pagination.offset],
    ),
  ]);
  return {
    runs: rows.map(mysteryRunAuditSummary),
    total: Number(countRow[0]?.total ?? 0),
    page: pagination.page,
    limit: pagination.limit,
  };
}

function turnAuditPayload(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    sequence: row.turn_sequence == null ? null : Number(row.turn_sequence),
    idempotencyKey: String(row.idempotency_key),
    rawInput: String(row.raw_input),
    inputClassification: row.input_classification ? String(row.input_classification) : null,
    injectionRisk: row.injection_risk ? String(row.injection_risk) : null,
    status: String(row.status),
    attemptCount: Number(row.attempt_count ?? 0),
    stateVersionBefore: Number(row.state_version_before),
    stateVersionAfter: row.state_version_after == null ? null : Number(row.state_version_after),
    errorCode: row.error_code ? String(row.error_code) : null,
    processingExpiresAt: iso(row.processing_expires_at),
    resolution: row.resolution_json == null ? null : jsonValue(row.resolution_json),
    playerVisiblePacket: row.player_visible_packet == null ? null : jsonValue(row.player_visible_packet),
    narrative: row.narrative ? String(row.narrative) : null,
    createdAt: iso(row.created_at)!,
    completedAt: iso(row.completed_at),
  };
}

export async function getMysteryRunAudit(storyId: string, runId: string) {
  const [[run]] = await pool.query<mysql.RowDataPacket[]>(
    `${runAuditSelect} WHERE runs.story_id = ? AND runs.id = ? LIMIT 1`,
    [storyId, runId],
  );
  if (!run) return null;
  const [turns] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, turn_sequence, idempotency_key, raw_input, input_classification, injection_risk, status,
      attempt_count, processing_expires_at, state_version_before, state_version_after,
      resolution_json, player_visible_packet, narrative, error_code, created_at, completed_at
     FROM mystery_turns WHERE run_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 50`,
    [runId],
  );
  return {
    run: { ...mysteryRunAuditSummary(run), stateSnapshot: jsonValue(run.state_snapshot) },
    turns: turns.map(turnAuditPayload),
  };
}

function eventAuditPayload(row: mysql.RowDataPacket) {
  const payload = jsonValue<Record<string, unknown>>(row.event_payload);
  return {
    id: String(row.id),
    turnId: String(row.turn_id),
    eventIndex: Number(row.event_index),
    eventType: String(row.event_type),
    worldTimeBefore: Number(row.world_time_before),
    worldTimeAfter: Number(row.world_time_after),
    actorIds: jsonValue<string[]>(row.actor_ids),
    targetIds: jsonValue<string[]>(row.target_ids),
    locationId: row.location_id ? String(row.location_id) : null,
    irreversible: Boolean(row.irreversible),
    keyNode: Boolean(row.is_key_node),
    keyNodeType: row.key_node_type ? String(row.key_node_type) : null,
    idempotencyKey: String(row.idempotency_key),
    committedStateVersion: Number(row.committed_state_version),
    summary: typeof payload.playerVisibleSummary === "string"
      ? payload.playerVisibleSummary
      : typeof payload.normalizedMeaning === "string"
        ? payload.normalizedMeaning
        : String(row.event_type),
    payload,
    createdAt: iso(row.created_at)!,
  };
}

export async function listMysteryRunEvents(input: {
  storyId: string;
  runId: string;
  keyOnly: boolean;
  before?: number;
  limit?: unknown;
}) {
  const limit = normalizeMysteryAuditPagination({ limit: input.limit }).limit;
  const params: Array<string | number> = [input.storyId, input.runId];
  const filters = ["runs.story_id = ?", "events.run_id = ?"];
  if (input.keyOnly) filters.push("events.is_key_node = 1");
  if (input.before !== undefined) {
    filters.push("events.event_index < ?");
    params.push(input.before);
  }
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT events.* FROM mystery_world_events events
     JOIN mystery_runs runs ON runs.id = events.run_id
     WHERE ${filters.join(" AND ")}
     ORDER BY events.event_index DESC LIMIT ?`,
    [...params, limit + 1],
  );
  const items = rows.slice(0, limit).map(eventAuditPayload);
  return {
    events: items,
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit && items.length ? items[items.length - 1].eventIndex : null,
  };
}
