export function canCommitOnlineSoupAiQuestion(
  state: {
    aiStatus: unknown;
    recalledAt: unknown;
    roundStatus: unknown;
    hostMode: unknown;
    aiVersion: unknown;
  } | null | undefined,
  expectedAiVersion: unknown,
) {
  return Boolean(
    state
    && !state.recalledAt
    && ["pending", "answering", "scoring"].includes(String(state.aiStatus))
    && state.roundStatus === "playing"
    && state.hostMode === "ai"
    && Number(state.aiVersion) === Number(expectedAiVersion),
  );
}

export function selectAllowedSupplementSurfaceIndices(
  suggestedIndices: unknown,
  existingIndices: unknown,
  supplementalSurfaceCount: number,
  progressAfter: number,
) {
  if (progressAfter < 30 || progressAfter > 70 || !Array.isArray(suggestedIndices)) return [];
  const existing = new Set(
    Array.isArray(existingIndices)
      ? existingIndices.map(Number).filter(Number.isInteger)
      : [],
  );
  const next = suggestedIndices
    .map(Number)
    .filter((index) => Number.isInteger(index)
      && index >= 0
      && index < supplementalSurfaceCount
      && !existing.has(index));
  return [...new Set(next)].slice(0, 1);
}
