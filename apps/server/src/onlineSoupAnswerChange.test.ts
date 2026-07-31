import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerChangeNotice } from "./onlineSoupAnswerChange.js";

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
