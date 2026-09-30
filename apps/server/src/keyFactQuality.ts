export const AI_KEY_FACT_GENERATION_VERSION = "v4-independent-deductions";
export const AI_KEY_FACT_MIN_COUNT = 1;
export const AI_KEY_FACT_MAX_COUNT = 15;

export type KeyFactQualityIssue = {
  code: "COUNT_OUT_OF_RANGE" | "PUBLIC_FACT" | "DUPLICATE_FACT" | "INVALID_WEIGHTS" | "MISSING_HINT" | "REVIEW_REJECTED";
  factId?: number;
  reason: string;
};

export type KeyFactReviewResult = {
  approved: boolean;
  issues: KeyFactQualityIssue[];
};

function normalizeFactText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Returns true only when the whole fact is explicitly present in public text. */
export function isFactExplicitlyPublic(content: string, publicTexts: readonly string[]): boolean {
  const fact = normalizeFactText(content);
  if (!fact) return false;
  return publicTexts.some((publicText) => {
    const known = normalizeFactText(publicText);
    if (!known) return false;
    if (fact === known) return true;
    return fact.length >= 4 && known.includes(fact);
  });
}

export function validateGeneratedKeyFacts(
  facts: readonly { id: number; content: string; weight: number; hintContent?: string }[],
  publicTexts: readonly string[],
): KeyFactQualityIssue[] {
  const issues: KeyFactQualityIssue[] = [];
  if (facts.length < AI_KEY_FACT_MIN_COUNT || facts.length > AI_KEY_FACT_MAX_COUNT) {
    issues.push({
      code: "COUNT_OUT_OF_RANGE",
      reason: `关键点数量必须为 ${AI_KEY_FACT_MIN_COUNT}–${AI_KEY_FACT_MAX_COUNT}，本次为 ${facts.length}`,
    });
  }

  const contentToId = new Map<string, number>();
  for (const fact of facts) {
    const normalized = normalizeFactText(fact.content);
    const previousId = contentToId.get(normalized);
    if (previousId !== undefined) {
      issues.push({ code: "DUPLICATE_FACT", factId: fact.id, reason: `与关键点 ${previousId} 重复` });
    } else {
      contentToId.set(normalized, fact.id);
    }
    if (isFactExplicitlyPublic(fact.content, publicTexts)) {
      issues.push({ code: "PUBLIC_FACT", factId: fact.id, reason: "汤面已明确告知玩家" });
    }
    if (!Number.isInteger(fact.weight) || fact.weight <= 0) {
      issues.push({ code: "INVALID_WEIGHTS", factId: fact.id, reason: "关键点权重必须是正整数" });
    }
    if (fact.hintContent !== undefined && !fact.hintContent.trim()) {
      issues.push({ code: "MISSING_HINT", factId: fact.id, reason: "关键点缺少方向提示" });
    }
  }

  if (facts.length > 0 && facts.reduce((sum, fact) => sum + fact.weight, 0) !== 100) {
    issues.push({ code: "INVALID_WEIGHTS", reason: "关键点权重总和必须为 100" });
  }
  return issues;
}

export function parseKeyFactReviewResult(raw: string): KeyFactReviewResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.approved !== "boolean" || !Array.isArray(value.issues)) return null;
  const issues = value.issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) return [];
    const item = issue as Record<string, unknown>;
    const reason = typeof item.reason === "string" ? item.reason.trim().slice(0, 240) : "";
    if (!reason) return [];
    const factId = Number(item.factId);
    return [{
      code: "REVIEW_REJECTED" as const,
      ...(Number.isInteger(factId) ? { factId } : {}),
      reason,
    }];
  });
  if (issues.length !== value.issues.length) return null;
  return { approved: value.approved && issues.length === 0, issues };
}
