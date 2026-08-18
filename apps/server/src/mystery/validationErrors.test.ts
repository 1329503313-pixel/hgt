import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { formatMysteryValidationError, formatMysteryValidationIssues } from "./validationErrors.js";

test("谜局文本长度错误包含中文字段名称和限制", () => {
  const schema = z.object({ source: z.object({ playerRole: z.object({ socialStatus: z.string().max(5) }) }) });
  const result = schema.safeParse({ source: { playerRole: { socialStatus: "超过五个字符的社会身份" } } });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(formatMysteryValidationError(result.error), "社会地位最多填写 5 个字符");
});

test("谜局数组错误标明中文字段及具体序号", () => {
  const schema = z.object({ source: z.object({ display: z.object({ genres: z.array(z.string().max(2)) }) }) });
  const result = schema.safeParse({ source: { display: { genres: ["悬疑", "超过限制"] } } });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.deepEqual(formatMysteryValidationIssues(result.error), ["类型第 2 项最多填写 2 个字符"]);
});

test("谜局必填及枚举错误不再暴露英文默认提示", () => {
  const schema = z.object({ source: z.object({ title: z.string(), worldRules: z.object({ worldType: z.enum(["realistic", "fantasy"]) }) }) });
  const result = schema.safeParse({ source: { worldRules: { worldType: "unknown" } } });
  assert.equal(result.success, false);
  if (result.success) return;
  const messages = formatMysteryValidationIssues(result.error);
  assert.deepEqual(messages, ["标题为必填项", "世界类型的取值不在允许范围内"]);
  assert.equal(messages.some((message) => /String|Required|Invalid|Expected/.test(message)), false);
});

test("故事结构包错误保留集合序号和中文子字段名称", () => {
  const schema = z.object({ storyPackage: z.object({ entityResourceGraph: z.object({ resources: z.array(z.object({ unit: z.string().max(2) })) }) }) });
  const result = schema.safeParse({ storyPackage: { entityResourceGraph: { resources: [{ unit: "分钟" }, { unit: "超过限制" }] } } });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(formatMysteryValidationError(result.error), "资源第 2 项的资源单位最多填写 2 个字符");
});

test("事实对象被模型简写为文本时明确提示期望和实际类型", () => {
  const schema = z.object({ storyPackage: z.object({ coreFactGraph: z.object({ facts: z.array(z.object({ statement: z.string() })) }) }) });
  const result = schema.safeParse({ storyPackage: { coreFactGraph: { facts: [{ statement: "完整事实" }, "错误的事实简写"] } } });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(formatMysteryValidationError(result.error), "事实第 2 项必须填写为对象，当前为文本");
});
