import { load } from "cheerio";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import type mysql from "mysql2/promise";
import sharp from "sharp";
import { config } from "./config.js";
import { pool } from "./db.js";
import { optimizeGiftIconBuffer } from "./giftImages.js";
import {
  isOssRef,
  publicOssUrl,
  readStoredMediaBuffer,
  storeMediaBuffer,
  verifyPublicObject
} from "./ossStorage.js";

type Mode = "dry-run" | "apply" | "verify";
type MigrationResult = {
  scanned: number;
  eligible: number;
  migrated: number;
  skipped: number;
  failed: number;
  missingVideos: number;
};

type ImageField = {
  table: string;
  column: string;
  category: string;
  variant: string;
  maxWidth: number;
  localPublicRoot?: boolean;
};

const IMAGE_FIELDS: ImageField[] = [
  { table: "users", column: "avatar", category: "users", variant: "avatar", maxWidth: 256 },
  { table: "users", column: "profile_background", category: "users", variant: "profile-background", maxWidth: 1200 },
  { table: "soups", column: "cover_image", category: "soups", variant: "cover", maxWidth: 1600 },
  { table: "soups", column: "cover_thumbnail", category: "soups", variant: "thumbnail", maxWidth: 480 },
  { table: "circles", column: "avatar", category: "circles", variant: "avatar", maxWidth: 320, localPublicRoot: true },
  { table: "home_banners", column: "image_url", category: "banners", variant: "mobile", maxWidth: 960 },
  { table: "home_banners", column: "desktop_image_url", category: "banners", variant: "desktop", maxWidth: 2000 },
  { table: "asset_cards", column: "image_url", category: "assets/cards", variant: "image", maxWidth: 1200 },
  { table: "asset_cards", column: "thumbnail_url", category: "assets/cards", variant: "thumbnail", maxWidth: 360 },
  { table: "asset_packs", column: "cover_url", category: "assets/packs", variant: "cover", maxWidth: 1280 },
  { table: "asset_packs", column: "cover_thumbnail", category: "assets/packs", variant: "thumbnail", maxWidth: 480 },
  { table: "user_feedback", column: "screenshot", category: "feedback", variant: "screenshot", maxWidth: 1600 }
];

const VIDEO_COLUMNS = ["motion_mp4_path", "motion_webm_path", "motion_poster_path"] as const;
const DIST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT_ROOT = existsSync(resolve(DIST_ROOT, "apps/web/dist"))
  ? DIST_ROOT
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_PUBLIC_ROOT = existsSync(resolve(PROJECT_ROOT, "apps/web/public"))
  ? resolve(PROJECT_ROOT, "apps/web/public")
  : resolve(PROJECT_ROOT, "apps/web/dist");

function modeFromArguments(): Mode {
  if (process.argv.includes("--apply")) return "apply";
  if (process.argv.includes("--verify")) return "verify";
  return "dry-run";
}

function emptyResult(): MigrationResult {
  return { scanned: 0, eligible: 0, migrated: 0, skipped: 0, failed: 0, missingVideos: 0 };
}

function isEligibleImageValue(value: string) {
  return value.startsWith("data:image/") || value.startsWith("/");
}

async function optimizeExistingImage(value: string, maxWidth: number, localPublicRoot = false) {
  const source = localPublicRoot && value.startsWith("/")
    ? await readFile(resolve(WEB_PUBLIC_ROOT, value.slice(1)))
    : await readStoredMediaBuffer(value);
  return sharp(source)
    .rotate()
    .resize({ width: maxWidth, height: maxWidth, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toBuffer();
}

async function backupRows(backupDirectory: string) {
  const tables = [...new Set(IMAGE_FIELDS.map((field) => field.table).concat(["admin_notices", "asset_cards", "gifts"]))];
  const backup: Record<string, mysql.RowDataPacket[]> = {};
  for (const table of tables) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT * FROM ${table}`);
    backup[table] = rows;
  }
  const backupPath = resolve(backupDirectory, "database-media.json.gz");
  await pipeline(
    async function* () {
      yield Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), tables: backup }));
    }(),
    createGzip({ level: 9 }),
    createWriteStream(backupPath, { flags: "wx" })
  );
  return backupPath;
}

async function migrateGiftIcons(mode: Mode, result: MigrationResult) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, icon_image FROM gifts WHERE icon_image IS NOT NULL AND icon_image <> ''"
  );
  for (const row of rows) {
    result.scanned += 1;
    const current = String(row.icon_image);
    if (isOssRef(current) || !isEligibleImageValue(current)) {
      result.skipped += 1;
      continue;
    }
    result.eligible += 1;
    if (mode !== "apply") continue;
    try {
      const optimized = await optimizeGiftIconBuffer(current);
      if (!optimized) throw new Error("GIFT_ICON_INVALID");
      const stored = await storeMediaBuffer(optimized, {
        category: "gifts",
        entityId: String(row.id),
        variant: "icon",
        contentType: "image/webp",
        extension: "webp"
      });
      if (!(await verifyPublicObject(stored))) throw new Error("OSS_OBJECT_NOT_PUBLIC");
      const [updated] = await pool.query<mysql.ResultSetHeader>(
        "UPDATE gifts SET icon_image = ? WHERE id = ? AND icon_image = ?",
        [stored, row.id, current]
      );
      if (updated.affectedRows === 1) result.migrated += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      console.error("gift icon migration failed", {
        id: String(row.id),
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}

async function migrateImageFields(mode: Mode, result: MigrationResult) {
  for (const field of IMAGE_FIELDS) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, ${field.column} AS media_value FROM ${field.table} WHERE ${field.column} IS NOT NULL AND ${field.column} <> ''`
    );
    for (const row of rows) {
      result.scanned += 1;
      const current = String(row.media_value);
      if (isOssRef(current) || !isEligibleImageValue(current)) {
        result.skipped += 1;
        continue;
      }
      result.eligible += 1;
      if (mode !== "apply") continue;
      try {
        const optimized = await optimizeExistingImage(current, field.maxWidth, field.localPublicRoot);
        const stored = await storeMediaBuffer(optimized, {
          category: field.category,
          entityId: String(row.id),
          variant: field.variant,
          contentType: "image/webp",
          extension: "webp"
        });
        if (!(await verifyPublicObject(stored))) throw new Error("OSS_OBJECT_NOT_PUBLIC");
        const [updated] = await pool.query<mysql.ResultSetHeader>(
          `UPDATE ${field.table} SET ${field.column} = ? WHERE id = ? AND ${field.column} = ?`,
          [stored, row.id, current]
        );
        if (updated.affectedRows === 1) result.migrated += 1;
        else result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        console.error("media migration failed", {
          table: field.table,
          column: field.column,
          id: String(row.id),
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }
  }
}

async function migrateNoticeImages(mode: Mode, result: MigrationResult) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, content FROM admin_notices WHERE content LIKE '%data:image/%'"
  );
  for (const row of rows) {
    result.scanned += 1;
    const original = String(row.content);
    const document = load(original, { xml: false });
    const images = document("img").toArray().filter((image) => String(document(image).attr("src") ?? "").startsWith("data:image/"));
    result.eligible += images.length;
    if (mode !== "apply") continue;
    let failed = false;
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const source = String(document(image).attr("src"));
      try {
        const optimized = await optimizeExistingImage(source, 1600);
        const stored = await storeMediaBuffer(optimized, {
          category: "notices",
          entityId: String(row.id),
          variant: `content-image-${index + 1}`,
          contentType: "image/webp",
          extension: "webp"
        });
        if (!(await verifyPublicObject(stored))) throw new Error("OSS_OBJECT_NOT_PUBLIC");
        document(image).attr("src", publicOssUrl(stored) ?? "");
      } catch (error) {
        failed = true;
        result.failed += 1;
        console.error("notice image migration failed", {
          id: String(row.id),
          index,
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }
    if (failed) continue;
    const next = document("body").html() ?? original;
    const [updated] = await pool.query<mysql.ResultSetHeader>(
      "UPDATE admin_notices SET content = ? WHERE id = ? AND content = ?",
      [next, row.id, original]
    );
    if (updated.affectedRows === 1) result.migrated += images.length;
    else result.skipped += images.length;
  }
}

async function migrateVideos(mode: Mode, result: MigrationResult, missing: Array<Record<string, unknown>>) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, card_no, motion_mp4_path, motion_webm_path, motion_poster_path, motion_version, motion_status
     FROM asset_cards
     WHERE motion_mp4_path IS NOT NULL OR motion_webm_path IS NOT NULL OR motion_poster_path IS NOT NULL`
  );
  for (const row of rows) {
    const legacyPaths = VIDEO_COLUMNS.map((column) => row[column]).filter(Boolean).map(String);
    if (legacyPaths.length === 0 || legacyPaths.every((mediaPath) => isOssRef(mediaPath))) {
      result.skipped += legacyPaths.length;
      continue;
    }
    result.scanned += legacyPaths.length;
    result.eligible += legacyPaths.length;
    const sourceFiles: Array<{ column: typeof VIDEO_COLUMNS[number]; path: string; contentType: string; extension: string }> = [];
    for (const column of VIDEO_COLUMNS) {
      const mediaPath = row[column] ? String(row[column]) : "";
      if (!mediaPath || isOssRef(mediaPath)) continue;
      try {
        await stat(resolve(config.assetMediaDir, mediaPath));
        sourceFiles.push({
          column,
          path: mediaPath,
          contentType: column === "motion_mp4_path" ? "video/mp4" : column === "motion_webm_path" ? "video/webm" : "image/webp",
          extension: column === "motion_mp4_path" ? "mp4" : column === "motion_webm_path" ? "webm" : "webp"
        });
      } catch {
        missing.push({ id: String(row.id), cardNo: String(row.card_no), column, path: mediaPath });
      }
    }
    if (sourceFiles.length !== legacyPaths.length) {
      result.missingVideos += legacyPaths.length - sourceFiles.length;
      if (mode === "apply") {
        await pool.query(
          `UPDATE asset_cards SET motion_mp4_path = NULL, motion_webm_path = NULL, motion_poster_path = NULL,
             motion_version = NULL, motion_processing_version = NULL, motion_status = 'failed',
             motion_error = '源文件缺失，请重新上传', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [row.id]
        );
      }
      continue;
    }
    if (mode !== "apply") continue;
    try {
      const updates: Partial<Record<typeof VIDEO_COLUMNS[number], string>> = {};
      for (const file of sourceFiles) {
        const content = await readFile(resolve(config.assetMediaDir, file.path));
        const stored = await storeMediaBuffer(content, {
          category: "assets/card-motion",
          entityId: String(row.id),
          variant: `${String(row.motion_version ?? "legacy")}/${file.extension}`,
          contentType: file.contentType,
          extension: file.extension
        });
        if (!(await verifyPublicObject(stored))) throw new Error("OSS_OBJECT_NOT_PUBLIC");
        updates[file.column] = stored;
      }
      await pool.query(
        `UPDATE asset_cards SET motion_mp4_path = ?, motion_webm_path = ?, motion_poster_path = ?,
           motion_status = 'ready', motion_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [updates.motion_mp4_path ?? null, updates.motion_webm_path ?? null, updates.motion_poster_path ?? null, row.id]
      );
      result.migrated += sourceFiles.length;
    } catch (error) {
      result.failed += sourceFiles.length;
      console.error("video migration failed", {
        id: String(row.id),
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}

async function verificationReport() {
  const legacy: Record<string, number> = {};
  for (const field of IMAGE_FIELDS) {
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM ${field.table}
       WHERE ${field.column} IS NOT NULL AND ${field.column} <> ''
         AND (${field.column} LIKE 'data:image/%' OR ${field.column} LIKE '/%')`
    );
    legacy[`${field.table}.${field.column}`] = Number(row.count ?? 0);
  }
  const [[notices]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM admin_notices WHERE content LIKE '%data:image/%'"
  );
  const [[videos]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM asset_cards
     WHERE (motion_mp4_path IS NOT NULL AND motion_mp4_path NOT LIKE 'oss://%')
        OR (motion_webm_path IS NOT NULL AND motion_webm_path NOT LIKE 'oss://%')
        OR (motion_poster_path IS NOT NULL AND motion_poster_path NOT LIKE 'oss://%')`
  );
  const [[gifts]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM gifts
     WHERE icon_image IS NOT NULL AND icon_image <> ''
       AND (icon_image LIKE 'data:image/%' OR icon_image LIKE '/%')`
  );
  return {
    legacy,
    noticesWithEmbeddedImages: Number(notices.count ?? 0),
    giftsWithLegacyIcons: Number(gifts.count ?? 0),
    cardsWithLegacyVideoPaths: Number(videos.count ?? 0)
  };
}

async function assertPublicOssWritable() {
  const marker = await storeMediaBuffer(Buffer.from("hgt-oss-public-read-preflight-v1"), {
    category: "_preflight",
    entityId: "public-read",
    variant: "marker",
    contentType: "text/plain",
    extension: "txt",
    cacheControl: "public, max-age=300"
  });
  if (!(await verifyPublicObject(marker))) throw new Error("OSS_PUBLIC_READ_PREFLIGHT_FAILED");
}

async function main() {
  const mode = modeFromArguments();
  if (mode === "verify") {
    console.log(JSON.stringify(await verificationReport(), null, 2));
    return;
  }

  const result = emptyResult();
  const missing: Array<Record<string, unknown>> = [];
  let backupDirectory: string | null = null;
  if (mode === "apply") {
    await assertPublicOssWritable();
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    backupDirectory = resolve(PROJECT_ROOT, ".local-backups", "oss-migration", runId);
    await mkdir(backupDirectory, { recursive: true });
    await backupRows(backupDirectory);
  }

  await migrateImageFields(mode, result);
  await migrateGiftIcons(mode, result);
  await migrateNoticeImages(mode, result);
  await migrateVideos(mode, result, missing);

  const report = {
    mode,
    completedAt: new Date().toISOString(),
    result,
    missing,
    verification: await verificationReport()
  };
  if (backupDirectory) {
    await Promise.all([
      writeFile(resolve(backupDirectory, "manifest.json"), JSON.stringify(report, null, 2)),
      writeFile(resolve(backupDirectory, "missing-media.json"), JSON.stringify(missing, null, 2))
    ]);
  }
  console.log(JSON.stringify(report, null, 2));
  if (result.failed > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await pool.end();
}
