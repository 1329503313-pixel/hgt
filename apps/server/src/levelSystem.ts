export const MAX_LEVEL = 40;
export const MAX_EXPERIENCE = 1_500_000;

export const LEVEL_THRESHOLDS = [
  0, 10, 50, 100, 200, 350, 550, 800, 1_200, 1_700,
  2_400, 3_200, 4_200, 5_500, 7_000, 9_000, 12_000, 16_000,
  21_000, 27_000, 34_000, 42_000, 51_000, 62_000, 75_000,
  90_000, 110_000, 135_000, 165_000, 200_000, 240_000,
  290_000, 350_000, 420_000, 500_000, 600_000, 720_000,
  850_000, 1_000_000, 1_200_000, MAX_EXPERIENCE
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

export function calculateExperienceAdjustment(
  currentValue: unknown,
  operation: "add" | "deduct",
  amountValue: unknown
) {
  const current = Math.floor(Number(currentValue));
  const amount = Math.floor(Number(amountValue));
  if (!Number.isSafeInteger(current) || current < 0 || current > MAX_EXPERIENCE) {
    throw new Error("EXPERIENCE_CURRENT_INVALID");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_EXPERIENCE) {
    throw new Error("EXPERIENCE_AMOUNT_INVALID");
  }
  if (operation === "deduct") {
    if (amount > current) throw new Error("EXPERIENCE_INSUFFICIENT");
    return current - amount;
  }
  if (current + amount > MAX_EXPERIENCE) throw new Error("EXPERIENCE_MAX_EXCEEDED");
  return current + amount;
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
