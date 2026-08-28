export const NORMAL_GAME_ANSWERS = ["是也不是", "不重要", "不知道", "不是", "是"] as const;

export type PublicGameMessage = {
  role: "assistant" | "user";
  content: string;
};

export const HINT_DIMENSIONS = [
  "人物关系",
  "行为目的",
  "动机",
  "手法",
  "关键物品",
  "时间",
  "地点",
  "因果关系",
] as const;

export type HintDimension = (typeof HINT_DIMENSIONS)[number];

export type ProgressKeyFact = {
  id: number;
  content: string;
  weight: number;
  hintContent?: string;
};

export function selectNextHintKeyFact(
  keyFacts: readonly ProgressKeyFact[],
  revealedKeyIds: readonly number[],
  hintedKeyIds: readonly number[],
): { keyFact: ProgressKeyFact & { hintContent: string }; hintedKeyIds: number[] } | null {
  const revealed = new Set(revealedKeyIds);
  const candidates = [...keyFacts]
    .filter((fact): fact is ProgressKeyFact & { hintContent: string } => (
      !revealed.has(fact.id) && typeof fact.hintContent === "string" && Boolean(fact.hintContent.trim())
    ))
    .sort((a, b) => a.id - b.id);
  if (candidates.length === 0) return null;

  const candidateIds = new Set(candidates.map((fact) => fact.id));
  const usedInCycle = [...new Set(hintedKeyIds.filter((id) => candidateIds.has(id)))];
  const next = candidates.find((fact) => !usedInCycle.includes(fact.id));
  if (next) return { keyFact: next, hintedKeyIds: [...usedInCycle, next.id] };

  const restarted = candidates[0];
  return { keyFact: restarted, hintedKeyIds: [restarted.id] };
}

export type AtomicFact = {
  id: number;
  keyId: number;
  content: string;
  weight: number;
};

export const FACT_MATCH_GRADES = ["DIRECT", "STRONG", "WEAK", "NONE"] as const;
export type FactMatchGrade = (typeof FACT_MATCH_GRADES)[number];

export type FactMatch = {
  factId: number;
  grade: FactMatchGrade;
};

export type AiGameSessionStatus = "active" | "completed";

export const ROOM_AI_QUESTION_RISKS = [
  "long",
  "multiple_claims",
  "negation",
  "ambiguous_reference",
] as const;

export type RoomAiQuestionRisk = (typeof ROOM_AI_QUESTION_RISKS)[number];

function normalizedFactText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

/**
 * 原子事实只作为服务端内部判定依据。作者配置的关键点仍是进度分组，
 * 每组权重由服务端确定性地分摊给该组原子事实，避免模型自行决定进度。
 */
export function normalizeAtomicFacts(value: unknown, keyFacts: ProgressKeyFact[]): AtomicFact[] {
  const rawFacts = Array.isArray(value) ? value : [];
  const factsByKey = new Map<number, string[]>();

  for (const keyFact of keyFacts) {
    const seen = new Set<string>();
    const maxAtoms = Math.max(1, Math.min(5, Math.floor(keyFact.weight)));
    const candidates: string[] = [];
    for (const raw of rawFacts) {
      if (Number(raw?.keyId ?? raw?.parentKeyId) !== keyFact.id) continue;
      const content = typeof raw?.content === "string" ? raw.content.trim().slice(0, 240) : "";
      const normalized = normalizedFactText(content);
      if (!content || seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push(content);
      if (candidates.length >= maxAtoms) break;
    }
    factsByKey.set(keyFact.id, candidates.length > 0 ? candidates : [keyFact.content]);
  }

  let nextId = 1;
  return keyFacts.flatMap((keyFact) => {
    const contents = factsByKey.get(keyFact.id) ?? [keyFact.content];
    const baseWeight = Math.floor(keyFact.weight / contents.length);
    const remainder = keyFact.weight - baseWeight * contents.length;
    return contents.map((content, index) => ({
      id: nextId++,
      keyId: keyFact.id,
      content,
      weight: baseWeight + (index < remainder ? 1 : 0),
    }));
  });
}

export function calculateAtomicProgress(revealedFactIds: unknown, atomicFacts: AtomicFact[]): number {
  const revealed = new Set(
    Array.isArray(revealedFactIds)
      ? revealedFactIds.map(Number).filter(Number.isInteger)
      : [],
  );
  return Math.round(Math.min(100, atomicFacts.reduce(
    (sum, fact) => sum + (revealed.has(fact.id) ? fact.weight : 0),
    0,
  )));
}

export function completedProgressKeyIds(revealedFactIds: unknown, atomicFacts: AtomicFact[]): number[] {
  const revealed = new Set(
    Array.isArray(revealedFactIds)
      ? revealedFactIds.map(Number).filter(Number.isInteger)
      : [],
  );
  const grouped = new Map<number, number[]>();
  for (const fact of atomicFacts) {
    const ids = grouped.get(fact.keyId) ?? [];
    ids.push(fact.id);
    grouped.set(fact.keyId, ids);
  }
  return [...grouped.entries()]
    .filter(([, ids]) => ids.length > 0 && ids.every((id) => revealed.has(id)))
    .map(([keyId]) => keyId)
    .sort((a, b) => a - b);
}

export function normalizeFactMatches(value: unknown, validFactIds: Iterable<number>): FactMatch[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(validFactIds);
  const strength: Record<FactMatchGrade, number> = { NONE: 0, WEAK: 1, STRONG: 2, DIRECT: 3 };
  const matches = new Map<number, FactMatchGrade>();

  for (const candidate of value) {
    const factId = Number(candidate?.factId ?? candidate?.id);
    const grade = typeof candidate?.grade === "string" ? candidate.grade.toUpperCase() as FactMatchGrade : null;
    if (!Number.isInteger(factId) || !valid.has(factId) || !grade || !FACT_MATCH_GRADES.includes(grade)) continue;
    const previous = matches.get(factId);
    if (!previous || strength[grade] > strength[previous]) matches.set(factId, grade);
  }

  return [...matches.entries()]
    .map(([factId, grade]) => ({ factId, grade }))
    .sort((a, b) => a.factId - b.factId);
}

export function gameSessionStatus(progress: number, completed: boolean): AiGameSessionStatus {
  if (completed || progress >= 100) return "completed";
  return "active";
}

/**
 * 普通问答只允许五种主持人结论。通关回复可携带完整故事，但是否真的
 * 通关仍由服务端进度门槛决定。
 */
export function normalizeOrdinaryGameAnswer(value: unknown, completed: boolean): string | null {
  if (typeof value !== "string") return null;
  const answer = value.trim();
  if (!answer) return null;
  if (completed) return answer.slice(0, 8_000);

  for (const allowed of NORMAL_GAME_ANSWERS) {
    if (answer === allowed || answer.startsWith(allowed)) return allowed;
  }
  return null;
}

/**
 * 存档中的 assistant 消息可能包含服务端内部进度字段。对外只暴露 answer，
 * 避免旧存档里的完整 keyFacts 被浏览器网络响应读取。
 */
export function toPublicGameMessages(messages: unknown): PublicGameMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages.flatMap<PublicGameMessage>((message: any): PublicGameMessage[] => {
    if (message?.role !== "assistant" && message?.role !== "user") return [];
    if (typeof message.content !== "string") return [];
    if (message.role === "user") return [{ role: "user" as const, content: message.content }];

    try {
      const parsed = JSON.parse(message.content) as { answer?: unknown };
      if (typeof parsed.answer === "string" && parsed.answer.trim()) {
        return [{ role: "assistant" as const, content: parsed.answer.trim() }];
      }
      return [{ role: "assistant" as const, content: "AI 主持人消息格式异常" }];
    } catch {
      return [{ role: "assistant" as const, content: message.content }];
    }
  });
}

export function normalizeHintDimension(value: unknown): HintDimension | null {
  return HINT_DIMENSIONS.includes(value as HintDimension) ? value as HintDimension : null;
}

export function renderSafeHint(dimension: HintDimension): string {
  const messages: Record<HintDimension, string> = {
    人物关系: "可以关注人物之间的关系，以及这种关系是否影响了他们的行为。",
    行为目的: "可以追问某个关键行为的目的，思考当事人为什么要这样做。",
    动机: "可以从人物的动机继续推理，关注促使事件发生的原因。",
    手法: "可以关注事件是如何发生的，尝试从实施方式提出更具体的问题。",
    关键物品: "可以确认是否存在影响真相的关键物品，但先不要限定具体物品。",
    时间: "可以关注事件发生的时间或先后顺序，看看时间条件是否重要。",
    地点: "可以关注事件发生的地点，以及地点特征是否影响了结果。",
    因果关系: "可以梳理已知事件之间的因果关系，追问哪一步导致了最终结果。",
  };
  return messages[dimension];
}

/**
 * 提示逐次变得更可操作，但正文始终由服务端模板生成，不接触汤底事实。
 */
export function renderProgressiveHint(dimension: HintDimension, requestCount: number): string {
  const level = Math.max(1, Math.min(3, Math.floor(requestCount)));
  if (level === 1) return renderSafeHint(dimension);

  const questionGuides: Record<HintDimension, string> = {
    人物关系: "可以具体确认关键人物在事件发生前是否认识，以及彼此是什么关系。",
    行为目的: "可以选一个最异常的行为，追问当事人这样做是否为了达成某个目的。",
    动机: "可以追问谁最希望事件发生，以及这种愿望是否构成了关键动机。",
    手法: "可以把结果拆成步骤，逐一确认事件是如何被实施或造成的。",
    关键物品: "可以确认是否有某件物品改变了事件结果，再追问它的用途或来源。",
    时间: "可以确认关键事件的先后顺序，以及某个时间条件是否决定了结果。",
    地点: "可以确认地点本身是否具有特殊条件，以及换个地点结果是否会不同。",
    因果关系: "可以从最终结果向前倒推，确认直接原因和更早发生的诱因。",
  };
  if (level === 2) return questionGuides[dimension];

  const narrowingGuides: Record<HintDimension, string> = {
    人物关系: "建议把人物两两组合提问，优先排查亲属、熟人、利益或身份关系。",
    行为目的: "建议先确认异常行为是在保护、隐瞒、误导还是求助，再继续缩小目的。",
    动机: "建议从利益、情感、恐惧和误解四类动机逐一排查，先确认哪一类重要。",
    手法: "建议依次确认是否涉及伪装、替代、时间差或环境条件，不要一次列举多个答案。",
    关键物品: "建议先确认关键物品是否由人物携带、现场原有或后来出现，再追问用途。",
    时间: "建议画出事件前、事件中、被发现后三段时间线，逐段确认异常发生在哪一段。",
    地点: "建议先确认地点是公开还是封闭、固定还是移动，再追问其特殊条件。",
    因果关系: "建议用“如果没有这一步，结局还会发生吗”逐步测试每个事件是否是必要原因。",
  };
  return narrowingGuides[dimension];
}

export function trimRoomAiHistory<T>(messages: T[], maxMessages = 24): T[] {
  if (!Array.isArray(messages) || maxMessages <= 0) return [];
  return messages.slice(-maxMessages);
}

/**
 * 房间 AI 每次都能从持久化事实状态取得累计进度，因此上下文只保留最近五轮。
 * assistant 历史中的内部计分 JSON 会被压缩成五态回答，减少输入 token，
 * 同时保留代词和承接问句所需的短期语境。
 */
export function compactRoomAiHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxMessages = 10,
): Array<{ role: "user" | "assistant"; content: string }> {
  const compacted: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of trimRoomAiHistory(messages, maxMessages)) {
    if (message.role === "user") {
      compacted.push({ role: "user", content: message.content.slice(0, 1_000) });
      continue;
    }
    try {
      const parsed = JSON.parse(message.content) as { answer?: unknown };
      const answer = normalizeOrdinaryGameAnswer(parsed.answer, false);
      if (answer) compacted.push({ role: "assistant", content: answer });
    } catch {
      const answer = normalizeOrdinaryGameAnswer(message.content, false);
      if (answer) compacted.push({ role: "assistant", content: answer });
    }
  }
  return compacted;
}

/**
 * 识别会影响计分反馈的表达风险，不尝试猜测问题语义或故事答案。
 * 所有正式提问都使用同一套完整最终判断流程。
 */
export function roomAiQuestionRisks(question: string): RoomAiQuestionRisk[] {
  const text = question.trim();
  const risks: RoomAiQuestionRisk[] = [];
  if (text.length > 80) risks.push("long");

  const questionMarks = (text.match(/[？?]/g) ?? []).length;
  const judgmentWords = (text.match(/(?:是否|是不是|有没有|会不会|能不能|难道)/g) ?? []).length;
  if (
    questionMarks > 1
    || judgmentWords > 1
    || /(?:以及|并且|同时|或者|还是).*(?:是否|是不是|有没有|会不会|能不能)/.test(text)
  ) risks.push("multiple_claims");

  if (/(?:不是|没有|并非|未曾|不可能|难道|莫非).*(?:吗|么|是否|是不是|没有|不)/.test(text)) {
    risks.push("negation");
  }

  if (/^(?:他|她|它|他们|她们|它们|这个人|那个人|这个东西|那个东西|这件事|那件事)/.test(text)) {
    risks.push("ambiguous_reference");
  }
  return risks;
}

export type RoomAiProgressFeedbackKind = "gain" | "duplicate" | "close" | "off_track" | "ambiguous";

export function roomAiProgressFeedback(
  progressDelta: number,
  scoreableFactCount: number,
  weakFactCount: number,
  risks: readonly RoomAiQuestionRisk[] = [],
): { kind: RoomAiProgressFeedbackKind; text: string } {
  if (progressDelta > 0) return { kind: "gain", text: `确认了新的关键信息，进度 +${progressDelta}%` };
  if (risks.includes("multiple_claims")) return { kind: "ambiguous", text: "本题包含多个判断，暂未形成唯一确认；拆成一个判断提问更容易推进" };
  if (risks.includes("ambiguous_reference")) return { kind: "ambiguous", text: "指代对象不够明确，暂未增加进度；说出人物或物品名称会更准确" };
  if (scoreableFactCount > 0) return { kind: "duplicate", text: "方向正确，但本题确认的是已知信息，进度保持不变" };
  if (weakFactCount > 0) return { kind: "close", text: "已经接近关键方向；把对象、行为或因果关系问得更具体会更容易推进" };
  return { kind: "off_track", text: "本题暂未触及新的关键信息，可以换一个人物、动机、物品或因果方向" };
}

/**
 * 判断是否刚好进入“连续多题无进展”状态。
 * progressDeltas 按时间倒序排列；只在达到门槛的那一题返回 true，避免后续重复发提示。
 */
export function shouldPublishRoomAiStallHint(
  progressDeltas: readonly number[],
  threshold = 10,
): boolean {
  if (!Number.isInteger(threshold) || threshold <= 0 || progressDeltas.length < threshold) return false;
  return progressDeltas.slice(0, threshold).every((delta) => Number(delta) === 0)
    && (progressDeltas.length === threshold || Number(progressDeltas[threshold]) > 0);
}

export function canRequestRoomAiHint(progress: number): boolean {
  return Number.isFinite(progress) && progress >= 20 && progress < 100;
}
