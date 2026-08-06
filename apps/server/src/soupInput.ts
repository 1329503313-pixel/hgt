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
