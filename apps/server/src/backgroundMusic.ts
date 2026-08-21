import express from "express";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { publicOssUrl, storeMediaBuffer } from "./ossStorage.js";
import type { UserRole } from "./roles.js";

type RouteUser = { id: string; role: UserRole };
type RouteDependencies = {
  requireAuth: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  requireAdmin: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
};

export const BACKGROUND_MUSIC_MAX_BYTES = 50 * 1024 * 1024;
export const BACKGROUND_MUSIC_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
] as const;

const backgroundMusicSchema = z.object({
  name: z.string().trim().min(1, "请填写音乐名称").max(100),
  audioRef: z.string().trim().min(1, "请上传音频").max(1000),
  weight: z.coerce.number().int().min(-1_000_000).max(1_000_000),
  enabled: z.boolean(),
});

export function isBackgroundMusicMimeType(value: string) {
  return (BACKGROUND_MUSIC_MIME_TYPES as readonly string[]).includes(value.toLowerCase());
}

function backgroundMusicPayload(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    name: String(row.name),
    audioUrl: publicOssUrl(row.audio_ref),
    audioRef: String(row.audio_ref),
    weight: Number(row.sort_order ?? 0),
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function transcodeBackgroundMusic(source: Buffer, contentType: string) {
  const directory = await mkdtemp(join(tmpdir(), "hgt-bgm-"));
  try {
    const inputExtension = contentType === "audio/mpeg" ? "mp3"
      : contentType === "audio/mp4" || contentType === "audio/x-m4a" ? "m4a"
        : "wav";
    const inputPath = join(directory, `source.${inputExtension}`);
    const outputPath = join(directory, "background-music.mp3");
    await writeFile(inputPath, source);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(config.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
        "-vn", "-map_metadata", "-1", "-ac", "2", "-ar", "44100",
        "-codec:a", "libmp3lame", "-b:a", "160k", outputPath,
      ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("BACKGROUND_MUSIC_TRANSCODE_TIMEOUT"));
      }, 180_000);
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 8_000) stderr += String(chunk);
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        reject(new Error(error.code === "ENOENT" ? "BACKGROUND_MUSIC_TRANSCODER_UNAVAILABLE" : "BACKGROUND_MUSIC_TRANSCODE_FAILED"));
      });
      child.once("close", async (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`BACKGROUND_MUSIC_TRANSCODE_FAILED:${stderr.slice(-500)}`));
          return;
        }
        resolve();
      });
    });
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function backgroundMusicError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("TRANSCODER_UNAVAILABLE")) return "服务器暂时无法处理音频，请联系维护人员";
  if (message.includes("TRANSCODE_TIMEOUT")) return "音频处理超时，请压缩文件后重试";
  if (message.includes("TRANSCODE_FAILED")) return "无法识别或转换该音频，请上传有效的 MP3、M4A 或 WAV 文件";
  if (message.includes("OSS_CONFIG_INCOMPLETE")) return "音频存储尚未配置，请联系维护人员";
  return "背景音乐上传失败，请稍后重试";
}

export function registerBackgroundMusicRoutes(app: express.Express, dependencies: RouteDependencies) {
  const { requireAuth, requireAdmin, sendError } = dependencies;

  app.get("/api/online-soup/background-music", async (req, res) => {
    if (!(await requireAuth(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_soup_background_music WHERE enabled = 1 ORDER BY sort_order DESC, created_at DESC, id DESC",
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ tracks: rows.map(backgroundMusicPayload) });
  });

  app.post(
    "/api/admin/background-music/audio",
    express.raw({ type: [...BACKGROUND_MUSIC_MIME_TYPES], limit: BACKGROUND_MUSIC_MAX_BYTES }),
    async (req, res) => {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!isBackgroundMusicMimeType(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return sendError(res, 400, "音频仅支持 MP3、M4A 或 WAV");
      }
      try {
        const output = await transcodeBackgroundMusic(req.body, contentType);
        const audioRef = await storeMediaBuffer(output, {
          category: "online-soup/background-music",
          entityId: nanoid(),
          variant: "audio",
          contentType: "audio/mpeg",
          extension: "mp3",
        });
        res.status(201).json({ audioRef, audioUrl: publicOssUrl(audioRef) });
      } catch (error) {
        return sendError(res, 400, backgroundMusicError(error));
      }
    },
  );

  app.get("/api/admin/background-music", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_soup_background_music ORDER BY sort_order DESC, created_at DESC, id DESC",
    );
    res.json({ tracks: rows.map(backgroundMusicPayload) });
  });

  app.post("/api/admin/background-music", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = backgroundMusicSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "背景音乐信息不完整");
    const id = nanoid();
    await pool.query(
      `INSERT INTO online_soup_background_music (id, name, audio_ref, sort_order, enabled, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, parsed.data.name, parsed.data.audioRef, parsed.data.weight, parsed.data.enabled ? 1 : 0, admin.id],
    );
    res.status(201).json({ id });
  });

  app.patch("/api/admin/background-music/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = backgroundMusicSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "背景音乐信息不完整");
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE online_soup_background_music
       SET name = ?, audio_ref = ?, sort_order = ?, enabled = ?
       WHERE id = ?`,
      [parsed.data.name, parsed.data.audioRef, parsed.data.weight, parsed.data.enabled ? 1 : 0, req.params.id],
    );
    if (result.affectedRows !== 1) return sendError(res, 404, "背景音乐不存在");
    res.json({ ok: true });
  });
}
