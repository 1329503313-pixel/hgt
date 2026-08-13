import assert from "node:assert/strict";
import test from "node:test";
import { parseGeneratedKeyFactsResponse } from "./keyFactGeneration.js";

test("解析 DeepSeek JSON 对象格式的自动关键点", () => {
  const facts = parseGeneratedKeyFactsResponse(JSON.stringify({
    keyFacts: [
      { id: 1, content: " 关键身份 ", weight: 20 },
      { id: 2, content: "核心动机", weight: 10 },
    ],
  }));
  assert.deepEqual(facts.map((fact) => fact.content), ["关键身份", "核心动机"]);
  assert.equal(facts.reduce((sum, fact) => sum + fact.weight, 0), 100);
});

test("兼容历史数组格式并拒绝无效关键点", () => {
  const facts = parseGeneratedKeyFactsResponse('[{"id":1,"content":"有效事实","weight":20},{"id":1,"content":"重复","weight":10}]');
  assert.equal(facts.length, 1);
  assert.equal(facts[0].weight, 100);
  assert.deepEqual(parseGeneratedKeyFactsResponse('{"keyFacts":[]}'), []);
});
