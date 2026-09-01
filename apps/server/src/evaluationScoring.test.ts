import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluationCountsTowardScore,
  MIN_SCORING_EXPERIENCE,
  MIN_SCORING_LEVEL,
  scoringEvaluationJoin,
  scoringSoupHeatExpression
} from "./evaluationScoring.js";

test("上传者评价始终不计入作品评分", () => {
  assert.equal(evaluationCountsTowardScore("creator", "creator", 1_500_000), false);
});

test("其他用户只有达到 5 级才计入作品评分", () => {
  assert.equal(MIN_SCORING_LEVEL, 5);
  assert.equal(MIN_SCORING_EXPERIENCE, 350);
  assert.equal(evaluationCountsTowardScore("reviewer", "creator", 349), false);
  assert.equal(evaluationCountsTowardScore("reviewer", "creator", 350), true);
});

test("评分聚合 SQL 同时排除上传者和低等级用户", () => {
  const sql = scoringEvaluationJoin("e", "s");
  assert.match(sql, /e\.reviewer_id <> s\.creator_id/);
  assert.match(sql, /scoring_reviewer\.experience >= 350/);
});

test("热力值排序与列表展示复用相同的有效评分口径", () => {
  const expression = scoringSoupHeatExpression("s");
  assert.match(expression, /heat_score_eval\.reviewer_id <> s\.creator_id/);
  assert.match(expression, /heat_count_eval\.reviewer_id <> s\.creator_id/);
  assert.equal((expression.match(new RegExp(`experience >= ${MIN_SCORING_EXPERIENCE}`, "g")) ?? []).length, 2);
});
