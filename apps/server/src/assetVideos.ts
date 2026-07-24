import type express from "express";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";

const CARD_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "application/octet-stream"
]);

function run(command: string, args: string[]) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("FFmpeg processing timed out"));
    }, 10 * 60_000);
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      if (errorOutput.length < 12_000) errorOutput += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error(errorOutput.trim() || `${command} exited with code ${code}`));
    });
  });
}

function relativeMediaPath(absolutePath: string) {
  return relative(config.assetMediaDir, absolutePath).replaceAll("\\", "/");
}

export function absoluteAssetMediaPath(mediaPath: string) {
  const absolutePath = resolve(config.assetMediaDir, mediaPath);
  const relation = relative(config.assetMediaDir, absolutePath);
  if (isAbsolute(relation) || relation.startsWith("..")) throw new Error("INVALID_ASSET_MEDIA_PATH");
  return absolutePath;
}

export async function stageCardMotionVideo(cardId: string, source: Buffer, contentType: string) {
  if (!ALLOWED_VIDEO_TYPES.has(contentType)) throw new Error("ASSET_VIDEO_TYPE_INVALID");
  if (!source.length || source.length > CARD_VIDEO_MAX_BYTES) throw new Error("ASSET_VIDEO_SIZE_INVALID");

  const version = createHash("sha256").update(source).digest("hex").slice(0, 20);
  const cardDirectory = resolve(config.assetMediaDir, "cards", cardId);
  const outputDirectory = resolve(cardDirectory, version);
  const sourcePath = resolve(outputDirectory, "source.upload");
  const mp4Path = resolve(outputDirectory, "motion.mp4");
  const webmPath = resolve(outputDirectory, "motion.webm");
  const posterPath = resolve(outputDirectory, "poster.webp");
  try {
    await Promise.all([stat(mp4Path), stat(webmPath), stat(posterPath)]);
    return {
      version,
      reused: true,
      mp4Path: relativeMediaPath(mp4Path),
      webmPath: relativeMediaPath(webmPath),
      posterPath: relativeMediaPath(posterPath),
      sourcePath: null,
      pendingMp4Path: null,
      pendingPosterPath: null,
      pendingWebmPath: null
    };
  } catch {
    // At least one rendition is missing, so rebuild the complete version set.
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(sourcePath, source);
  return {
    version,
    reused: false,
    mp4Path: relativeMediaPath(mp4Path),
    webmPath: null,
    posterPath: relativeMediaPath(posterPath),
    sourcePath,
    pendingMp4Path: mp4Path,
    pendingPosterPath: posterPath,
    pendingWebmPath: webmPath
  };
}

export async function processCardMotionPrimary(
  stored: Awaited<ReturnType<typeof stageCardMotionVideo>>
) {
  if (stored.reused || !stored.sourcePath || !stored.pendingMp4Path || !stored.pendingPosterPath) return stored;
  const scale = "scale='min(1080,iw)':-2:flags=lanczos,fps=30";
  try {
    const primaryResults = await Promise.allSettled([
      run(config.ffmpegPath, [
        "-y", "-i", stored.sourcePath, "-an", "-vf", scale,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-g", "60", "-keyint_min", "60", "-movflags", "+faststart", stored.pendingMp4Path
      ]),
      run(config.ffmpegPath, [
        "-y", "-i", stored.sourcePath, "-frames:v", "1",
        "-vf", "scale='min(1080,iw)':-2:flags=lanczos", "-c:v", "libwebp", "-quality", "88", stored.pendingPosterPath
      ])
    ]);
    const primaryFailure = primaryResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (primaryFailure) throw primaryFailure.reason;
    return stored;
  } catch (error) {
    await removeCardMotionFiles([stored.mp4Path, stored.posterPath]);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("ASSET_VIDEO_TRANSCODER_UNAVAILABLE");
    throw new Error(`ASSET_VIDEO_TRANSCODE_FAILED:${error instanceof Error ? error.message : "unknown"}`);
  }
}

export async function finishCardMotionWebm(
  stored: Awaited<ReturnType<typeof stageCardMotionVideo>>
) {
  if (stored.reused || !stored.sourcePath || !stored.pendingWebmPath) return stored.webmPath;
  try {
    await run(config.ffmpegPath, [
      "-y", "-i", stored.sourcePath, "-an",
      "-vf", "scale='min(1080,iw)':-2:flags=lanczos,fps=30",
      "-c:v", "libvpx-vp9", "-crf", "24", "-b:v", "0",
      "-deadline", "good", "-cpu-used", "3", "-row-mt", "1", "-g", "60",
      stored.pendingWebmPath
    ]);
    return relativeMediaPath(stored.pendingWebmPath);
  } finally {
    await rm(stored.sourcePath, { force: true });
  }
}

export async function removeCardMotionFiles(mediaPaths: Array<unknown>) {
  const directories = new Set<string>();
  for (const value of mediaPaths) {
    if (!value) continue;
    try {
      directories.add(dirname(absoluteAssetMediaPath(String(value))));
    } catch {
      // Ignore invalid legacy paths instead of touching anything outside the media root.
    }
  }
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true })));
}

export async function sendAssetVideo(
  req: express.Request,
  res: express.Response,
  mediaPath: string,
  cacheControl = "private, max-age=31536000, immutable"
) {
  const absolutePath = absoluteAssetMediaPath(mediaPath);
  const file = await stat(absolutePath);
  const contentType = extname(absolutePath).toLowerCase() === ".webm" ? "video/webm" : "video/mp4";
  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Content-Type", contentType);
  res.setHeader("ETag", `"${file.size}-${Math.floor(file.mtimeMs)}"`);

  if (!range) {
    res.setHeader("Content-Length", file.size);
    createReadStream(absolutePath).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader("Content-Range", `bytes */${file.size}`);
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= file.size) {
    res.status(416).setHeader("Content-Range", `bytes */${file.size}`);
    res.end();
    return;
  }
  res.status(206);
  res.setHeader("Content-Length", end - start + 1);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
  createReadStream(absolutePath, { start, end }).pipe(res);
}
