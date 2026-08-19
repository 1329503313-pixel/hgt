export const onlineSoupAnswerValues = ["yes", "no", "both", "unknown", "irrelevant"] as const;

export type OnlineSoupAnswerValue = (typeof onlineSoupAnswerValues)[number];

const answerLabels: Record<OnlineSoupAnswerValue, string> = {
  yes: "是",
  no: "不是",
  both: "是也不是",
  unknown: "不知道",
  irrelevant: "不重要"
};

export function buildAnswerChangeNotice(
  previousAnswer: OnlineSoupAnswerValue | null,
  nextAnswer: OnlineSoupAnswerValue | null,
  questionNumber: number
) {
  if (!previousAnswer || !nextAnswer || previousAnswer === nextAnswer) return null;
  return `主持人变更了#${questionNumber}的回答为：${answerLabels[nextAnswer]}`;
}

export function buildBestQuestionChangeNotice(
  previousMessageId: string | null,
  nextMessageId: string | null,
  nextQuestionNumber: number | null
) {
  if (!previousMessageId || !nextMessageId || previousMessageId === nextMessageId || nextQuestionNumber == null) return null;
  return `主持人变更了最佳提问为：#${nextQuestionNumber}`;
}
