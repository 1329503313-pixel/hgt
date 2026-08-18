export function resolveBadgeOwnership(options: {
  badgeKey: string;
  approvalBased: boolean;
  currentProgress: number;
  progressTarget: number;
  permanentlyOwnedBadgeKeys: ReadonlySet<string>;
  unlockDates: Readonly<Record<string, string>>;
}) {
  const permanentlyOwned = options.permanentlyOwnedBadgeKeys.has(options.badgeKey);
  const progressCurrent = options.approvalBased
    ? (permanentlyOwned ? 1 : 0)
    : options.currentProgress;

  return {
    earned: permanentlyOwned || (!options.approvalBased && progressCurrent >= options.progressTarget),
    progressCurrent,
    unlockedAt: options.unlockDates[options.badgeKey] ?? null
  };
}
