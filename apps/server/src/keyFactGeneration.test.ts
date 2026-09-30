import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeMissingKeyFactHints,
  mergeMissingKeyFactHintsIntoStoredValue,
  normalizeStoredKeyFacts,
  parseGeneratedKeyFactHintsResponse,
  parseGeneratedKeyFactsResponse,
} from "./keyFactGeneration.js";

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

test("补齐提示只写入缺失项并允许模型分批返回", () => {
  const existing = [
    { id: 1, content: "身份", weight: 50, hintContent: "保留作者提示" },
    { id: 2, content: "动机", weight: 30, hintContent: "" },
    { id: 3, content: "手法", weight: 20, hintContent: "" },
  ];
  const first = mergeMissingKeyFactHints(existing, [
    { id: 1, hintContent: "不得覆盖" },
    { id: 2, hintContent: "从人物动机入手" },
  ]);
  assert.equal(first.added, 1);
  assert.equal(first.facts[0].hintContent, "保留作者提示");
  assert.equal(first.facts[1].hintContent, "从人物动机入手");
  assert.deepEqual(first.missingIds, [3]);

  const second = mergeMissingKeyFactHints(first.facts, [{ id: 3, hintContent: "留意实现方式" }]);
  assert.equal(second.added, 1);
  assert.deepEqual(second.missingIds, []);
});

test("历史关键点写回只新增提示并保留原始权重和扩展字段", () => {
  const stored = [
    { id: 1, content: "身份", weight: 0, legacy: true },
    { id: 2, content: "动机", weight: 100, hintContent: "作者提示" },
  ];
  const merged = mergeMissingKeyFactHintsIntoStoredValue(stored, [
    { id: 1, hintContent: "留意身份" },
    { id: 2, hintContent: "不得覆盖" },
  ]);
  assert.equal(merged.added, 1);
  assert.deepEqual(merged.facts, [
    { id: 1, content: "身份", weight: 0, legacy: true, hintContent: "留意身份" },
    { id: 2, content: "动机", weight: 100, hintContent: "作者提示" },
  ]);
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
  assert.deepEqual(facts, []);
  assert.deepEqual(parseGeneratedKeyFactsResponse('{"keyFacts":[]}'), []);
  const singleton = parseGeneratedKeyFactsResponse('{"keyFacts":[{"id":1,"content":"唯一隐藏反转","weight":1}]}');
  assert.equal(singleton.length, 1);
  assert.equal(singleton[0].weight, 100);
  const fifteen = parseGeneratedKeyFactsResponse(JSON.stringify({ keyFacts: Array.from({ length: 15 }, (_, index) => ({ id: index + 1, content: `隐藏结论${index + 1}`, weight: 1, hintContent: "留意关键因果" })) }));
  assert.equal(fifteen.length, 15);
  assert.equal(fifteen.reduce((sum, fact) => sum + fact.weight, 0), 100);
  assert.equal(parseGeneratedKeyFactsResponse(JSON.stringify({ keyFacts: Array.from({ length: 16 }, (_, index) => ({ id: index + 1, content: `隐藏事实${index + 1}`, weight: 1 })) })).length, 0);
});

test("历史零权重关键点全部保留并只在运行时确定性分配权重", () => {
  const stored = [
    { id: 1, content: "身份", weight: 0 },
    { id: 2, content: "动机", weight: 0 },
    { id: 3, content: "手法", weight: 0 },
  ];
  const normalized = normalizeStoredKeyFacts(stored);
  assert.deepEqual(normalized.map((fact) => fact.content), ["身份", "动机", "手法"]);
  assert.equal(normalized.reduce((sum, fact) => sum + fact.weight, 0), 100);
  assert.ok(normalized.every((fact) => fact.weight > 0));
  assert.deepEqual(stored.map((fact) => fact.weight), [0, 0, 0]);
});
