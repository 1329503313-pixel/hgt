import assert from "node:assert/strict";
import test from "node:test";
import { hasEmptyManualAiKeyFacts, hasSoupReviewContentChanged, normalizeExistingSoupCover, normalizeSoupAiConfigurationInput, normalizeStoredJsonForSql, soupValidationMessage } from "./soupInput.js";

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

test("编辑无 AI 配置权限的旧作品时将数据库 JSON 对象安全序列化", () => {
  assert.equal(normalizeStoredJsonForSql(null), null);
  assert.equal(normalizeStoredJsonForSql('[{"id":1}]'), '[{"id":1}]');
  assert.equal(normalizeStoredJsonForSql([{ id: 1, content: "关键点", weight: 100 }]), '[{"id":1,"content":"关键点","weight":100}]');
});

test("开启 AI 主持并手动管理关键点时禁止保存空列表", () => {
  assert.equal(hasEmptyManualAiKeyFacts({ enableAiGame: true, keyFactsCustomized: true, keyFacts: [] }), true);
  assert.equal(hasEmptyManualAiKeyFacts({ enableAiGame: true, keyFactsCustomized: false, keyFacts: [] }), false);
  assert.equal(hasEmptyManualAiKeyFacts({ enableAiGame: false, keyFactsCustomized: true, keyFacts: [] }), false);
  assert.equal(hasEmptyManualAiKeyFacts({ enableAiGame: true, keyFactsCustomized: true, keyFacts: [{}] }), false);
});

test("未开启 AI 主持时忽略残留关键点，开启自动关键点时也不采信客户端残留", () => {
  assert.deepEqual(normalizeSoupAiConfigurationInput({
    title: "测试汤",
    enableAiGame: false,
    keyFactsCustomized: true,
    keyFacts: [{ id: 1, content: "", weight: 10 }],
  }), {
    title: "测试汤",
    enableAiGame: false,
    keyFactsCustomized: false,
    keyFacts: [],
  });
  assert.deepEqual(normalizeSoupAiConfigurationInput({
    enableAiGame: true,
    keyFactsCustomized: false,
    keyFacts: [{ id: 1, content: "残留数据", weight: 10 }],
  }), {
    enableAiGame: true,
    keyFactsCustomized: false,
    keyFacts: [],
  });
  const manual = {
    enableAiGame: true,
    keyFactsCustomized: true,
    keyFacts: [{ id: 1, content: "关键点", weight: 100 }],
  };
  assert.equal(normalizeSoupAiConfigurationInput(manual), manual);
  const malformedSwitch = { enableAiGame: "false", keyFactsCustomized: true, keyFacts: [] };
  assert.equal(normalizeSoupAiConfigurationInput(malformedSwitch), malformedSwitch);
});

test("海龟汤校验错误明确指出 AI 高级设置中的问题", () => {
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts", 0, "content"], message: "Too small" }]),
    "AI 主持高级设置：第 1 个关键点未填写"
  );
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts", 1, "weight"], message: "Too small" }]),
    "AI 主持高级设置：第 2 个关键点未填写有效进度值（1–99）"
  );
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts", 2, "hintContent"], message: "Too small" }]),
    "AI 主持高级设置：第 3 个关键点提示内容需填写且不超过 50 个字"
  );
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts"], message: "进度关键点权重总和必须为 100" }]),
    "AI 主持高级设置：进度值总和必须为 100"
  );
  assert.equal(
    soupValidationMessage([{ path: ["keyFacts"], message: "手动管理关键点时至少保留 1 个关键点" }]),
    "AI 主持高级设置：手动管理关键点时至少保留 1 个关键点"
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
