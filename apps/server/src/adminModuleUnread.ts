export function hasPendingApprovals(
  counts: { soups: number; bottomRequests: number; excellentAuthors: number },
  canReviewExcellentAuthors: boolean,
) {
  return counts.soups > 0
    || counts.bottomRequests > 0
    || (canReviewExcellentAuthors && counts.excellentAuthors > 0);
}
