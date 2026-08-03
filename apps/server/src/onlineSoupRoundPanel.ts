export function finalizeOnlineSoupRoundPanelPage<T>(rows: T[], limit: number, sequenceOf: (row: T) => unknown) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    hasMore,
    nextCursor: hasMore && items.length ? String(sequenceOf(items[items.length - 1])) : null
  };
}
