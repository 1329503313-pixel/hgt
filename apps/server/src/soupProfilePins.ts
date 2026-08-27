export const PROFILE_SOUP_PIN_LIMIT = 4;
export const PROFILE_SOUP_ORDER_SQL = "s.profile_pinned_at IS NOT NULL DESC, s.created_at DESC, s.id DESC";

export type ProfilePinnedSoup = {
  id: unknown;
  profile_pinned_at: unknown;
  created_at: unknown;
};

function timestamp(value: unknown) {
  const parsed = value instanceof Date ? value.getTime() : new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function profilePinEvictionIds(
  pinnedSoups: readonly ProfilePinnedSoup[],
  limit = PROFILE_SOUP_PIN_LIMIT,
) {
  const evictionCount = Math.max(0, pinnedSoups.length - Math.max(1, limit) + 1);
  return [...pinnedSoups]
    .sort((left, right) =>
      timestamp(left.profile_pinned_at) - timestamp(right.profile_pinned_at)
      || timestamp(left.created_at) - timestamp(right.created_at)
      || String(left.id).localeCompare(String(right.id))
    )
    .slice(0, evictionCount)
    .map((soup) => String(soup.id));
}
