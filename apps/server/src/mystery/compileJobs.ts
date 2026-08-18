import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { pool } from "../db.js";
import { mysteryStorySourceSchema, type MysteryStorySource } from "./contracts.js";
import { compileMysteryStory, MysteryModelError } from "./models.js";
import { formatMysteryValidationError } from "./validationErrors.js";

export type MysteryCompileJobStatus = "queued" | "running" | "succeeded" | "failed";

export type MysteryCompileJobPayload = {
  id: string;
  storyId: string;
  sourceHash: string;
  sourceCurrent: boolean;
  versionNumber: number;
  forceRecompile: boolean;
  status: MysteryCompileJobStatus;
  attemptCount: number;
  maxAttempts: number;
  versionId: string | null;
  compiledModel: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  availableAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const COMPILE_JOB_POLL_MS = 5_000;
const COMPILE_JOB_LEASE_SECONDS = 120;
const COMPILE_JOB_HEARTBEAT_MS = 30_000;

let workerEnabled = false;
let workerLoopActive = false;
let workerTimer: NodeJS.Timeout | null = null;

function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function iso(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

function compileJobPayload(row: mysql.RowDataPacket): MysteryCompileJobPayload {
  return {
    id: String(row.id),
    storyId: String(row.story_id),
    sourceHash: String(row.source_hash),
    sourceCurrent: String(row.source_hash) === String(row.current_source_hash ?? row.source_hash),
    versionNumber: Number(row.version_number),
    forceRecompile: Boolean(row.force_recompile),
    status: String(row.status) as MysteryCompileJobStatus,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    versionId: row.version_id ? String(row.version_id) : null,
    compiledModel: row.compiled_model ? String(row.compiled_model) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    availableAt: iso(row.available_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

async function selectCompileJob(storyId: string, jobId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT jobs.*, stories.story_source_hash AS current_source_hash
     FROM mystery_compile_jobs jobs
     JOIN mystery_stories stories ON stories.id = jobs.story_id
     WHERE jobs.id = ? AND jobs.story_id = ? LIMIT 1`,
    [jobId, storyId],
  );
  return row ? compileJobPayload(row) : null;
}

export async function getMysteryCompileJob(storyId: string, jobId: string) {
  return selectCompileJob(storyId, jobId);
}

export async function getLatestMysteryCompileJob(storyId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT jobs.*, stories.story_source_hash AS current_source_hash
     FROM mystery_compile_jobs jobs
     JOIN mystery_stories stories ON stories.id = jobs.story_id
     WHERE jobs.story_id = ?
     ORDER BY jobs.version_number DESC, jobs.created_at DESC, jobs.id DESC LIMIT 1`,
    [storyId],
  );
  return row ? compileJobPayload(row) : null;
}

export async function enqueueMysteryCompileJob(input: {
  storyId: string;
  requestedBy: string;
  forceRecompile: boolean;
}) {
  const connection = await pool.getConnection();
  let jobId = "";
  try {
    await connection.beginTransaction();
    const [[story]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id, source_config, story_source_hash FROM mystery_stories WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.storyId],
    );
    if (!story) {
      await connection.rollback();
      return null;
    }
    const source = mysteryStorySourceSchema.parse(jsonValue<MysteryStorySource>(story.source_config));
    const sourceHash = String(story.story_source_hash);
    const [[active]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id FROM mystery_compile_jobs
       WHERE story_id = ? AND source_hash = ? AND status IN ('queued','running')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [input.storyId, sourceHash],
    );
    if (active) {
      jobId = String(active.id);
      await connection.commit();
      return selectCompileJob(input.storyId, jobId);
    }

    if (!input.forceRecompile) {
      const [[reusable]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, version_number, compiled_model FROM mystery_story_versions
         WHERE story_id = ? AND story_source_hash = ? ORDER BY version_number DESC LIMIT 1`,
        [input.storyId, sourceHash],
      );
      if (reusable) {
        jobId = `mystery_compile_${nanoid()}`;
        await connection.query(
          `INSERT INTO mystery_compile_jobs
            (id, story_id, requested_by, source_hash, source_snapshot, version_number, force_recompile,
             status, attempt_count, version_id, compiled_model, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'succeeded', 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [jobId, input.storyId, input.requestedBy, sourceHash, JSON.stringify(source), Number(reusable.version_number),
            String(reusable.id), String(reusable.compiled_model)],
        );
        await connection.commit();
        return selectCompileJob(input.storyId, jobId);
      }
    }

    const [[numberRow]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(version_number) FROM mystery_story_versions WHERE story_id = ?), 0),
         COALESCE((SELECT MAX(version_number) FROM mystery_compile_jobs
                   WHERE story_id = ? AND status IN ('queued','running')), 0)
       ) + 1 AS next_version`,
      [input.storyId, input.storyId],
    );
    jobId = `mystery_compile_${nanoid()}`;
    await connection.query(
      `INSERT INTO mystery_compile_jobs
        (id, story_id, requested_by, source_hash, source_snapshot, version_number, force_recompile)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [jobId, input.storyId, input.requestedBy, sourceHash, JSON.stringify(source), Number(numberRow.next_version), input.forceRecompile ? 1 : 0],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  wakeMysteryCompileJobWorker();
  return selectCompileJob(input.storyId, jobId);
}

type ClaimedCompileJob = {
  id: string;
  storyId: string;
  requestedBy: string | null;
  sourceHash: string;
  source: MysteryStorySource;
  versionNumber: number;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
};

async function claimNextCompileJob(): Promise<ClaimedCompileJob | null> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE mystery_compile_jobs
       SET status = 'failed', error_code = 'COMPILE_LEASE_EXHAUSTED', error_message = '编译任务重试次数已用尽',
           lease_token = NULL, lease_expires_at = NULL, finished_at = CURRENT_TIMESTAMP
       WHERE status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP AND attempt_count >= max_attempts`,
    );
    await connection.query(
      `UPDATE mystery_compile_jobs
       SET status = 'queued', lease_token = NULL, lease_expires_at = NULL, available_at = CURRENT_TIMESTAMP
       WHERE status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP AND attempt_count < max_attempts`,
    );
    const [[row]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT * FROM mystery_compile_jobs
       WHERE status = 'queued' AND available_at <= CURRENT_TIMESTAMP
       ORDER BY available_at ASC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!row) {
      await connection.commit();
      return null;
    }
    const leaseToken = `lease_${nanoid()}`;
    await connection.query(
      `UPDATE mystery_compile_jobs
       SET status = 'running', attempt_count = attempt_count + 1, lease_token = ?,
           lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error_code = NULL, error_message = NULL
       WHERE id = ?`,
      [leaseToken, COMPILE_JOB_LEASE_SECONDS, row.id],
    );
    await connection.commit();
    return {
      id: String(row.id),
      storyId: String(row.story_id),
      requestedBy: row.requested_by ? String(row.requested_by) : null,
      sourceHash: String(row.source_hash),
      source: mysteryStorySourceSchema.parse(jsonValue(row.source_snapshot)),
      versionNumber: Number(row.version_number),
      attemptCount: Number(row.attempt_count) + 1,
      maxAttempts: Number(row.max_attempts),
      leaseToken,
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

export function mysteryCompileRetryDelaySeconds(attemptCount: number) {
  return Math.min(120, 15 * (2 ** Math.max(0, attemptCount - 1)));
}

export function mysteryCompileFailure(error: unknown) {
  if (error instanceof MysteryModelError) {
    return { code: error.code.slice(0, 80), message: error.message.slice(0, 1000), retryable: error.retryable };
  }
  if (error instanceof z.ZodError) {
    return { code: "COMPILE_DATA_INVALID", message: formatMysteryValidationError(error, "故事编译数据"), retryable: false };
  }
  return { code: "COMPILE_INTERNAL_ERROR", message: "故事编译服务发生内部错误", retryable: false };
}

async function finishCompileJob(job: ClaimedCompileJob, compiled: Awaited<ReturnType<typeof compileMysteryStory>>) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[locked]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id FROM mystery_compile_jobs
       WHERE id = ? AND status = 'running' AND lease_token = ? LIMIT 1 FOR UPDATE`,
      [job.id, job.leaseToken],
    );
    if (!locked) {
      await connection.rollback();
      return;
    }
    const versionId = `mystery_version_${nanoid()}`;
    await connection.query(
      `INSERT INTO mystery_story_versions
        (id, story_id, version_number, story_source_hash, source_snapshot, compiled_package, compiled_diagnostics, compiled_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [versionId, job.storyId, job.versionNumber, job.sourceHash, JSON.stringify(job.source), JSON.stringify(compiled.storyPackage),
        JSON.stringify(compiled.diagnostics), compiled.model],
    );
    await connection.query(
      `UPDATE mystery_stories
       SET review_status = IF(story_source_hash = ?, 'compiled', review_status),
           updated_by = IF(story_source_hash = ?, COALESCE(?, updated_by), updated_by)
       WHERE id = ?`,
      [job.sourceHash, job.sourceHash, job.requestedBy, job.storyId],
    );
    await connection.query(
      `UPDATE mystery_compile_jobs
       SET status = 'succeeded', version_id = ?, compiled_model = ?, lease_token = NULL, lease_expires_at = NULL,
           error_code = NULL, error_message = NULL, finished_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_token = ?`,
      [versionId, compiled.model, job.id, job.leaseToken],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function failCompileJob(job: ClaimedCompileJob, error: unknown) {
  const failure = mysteryCompileFailure(error);
  const retry = failure.retryable && job.attemptCount < job.maxAttempts;
  const availableAt = new Date(Date.now() + mysteryCompileRetryDelaySeconds(job.attemptCount) * 1000);
  await pool.query(
    retry
      ? `UPDATE mystery_compile_jobs
         SET status = 'queued', available_at = ?, lease_token = NULL, lease_expires_at = NULL,
             error_code = ?, error_message = ?
         WHERE id = ? AND status = 'running' AND lease_token = ?`
      : `UPDATE mystery_compile_jobs
         SET status = 'failed', lease_token = NULL, lease_expires_at = NULL, error_code = ?, error_message = ?,
             finished_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'running' AND lease_token = ?`,
    retry
      ? [availableAt, failure.code, failure.message, job.id, job.leaseToken]
      : [failure.code, failure.message, job.id, job.leaseToken],
  );
  console.warn("Mystery compile job attempt failed:", {
    jobId: job.id,
    storyId: job.storyId,
    attemptCount: job.attemptCount,
    retry,
    code: failure.code,
  });
}

async function processCompileJob(job: ClaimedCompileJob) {
  const heartbeat = setInterval(() => {
    void pool.query(
      `UPDATE mystery_compile_jobs
       SET lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
       WHERE id = ? AND status = 'running' AND lease_token = ?`,
      [COMPILE_JOB_LEASE_SECONDS, job.id, job.leaseToken],
    ).catch((error) => console.error("Mystery compile job heartbeat failed:", { jobId: job.id, error }));
  }, COMPILE_JOB_HEARTBEAT_MS);
  heartbeat.unref();
  try {
    const compiled = await compileMysteryStory({ storyId: job.storyId, versionNumber: job.versionNumber, source: job.source });
    await finishCompileJob(job, compiled);
  } catch (error) {
    await failCompileJob(job, error).catch((failureError) => {
      console.error("Mystery compile job failure persistence failed:", { jobId: job.id, error: failureError });
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function runCompileJobLoop() {
  if (!workerEnabled || workerLoopActive) return;
  workerLoopActive = true;
  try {
    while (workerEnabled) {
      const job = await claimNextCompileJob();
      if (!job) break;
      await processCompileJob(job);
    }
  } catch (error) {
    console.error("Mystery compile job worker failed:", error);
  } finally {
    workerLoopActive = false;
  }
}

export function wakeMysteryCompileJobWorker() {
  if (!workerEnabled) return;
  queueMicrotask(() => { void runCompileJobLoop(); });
}

export function startMysteryCompileJobWorker() {
  if (workerEnabled) return;
  workerEnabled = true;
  wakeMysteryCompileJobWorker();
  workerTimer = setInterval(wakeMysteryCompileJobWorker, COMPILE_JOB_POLL_MS);
  workerTimer.unref();
}

export function stopMysteryCompileJobWorker() {
  workerEnabled = false;
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
