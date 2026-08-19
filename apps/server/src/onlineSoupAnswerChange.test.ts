import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerChangeNotice, buildBestQuestionChangeNotice } from "./onlineSoupAnswerChange.js";

test("首次回答、取消回答和相同回答不生成变更提醒", () => {
  assert.equal(buildAnswerChangeNotice(null, "yes", 6), null);
  assert.equal(buildAnswerChangeNotice("yes", null, 6), null);
  assert.equal(buildAnswerChangeNotice("yes", "yes", 6), null);
});

test("从一个已选答案直接改为另一个答案时生成可定位提醒", () => {
  assert.equal(
    buildAnswerChangeNotice("yes", "both", 6),
    "主持人变更了#6的回答为：是也不是"
  );
});

test("首次设置、取消和重复设置最佳提问不生成变更提醒", () => {
  assert.equal(buildBestQuestionChangeNotice(null, "question-6", 6), null);
  assert.equal(buildBestQuestionChangeNotice("question-6", null, null), null);
  assert.equal(buildBestQuestionChangeNotice("question-6", "question-6", 6), null);
});

test("从一条最佳提问直接换到另一条时生成可定位提醒", () => {
  assert.equal(
    buildBestQuestionChangeNotice("question-5", "question-6", 6),
    "主持人变更了最佳提问为：#6"
  );
});
