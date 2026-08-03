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
