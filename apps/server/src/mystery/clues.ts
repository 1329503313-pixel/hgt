import { z } from "zod";

export const mysteryClueContentSchema = z.string().trim().min(1).max(2000);

export function nextMysteryClueNumber(latestValue: unknown) {
  const latest = Number(latestValue ?? 0);
  if (!Number.isSafeInteger(latest) || latest < 0) {
    throw new Error("Invalid mystery clue number");
  }
  return latest + 1;
}
