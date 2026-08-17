import assert from "node:assert/strict";
import test from "node:test";
import { onlineSoupAnswerPrefix } from "./onlineSoupAnswerLabel";

test("真人主持回答使用主持人标签", () => {
  assert.equal(onlineSoupAnswerPrefix("none"), "主持人回答：");
  assert.equal(onlineSoupAnswerPrefix(null), "主持人回答：");
});

test("AI 主持回答使用 AI 主持人标签", () => {
  assert.equal(onlineSoupAnswerPrefix("completed"), "AI主持人回答：");
});
