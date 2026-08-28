export const ONLINE_SOUP_QUESTION_LIMIT_MAX = 4_294_967_295;

export type OnlineSoupQuestionLimitState = {
  limit: number | null;
  used: number;
  remaining: number | null;
  resolutionRequired: boolean;
};

export function onlineSoupQuestionLimitState(
  rawLimit: unknown,
  rawUsed: unknown,
  rawUnanswered: unknown
): OnlineSoupQuestionLimitState {
  const parsedLimit = Number(rawLimit);
  const limit = rawLimit == null || !Number.isInteger(parsedLimit) || parsedLimit <= 0
    ? null
    : Math.min(parsedLimit, ONLINE_SOUP_QUESTION_LIMIT_MAX);
  const used = Math.max(0, Math.floor(Number(rawUsed) || 0));
  const unanswered = Math.max(0, Math.floor(Number(rawUnanswered) || 0));
  const remaining = limit == null ? null : Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    resolutionRequired: limit != null && used >= limit && unanswered === 0
  };
}
