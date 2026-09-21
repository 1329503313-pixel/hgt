import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { constants, setPriority } from "node:os";
import { config } from "./config.js";
import { absoluteAssetMediaPath } from "./assetVideos.js";
import { isOssRef, publicOssUrl } from "./ossStorage.js";

export const BATTLE_MOTION_WIDTHS = [256, 512, 768] as const;
type Metadata = { width: number; height: number; bitrate: number; framerate: number; key: string };
const root = () => join(config.assetMediaDir, ".battle-motion-v1");
const keyFor = (source: string, width: number) => createHash("sha256").update(`${source}\n${width}`).digest("hex");
const pending = new Map<string, () => Promise<void>>();
const failed = new Map<string, number>();
let working = false;
export function battleMotionWidth(value: unknown): number | null {
  const width = typeof value === "string" ? Number(value) : NaN;
  return BATTLE_MOTION_WIDTHS.some(item => item === width) ? width : null;
}

async function cached(source: string, width: number) {
  const key = keyFor(source, width), directory = join(root(), key);
  try {
    const metadata: Metadata = JSON.parse(await readFile(join(directory, "metadata.json"), "utf8"));
    if (metadata.key !== key || !metadata.width || !metadata.height) return null;
    await stat(join(directory, "motion.mp4"));
    return { metadata, mediaPath: relative(config.assetMediaDir, join(directory, "motion.mp4")).replaceAll("\\", "/") };
  } catch { return null; }
}

/** Single bounded background worker. Cold requests immediately retain original playback. */
export async function battleMotionRendition(source: string, width: number, enqueue = true) {
  if (!BATTLE_MOTION_WIDTHS.some(item => item === width)) return null;
  const found = await cached(source, width); if (found) return found;
  const key = keyFor(source, width);
  if (enqueue && pending.size < 16 && !pending.has(key) && Date.now() - (failed.get(key) ?? 0) > 60000) {
    pending.set(key, () => generate(source, width));
    void drain();
  }
  return null;
}

async function drain() {
  if (working) return;
  working = true;
  try {
    for (const [key, task] of pending) {
      try { await task(); failed.delete(key); }
      catch { failed.set(key, Date.now()); if (failed.size > 128) failed.delete(failed.keys().next().value!); }
      finally { pending.delete(key); }
    }
  } finally { working = false; }
}

async function transcode(input: string, output: string, width: number) {
  return new Promise<string>((resolve, reject) => {
    const process = spawn(config.ffmpegPath, ["-nostdin", "-y", "-threads", "1", "-filter_threads", "1", "-i", input, "-an", "-vf", `scale='min(${width},iw)':-2:flags=lanczos,fps=30`,
      "-c:v", "libx264", "-threads", "1", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1", "-g", "60", "-movflags", "+faststart", output],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    process.once("spawn", () => { try { if (process.pid) setPriority(process.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* bounded single-thread processing remains */ } });
    let stderr = "";
    const timer = setTimeout(() => { process.kill("SIGKILL"); reject(new Error("battle rendition timeout")); }, 120000);
    process.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-24000); });
    process.once("error", error => { clearTimeout(timer); reject(error); });
    process.once("close", code => { clearTimeout(timer); code === 0 ? resolve(stderr) : reject(new Error("battle rendition failed")); });
  });
}

async function sourceFile(source: string, directory: string) {
  if (!isOssRef(source)) {
    const path = absoluteAssetMediaPath(source);
    if ((await stat(path)).size > 200 * 1024 * 1024) throw new Error("video too large");
    return path;
  }
  const url = publicOssUrl(source);
  if (!url) throw new Error("invalid media reference");
  // URL comes exclusively from the stored OSS reference, never from query input.
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok || !response.body) throw new Error("media unavailable");
  const reader = response.body.getReader(), path = join(directory, "source.mp4"), file = await open(path, "w");
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 200 * 1024 * 1024) throw new Error("video too large");
      await file.writeFile(value);
    }
  } finally { await reader.cancel().catch(() => {}); await file.close(); }
  return path;
}

async function trimCache() {
  const directories = await readdir(root(), { withFileTypes: true });
  const entries = await Promise.all(directories.filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)).map(async entry => {
    const path = join(root(), entry.name), file = await stat(join(path, "motion.mp4")).catch(() => null);
    return { path, bytes: file?.size ?? 0, at: file?.mtimeMs ?? 0 };
  }));
  entries.sort((a, b) => b.at - a.at);
  let bytes = 0;
  for (let i = 0; i < entries.length; i++) {
    bytes += entries[i].bytes;
    if (i >= 96 || bytes > 512 * 1024 * 1024) await rm(entries[i].path, { recursive: true, force: true }).catch(() => {});
  }
}

async function generate(source: string, width: number) {
  const key = keyFor(source, width), destination = join(root(), key), temporary = join(root(), `${key}.pending`);
  await mkdir(temporary, { recursive: true });
  try {
    const input = await sourceFile(source, temporary), output = join(temporary, "motion.mp4");
    const log = await transcode(input, output, width);
    const outputLog = log.slice(log.indexOf("Output #"));
    const dimensions = /Video:.*?\b(\d{2,5})x(\d{2,5})\b/.exec(outputLog);
    const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
    if (!dimensions || !duration) throw new Error("video metadata unavailable");
    const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    const size = (await stat(output)).size;
    if (!seconds || !size || size > 100 * 1024 * 1024) throw new Error("invalid rendition");
    const metadata: Metadata = { key, width: Number(dimensions[1]), height: Number(dimensions[2]), bitrate: Math.ceil(size * 8 / seconds), framerate: 30 };
    await writeFile(join(temporary, "metadata.json"), JSON.stringify(metadata));
    await rm(join(temporary, "source.mp4"), { force: true });
    await rename(temporary, destination);
    await trimCache();
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
