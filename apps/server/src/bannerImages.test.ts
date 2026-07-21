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

test("Banner 压缩拒绝非图片数据", async () => {
  assert.equal(await optimizeBannerImage("not-an-image"), null);
});
