import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerDigitalAssetRoutes } from "./digitalAssets.js";
import { pool } from "./db.js";
import { config } from "./config.js";
import { battleMotionRendition, battleMotionWidth } from "./battleMotionRenditions.js";

test("rendition widths reject arbitrary dimensions and paths", () => {
  for (const width of ["256", "512", "768"]) assert.equal(battleMotionWidth(width), Number(width));
  for (const width of ["../256", "1080", "0", "512.5", ["512"], undefined]) assert.equal(battleMotionWidth(width), null);
});

test("cold playback is nonblocking; warm rendition preserves duration, aspect and a supported H264 profile", { timeout: 30000 }, async t => {
  const ffmpeg = process.env.TEST_FFMPEG_PATH || config.ffmpegPath;
  if (spawnSync(ffmpeg, ["-version"], { windowsHide: true }).status !== 0) { t.skip("FFmpeg not available"); return; }
  const directory = await mkdtemp(join(tmpdir(), "hgt-battle-video-"));
  const previous = { assetMediaDir: config.assetMediaDir, ffmpegPath: config.ffmpegPath };
  config.assetMediaDir = directory; config.ffmpegPath = ffmpeg;
  try {
    const frames = Buffer.alloc(540 * 756 * 3 * 30, 80);
    const encode = spawnSync(ffmpeg, ["-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "540x756", "-framerate", "30", "-i", "pipe:0", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(directory, "source.mp4")], { input: frames, windowsHide: true, maxBuffer: 1024 * 1024 });
    assert.equal(encode.status, 0, String(encode.stderr));
    const start = performance.now();
    assert.equal(await battleMotionRendition("source.mp4", 256), null);
    assert.ok(performance.now() - start < 1000, "first request never waits for transcoding");
    const until = Date.now() + 20000;
    let rendition = await battleMotionRendition("source.mp4", 256, false);
    while (!rendition && Date.now() < until) { await new Promise(resolve => setTimeout(resolve, 100)); rendition = await battleMotionRendition("source.mp4", 256, false); }
    assert.ok(rendition, "background rendition completed");
    assert.equal(rendition.metadata.width, 256);
    assert.equal(rendition.metadata.height, 358);
    assert.equal(rendition.metadata.framerate, 30);
    assert.ok(rendition.metadata.bitrate > 0);
    const inspect = spawnSync(ffmpeg, ["-i", join(directory, rendition.mediaPath), "-f", "null", "-"], { windowsHide: true });
    assert.equal(inspect.status, 0);
    assert.match(String(inspect.stderr), /h264 \(High\).*yuv420p/s);
    assert.match(String(inspect.stderr), /Duration: 00:00:01\.00/);
    assert.deepEqual(await battleMotionRendition("source.mp4", 256), rendition);
    assert.equal(await battleMotionRendition("source.mp4", 123), null);
    const query = t.mock.method(pool, "query", async (sql: string, values: unknown[]) => {
      assert.match(sql, /^SELECT rarity,/);
      return [values[0] === "card" ? [{ rarity: "legend", media_path: "source.mp4", motion_mp4_path: "source.mp4" }] : []];
    });
    const app = express();
    registerDigitalAssetRoutes(app, {
      requireAuth: async (req, res) => { if (req.headers["x-test-user"]) return { id: "local-test", role: "super_admin" }; res.status(401).end(); return null; },
      requireAdmin: async () => null,
      sendError: (res, status, message) => res.status(status).json({ error: message }),
      sendStoredImage: async () => {},
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { "x-test-user": "1" };
    try {
      assert.equal((await fetch(`${base}/api/media/assets/cards/card/motion/renditions?width=256`)).status, 401);
      assert.equal((await fetch(`${base}/api/media/assets/cards/card/motion/renditions?width=100000`, { headers })).status, 400);
      assert.equal((await fetch(`${base}/api/media/assets/cards/missing/motion/renditions?width=256`, { headers })).status, 404);
      const manifest = await fetch(`${base}/api/media/assets/cards/card/motion/renditions?width=256`, { headers });
      assert.equal(manifest.headers.get("cache-control"), "private, no-store");
      const data = await manifest.json() as { sources: Array<{ url: string }> };
      const response = await fetch(base + data.sources[0].url, { headers: { ...headers, Range: "bytes=0-127" } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-length"), "128");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), (await readFile(join(directory, rendition.mediaPath))).subarray(0, 128));
      const stale = await fetch(`${base}/api/media/assets/cards/card/motion/mp4?width=256&v=old`, { headers });
      assert.equal(stale.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(Buffer.from(await stale.arrayBuffer()), await readFile(join(directory, "source.mp4")));
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); query.mock.restore(); }
    await writeFile(join(directory, "broken.mp4"), "invalid video");
    assert.equal(await battleMotionRendition("broken.mp4", 256), null);
    // A failed derivative never edits or removes the original.
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await readFile(join(directory, "broken.mp4"), "utf8"), "invalid video");
  } finally {
    Object.assign(config, previous);
    await rm(directory, { recursive: true, force: true });
  }
});
