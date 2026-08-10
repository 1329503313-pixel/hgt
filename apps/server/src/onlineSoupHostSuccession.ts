import { levelForExperience } from "./levelSystem.js";

export type OnlineSoupHostCandidate = {
  userId: string;
  experience: unknown;
  joinedAt: string | number | Date;
};

export function selectOnlineSoupHostSuccessor<T extends OnlineSoupHostCandidate>(candidates: T[]) {
  return [...candidates].sort((left, right) => {
    const levelDifference = levelForExperience(right.experience) - levelForExperience(left.experience);
    if (levelDifference !== 0) return levelDifference;
    const joinedDifference = new Date(left.joinedAt).getTime() - new Date(right.joinedAt).getTime();
    if (joinedDifference !== 0) return joinedDifference;
    return left.userId.localeCompare(right.userId);
  })[0] ?? null;
}
