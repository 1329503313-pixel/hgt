export const MAX_LEVEL = 40;
export const MAX_EXPERIENCE = 1_500_000;

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

export function getLevelTitle(value: unknown) {
  const level = normalizeLevel(value);
  if (level === 0) return "初来乍到";
  if (level <= 5) return "见习侦探";
  if (level <= 10) return "推理学徒";
  if (level <= 15) return "本格侦探";
  if (level <= 20) return "诡计专家";
  if (level <= 25) return "逻辑大师";
  if (level <= 30) return "谜境旅者";
  if (level <= 35) return "星海贤者";
  return "汤汤传说";
}
