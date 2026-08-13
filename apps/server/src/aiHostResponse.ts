import { z } from "zod";

export const AI_HOST_ANSWERS = ["是", "不是", "是也不是", "不知道", "不重要"] as const;

const answerSchema = z.enum(AI_HOST_ANSWERS);

const fullResponseSchema = z.object({
  answer: answerSchema,
  evidenceFactIds: z.array(z.number().int().nonnegative()),
  factMatches: z.array(z.object({
    factId: z.number().int().nonnegative(),
    grade: z.enum(["DIRECT", "STRONG", "WEAK", "NONE"]),
  }).strict()),
  revealedSupplementSurfaces: z.array(z.number().int().nonnegative()),
}).strict();

export type AiHostResponse = z.infer<typeof fullResponseSchema>;

export const AI_HOST_RESPONSE_REJECTIONS = [
  "empty",
  "non_json",
  "not_object",
  "invalid_answer",
  "missing_fields",
  "invalid_evidence_fact_ids",
  "invalid_fact_matches",
  "invalid_revealed_supplements",
] as const;

export type AiHostResponseRejection = (typeof AI_HOST_RESPONSE_REJECTIONS)[number];
export type AiHostResponseNormalization =
  | "markdown_fence_removed"
  | "json_object_extracted"
  | "extra_fields_dropped"
  | "answer_token_extracted";

export type AiHostResponseParseResult = {
  response: AiHostResponse | null;
  coreAnswer: (typeof AI_HOST_ANSWERS)[number] | null;
  rejection: AiHostResponseRejection | null;
  normalizations: AiHostResponseNormalization[];
};

function parsedJsonValue(raw: string): {
  value: unknown;
  rejection: "empty" | "non_json" | null;
  normalizations: AiHostResponseNormalization[];
} {
  const normalizations: AiHostResponseNormalization[] = [];
  let candidate = raw.trim();
  if (!candidate) return { value: null, rejection: "empty", normalizations };

  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    candidate = fenced[1].trim();
    normalizations.push("markdown_fence_removed");
  }

  try {
    return { value: JSON.parse(candidate), rejection: null, normalizations };
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const value = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
        normalizations.push("json_object_extracted");
        return { value, rejection: null, normalizations };
      } catch {
        // 继续返回分类错误；不得猜测或拼接残缺 JSON。
      }
    }
    return { value: null, rejection: "non_json", normalizations };
  }
}

function rejectionForFullResponse(value: Record<string, unknown>): AiHostResponseRejection {
  if (!answerSchema.safeParse(value.answer).success) return "invalid_answer";
  const requiredFields = ["evidenceFactIds", "factMatches", "revealedSupplementSurfaces"] as const;
  if (requiredFields.some((field) => !(field in value))) return "missing_fields";
  if (!z.array(z.number().int().nonnegative()).safeParse(value.evidenceFactIds).success) {
    return "invalid_evidence_fact_ids";
  }
  if (!z.array(z.object({
    factId: z.number().int().nonnegative(),
    grade: z.enum(["DIRECT", "STRONG", "WEAK", "NONE"]),
  }).strict()).safeParse(value.factMatches).success) {
    return "invalid_fact_matches";
  }
  return "invalid_revealed_supplements";
}

function extractCoreAnswer(value: unknown): (typeof AI_HOST_ANSWERS)[number] | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  const exact = answerSchema.safeParse(candidate);
  if (exact.success) return exact.data;

  // 只接受以标点或空白明确分隔的首个五态词，避免把“是不是”等问题文本误判成“是”。
  for (const answer of AI_HOST_ANSWERS) {
    if (!candidate.startsWith(answer)) continue;
    const remainder = candidate.slice(answer.length);
    if (/^[\s，。；：、！？,.!?:;]/u.test(remainder)) return answer;
  }
  return null;
}

export function inspectAiHostResponse(raw: string): AiHostResponseParseResult {
  const decoded = parsedJsonValue(raw);
  if (decoded.rejection) {
    return { response: null, coreAnswer: null, rejection: decoded.rejection, normalizations: decoded.normalizations };
  }
  if (!decoded.value || typeof decoded.value !== "object" || Array.isArray(decoded.value)) {
    return { response: null, coreAnswer: null, rejection: "not_object", normalizations: decoded.normalizations };
  }

  const value = decoded.value as Record<string, unknown>;
  const parsedCoreAnswer = answerSchema.safeParse(value.answer);
  const coreAnswer = parsedCoreAnswer.success ? parsedCoreAnswer.data : extractCoreAnswer(value.answer);
  const allowedFields = new Set(["answer", "evidenceFactIds", "factMatches", "revealedSupplementSurfaces"]);
  const normalizations = [...decoded.normalizations];
  if (!parsedCoreAnswer.success && coreAnswer) normalizations.push("answer_token_extracted");
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    normalizations.push("extra_fields_dropped");
  }

  const projected = {
    answer: value.answer,
    evidenceFactIds: value.evidenceFactIds,
    factMatches: value.factMatches,
    revealedSupplementSurfaces: value.revealedSupplementSurfaces,
  };
  const result = fullResponseSchema.safeParse(projected);
  return result.success
    ? { response: result.data, coreAnswer: result.data.answer, rejection: null, normalizations }
    : { response: null, coreAnswer, rejection: rejectionForFullResponse(value), normalizations };
}

export function parseAiHostResponse(raw: string): AiHostResponse | null {
  return inspectAiHostResponse(raw).response;
}
