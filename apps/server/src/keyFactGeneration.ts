export type GeneratedKeyFact = { id: number; content: string; weight: number };

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
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const facts = value.flatMap((fact: any) => {
    const id = Number(fact?.id);
    const weight = Number(fact?.weight);
    const content = typeof fact?.content === "string" ? fact.content.trim() : "";
    if (!Number.isInteger(id) || seen.has(id) || !Number.isFinite(weight) || weight <= 0 || !content) return [];
    seen.add(id);
    return [{ id, content, weight }];
  }).slice(0, 10);
  if (facts.length === 0) return [];

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
