export type GeneratedKeyFact = { id: number; content: string; weight: number; hintContent: string };
export type GeneratedKeyFactHint = { id: number; hintContent: string };
type HintableKeyFact = Omit<GeneratedKeyFact, "hintContent"> & { hintContent?: string };

/**
 * 兼容早期保存的零权重关键点。只返回运行时副本，不回写作者配置；一旦存在
 * 非正权重，就为全部关键点确定性地重新分配总计 100 的有效权重。
 */
export function normalizeStoredKeyFacts(value: unknown): GeneratedKeyFact[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const facts = value.flatMap((fact: any) => {
    const id = Number(fact?.id);
    const rawWeight = Number(fact?.weight);
    const content = typeof fact?.content === "string" ? fact.content.trim() : "";
    const hintContent = typeof fact?.hintContent === "string" ? fact.hintContent.trim().slice(0, 50) : "";
    if (!Number.isInteger(id) || seen.has(id) || !content) return [];
    seen.add(id);
    return [{ id, content, weight: Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 0, hintContent }];
  });
  if (facts.length === 0 || facts.every((fact) => fact.weight > 0)) return facts;

  const sourceWeights = facts.map((fact) => fact.weight > 0 ? fact.weight : 1);
  const remaining = Math.max(0, 100 - facts.length);
  const total = sourceWeights.reduce((sum, weight) => sum + weight, 0);
  const allocations = sourceWeights.map((weight, index) => {
    const exact = total > 0 ? (weight / total) * remaining : remaining / facts.length;
    return { index, base: 1 + Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let left = 100 - allocations.reduce((sum, allocation) => sum + allocation.base, 0);
  for (const allocation of [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (left <= 0) break;
    allocation.base += 1;
    left -= 1;
  }
  return facts.map((fact, index) => ({ ...fact, weight: allocations[index].base }));
}

function candidateArray(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const object = parsed as Record<string, unknown>;
      return object.keyFacts ?? object.facts ?? [];
    }
  } catch { /* 尝试从带说明文字的历史响应中提取 */ }
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]); } catch { return []; }
}

/** 兼容新的 JSON 对象协议和历史数组协议，并把模型权重归一化为精确 100。 */
export function parseGeneratedKeyFactsResponse(raw: string): GeneratedKeyFact[] {
  const value = candidateArray(raw);
  if (!Array.isArray(value) || value.length < 1 || value.length > 15) return [];
  const seen = new Set<number>();
  let invalid = false;
  const facts = value.flatMap((fact: any) => {
    const id = Number(fact?.id);
    const weight = Number(fact?.weight);
    const content = typeof fact?.content === "string" ? fact.content.trim() : "";
    const hintContent = typeof fact?.hintContent === "string" ? fact.hintContent.trim().slice(0, 50) : "";
    if (!Number.isInteger(id) || seen.has(id) || !Number.isFinite(weight) || weight <= 0 || !content) {
      invalid = true;
      return [];
    }
    seen.add(id);
    return [{ id, content, weight, hintContent }];
  });
  if (invalid || facts.length !== value.length) return [];

  const remaining = 100 - facts.length;
  const total = facts.reduce((sum, fact) => sum + fact.weight, 0);
  const allocations = facts.map((fact, index) => {
    const exact = total > 0 ? (fact.weight / total) * remaining : remaining / facts.length;
    return { index, base: 1 + Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let left = 100 - allocations.reduce((sum, allocation) => sum + allocation.base, 0);
  for (const allocation of [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (left <= 0) break;
    allocation.base += 1;
    left -= 1;
  }
  return facts.map((fact, index) => ({ ...fact, weight: allocations[index].base }));
}

export function parseGeneratedKeyFactHintsResponse(raw: string): GeneratedKeyFactHint[] {
  const value = candidateArray(raw);
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap((fact: any) => {
    const id = Number(fact?.id);
    const hintContent = typeof fact?.hintContent === "string" ? fact.hintContent.trim().slice(0, 50) : "";
    if (!Number.isInteger(id) || seen.has(id) || !hintContent) return [];
    seen.add(id);
    return [{ id, hintContent }];
  });
}

/**
 * 只填充当前仍为空的提示。模型重复返回已有关键点时也不得覆盖作者或先前任务
 * 已经保存的提示；部分响应可以先落库，剩余项留给本轮后续尝试或下次补齐任务。
 */
export function mergeMissingKeyFactHints(
  keyFacts: readonly HintableKeyFact[],
  generatedHints: readonly GeneratedKeyFactHint[],
) {
  const hintById = new Map(generatedHints.map((hint) => [hint.id, hint.hintContent]));
  let added = 0;
  const facts = keyFacts.map((fact) => {
    if (fact.hintContent) return fact;
    const hintContent = hintById.get(fact.id)?.trim().slice(0, 50) ?? "";
    if (!hintContent) return fact;
    added += 1;
    return { ...fact, hintContent };
  });
  return {
    facts,
    added,
    missingIds: facts.filter((fact) => !fact.hintContent).map((fact) => fact.id),
  };
}

/**
 * 写回历史 JSON 时保留原始对象的全部字段和值（尤其是历史零权重），仅新增缺失的
 * hintContent。并发保护由调用方使用读取该 JSON 时取得的存储摘要完成。
 */
export function mergeMissingKeyFactHintsIntoStoredValue(
  value: unknown,
  generatedHints: readonly GeneratedKeyFactHint[],
) {
  if (!Array.isArray(value)) return { facts: [] as unknown[], added: 0 };
  const hintById = new Map(generatedHints.map((hint) => [hint.id, hint.hintContent]));
  let added = 0;
  const facts = value.map((fact) => {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) return fact;
    const record = fact as Record<string, unknown>;
    if (String(record.hintContent ?? "").trim()) return fact;
    const id = Number(record.id);
    const hintContent = hintById.get(id)?.trim().slice(0, 50) ?? "";
    if (!Number.isInteger(id) || !hintContent) return fact;
    added += 1;
    return { ...record, hintContent };
  });
  return { facts, added };
}
