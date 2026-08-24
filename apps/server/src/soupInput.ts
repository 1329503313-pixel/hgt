export function normalizeExistingSoupCover(
  body: unknown,
  soupId: string,
  existingCoverUrl: string | null
): unknown {
  if (!existingCoverUrl || !body || typeof body !== "object" || Array.isArray(body)) return body;

  const input = body as Record<string, unknown>;
  if (input.coverImage !== existingCoverUrl) return body;

  return {
    ...input,
    coverImage: `/api/media/soups/${encodeURIComponent(soupId)}/cover`
  };
}

export function hasSoupReviewContentChanged(
  existing: { title: unknown; surface: unknown; bottom: unknown },
  next: { title: string; surface: string; bottom: string }
) {
  return String(existing.title) !== next.title
    || String(existing.surface) !== next.surface
    || String(existing.bottom) !== next.bottom;
}

export function normalizeStoredJsonForSql(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function hasEmptyManualAiKeyFacts(input: {
  enableAiGame: boolean;
  keyFactsCustomized: boolean;
  keyFacts: unknown[];
}) {
  return input.enableAiGame && input.keyFactsCustomized && input.keyFacts.length === 0;
}

export function normalizeSoupAiConfigurationInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  const enableAiGameMissing = !("enableAiGame" in candidate);
  const keyFactsCustomizedMissing = !("keyFactsCustomized" in candidate);

  if (candidate.enableAiGame === false || enableAiGameMissing) {
    return { ...candidate, enableAiGame: false, keyFacts: [], keyFactsCustomized: false };
  }
  if (candidate.enableAiGame === true && (candidate.keyFactsCustomized === false || keyFactsCustomizedMissing)) {
    return { ...candidate, keyFacts: [], keyFactsCustomized: false };
  }
  return input;
}

type SoupValidationIssue = {
  path: PropertyKey[];
  message: string;
};

const soupFieldLabels: Record<string, string> = {
  title: "标题",
  author: "作者",
  type: "类型",
  difficulty: "难度",
  summary: "摘要",
  coverImage: "封面",
  isSensitive: "敏感内容设置",
  surface: "汤面",
  supplementalSurfaces: "补充汤面",
  bottom: "汤底",
  supplementalBottoms: "补充汤底",
  manual: "主持人手册",
  isSurfacePublic: "汤面公开设置",
  isBottomPublic: "汤底公开设置",
  enableAiGame: "AI 主持开关",
  keyFacts: "AI 主持高级设置关键点",
  keyFactsCustomized: "AI 主持高级设置"
};

export function soupValidationMessage(issues: SoupValidationIssue[]) {
  const issue = issues[0];
  if (!issue) return "海龟汤信息填写不正确";

  const [field, rawIndex, keyFactField] = issue.path;
  if (field === "keyFacts") {
    if (typeof rawIndex === "number") {
      const position = rawIndex + 1;
      if (keyFactField === "content") return `AI 主持高级设置：第 ${position} 个关键点未填写`;
      if (keyFactField === "weight") return `AI 主持高级设置：第 ${position} 个关键点未填写有效进度值（1–99）`;
    }
    if (issue.message.includes("权重总和")) return "AI 主持高级设置：进度值总和必须为 100";
    if (issue.message.includes("至少保留 1 个")) return "AI 主持高级设置：手动管理关键点时至少保留 1 个关键点";
    return `AI 主持高级设置关键点有误：${issue.message}`;
  }

  const label = soupFieldLabels[String(field)] ?? "海龟汤信息";
  if (issue.message.startsWith("Invalid input") || issue.message.startsWith("Too ")) {
    return `${label}填写不正确`;
  }
  if (issue.message.includes(label)) return issue.message;
  return `${label}：${issue.message}`;
}
