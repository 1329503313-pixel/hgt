export const MAX_LEVEL = 40;

export type LevelProgress = {
  level: number;
  experience: number;
  levelStartExperience: number;
  nextLevelExperience: number | null;
  currentLevelExperience: number;
  experienceForNextLevel: number;
  remainingExperience: number;
  progressPercent: number;
  isMaxLevel: boolean;
};

export function normalizeLevel(value: unknown) {
  return Math.max(0, Math.min(MAX_LEVEL, Math.floor(Number(value) || 0)));
}
