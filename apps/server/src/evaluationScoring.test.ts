import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluationCountsTowardScore,
  MIN_SCORING_EXPERIENCE,
  MIN_SCORING_LEVEL,
  scoringEvaluationJoin
} from "./evaluationScoring.js";

test("上传者评价始终不计入作品评分", () => {
  assert.equal(evaluationCountsTowardScore("creator", "creator", 100_000_000), false);
});

test("其他用户只有达到 3 级才计入作品评分", () => {
  assert.equal(MIN_SCORING_LEVEL, 3);
  assert.equal(MIN_SCORING_EXPERIENCE, 250);
  assert.equal(evaluationCountsTowardScore("reviewer", "creator", 249), false);
  assert.equal(evaluationCountsTowardScore("reviewer", "creator", 250), true);
});

test("评分聚合 SQL 同时排除上传者和低等级用户", () => {
  const sql = scoringEvaluationJoin("e", "s");
  assert.match(sql, /e\.reviewer_id <> s\.creator_id/);
  assert.match(sql, /scoring_reviewer\.experience >= 250/);
});
