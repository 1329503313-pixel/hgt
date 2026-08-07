export const MAX_LEVEL = 40;
export const MAX_EXPERIENCE = 10_000_000;

export const LEVEL_THRESHOLDS = [
  0, 10, 100, 250, 450, 800, 1_200, 1_800, 2_600, 3_600,
  4_800, 6_000, 7_500, 9_500, 12_000, 15_000, 19_000, 24_000,
  30_000, 37_000, 45_000, 54_000, 64_000, 75_000, 87_000,
  100_000, 120_000, 150_000, 190_000, 240_000, 300_000,
  400_000, 550_000, 750_000, 1_000_000, 1_350_000, 2_000_000,
  3_000_000, 4_500_000, 6_500_000, MAX_EXPERIENCE
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
