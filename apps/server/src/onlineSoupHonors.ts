export type OnlineSoupHonorQuestion = {
  id: string;
  sequence: string | number | bigint;
  questionNumber: number;
  senderId: string;
  senderNickname: string;
  senderAvatar: string | null;
  content: string;
  answer: string;
  progressDelta: number;
};

export type OnlineSoupAiHonors = {
  version: 1;
  mvp: {
    userId: string;
    nickname: string;
    avatar: string | null;
    progressContribution: number;
  };
  bestQuestion: {
    messageId: string;
    questionNumber: number;
    userId: string;
    nickname: string;
    avatar: string | null;
    question: string;
    answer: string;
    progressDelta: number;
  };
};

export type OnlineSoupHumanHonorSelection = {
  mvpUserId: string;
  bestQuestionMessageId: string;
};

const honorAnswerValues = new Set(["yes", "no", "both", "unknown", "irrelevant"]);

function sequenceValue(value: string | number | bigint) {
  try { return BigInt(value); }
  catch { return 0n; }
}

/**
 * MVP 按用户有效提问的累计进度增量评选；最佳提问按单题进度增量评选。
 * 平分时优先更早取得有效进度者，最后用稳定 ID 消除结果漂移。
 */
export function selectOnlineSoupAiHonors(questions: readonly OnlineSoupHonorQuestion[]): OnlineSoupAiHonors | null {
  const eligible = questions
    .filter((question) => question.senderId && question.progressDelta > 0 && question.answer)
    .sort((left, right) => {
      const leftSequence = sequenceValue(left.sequence);
      const rightSequence = sequenceValue(right.sequence);
      return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : left.id.localeCompare(right.id);
    });
  if (eligible.length === 0) return null;

  const bestQuestion = [...eligible].sort((left, right) =>
    right.progressDelta - left.progressDelta
    || (sequenceValue(left.sequence) < sequenceValue(right.sequence) ? -1 : sequenceValue(left.sequence) > sequenceValue(right.sequence) ? 1 : 0)
    || left.id.localeCompare(right.id)
  )[0];
  const contributors = new Map<string, {
    userId: string;
    nickname: string;
    avatar: string | null;
    progressContribution: number;
    firstSequence: bigint;
  }>();
  for (const question of eligible) {
    const existing = contributors.get(question.senderId);
    if (existing) {
      existing.progressContribution += question.progressDelta;
      continue;
    }
    contributors.set(question.senderId, {
      userId: question.senderId,
      nickname: question.senderNickname,
      avatar: question.senderAvatar,
      progressContribution: question.progressDelta,
      firstSequence: sequenceValue(question.sequence),
    });
  }
  const mvp = [...contributors.values()].sort((left, right) =>
    right.progressContribution - left.progressContribution
    || (left.firstSequence < right.firstSequence ? -1 : left.firstSequence > right.firstSequence ? 1 : 0)
    || left.userId.localeCompare(right.userId)
  )[0];

  return {
    version: 1,
    mvp: {
      userId: mvp.userId,
      nickname: mvp.nickname,
      avatar: mvp.avatar,
      progressContribution: mvp.progressContribution,
    },
    bestQuestion: {
      messageId: bestQuestion.id,
      questionNumber: bestQuestion.questionNumber,
      userId: bestQuestion.senderId,
      nickname: bestQuestion.senderNickname,
      avatar: bestQuestion.senderAvatar,
      question: bestQuestion.content,
      answer: bestQuestion.answer,
      progressDelta: bestQuestion.progressDelta,
    },
  };
}

/**
 * 真人主持由房主人工选择本场 MVP 与最佳提问。MVP 只要求本轮至少提问一次；
 * 最佳提问必须已有真人主持的五态回答，确保荣誉卡能完整复用 AI 结算样式。
 */
export function selectOnlineSoupHumanHonors(
  questions: readonly OnlineSoupHonorQuestion[],
  selection: OnlineSoupHumanHonorSelection,
): OnlineSoupAiHonors | null {
  const askedQuestions = questions
    .filter((question) => question.senderId && question.content)
    .sort((left, right) => {
      const leftSequence = sequenceValue(left.sequence);
      const rightSequence = sequenceValue(right.sequence);
      return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : left.id.localeCompare(right.id);
    });
  const mvpQuestion = askedQuestions.find((question) => question.senderId === selection.mvpUserId);
  const bestQuestion = askedQuestions.find((question) =>
    question.id === selection.bestQuestionMessageId && honorAnswerValues.has(question.answer)
  );
  if (!mvpQuestion || !bestQuestion) return null;

  return {
    version: 1,
    mvp: {
      userId: mvpQuestion.senderId,
      nickname: mvpQuestion.senderNickname,
      avatar: mvpQuestion.senderAvatar,
      progressContribution: 0,
    },
    bestQuestion: {
      messageId: bestQuestion.id,
      questionNumber: bestQuestion.questionNumber,
      userId: bestQuestion.senderId,
      nickname: bestQuestion.senderNickname,
      avatar: bestQuestion.senderAvatar,
      question: bestQuestion.content,
      answer: bestQuestion.answer,
      progressDelta: 0,
    },
  };
}

export function parseOnlineSoupAiHonors(value: unknown): OnlineSoupAiHonors | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<OnlineSoupAiHonors>;
    if (candidate.version !== 1 || !candidate.mvp || !candidate.bestQuestion) return null;
    if (!candidate.mvp.userId || !candidate.mvp.nickname) return null;
    if (!candidate.bestQuestion.messageId || !candidate.bestQuestion.userId || !candidate.bestQuestion.nickname) return null;
    if (!candidate.bestQuestion.question || !candidate.bestQuestion.answer) return null;
    return candidate as OnlineSoupAiHonors;
  } catch {
    return null;
  }
}
