import express from "express";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { z } from "zod";
import { pool } from "./db.js";
import { config } from "./config.js";
import type { UserRole } from "./roles.js";
import { ossConfigured, ossRefFromPublicUrl, publicOssUrl, storeMediaBuffer } from "./ossStorage.js";

export type StickerAsset = {
  id: string;
  name: string;
  text: string;
  description: string;
  staticUrl: string;
  animatedUrl: string;
  width: number;
  height: number;
  weight: number;
  price: number;
  owned: boolean;
};

export type StickerSeries = {
  id: string;
  name: string;
  description: string;
  weight: number;
  stickers: StickerAsset[];
};

type RouteUser = { id: string; role: UserRole };
type RouteDependencies = {
  requireAuth: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  requireAdmin: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
  sendStoredImage: (req: express.Request, res: express.Response, value: unknown, maxWidth: number, cacheControl?: string) => Promise<express.Response | void>;
};

const seriesSchema = z.object({
  name: z.string().trim().min(1, "请填写系列名称").max(80),
  description: z.string().trim().max(500).optional().default(""),
  weight: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional().default(0)
});

const stickerSchema = z.object({
  seriesId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1, "请填写表情包名称").max(80),
  description: z.string().trim().max(500).optional().default(""),
  staticImage: z.string().trim().min(1, "请上传表情包图片").max(6_000_000),
  animatedImage: z.string().trim().max(6_000_000).nullable().optional().default(null),
  price: z.coerce.number().int().min(0).max(1_000_000),
  weight: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional().default(0),
  enabled: z.boolean().optional().default(false)
});

const purchaseSchema = z.object({ requestId: z.string().trim().min(8).max(100) });
const STICKER_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
const STICKER_ANIMATED_MAX_BYTES = 1_500_000;
const STICKER_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]);
const stickersById = new Map<string, StickerAsset>();
for (const [id, name] of [
  ["tangtang-detective-hello", "你好呀"],
  ["tangtang-detective-come-drink-soup", "来喝汤"],
  ["tangtang-detective-received", "收到啦"],
  ["tangtang-detective-good-night", "晚安喔"],
  ["tangtang-detective-question", "我有问题"],
  ["tangtang-detective-is-that-so", "是这样吗"],
  ["tangtang-detective-think-again", "再想想看"],
  ["tangtang-detective-clue", "线索呢"],
  ["tangtang-detective-brain-burning", "好烧脑呀"],
  ["tangtang-detective-confused", "我懵了"],
  ["tangtang-detective-unbelievable", "真的假的？"],
  ["tangtang-detective-awesome", "你太棒了！"],
  ["tangtang-detective-exhausted", "我不行了"],
  ["tangtang-detective-why-like-this", "怎么这样？"],
  ["tangtang-detective-happy", "开心~"],
  ["tangtang-detective-whats-wrong", "怎么啦？"],
  ["tangtang-detective-thank-you", "谢谢你"],
  ["tangtang-detective-another-bowl", "再来一碗"],
  ["tangtang-detective-give-up", "我放弃了"]
] as const) {
  stickersById.set(id, { id, name, text: name, description: "", staticUrl: "", animatedUrl: "", width: 320, height: 320, weight: 0, price: 0, owned: true });
}

function mediaUrl(row: mysql.RowDataPacket, variant: "static" | "animated") {
  const ref = String(variant === "static" ? row.static_image_ref : row.animated_image_ref ?? row.static_image_ref);
  if (ref.startsWith("/stickers/")) return ref;
  const version = new Date(row.updated_at ?? row.created_at ?? 0).getTime();
  return `/api/media/stickers/${encodeURIComponent(String(row.id))}/${variant}?v=${version}`;
}

function stickerPayload(row: mysql.RowDataPacket, owned = false): StickerAsset {
  return {
    id: String(row.id),
    name: String(row.name),
    text: String(row.name),
    description: String(row.description ?? ""),
    staticUrl: mediaUrl(row, "static"),
    animatedUrl: mediaUrl(row, "animated"),
    width: 320,
    height: 320,
    weight: Number(row.sort_order ?? 0),
    price: Number(row.price ?? 0),
    owned
  };
}

export async function initializeStickerCatalog() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT * FROM sticker_products
     WHERE enabled = 1 AND deleted_at IS NULL
     ORDER BY sort_order DESC, created_at ASC, id ASC`
  );
  stickersById.clear();
  for (const row of rows) stickersById.set(String(row.id), stickerPayload(row, true));
}

export function getSticker(stickerId: string) {
  return stickersById.get(stickerId) ?? null;
}

export async function userOwnsSticker(userId: string, stickerId: string, executor: mysql.Pool | mysql.PoolConnection = pool) {
  const [[row]] = await executor.query<mysql.RowDataPacket[]>(
    `SELECT product.id
     FROM sticker_products product
     LEFT JOIN user_stickers owned ON owned.sticker_id = product.id AND owned.user_id = ?
     WHERE product.id = ? AND product.enabled = 1 AND product.deleted_at IS NULL
       AND (product.default_owned = 1 OR owned.user_id IS NOT NULL)
     LIMIT 1`,
    [userId, stickerId]
  );
  return Boolean(row);
}

export async function stickerSeriesForUser(userId: string): Promise<StickerSeries[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT product.*, series.name AS series_name, series.description AS series_description,
       series.sort_order AS series_sort_order,
       (product.default_owned = 1 OR owned.user_id IS NOT NULL) AS owned
     FROM sticker_products product
     INNER JOIN sticker_series series ON series.id = product.series_id
     LEFT JOIN user_stickers owned ON owned.sticker_id = product.id AND owned.user_id = ?
     WHERE product.enabled = 1 AND product.deleted_at IS NULL
     ORDER BY series.sort_order DESC, series.created_at ASC, product.sort_order DESC, product.created_at ASC`,
    [userId]
  );
  const grouped = new Map<string, StickerSeries>();
  for (const row of rows) {
    const id = String(row.series_id);
    const series = grouped.get(id) ?? {
      id,
      name: String(row.series_name),
      description: String(row.series_description ?? ""),
      weight: Number(row.series_sort_order ?? 0),
      stickers: []
    };
    series.stickers.push(stickerPayload(row, Boolean(row.owned)));
    grouped.set(id, series);
  }
  return [...grouped.values()];
}

async function storeOptimizedSticker(output: Buffer, stickerId: string, variant: "static" | "animated") {
  if (!ossConfigured()) return `data:image/webp;base64,${output.toString("base64")}`;
  return storeMediaBuffer(output, {
    category: "stickers",
    entityId: stickerId,
    variant,
    contentType: "image/webp",
    extension: "webp"
  });
}

async function optimizeStickerImage(value: string, stickerId: string, variant: "static" | "animated") {
  if (!value.startsWith("data:image/")) return ossRefFromPublicUrl(value) ?? value;
  const match = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) throw new Error("表情图片仅支持 PNG、JPG 或 WebP，不支持 GIF");
  const source = Buffer.from(match[1], "base64");
  if (source.length > 4_200_000) throw new Error("表情素材不能超过 4MB");
  const image = sharp(source, { animated: variant === "animated", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("无法识别表情素材");
  const output = await image
    .resize({ width: 320, height: 320, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true })
    .webp({ quality: variant === "animated" ? 76 : 84, effort: 5, loop: 0 })
    .toBuffer();
  if (output.length > STICKER_ANIMATED_MAX_BYTES) throw new Error("表情压缩后仍超过 1.5MB，请使用更简单的素材");
  return storeOptimizedSticker(output, stickerId, variant);
}

function runStickerVideoDecode(inputPath: string, outputPath: string, fps: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(config.ffmpegPath, [
      "-y", "-i", inputPath, "-t", "5", "-an",
      "-vf", `fps=${fps},scale=320:320:force_original_aspect_ratio=decrease:flags=lanczos,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`,
      "-loop", "0", outputPath
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("STICKER_VIDEO_TRANSCODE_TIMEOUT"));
    }, 90_000);
    child.stderr.on("data", (chunk) => { if (stderr.length < 8_000) stderr += String(chunk); });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      reject(new Error(error.code === "ENOENT" ? "STICKER_VIDEO_TRANSCODER_UNAVAILABLE" : "STICKER_VIDEO_TRANSCODE_FAILED"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`STICKER_VIDEO_TRANSCODE_FAILED:${stderr.slice(-500)}`));
    });
  });
}

async function optimizeStickerVideo(source: Buffer, contentType: string) {
  if (!STICKER_VIDEO_TYPES.has(contentType)) throw new Error("STICKER_VIDEO_TYPE_INVALID");
  if (!source.length || source.length > STICKER_VIDEO_MAX_BYTES) throw new Error("STICKER_VIDEO_SIZE_INVALID");
  const directory = await mkdtemp(join(tmpdir(), "hgt-sticker-video-"));
  const inputPath = join(directory, "source.upload");
  const framesPath = join(directory, "frames.gif");
  try {
    await writeFile(inputPath, source);
    await runStickerVideoDecode(inputPath, framesPath, 12);
    let frames = await readFile(framesPath);
    let output = await sharp(frames, { animated: true, limitInputPixels: 40_000_000 })
      .webp({ quality: 68, effort: 6, loop: 0 })
      .toBuffer();
    if (output.length > STICKER_ANIMATED_MAX_BYTES) {
      await runStickerVideoDecode(inputPath, framesPath, 8);
      frames = await readFile(framesPath);
      output = await sharp(frames, { animated: true, limitInputPixels: 40_000_000 })
        .webp({ quality: 52, effort: 6, loop: 0 })
        .toBuffer();
    }
    if (!output.length || output.length > STICKER_ANIMATED_MAX_BYTES) throw new Error("STICKER_VIDEO_OUTPUT_TOO_LARGE");
    return output;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    STICKER_NOT_FOUND: "表情不存在或已下架",
    STICKER_ALREADY_OWNED: "你已经拥有这个表情",
    STICKER_INSUFFICIENT_SHELLS: "贝壳余额不足",
    STICKER_USER_NOT_FOUND: "用户不存在",
    STICKER_REQUEST_CONFLICT: "购买请求编号冲突，请刷新后重试",
    OSS_CONFIG_INCOMPLETE: "对象存储配置不完整，请联系管理员检查 OSS 配置",
    STICKER_VIDEO_TYPE_INVALID: "动态表情仅支持 MP4、WebM、MOV 或 M4V 视频，不支持 GIF",
    STICKER_VIDEO_SIZE_INVALID: "动态表情视频不能为空且不能超过 20MB",
    STICKER_VIDEO_TRANSCODER_UNAVAILABLE: "服务器未安装 FFmpeg，暂时无法处理动态表情视频",
    STICKER_VIDEO_TRANSCODE_TIMEOUT: "视频处理超时，请缩短视频后重试",
    STICKER_VIDEO_OUTPUT_TOO_LARGE: "视频转为动态 WebP 后仍超过 1.5MB，请缩短时长或简化画面"
  };
  return messages[code] ?? code;
}

export function registerStickerStoreRoutes(app: express.Express, dependencies: RouteDependencies) {
  const { requireAuth, requireAdmin, sendError, sendStoredImage } = dependencies;

  app.post(
    "/api/admin/sticker-media/animated",
    express.raw({ type: ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"], limit: "20mb" }),
    async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      if (!Buffer.isBuffer(req.body)) return sendError(res, 400, "动态表情视频无效");
      try {
        const uploadId = nanoid();
        const output = await optimizeStickerVideo(req.body, String(req.headers["content-type"] ?? ""));
        const stored = await storeOptimizedSticker(output, uploadId, "animated");
        res.status(201).json({
          animatedImage: publicOssUrl(stored) ?? stored,
          size: output.length,
          format: "image/webp"
        });
      } catch (error) {
        const message = errorMessage(error);
        const status = message.includes("不能超过 20MB") ? 413
          : message.includes("仅支持") ? 415
          : message.includes("未安装 FFmpeg") ? 503
          : 422;
        return sendError(res, status, message.startsWith("STICKER_VIDEO_TRANSCODE_FAILED") ? "视频转码失败，请检查文件是否完整" : message);
      }
    }
  );

  app.get("/api/media/stickers/:id/:variant", async (req, res) => {
    if (!(await requireAuth(req, res))) return;
    if (req.params.variant !== "static" && req.params.variant !== "animated") return sendError(res, 404, "表情素材不存在");
    const column = req.params.variant === "animated" ? "COALESCE(animated_image_ref, static_image_ref)" : "static_image_ref";
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT ${column} AS image FROM sticker_products WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.params.id]
    );
    if (!row) return sendError(res, 404, "表情素材不存在");
    return sendStoredImage(req, res, row.image, 320, "private, max-age=31536000, immutable");
  });

  app.get("/api/asset-store/stickers", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [rows, [balanceRows]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>(
        `SELECT product.*, series.name AS series_name, series.description AS series_description,
           series.sort_order AS series_sort_order,
           (product.default_owned = 1 OR owned.user_id IS NOT NULL) AS owned
         FROM sticker_products product
         INNER JOIN sticker_series series ON series.id = product.series_id
         LEFT JOIN user_stickers owned ON owned.sticker_id = product.id AND owned.user_id = ?
         WHERE product.enabled = 1 AND product.deleted_at IS NULL AND series.id <> 'tangtang'
         ORDER BY series.sort_order DESC, series.created_at ASC,
           (product.default_owned = 1 OR owned.user_id IS NOT NULL) ASC,
           product.sort_order DESC, product.created_at ASC`,
        [user.id]
      ).then(([items]) => items),
      pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? LIMIT 1", [user.id])
    ]);
    const grouped = new Map<string, StickerSeries>();
    for (const row of rows) {
      const id = String(row.series_id);
      const series = grouped.get(id) ?? { id, name: String(row.series_name), description: String(row.series_description ?? ""), weight: Number(row.series_sort_order), stickers: [] };
      series.stickers.push(stickerPayload(row, Boolean(row.owned)));
      grouped.set(id, series);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ balance: Number(balanceRows[0]?.shell_balance ?? 0), series: [...grouped.values()] });
  });

  app.post("/api/asset-store/stickers/:id/purchase", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const parsed = purchaseSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "购买请求无效");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[existingOrder]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT * FROM sticker_purchase_orders WHERE request_id = ? FOR UPDATE",
        [parsed.data.requestId]
      );
      if (existingOrder) {
        if (String(existingOrder.user_id) !== user.id || String(existingOrder.sticker_id) !== req.params.id) throw new Error("STICKER_REQUEST_CONFLICT");
        await connection.commit();
        return res.json({ owned: true, balance: Number(existingOrder.balance_after), orderId: String(existingOrder.id) });
      }
      const [[product]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT * FROM sticker_products WHERE id = ? AND enabled = 1 AND deleted_at IS NULL FOR UPDATE",
        [req.params.id]
      );
      if (!product) throw new Error("STICKER_NOT_FOUND");
      if (Number(product.default_owned) === 1 || await userOwnsSticker(user.id, req.params.id, connection)) throw new Error("STICKER_ALREADY_OWNED");
      const [[userRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? FOR UPDATE", [user.id]);
      if (!userRow) throw new Error("STICKER_USER_NOT_FOUND");
      const cost = Number(product.price ?? 0);
      const balance = Number(userRow.shell_balance ?? 0) - cost;
      if (balance < 0) throw new Error("STICKER_INSUFFICIENT_SHELLS");
      const orderId = nanoid();
      await connection.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balance, user.id]);
      await connection.query("INSERT INTO user_stickers (user_id, sticker_id, source) VALUES (?, ?, 'purchase')", [user.id, req.params.id]);
      await connection.query(
        "INSERT INTO sticker_purchase_orders (id, request_id, user_id, sticker_id, shell_cost, balance_after) VALUES (?, ?, ?, ?, ?, ?)",
        [orderId, parsed.data.requestId, user.id, req.params.id, cost, balance]
      );
      if (cost > 0) {
        await connection.query(
          `INSERT INTO shell_transactions
            (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
           VALUES (?, ?, 'sticker_purchase', ?, ?, 'sticker_purchase_order', ?, ?, ?)`,
          [nanoid(), user.id, -cost, balance, orderId, `购买表情“${String(product.name)}”`, `sticker-purchase:${orderId}`]
        );
      }
      await connection.commit();
      res.json({ owned: true, balance, orderId });
    } catch (error) {
      await connection.rollback();
      const message = errorMessage(error);
      const status = message === "贝壳余额不足" ? 409 : message.includes("已经拥有") ? 409 : 400;
      return sendError(res, status, message);
    } finally {
      connection.release();
    }
  });

  app.get("/api/admin/sticker-series", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT series.*, COUNT(product.id) AS sticker_count
       FROM sticker_series series LEFT JOIN sticker_products product ON product.series_id = series.id AND product.deleted_at IS NULL
       GROUP BY series.id ORDER BY series.sort_order DESC, series.created_at ASC`
    );
    res.json({ series: rows.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description ?? ""), weight: Number(row.sort_order), systemLocked: Boolean(row.system_locked), stickerCount: Number(row.sticker_count) })) });
  });

  app.post("/api/admin/sticker-series", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = seriesSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "系列信息不完整");
    const id = nanoid();
    await pool.query("INSERT INTO sticker_series (id, name, description, sort_order) VALUES (?, ?, ?, ?)", [id, parsed.data.name, parsed.data.description, parsed.data.weight]);
    res.status(201).json({ id });
  });

  app.patch("/api/admin/sticker-series/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = seriesSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "系列信息不完整");
    const [[series]] = await pool.query<mysql.RowDataPacket[]>("SELECT system_locked FROM sticker_series WHERE id = ? LIMIT 1", [req.params.id]);
    if (!series) return sendError(res, 404, "系列不存在");
    if (Boolean(series.system_locked)) return sendError(res, 409, "系统内置系列不可编辑");
    await pool.query("UPDATE sticker_series SET name = ?, description = ?, sort_order = ? WHERE id = ?", [parsed.data.name, parsed.data.description, parsed.data.weight, req.params.id]);
    res.json({ ok: true });
  });

  app.get("/api/admin/stickers", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT product.*, series.name AS series_name,
         CASE WHEN product.default_owned = 1 THEN (SELECT COUNT(*) FROM users)
              ELSE (SELECT COUNT(*) FROM user_stickers owned WHERE owned.sticker_id = product.id) END AS owner_count
       FROM sticker_products product INNER JOIN sticker_series series ON series.id = product.series_id
       ORDER BY product.deleted_at IS NOT NULL, series.sort_order DESC, product.sort_order DESC, product.created_at DESC`
    );
    res.json({ stickers: rows.map((row) => ({ ...stickerPayload(row, Boolean(row.default_owned)), seriesId: String(row.series_id), seriesName: String(row.series_name), enabled: Boolean(row.enabled), defaultOwned: Boolean(row.default_owned), hasAnimated: Boolean(row.animated_image_ref), deleted: Boolean(row.deleted_at), ownerCount: Number(row.owner_count), createdAt: new Date(row.created_at).toISOString() })) });
  });

  app.post("/api/admin/stickers", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = stickerSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "表情信息不完整");
    const [[series]] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM sticker_series WHERE id = ? LIMIT 1", [parsed.data.seriesId]);
    if (!series) return sendError(res, 400, "绑定的系列不存在");
    const id = nanoid();
    try {
      const [staticRef, animatedRef] = await Promise.all([
        optimizeStickerImage(parsed.data.staticImage, id, "static"),
        parsed.data.animatedImage ? optimizeStickerImage(parsed.data.animatedImage, id, "animated") : Promise.resolve(null)
      ]);
      await pool.query(
        `INSERT INTO sticker_products
          (id, series_id, name, description, static_image_ref, animated_image_ref, price, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, parsed.data.seriesId, parsed.data.name, parsed.data.description, staticRef, animatedRef, parsed.data.price, parsed.data.weight, parsed.data.enabled ? 1 : 0]
      );
      await initializeStickerCatalog();
      res.status(201).json({ id, ok: true, message: "表情包上传成功" });
    } catch (error) {
      return sendError(res, 400, errorMessage(error));
    }
  });

  app.patch("/api/admin/stickers/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = stickerSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "表情信息不完整");
    const [[existing], [series]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT * FROM sticker_products WHERE id = ? AND deleted_at IS NULL LIMIT 1", [req.params.id]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT id FROM sticker_series WHERE id = ? LIMIT 1", [parsed.data.seriesId]).then(([rows]) => rows)
    ]);
    if (!existing) return sendError(res, 404, "表情不存在");
    if (!series) return sendError(res, 400, "绑定的系列不存在");
    try {
      const staticInput = parsed.data.staticImage.startsWith("/api/media/stickers/") ? String(existing.static_image_ref) : parsed.data.staticImage;
      const animatedInput = parsed.data.animatedImage?.startsWith("/api/media/stickers/") ? String(existing.animated_image_ref ?? "") : parsed.data.animatedImage;
      const [staticRef, animatedRef] = await Promise.all([
        optimizeStickerImage(staticInput, req.params.id, "static"),
        animatedInput ? optimizeStickerImage(animatedInput, req.params.id, "animated") : Promise.resolve(null)
      ]);
      await pool.query(
        `UPDATE sticker_products SET series_id = ?, name = ?, description = ?, static_image_ref = ?, animated_image_ref = ?,
          price = ?, sort_order = ?, enabled = ? WHERE id = ?`,
        [parsed.data.seriesId, parsed.data.name, parsed.data.description, staticRef, animatedRef, parsed.data.price, parsed.data.weight, parsed.data.enabled ? 1 : 0, req.params.id]
      );
      await initializeStickerCatalog();
      res.json({ ok: true });
    } catch (error) {
      return sendError(res, 400, errorMessage(error));
    }
  });

  app.delete("/api/admin/stickers/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [[product]] = await pool.query<mysql.RowDataPacket[]>("SELECT default_owned FROM sticker_products WHERE id = ? AND deleted_at IS NULL LIMIT 1", [req.params.id]);
    if (!product) return sendError(res, 404, "表情不存在");
    await pool.query("UPDATE sticker_products SET enabled = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
    await initializeStickerCatalog();
    res.json({ ok: true });
  });
}
