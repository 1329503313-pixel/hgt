import { createHash } from "node:crypto";
import type express from "express";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { z } from "zod";
import { pool } from "../db.js";
import { publicOssUrl, storeMediaBuffer } from "../ossStorage.js";
import type { PublicUser } from "../types.js";
import { mysteryStoryPackageSchema, mysteryStorySourceSchema, type MysteryStorySource } from "./contracts.js";
import { enqueueMysteryCompileJob, getLatestMysteryCompileJob, getMysteryCompileJob } from "./compileJobs.js";
import {
  getMysteryRunAudit,
  listMysteryRunAudits,
  listMysteryRunEvents,
  mysteryRunExists,
  mysteryStoryExists,
  type MysteryRunAuditStatus,
} from "./audit.js";
import { MysteryInvariantError } from "./engine.js";
import { MysteryModelError } from "./models.js";
import { validateMysteryStoryPackageIntegrity } from "./packageValidation.js";

type AuthenticatedUser = PublicUser & { tokenVersion: number };
type RouteDependencies = {
  requireAuth: (req: express.Request, res: express.Response) => Promise<AuthenticatedUser | null>;
  requireBackofficeAdmin: (req: express.Request, res: express.Response) => Promise<AuthenticatedUser | null>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
};

const storyInputSchema = z.object({
  source: mysteryStorySourceSchema,
  coverData: z.string().max(12_000_000).regex(/^data:image\/(png|jpeg|jpg|webp);base64,/i).nullable().optional(),
  removeCover: z.boolean().optional().default(false),
});

function hashStorySource(source: MysteryStorySource) {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

function jsonValue<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function iso(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

function coverUrl(value: unknown) {
  return publicOssUrl(value);
}

async function storeMysteryCover(dataUrl: string, storyId: string) {
  const match = /^data:image\/(?:png|jpeg|jpg|webp);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new MysteryInvariantError("COVER_INVALID", "谜局封面仅支持 JPG、PNG 或 WebP");
  const raw = Buffer.from(match[1], "base64");
  if (!raw.length || raw.length > 8 * 1024 * 1024) throw new MysteryInvariantError("COVER_TOO_LARGE", "谜局封面不能超过 8MB");
  const output = await sharp(raw)
    .rotate()
    .resize({ width: 1280, height: 720, fit: "cover", position: "centre" })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  return storeMediaBuffer(output, {
    category: "mysteries",
    entityId: storyId,
    variant: "cover",
    contentType: "image/webp",
    extension: "webp",
  });
}

function adminStory(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    title: String(row.title),
    coverUrl: coverUrl(row.cover_url),
    tags: jsonValue<string[]>(row.tags),
    storyBackground: String(row.story_background),
    storyContent: String(row.story_content),
    characterDesign: String(row.character_design),
    presetEndings: String(row.preset_endings),
    coreSettings: String(row.core_settings),
    source: jsonValue<MysteryStorySource>(row.source_config),
    sourceHash: String(row.story_source_hash),
    publicationStatus: String(row.publication_status),
    reviewStatus: String(row.review_status),
    publishedVersionId: row.published_version_id ? String(row.published_version_id) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: iso(row.published_at),
  };
}

function versionPayload(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    storyId: String(row.story_id),
    versionNumber: Number(row.version_number),
    sourceHash: String(row.story_source_hash),
    sourceSnapshot: row.source_snapshot ? jsonValue(row.source_snapshot) : null,
    storyPackage: jsonValue(row.compiled_package),
    diagnostics: jsonValue(row.compiled_diagnostics),
    compiledModel: String(row.compiled_model),
    customized: Boolean(row.compiled_customized),
    reviewStatus: String(row.review_status),
    reviewNote: row.review_note ? String(row.review_note) : null,
    reviewedAt: iso(row.reviewed_at),
    publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at),
  };
}

export function registerMysteryRoutes(app: express.Application, dependencies: RouteDependencies) {
  const { requireAuth, requireBackofficeAdmin, sendError } = dependencies;

  app.get("/api/mysteries", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const keyword = String(req.query.q ?? "").trim();
    const requestedLimit = Number(req.query.limit ?? 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20));
    const requestedOffset = Number(req.query.offset ?? 0);
    const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);
    const where = keyword ? "AND (stories.title LIKE ? OR JSON_SEARCH(stories.tags, 'one', ?) IS NOT NULL)" : "";
    const params = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT stories.id, stories.title, stories.cover_url, stories.tags, versions.source_snapshot,
        slots.current_run_id, runs.status AS run_status
       FROM mystery_stories stories
       JOIN mystery_story_versions versions ON versions.id = stories.published_version_id
       LEFT JOIN mystery_save_slots slots ON slots.story_id = stories.id AND slots.owner_user_id = ?
       LEFT JOIN mystery_runs runs ON runs.id = slots.current_run_id
       WHERE stories.publication_status = 'published' AND stories.published_version_id IS NOT NULL ${where}
       ORDER BY stories.published_at DESC, stories.created_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, ...params, limit + 1, offset],
    );
    const items = rows.slice(0, limit).map((row) => {
      const source = row.source_snapshot ? jsonValue<MysteryStorySource>(row.source_snapshot) : null;
      return {
        id: String(row.id), title: source?.title ?? String(row.title), coverUrl: source?.coverUrl ?? coverUrl(row.cover_url),
        tags: source?.tags ?? jsonValue<string[]>(row.tags),
        saveStatus: row.current_run_id ? String(row.run_status) : null,
        canContinue: Boolean(row.current_run_id) && String(row.run_status) === "active",
      };
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ mysteries: items, hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null });
  });

  app.get("/api/mysteries/:id", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT stories.id, stories.title, stories.cover_url, stories.tags, stories.story_background, versions.source_snapshot,
        slots.current_run_id, runs.status AS run_status
       FROM mystery_stories stories
       JOIN mystery_story_versions versions ON versions.id = stories.published_version_id
       LEFT JOIN mystery_save_slots slots ON slots.story_id = stories.id AND slots.owner_user_id = ?
       LEFT JOIN mystery_runs runs ON runs.id = slots.current_run_id
       WHERE stories.id = ? AND stories.publication_status = 'published' AND stories.published_version_id IS NOT NULL
       LIMIT 1`,
      [user.id, req.params.id],
    );
    if (!row) return sendError(res, 404, "谜局不存在或尚未上架");
    // 玩家侧只暴露标题、封面、标签、背景和自己的存档状态。
    res.setHeader("Cache-Control", "private, no-store");
    const source = row.source_snapshot ? jsonValue<MysteryStorySource>(row.source_snapshot) : null;
    res.json({
      mystery: {
        id: String(row.id), title: source?.title ?? String(row.title), coverUrl: source?.coverUrl ?? coverUrl(row.cover_url),
        tags: source?.tags ?? jsonValue<string[]>(row.tags), background: source?.storyBackground ?? String(row.story_background),
      },
      save: row.current_run_id ? { runId: String(row.current_run_id), status: String(row.run_status), canContinue: String(row.run_status) === "active" } : null,
    });
  });

  app.get("/api/admin/mysteries", async (req, res) => {
    if (!(await requireBackofficeAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT stories.*,
        (SELECT COUNT(*) FROM mystery_story_versions versions WHERE versions.story_id = stories.id) AS version_count,
        (SELECT COUNT(*) FROM mystery_runs runs WHERE runs.story_id = stories.id) AS run_count
       FROM mystery_stories stories ORDER BY stories.updated_at DESC`,
    );
    res.json({ mysteries: rows.map((row) => ({ ...adminStory(row), versionCount: Number(row.version_count), runCount: Number(row.run_count) })) });
  });

  app.post("/api/admin/mysteries", async (req, res) => {
    const admin = await requireBackofficeAdmin(req, res);
    if (!admin) return;
    const parsed = storyInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "谜局配置不完整");
    const id = `mystery_${nanoid()}`;
    let storedCover: string | null = parsed.data.source.coverUrl;
    if (parsed.data.coverData) {
      try { storedCover = await storeMysteryCover(parsed.data.coverData, id); }
      catch (error) { return sendError(res, 400, error instanceof Error ? error.message : "谜局封面处理失败"); }
    }
    const source = { ...parsed.data.source, coverUrl: storedCover ? coverUrl(storedCover) : null };
    const sourceHash = hashStorySource(source);
    await pool.query(
      `INSERT INTO mystery_stories
        (id, title, cover_url, tags, story_background, story_content, character_design,
         preset_endings, core_settings, source_config, story_source_hash, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, source.title, storedCover, JSON.stringify(source.tags), source.storyBackground, source.storyContent,
        source.characterDesign, source.presetEndings, source.coreSettings, JSON.stringify(source), sourceHash, admin.id, admin.id],
    );
    res.status(201).json({ id, sourceHash });
  });

  app.get("/api/admin/mysteries/:id", async (req, res) => {
    if (!(await requireBackofficeAdmin(req, res))) return;
    const [stories, versions, compileJob] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT * FROM mystery_stories WHERE id = ? LIMIT 1", [req.params.id]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT * FROM mystery_story_versions WHERE story_id = ? ORDER BY version_number DESC", [req.params.id]).then(([rows]) => rows),
      getLatestMysteryCompileJob(req.params.id),
    ]);
    const story = stories[0];
    if (!story) return sendError(res, 404, "谜局不存在");
    res.json({ mystery: adminStory(story), versions: versions.map(versionPayload), compileJob });
  });

  app.get("/api/admin/mysteries/:storyId/runs", async (req, res) => {
    if (!(await requireBackofficeAdmin(req, res))) return;
    const parsed = z.object({
      status: z.enum(["active", "completed", "superseded", "abandoned"]).optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return sendError(res, 400, "运行审计筛选参数不正确");
    if (!(await mysteryStoryExists(req.params.storyId))) return sendError(res, 404, "谜局不存在");
    const result = await listMysteryRunAudits({
      storyId: req.params.storyId,
      status: parsed.data.status as MysteryRunAuditStatus | undefined,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  });

  app.get("/api/admin/mysteries/:storyId/runs/:runId", async (req, res) => {
    if (!(await requireBackofficeAdmin(req, res))) return;
    const result = await getMysteryRunAudit(req.params.storyId, req.params.runId);
    if (!result) return sendError(res, 404, "谜局进程不存在");
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  });

  app.get("/api/admin/mysteries/:storyId/runs/:runId/events", async (req, res) => {
    if (!(await requireBackofficeAdmin(req, res))) return;
    const parsed = z.object({
      keyOnly: z.enum(["true", "false"]).optional().default("true"),
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return sendError(res, 400, "事件账本筛选参数不正确");
    if (!(await mysteryRunExists(req.params.storyId, req.params.runId))) return sendError(res, 404, "谜局进程不存在");
    const result = await listMysteryRunEvents({
      storyId: req.params.storyId,
      runId: req.params.runId,
      keyOnly: parsed.data.keyOnly === "true",
      before: parsed.data.before,
      limit: parsed.data.limit,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  });

  app.put("/api/admin/mysteries/:id", async (req, res) => {
    const admin = await requireBackofficeAdmin(req, res);
    if (!admin) return;
    const parsed = storyInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "谜局配置不完整");
    const [[existing]] = await pool.query<mysql.RowDataPacket[]>("SELECT cover_url, story_source_hash FROM mystery_stories WHERE id = ? LIMIT 1", [req.params.id]);
    if (!existing) return sendError(res, 404, "谜局不存在");
    let storedCover: string | null = parsed.data.removeCover ? null : (existing.cover_url ? String(existing.cover_url) : null);
    if (parsed.data.coverData) {
      try { storedCover = await storeMysteryCover(parsed.data.coverData, req.params.id); }
      catch (error) { return sendError(res, 400, error instanceof Error ? error.message : "谜局封面处理失败"); }
    }
    const source = { ...parsed.data.source, coverUrl: storedCover ? coverUrl(storedCover) : null };
    const sourceHash = hashStorySource(source);
    const sourceChanged = String(existing.story_source_hash) !== sourceHash;
    await pool.query(
      `UPDATE mystery_stories SET title = ?, cover_url = ?, tags = ?, story_background = ?, story_content = ?,
        character_design = ?, preset_endings = ?, core_settings = ?, source_config = ?, story_source_hash = ?,
        review_status = IF(?, 'not_compiled', review_status), updated_by = ?
       WHERE id = ?`,
      [source.title, storedCover, JSON.stringify(source.tags), source.storyBackground, source.storyContent,
        source.characterDesign, source.presetEndings, source.coreSettings, JSON.stringify(source), sourceHash,
        sourceChanged ? 1 : 0, admin.id, req.params.id],
    );
    res.json({ ok: true, sourceHash });
  });

  app.post("/api/admin/mysteries/:id/compile", async (req, res) => {
    const admin = await requireBackofficeAdmin(req, res);
    if (!admin) return;
    const parsed = z.object({ force: z.boolean().optional().default(false) }).safeParse(req.body ?? {});
    if (!parsed.success) return sendError(res, 400, "编译参数不正确");
    const job = await enqueueMysteryCompileJob({
      storyId: req.params.id,
      requestedBy: admin.id,
      forceRecompile: parsed.data.force,
    });
    if (!job) return sendError(res, 404, "谜局不存在");
    res.status(job.status === "succeeded" ? 200 : 202).json({ job });
  });

  app.get("/api/admin/mysteries/:storyId/compile-jobs/:jobId", async (req, res) => {
    if (!(await requireBackofficeAdmin(req, res))) return;
    const job = await getMysteryCompileJob(req.params.storyId, req.params.jobId);
    if (!job) return sendError(res, 404, "编译任务不存在");
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ job });
  });

  app.put("/api/admin/mysteries/:storyId/versions/:versionId/package", async (req, res) => {
    if (!(await requireBackofficeAdmin(req, res))) return;
    const parsed = z.object({ storyPackage: mysteryStoryPackageSchema }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "Story Package 结构不合法");
    if (parsed.data.storyPackage.storyId !== req.params.storyId) return sendError(res, 400, "Story Package 的 storyId 不匹配");
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE mystery_story_versions SET compiled_package = ?, compiled_customized = 1,
        review_status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
       WHERE id = ? AND story_id = ? AND published_at IS NULL`,
      [JSON.stringify(parsed.data.storyPackage), req.params.versionId, req.params.storyId],
    );
    if (result.affectedRows !== 1) return sendError(res, 409, "版本不存在或已发布锁定，不能再修改");
    res.json({ ok: true });
  });

  app.post("/api/admin/mysteries/:storyId/versions/:versionId/review", async (req, res) => {
    const admin = await requireBackofficeAdmin(req, res);
    if (!admin) return;
    const parsed = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(2_000).default("") }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "审核信息不正确");
    const [[version]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT compiled_package, published_at FROM mystery_story_versions WHERE id = ? AND story_id = ? LIMIT 1",
      [req.params.versionId, req.params.storyId],
    );
    if (!version) return sendError(res, 404, "编译版本不存在");
    if (version.published_at) return sendError(res, 409, "已发布版本已经锁定，不能重新审核");
    if (parsed.data.decision === "approved") {
      const packageResult = mysteryStoryPackageSchema.safeParse(jsonValue(version.compiled_package));
      if (!packageResult.success) return sendError(res, 409, "Story Package 未通过结构校验，不能审核通过");
      const integrityIssues = validateMysteryStoryPackageIntegrity(packageResult.data);
      if (integrityIssues.length) return sendError(res, 409, `Story Package 引用不完整：${integrityIssues[0]}`);
    }
    const [reviewUpdate] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE mystery_story_versions SET review_status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
       WHERE id = ? AND story_id = ? AND published_at IS NULL`,
      [parsed.data.decision, admin.id, parsed.data.note || null, req.params.versionId, req.params.storyId],
    );
    if (reviewUpdate.affectedRows !== 1) return sendError(res, 409, "版本状态已经变化，请刷新后重试");
    await pool.query("UPDATE mystery_stories SET review_status = ?, updated_by = ? WHERE id = ?", [parsed.data.decision, admin.id, req.params.storyId]);
    res.json({ ok: true });
  });

  app.post("/api/admin/mysteries/:storyId/publish", async (req, res) => {
    const admin = await requireBackofficeAdmin(req, res);
    if (!admin) return;
    const parsed = z.object({ versionId: z.string().trim().min(1).max(64) }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "请选择审核通过的版本");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[version]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id FROM mystery_story_versions
         WHERE id = ? AND story_id = ? AND review_status = 'approved' LIMIT 1 FOR UPDATE`,
        [parsed.data.versionId, req.params.storyId],
      );
      if (!version) {
        await connection.rollback();
        return sendError(res, 409, "只有人工审核通过的版本可以上架");
      }
      await connection.query(
        `UPDATE mystery_stories SET publication_status = 'published', published_version_id = ?,
          published_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?`,
        [parsed.data.versionId, admin.id, req.params.storyId],
      );
      await connection.query(
        "UPDATE mystery_story_versions SET published_at = COALESCE(published_at, CURRENT_TIMESTAMP) WHERE id = ?",
        [parsed.data.versionId],
      );
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  });

  app.post("/api/admin/mysteries/:storyId/unpublish", async (req, res) => {
    const admin = await requireBackofficeAdmin(req, res);
    if (!admin) return;
    const [result] = await pool.query<mysql.ResultSetHeader>(
      "UPDATE mystery_stories SET publication_status = 'unpublished', updated_by = ? WHERE id = ? AND publication_status = 'published'",
      [admin.id, req.params.storyId],
    );
    if (result.affectedRows !== 1) return sendError(res, 409, "谜局当前未上架");
    res.json({ ok: true });
  });
}

export function handleMysteryRouteError(error: unknown) {
  if (error instanceof MysteryInvariantError) return { status: 409, code: error.code, message: error.message };
  if (error instanceof MysteryModelError) return { status: error.code === "MODEL_NOT_CONFIGURED" ? 503 : 502, code: error.code, message: error.message };
  return null;
}
