import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { BANNER_MAX_BYTES, optimizeBannerImage, storedBannerImageBytes } from "./bannerImages.js";

test("Banner 上传图自动转换为不超过 300KB 的 WebP", async () => {
  const width = 900;
  const height = 506;
  const png = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).png().toBuffer();
  const optimized = await optimizeBannerImage(`data:image/png;base64,${png.toString("base64")}`);
  assert.ok(optimized?.startsWith("data:image/webp;base64,"));
  assert.ok(storedBannerImageBytes(optimized!) <= BANNER_MAX_BYTES);
});

test("Banner 按桌面端和手机端输出不同画幅", async () => {
  const source = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: "#2563eb" }
  }).png().toBuffer();
  const value = `data:image/png;base64,${source.toString("base64")}`;
  const desktop = await optimizeBannerImage(value, "desktop");
  const mobile = await optimizeBannerImage(value, "mobile");
  const desktopMeta = await sharp(Buffer.from(desktop!.split(",")[1], "base64")).metadata();
  const mobileMeta = await sharp(Buffer.from(mobile!.split(",")[1], "base64")).metadata();
  assert.deepEqual([desktopMeta.width, desktopMeta.height], [2000, 800]);
  assert.deepEqual([mobileMeta.width, mobileMeta.height], [960, 540]);
});

test("Banner 压缩拒绝非图片数据", async () => {
  assert.equal(await optimizeBannerImage("not-an-image"), null);
});
