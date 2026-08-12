export function finalizeOnlineSoupRoundPanelPage<T>(rows: T[], limit: number, sequenceOf: (row: T) => unknown) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    hasMore,
    nextCursor: hasMore && items.length ? String(sequenceOf(items[items.length - 1])) : null
  };
}

export function onlineSoupAiProgressChange(previousProgress: unknown, nextProgress: unknown) {
  const previous = Math.max(0, Math.min(100, Number(previousProgress) || 0));
  const after = Math.max(previous, Math.min(100, Number(nextProgress) || 0));
  return { delta: after - previous, after };
}

export type OnlineSoupAiProgressEvent =
  | { type: "milestone"; progress: 20 | 40 | 60 | 80 }
  | { type: "completion"; progress: 100 };

export const ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS = 80;

/**
 * 进度事件只沿累计值向前生成，并保证同一题跨越多个节点时严格升序。
 * 100% 完成事件永远排在 20/40/60/80 里程碑之后。
 */
export function onlineSoupAiProgressEvents(previousProgress: unknown, nextProgress: unknown): OnlineSoupAiProgressEvent[] {
  const change = onlineSoupAiProgressChange(previousProgress, nextProgress);
  const before = change.after - change.delta;
  const events: OnlineSoupAiProgressEvent[] = ([20, 40, 60, 80] as const)
    .filter((milestone) => before < milestone && change.after >= milestone)
    .map((progress) => ({ type: "milestone", progress }));
  if (before < 100 && change.after >= 100) events.push({ type: "completion", progress: 100 });
  return events;
}

export function requiredOnlineSoupFinishVotes(eligiblePlayers: unknown) {
  return Math.ceil(Math.max(0, Math.floor(Number(eligiblePlayers) || 0)) / 2);
}

export function onlineSoupAiFinishDecision(
  progress: unknown,
  eligiblePlayers: unknown,
  viewBottomVotes: unknown,
): "progress" | "vote" | null {
  const normalizedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  const requiredVotes = requiredOnlineSoupFinishVotes(eligiblePlayers);
  if (normalizedProgress >= 100) return "progress";
  if (normalizedProgress >= ONLINE_SOUP_AI_FINISH_VOTE_PROGRESS && requiredVotes > 0 && Number(viewBottomVotes) >= requiredVotes) return "vote";
  return null;
}

export function canViewOnlineSoupHostMaterials(isHost: boolean, hostMode: unknown) {
  return isHost && String(hostMode ?? "human") === "human";
}
