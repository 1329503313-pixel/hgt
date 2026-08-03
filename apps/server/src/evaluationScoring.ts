import { LEVEL_THRESHOLDS, levelForExperience } from "./levelSystem.js";

export const MIN_SCORING_LEVEL = 3;
export const MIN_SCORING_EXPERIENCE = LEVEL_THRESHOLDS[MIN_SCORING_LEVEL];

function sqlAlias(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("INVALID_SQL_ALIAS");
  return value;
}

export function evaluationCountsTowardScore(
  reviewerId: unknown,
  creatorId: unknown,
  reviewerExperience: unknown
) {
  return String(reviewerId) !== String(creatorId)
    && levelForExperience(reviewerExperience) >= MIN_SCORING_LEVEL;
}

export function scoringEvaluationPredicate(evaluationAlias: string, soupAlias: string) {
  const evaluation = sqlAlias(evaluationAlias);
  const soup = sqlAlias(soupAlias);
  return `${evaluation}.reviewer_id <> ${soup}.creator_id
    AND EXISTS (
      SELECT 1 FROM users scoring_reviewer
      WHERE scoring_reviewer.id = ${evaluation}.reviewer_id
        AND scoring_reviewer.experience >= ${MIN_SCORING_EXPERIENCE}
    )`;
}

export function scoringEvaluationJoin(evaluationAlias: string, soupAlias: string) {
  const evaluation = sqlAlias(evaluationAlias);
  const soup = sqlAlias(soupAlias);
  return `LEFT JOIN evaluations ${evaluation} ON ${evaluation}.soup_id = ${soup}.id
    AND ${scoringEvaluationPredicate(evaluation, soup)}`;
}
