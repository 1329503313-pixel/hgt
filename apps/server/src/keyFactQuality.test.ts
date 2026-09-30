import assert from "node:assert/strict";
import test from "node:test";
import {
  isFactExplicitlyPublic,
  parseKeyFactReviewResult,
  validateGeneratedKeyFacts,
} from "./keyFactQuality.js";

test("汤面明示的完整事实不应成为计分关键点", () => {
  const publicTexts = ["女孩在雨夜打着伞，却全身湿透。", "补充汤面：她的右手拿着一把红伞。"];
  assert.equal(isFactExplicitlyPublic("全身湿透", publicTexts), true);
  assert.equal(isFactExplicitlyPublic("她的右手拿着一把红伞", publicTexts), true);
  assert.equal(isFactExplicitlyPublic("她故意走到伞外，想伪装成落水", publicTexts), false);
});

test("根据真实推理量允许一到十五个关键点并拒绝公开、重复关键点", () => {
  assert.deepEqual(validateGeneratedKeyFacts(
    [{ id: 1, content: "她故意走到伞外，想伪装成落水", weight: 100 }],
    ["女孩在雨夜打着伞，却全身湿透。"],
  ), []);

  const issues = validateGeneratedKeyFacts([
    { id: 1, content: "全身湿透", weight: 50 },
    { id: 2, content: "全身湿透！", weight: 50 },
  ], ["女孩在雨夜打着伞，却全身湿透。"]);
  assert.deepEqual(new Set(issues.map((issue) => issue.code)), new Set(["PUBLIC_FACT", "DUPLICATE_FACT"]));
});

test("语义复核结果必须是明确通过且没有问题项", () => {
  assert.deepEqual(parseKeyFactReviewResult('{"approved":true,"issues":[]}'), { approved: true, issues: [] });
  assert.deepEqual(parseKeyFactReviewResult('{"approved":true,"issues":[{"factId":2,"reason":"汤面已经说明"}]}'), {
    approved: false,
    issues: [{ code: "REVIEW_REJECTED", factId: 2, reason: "汤面已经说明" }],
  });
  assert.equal(parseKeyFactReviewResult("not-json"), null);
});

test("自动关键点必须附带方向提示才能通过结构校验", () => {
  const issues = validateGeneratedKeyFacts(
    [{ id: 1, content: "唯一隐藏反转", weight: 100, hintContent: "" }],
    [],
  );
  assert.equal(issues.some((issue) => issue.code === "MISSING_HINT"), true);
});
