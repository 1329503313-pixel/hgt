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
};

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

export type AiGameSessionStatus = "active" | "awaiting_retell" | "completed";

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
  if (progress >= 90) return "awaiting_retell";
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
