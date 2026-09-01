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

export function remainingQuestionCountAfterAcceptedQuestion(rawLimit: unknown, rawUsedBefore: unknown) {
  const usedBefore = Math.max(0, Math.floor(Number(rawUsedBefore) || 0));
  return onlineSoupQuestionLimitState(rawLimit, usedBefore + 1, 0).remaining;
}

export function onlineSoupQuestionLimitStartNotice(rawLimit: unknown) {
  const limit = onlineSoupQuestionLimitState(rawLimit, 0, 0).limit;
  return limit === null ? "游戏开始，本局游戏不限次数" : `游戏开始，本局游戏限${limit}次`;
}
