export const MAX_LEVEL = 40;
export const MAX_EXPERIENCE = 100_000_000;

export const LEVEL_THRESHOLDS = [
  0, 10, 100, 300, 800, 1_800, 3_200, 5_600, 9_000, 14_500,
  22_000, 32_000, 45_000, 60_000, 80_000, 110_000, 150_000, 210_000,
  300_000, 420_000, 580_000, 780_000, 1_050_000, 1_500_000, 2_200_000,
  3_200_000, 4_500_000, 6_000_000, 7_750_000, 9_750_000, 13_000_000,
  17_000_000, 22_000_000, 28_000_000, 35_000_000, 43_000_000,
  52_000_000, 62_000_000, 73_000_000, 85_000_000, MAX_EXPERIENCE
] as const;

export function levelForExperience(value: unknown) {
  const experience = Math.max(0, Math.min(MAX_EXPERIENCE, Math.floor(Number(value) || 0)));
  let low = 0;
  let high = LEVEL_THRESHOLDS.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (LEVEL_THRESHOLDS[middle] <= experience) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function experienceProgress(value: unknown) {
  const experience = Math.max(0, Math.min(MAX_EXPERIENCE, Math.floor(Number(value) || 0)));
  const level = levelForExperience(experience);
  if (level === MAX_LEVEL) {
    return { level, experience, levelStartExperience: MAX_EXPERIENCE, nextLevelExperience: null, currentLevelExperience: 0, experienceForNextLevel: 0, remainingExperience: 0, progressPercent: 100, isMaxLevel: true };
  }
  const levelStartExperience = LEVEL_THRESHOLDS[level];
  const nextLevelExperience = LEVEL_THRESHOLDS[level + 1];
  const currentLevelExperience = experience - levelStartExperience;
  const experienceForNextLevel = nextLevelExperience - levelStartExperience;
  return {
    level,
    experience,
    levelStartExperience,
    nextLevelExperience,
    currentLevelExperience,
    experienceForNextLevel,
    remainingExperience: nextLevelExperience - experience,
    progressPercent: Math.min(100, Math.round((currentLevelExperience / experienceForNextLevel) * 100)),
    isMaxLevel: false
  };
}
