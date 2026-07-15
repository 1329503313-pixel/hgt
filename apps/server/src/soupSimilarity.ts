export type SoupSimilarityInput = {
  title: string;
  surface: string;
  bottom: string;
};

export type SoupSimilarityCandidate = SoupSimilarityInput & {
  id: string;
};

export const SOUP_DUPLICATE_THRESHOLD = 0.9;

const FIELD_WEIGHTS = {
  title: 0.1,
  surface: 0.4,
  bottom: 0.5
} as const;

/**
 * Normalize harmless formatting differences so punctuation, whitespace,
 * capitalization and full-width variants cannot bypass duplicate detection.
 */
export function normalizeSoupText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "");
}

/** Sørensen-Dice similarity over character bigrams, including duplicates. */
export function textSimilarity(left: string, right: string): number {
  const a = normalizeSoupText(left);
  const b = normalizeSoupText(right);
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const aBigrams = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const bigram = a.slice(index, index + 2);
    aBigrams.set(bigram, (aBigrams.get(bigram) ?? 0) + 1);
  }

  let intersections = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const bigram = b.slice(index, index + 2);
    const available = aBigrams.get(bigram) ?? 0;
    if (available > 0) {
      intersections += 1;
      aBigrams.set(bigram, available - 1);
    }
  }

  return (2 * intersections) / (a.length + b.length - 2);
}

export function calculateSoupSimilarity(left: SoupSimilarityInput, right: SoupSimilarityInput): number {
  return (
    textSimilarity(left.title, right.title) * FIELD_WEIGHTS.title +
    textSimilarity(left.surface, right.surface) * FIELD_WEIGHTS.surface +
    textSimilarity(left.bottom, right.bottom) * FIELD_WEIGHTS.bottom
  );
}

export function findHighlySimilarSoup(
  input: SoupSimilarityInput,
  candidates: SoupSimilarityCandidate[],
  excludedId?: string
): { id: string; similarity: number } | null {
  let closest: { id: string; similarity: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.id === excludedId) continue;
    const similarity = calculateSoupSimilarity(input, candidate);
    if (similarity > SOUP_DUPLICATE_THRESHOLD && (!closest || similarity > closest.similarity)) {
      closest = { id: candidate.id, similarity };
    }
  }

  return closest;
}
