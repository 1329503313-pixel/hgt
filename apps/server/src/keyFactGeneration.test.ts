import assert from "node:assert/strict";
import test from "node:test";
import { parseGeneratedKeyFactHintsResponse, parseGeneratedKeyFactsResponse } from "./keyFactGeneration.js";

test("解析 DeepSeek JSON 对象格式的自动关键点", () => {
  const facts = parseGeneratedKeyFactsResponse(JSON.stringify({
    keyFacts: [
      { id: 1, content: " 关键身份 ", weight: 20, hintContent: " 留意人物身份 " },
      { id: 2, content: "核心动机", weight: 10, hintContent: "思考事件动机" },
    ],
  }));
  assert.deepEqual(facts.map((fact) => fact.content), ["关键身份", "核心动机"]);
  assert.deepEqual(facts.map((fact) => fact.hintContent), ["留意人物身份", "思考事件动机"]);
  assert.equal(facts.reduce((sum, fact) => sum + fact.weight, 0), 100);
});

test("解析历史关键点缺失提示内容的 AI 补齐结果", () => {
  assert.deepEqual(parseGeneratedKeyFactHintsResponse(JSON.stringify({
    keyFacts: [
      { id: 2, hintContent: " 从时间顺序入手 " },
      { id: 3, hintContent: "" },
    ],
  })), [{ id: 2, hintContent: "从时间顺序入手" }]);
});

test("兼容历史数组格式并拒绝无效关键点", () => {
  const facts = parseGeneratedKeyFactsResponse('[{"id":1,"content":"有效事实","weight":20},{"id":1,"content":"重复","weight":10}]');
  assert.equal(facts.length, 1);
  assert.equal(facts[0].weight, 100);
  assert.deepEqual(parseGeneratedKeyFactsResponse('{"keyFacts":[]}'), []);
});
