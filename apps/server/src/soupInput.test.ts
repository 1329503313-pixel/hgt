import assert from "node:assert/strict";
import test from "node:test";
import { hasSoupReviewContentChanged, normalizeExistingSoupCover, soupValidationMessage } from "./soupInput.js";

test("编辑海龟汤时将当前 OSS 封面转换为站内封面标记", () => {
  const body = {
    title: "测试海龟汤",
    coverImage: "https://test-bucket.oss-cn-beijing.aliyuncs.com/soups/soup-1/cover.webp"
  };

  assert.deepEqual(
    normalizeExistingSoupCover(body, "soup-1", body.coverImage),
    {
      title: "测试海龟汤",
      coverImage: "/api/media/soups/soup-1/cover"
    }
  );
});

test("编辑海龟汤时不改写新上传封面或无关地址", () => {
  const dataImage = { coverImage: "data:image/png;base64,AAAA" };
  const unrelatedUrl = { coverImage: "https://example.com/cover.webp" };

  assert.equal(normalizeExistingSoupCover(dataImage, "soup-1", "https://oss.example/current.webp"), dataImage);
  assert.equal(normalizeExistingSoupCover(unrelatedUrl, "soup-1", "https://oss.example/current.webp"), unrelatedUrl);
});

test("仅修改封面等非审核内容时不触发重新审核", () => {
  const existing = { title: "标题", surface: "汤面", bottom: "汤底" };

  assert.equal(hasSoupReviewContentChanged(existing, { ...existing }), false);
  assert.equal(hasSoupReviewContentChanged(existing, { ...existing, bottom: "新汤底" }), true);
});

test("海龟汤校验错误明确指出 AI 高级设置中的问题", () => {
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts", 0, "content"], message: "Too small" }]),
    "AI 玩汤高级设置：第 1 个关键点未填写"
  );
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts", 1, "weight"], message: "Too small" }]),
    "AI 玩汤高级设置：第 2 个关键点未填写有效进度值（1–99）"
  );
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts"], message: "进度关键点权重总和必须为 100" }]),
    "AI 玩汤高级设置：进度值总和必须为 100"
  );
});

test("海龟汤校验错误明确指出普通表单字段", () => {
  assert.equal(
    soupValidationMessage([{ path: ["summary"], message: "摘要不超过 40 个字" }]),
    "摘要不超过 40 个字"
  );
  assert.equal(
    soupValidationMessage([{ path: ["coverImage"], message: "封面仅支持 JPG 或 PNG" }]),
    "封面仅支持 JPG 或 PNG"
  );
});
