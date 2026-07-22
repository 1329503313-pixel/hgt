import type express from "express";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { pool } from "./db.js";
import { optimizeBannerImage } from "./bannerImages.js";

type RouteDependencies = {
  requireAdmin: (req: express.Request, res: express.Response) => Promise<unknown | null>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
};

const bannerSchema = z.object({
  name: z.string().trim().min(1, "请输入 Banner 名称").max(120, "名称不超过 120 字"),
  mobileImage: z.string().max(6_000_000, "手机端图片内容过大").nullable().optional(),
  desktopImage: z.string().max(6_000_000, "PC 端图片内容过大").nullable().optional(),
  linkUrl: z.string().trim().max(2000, "链接过长").nullable().optional(),
  weight: z.coerce.number().int().min(-999999).max(999999),
  enabled: z.boolean()
});

function imageVersion(row: mysql.RowDataPacket) {
  return new Date(row.updated_at).getTime();
}

function bannerPayload(row: mysql.RowDataPacket, includeAdminFields = false) {
  return {
    id: String(row.id),
    name: String(row.name),
    imageUrl: row.has_image || row.image_url ? `/api/banners/${row.id}/image?v=${imageVersion(row)}` : null,
    desktopImageUrl: row.has_desktop_image || row.desktop_image_url ? `/api/banners/${row.id}/desktop-image?v=${imageVersion(row)}` : null,
    linkUrl: row.link_url ? String(row.link_url) : null,
    weight: Number(row.weight ?? 0),
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    ...(includeAdminFields
      ? {
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString()
        }
      : {})
  };
}

function validLink(value: string | null | undefined) {
  const link = value?.trim() ?? "";
  if (!link) return null;
  if (link.startsWith("/") && !link.startsWith("//")) return link;
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(link)) {
    const localUrl = new URL(`http://${link}`);
    return `${localUrl.pathname}${localUrl.search}${localUrl.hash}`;
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9/_?&=.#%-]*$/.test(link)) return `/${link}`;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sendStoredImage(res: express.Response, value: unknown) {
  if (!value) return res.status(404).json({ error: "图片不存在" });
  const match = /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/i.exec(String(value));
  if (!match) return res.status(415).json({ error: "图片格式不受支持" });
  res.setHeader("Content-Type", match[1]);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(Buffer.from(match[2], "base64"));
}

const bannerImageCache = new Map<string, { expiresAt: number; image: unknown }>();

export function registerBannerRoutes(app: express.Express, deps: RouteDependencies) {
  const { requireAdmin, sendError } = deps;

  app.get("/api/banners", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, name, link_url, weight, enabled, is_default, created_at, updated_at,
         image_url IS NOT NULL AS has_image, desktop_image_url IS NOT NULL AS has_desktop_image
       FROM home_banners WHERE enabled = 1 ORDER BY weight DESC, created_at ASC, id ASC`
    );
    res.json({ banners: rows.map((row) => bannerPayload(row)) });
  });

  app.get("/api/banners/:id/image", async (req, res) => {
    const cacheKey = `mobile:${req.params.id}:${String(req.query.v ?? "")}`;
    const cached = bannerImageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return sendStoredImage(res, cached.image);
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT image_url FROM home_banners WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    if (!row) return sendError(res, 404, "Banner 不存在");
    bannerImageCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, image: row.image_url });
    if (bannerImageCache.size > 20) bannerImageCache.delete(bannerImageCache.keys().next().value!);
    return sendStoredImage(res, row.image_url);
  });

  app.get("/api/banners/:id/desktop-image", async (req, res) => {
    const cacheKey = `desktop:${req.params.id}:${String(req.query.v ?? "")}`;
    const cached = bannerImageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return sendStoredImage(res, cached.image);
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT desktop_image_url, image_url FROM home_banners WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    if (!row) return sendError(res, 404, "Banner 不存在");
    const image = row.desktop_image_url ?? row.image_url;
    bannerImageCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, image });
    if (bannerImageCache.size > 20) bannerImageCache.delete(bannerImageCache.keys().next().value!);
    return sendStoredImage(res, image);
  });

  app.get("/api/admin/banners", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, name, link_url, weight, enabled, is_default, created_at, updated_at,
         image_url IS NOT NULL AS has_image, desktop_image_url IS NOT NULL AS has_desktop_image
       FROM home_banners ORDER BY is_default DESC, weight DESC, created_at DESC`
    );
    res.json({ banners: rows.map((row) => bannerPayload(row, true)) });
  });

  app.post("/api/admin/banners", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = bannerSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "Banner 信息不正确");
    if (!parsed.data.mobileImage || !parsed.data.desktopImage) return sendError(res, 400, "请分别上传 PC 端和手机端 Banner 图片");
    const linkUrl = validLink(parsed.data.linkUrl);
    if (linkUrl === undefined) return sendError(res, 400, "跳转链接仅支持站内路径或 HTTP/HTTPS 地址");
    const [mobileImage, desktopImage] = await Promise.all([
      optimizeBannerImage(parsed.data.mobileImage, "mobile"),
      optimizeBannerImage(parsed.data.desktopImage, "desktop")
    ]);
    if (!mobileImage || !desktopImage) return sendError(res, 400, "图片无法压缩到 300KB 以内，请使用 JPG、PNG 或 WebP");
    const id = nanoid();
    await pool.query(
      "INSERT INTO home_banners (id, name, image_url, desktop_image_url, link_url, weight, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, parsed.data.name, mobileImage, desktopImage, linkUrl, parsed.data.weight, parsed.data.enabled ? 1 : 0]
    );
    res.status(201).json({ id });
  });

  app.put("/api/admin/banners/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [[existing]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM home_banners WHERE id = ? LIMIT 1", [req.params.id]);
    if (!existing) return sendError(res, 404, "Banner 不存在");
    const parsed = bannerSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "Banner 信息不正确");
    const linkUrl = validLink(parsed.data.linkUrl);
    if (linkUrl === undefined) return sendError(res, 400, "跳转链接仅支持站内路径或 HTTP/HTTPS 地址");
    let mobileImage = existing.image_url as string | null;
    let desktopImage = existing.desktop_image_url as string | null;
    if (parsed.data.mobileImage && !parsed.data.mobileImage.startsWith("/api/banners/")) {
      mobileImage = await optimizeBannerImage(parsed.data.mobileImage, "mobile");
      if (!mobileImage) return sendError(res, 400, "手机端图片无法压缩到 300KB 以内");
    }
    if (parsed.data.desktopImage && !parsed.data.desktopImage.startsWith("/api/banners/")) {
      desktopImage = await optimizeBannerImage(parsed.data.desktopImage, "desktop");
      if (!desktopImage) return sendError(res, 400, "PC 端图片无法压缩到 300KB 以内");
    }
    if (!mobileImage || !desktopImage) return sendError(res, 400, "请分别上传 PC 端和手机端 Banner 图片");
    await pool.query(
      "UPDATE home_banners SET name = ?, image_url = ?, desktop_image_url = ?, link_url = ?, weight = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [parsed.data.name, mobileImage, desktopImage, linkUrl, parsed.data.weight, parsed.data.enabled ? 1 : 0, req.params.id]
    );
    res.json({ ok: true });
  });

  app.delete("/api/admin/banners/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [[existing]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT is_default FROM home_banners WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    if (!existing) return sendError(res, 404, "Banner 不存在");
    if (existing.is_default) return sendError(res, 403, "默认 Banner 不可删除");
    await pool.query("DELETE FROM home_banners WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });
}
