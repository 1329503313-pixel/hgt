import assert from "node:assert/strict";
import test from "node:test";
import { inspectAiHostResponse, parseAiHostResponse } from "./aiHostResponse.js";

test("完整复核必须包含全部服务端计分字段", () => {
  const valid = parseAiHostResponse(JSON.stringify({
    answer: "不知道",
    evidenceFactIds: [],
    factMatches: [],
    revealedSupplementSurfaces: [],
  }));
  assert.equal(valid?.answer, "不知道");
  assert.equal(parseAiHostResponse('{"answer":"不知道"}'), null);
  const degraded = inspectAiHostResponse('{"answer":"是"}');
  assert.equal(degraded.response, null);
  assert.equal(degraded.coreAnswer, "是");
  assert.equal(degraded.rejection, "missing_fields");
  const explained = inspectAiHostResponse('{"answer":"是，因为符合汤底"}');
  assert.equal(explained.response, null);
  assert.equal(explained.coreAnswer, "是");
  assert.deepEqual(explained.normalizations, ["answer_token_extracted"]);
  assert.equal(inspectAiHostResponse('{"answer":"是不是"}').coreAnswer, null);
});

test("完整复核拒绝无效事实等级和索引，但安全忽略未经信任的额外字段", () => {
  assert.equal(parseAiHostResponse(JSON.stringify({
    answer: "是",
    evidenceFactIds: [1],
    factMatches: [{ factId: 1, grade: "MAYBE" }],
    revealedSupplementSurfaces: [],
  })), null);
  assert.equal(parseAiHostResponse(JSON.stringify({
    answer: "是",
    evidenceFactIds: [1],
    factMatches: [{ factId: 1, grade: "DIRECT" }],
    revealedSupplementSurfaces: [-1],
  })), null);
  assert.equal(parseAiHostResponse(JSON.stringify({
    answer: "是",
    evidenceFactIds: [],
    factMatches: [],
    revealedSupplementSurfaces: [],
    progress: 10,
  }))?.answer, "是");
});

test("协议拒绝日志只返回安全分类，不记录模型原文", () => {
  assert.deepEqual(inspectAiHostResponse(""), {
    response: null,
    coreAnswer: null,
    rejection: "empty",
    normalizations: [],
  });
  assert.equal(inspectAiHostResponse('{"answer":"是"}').rejection, "missing_fields");
  assert.equal(inspectAiHostResponse('{"answer":"是"}').coreAnswer, "是");
  assert.equal(inspectAiHostResponse('{"answer":"可能"}').rejection, "invalid_answer");
  assert.equal(inspectAiHostResponse("不是 JSON").rejection, "non_json");
  assert.deepEqual(inspectAiHostResponse(JSON.stringify({
    answer: "是",
    evidenceFactIds: [],
    factMatches: [],
    revealedSupplementSurfaces: [],
    progress: 10,
  })).normalizations, ["extra_fields_dropped"]);
});
