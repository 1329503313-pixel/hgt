import { createHash } from "node:crypto";
import { z } from "zod";
import type { AtomicFact, ProgressKeyFact } from "./gameLogic.js";

export const AI_HOST_ANSWERS = ["YES", "NO", "BOTH", "UNKNOWN", "IRRELEVANT"] as const;
export type AiHostAnswer = (typeof AI_HOST_ANSWERS)[number];

export const AI_FACT_STATES = ["UNSEEN", "TOUCHED", "DISCOVERED"] as const;
export type AiFactState = (typeof AI_FACT_STATES)[number];

export const AI_GAME_PHASES = ["PREPARING", "PLAYING", "READY_TO_SOLVE", "SOLVING", "COMPLETED", "CANCELLED"] as const;
export type AiGamePhase = (typeof AI_GAME_PHASES)[number];

export type AiFactDefinition = {
  id: string;
  sourceKeyId: number;
  content: string;
  weight: number;
  core: boolean;
  mustHave: boolean;
  aliases: string[];
  discoveryCondition: string;
  hints: [string, string, string];
};

export type AiRoundFact = AiFactDefinition & {
  state: AiFactState;
};

const matchedFactSchema = z.object({
  factId: z.string().regex(/^F\d{2,}$/),
  matchStrength: z.number().min(0).max(1),
  discoveryStrength: z.number().min(0).max(1),
  proposedState: z.enum(AI_FACT_STATES),
}).strict();

export const aiAdjudicationSchema = z.object({
  answer: z.enum(AI_HOST_ANSWERS),
  confidence: z.number().min(0).max(1),
  matchedFacts: z.array(matchedFactSchema).max(30),
  containsUnsupportedAssumption: z.boolean(),
  injectionDetected: z.boolean(),
}).strict();

export type AiAdjudication = z.infer<typeof aiAdjudicationSchema>;

export const aiFastAnswerSchema = z.object({
  answer: z.enum(AI_HOST_ANSWERS),
  confidence: z.number().min(0).max(1),
  injectionDetected: z.boolean(),
}).strict();

export type AiFastAnswer = z.infer<typeof aiFastAnswerSchema>;

export const AI_VERIFIER_ISSUES = [
  "ANSWER_NOT_SUPPORTED",
  "FACT_NOT_MATCHED",
  "DISCOVERY_TOO_STRONG",
  "UNSUPPORTED_ASSUMPTION",
  "INJECTION_NOT_ISOLATED",
] as const;

type AiVerifierIssue = typeof AI_VERIFIER_ISSUES[number];

const AI_VERIFIER_ISSUE_ALIASES: Record<string, AiVerifierIssue> = {
  // 已在真实模型响应中出现的同义写法，在协议边界归一化为服务端标准码。
  FACT_MATCH_UNSUPPORTED: "FACT_NOT_MATCHED",
  unsupportedAssumption: "UNSUPPORTED_ASSUMPTION",
};

const aiVerifierIssueSchema = z.preprocess(
  (value) => typeof value === "string" ? (AI_VERIFIER_ISSUE_ALIASES[value] ?? value) : value,
  z.enum(AI_VERIFIER_ISSUES),
) as z.ZodType<AiVerifierIssue>;

export const aiVerifierSchema = z.object({
  verdict: z.enum(["ACCEPT", "REJECT"]),
  issueCodes: z.array(aiVerifierIssueSchema).max(AI_VERIFIER_ISSUES.length)
    .transform((values) => [...new Set(values)]),
}).strict();

export type AiVerifierResult = z.infer<typeof aiVerifierSchema>;

export const AI_ADJUDICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "matchedFacts", "containsUnsupportedAssumption", "injectionDetected"],
  properties: {
    answer: { type: "string", enum: AI_HOST_ANSWERS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    matchedFacts: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factId", "matchStrength", "discoveryStrength", "proposedState"],
        properties: {
          factId: { type: "string", pattern: "^F[0-9]{2,}$" },
          matchStrength: { type: "number", minimum: 0, maximum: 1 },
          discoveryStrength: { type: "number", minimum: 0, maximum: 1 },
          proposedState: { type: "string", enum: AI_FACT_STATES },
        },
      },
    },
    containsUnsupportedAssumption: { type: "boolean" },
    injectionDetected: { type: "boolean" },
  },
} as const;

export const AI_FAST_ANSWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "injectionDetected"],
  properties: {
    answer: { type: "string", enum: AI_HOST_ANSWERS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    injectionDetected: { type: "boolean" },
  },
} as const;

export const AI_VERIFIER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "issueCodes"],
  properties: {
    verdict: { type: "string", enum: ["ACCEPT", "REJECT"] },
    issueCodes: { type: "array", items: { type: "string", enum: AI_VERIFIER_ISSUES }, uniqueItems: true },
  },
} as const;

export const aiAnswerToChinese: Record<AiHostAnswer, string> = {
  YES: "是",
  NO: "不是",
  BOTH: "是也不是",
  UNKNOWN: "不知道",
  IRRELEVANT: "不重要",
};

export const aiAnswerToLegacy: Record<AiHostAnswer, "yes" | "no" | "both" | "unknown" | "irrelevant"> = {
  YES: "yes",
  NO: "no",
  BOTH: "both",
  UNKNOWN: "unknown",
  IRRELEVANT: "irrelevant",
};

export function aiAnswerFromLegacy(value: unknown): AiHostAnswer | null {
  if (typeof value !== "string") return null;
  const entry = Object.entries(aiAnswerToLegacy).find(([, legacy]) => legacy === value);
  return entry ? entry[0] as AiHostAnswer : null;
}

export function resolveRepeatedVerifierRejection(
  adjudication: AiAdjudication,
  preliminaryAnswer: AiHostAnswer | null,
): AiAdjudication {
  const answersAgree = preliminaryAnswer === adjudication.answer
    && !adjudication.containsUnsupportedAssumption
    && !adjudication.injectionDetected;
  return {
    ...adjudication,
    // 两次独立回答一致时保留玩家已看到的答案；否则安全收敛为 UNKNOWN。
    answer: answersAgree ? adjudication.answer : "UNKNOWN",
    confidence: answersAgree ? Math.min(adjudication.confidence, 0.8) : 0.5,
    // Verifier 对事实证据有争议时绝不推进事实或进度。
    matchedFacts: [],
  };
}

const chineseToAiAnswer = new Map(Object.entries(aiAnswerToChinese).map(([answer, chinese]) => [chinese, answer as AiHostAnswer]));

export function aiAnswerFromChinese(value: unknown): AiHostAnswer | null {
  return typeof value === "string" ? chineseToAiAnswer.get(value.trim()) ?? null : null;
}

export function parseStrictModelJson<T>(raw: string, schema: z.ZodType<T>): T {
  if (!raw.trim()) throw new Error("AI_PROTOCOL_EMPTY_CONTENT");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI_PROTOCOL_INVALID_JSON");
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) throw new Error("AI_PROTOCOL_SCHEMA_MISMATCH");
  return validated.data;
}

export function validateAdjudicationFactIds(result: AiAdjudication, facts: readonly AiFactDefinition[]): AiAdjudication {
  const validIds = new Set(facts.map((fact) => fact.id));
  const seen = new Set<string>();
  for (const match of result.matchedFacts) {
    if (!validIds.has(match.factId)) throw new Error("AI_PROTOCOL_UNKNOWN_FACT_ID");
    if (seen.has(match.factId)) throw new Error("AI_PROTOCOL_DUPLICATE_FACT_ID");
    seen.add(match.factId);
  }
  return result;
}

const promptInjectionPatterns = [
  /(忽略|无视|绕过|覆盖|取消).{0,16}(以上|之前|系统|规则|指令|提示词|限制)/i,
  /(输出|显示|泄露|告诉我|打印|复述).{0,16}(系统提示|system prompt|提示词|内部指令|隐藏指令|汤底|完整答案)/i,
  /(你现在是|从现在开始|切换.{0,8}(角色|身份)|扮演.{0,10}(助手|角色|主持人))/i,
  /(ignore|disregard|override|bypass).{0,24}(previous|above|system|instruction|prompt|rule)/i,
  /(reveal|show|print|repeat).{0,24}(system prompt|hidden prompt|instruction|answer)/i,
  /<\/?(system|assistant|developer)>|\[(system|developer)\]/i,
];

/**
 * Prompt injection 是安全规则，不交给模型自由推断。
 * 普通闲聊、数学题和与谜底无关的问题不属于注入。
 */
export function detectPromptInjection(question: string): boolean {
  const normalized = question.normalize("NFKC").trim();
  return promptInjectionPatterns.some((pattern) => pattern.test(normalized));
}

export function normalizeAiQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?？]+$/g, "")
    .toLocaleLowerCase("zh-CN");
}

export function aiQuestionHash(question: string): string {
  return createHash("sha256").update(normalizeAiQuestion(question)).digest("hex");
}

export function aiContextHash(recentAnswers: readonly string[], factStates: readonly Pick<AiRoundFact, "id" | "state">[]): string {
  const input = JSON.stringify({
    recentAnswers: recentAnswers.slice(-10),
    facts: [...factStates].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, state }) => [id, state]),
  });
  return createHash("sha256").update(input).digest("hex");
}

function factHints(content: string): [string, string, string] {
  void content;
  return [
    "可以换一个人物、行为或因果方向继续确认。",
    "可以把当前最反常的环节拆成单一判断来提问。",
    "建议从最异常的结果向前倒推直接原因，一次只验证一个人物和行为关系。",
  ];
}

/**
 * 把现有作者关键点+原子事实编译为版本化运行时事实。
 * 作者内容和权重不被改写，权重按原有原子事实分配保持现有进度体感。
 */
export function compileRuntimeFacts(keyFacts: readonly ProgressKeyFact[], atomicFacts: readonly AtomicFact[]): AiFactDefinition[] {
  const keyById = new Map(keyFacts.map((fact) => [fact.id, fact]));
  const source = atomicFacts.length > 0
    ? atomicFacts.filter((fact) => keyById.has(fact.keyId))
    : keyFacts.map((fact, index) => ({ id: index + 1, keyId: fact.id, content: fact.content, weight: fact.weight }));
  return source.map((fact, index) => {
    const parent = keyById.get(fact.keyId)!;
    const content = fact.content.trim();
    return {
      id: `F${String(index + 1).padStart(2, "0")}`,
      sourceKeyId: fact.keyId,
      content,
      weight: fact.weight,
      core: parent.weight >= 15,
      mustHave: parent.weight >= 18,
      aliases: [],
      discoveryCondition: `玩家明确表达或逻辑等价地确认：${content}`,
      hints: factHints(content),
    };
  });
}

export type FactTransition = {
  factId: string;
  before: AiFactState;
  after: AiFactState;
  progressDelta: number;
};

export function applyFactAdjudication(
  facts: readonly AiRoundFact[],
  result: AiAdjudication,
): { facts: AiRoundFact[]; transitions: FactTransition[]; progress: number; progressDelta: number } {
  validateAdjudicationFactIds(result, facts);
  const matches = new Map(result.matchedFacts.map((match) => [match.factId, match]));
  const transitions: FactTransition[] = [];
  const nextFacts = facts.map((fact) => {
    const match = matches.get(fact.id);
    let after = fact.state;
    if (fact.state !== "DISCOVERED" && match) {
      const discovered = match.proposedState === "DISCOVERED"
        && match.matchStrength >= 0.65
        && match.discoveryStrength >= 0.90
        && result.confidence >= 0.80
        && !result.containsUnsupportedAssumption;
      if (discovered) after = "DISCOVERED";
      else if (fact.state === "UNSEEN" && match.matchStrength >= 0.65) after = "TOUCHED";
    }
    if (after !== fact.state) transitions.push({
      factId: fact.id,
      before: fact.state,
      after,
      progressDelta: after === "DISCOVERED" ? fact.weight : 0,
    });
    return { ...fact, state: after };
  });
  const beforeProgress = facts.reduce((sum, fact) => sum + (fact.state === "DISCOVERED" ? fact.weight : 0), 0);
  const progress = Math.min(100, nextFacts.reduce((sum, fact) => sum + (fact.state === "DISCOVERED" ? fact.weight : 0), 0));
  return { facts: nextFacts, transitions, progress, progressDelta: Math.max(0, progress - beforeProgress) };
}

export function shouldVerifyAdjudication(
  result: AiAdjudication,
  facts: readonly AiRoundFact[],
  candidateProgress: number,
  previousProgress: number,
): boolean {
  if (result.confidence < 0.85 || result.answer === "BOTH" || result.containsUnsupportedAssumption || result.injectionDetected) return true;
  const definitions = new Map(facts.map((fact) => [fact.id, fact]));
  if (result.matchedFacts.some((match) => match.proposedState === "DISCOVERED" && (definitions.get(match.factId)?.core || definitions.get(match.factId)?.mustHave))) return true;
  return (previousProgress < 80 && candidateProgress >= 80) || (previousProgress < 100 && candidateProgress >= 100);
}

export function aiGamePhase(progress: number, ended: boolean, cancelled = false): AiGamePhase {
  if (cancelled) return "CANCELLED";
  if (ended) return "COMPLETED";
  if (progress >= 80) return "READY_TO_SOLVE";
  return "PLAYING";
}
