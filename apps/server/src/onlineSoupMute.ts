export const ONLINE_SOUP_MUTE_DURATIONS = [1, 5] as const;

export type OnlineSoupMuteDuration = (typeof ONLINE_SOUP_MUTE_DURATIONS)[number];

export function onlineSoupMuteRemainingMinutes(mutedUntil: Date | string | null | undefined, now = new Date()) {
  if (!mutedUntil) return 0;
  const remainingMs = new Date(mutedUntil).getTime() - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 60_000);
}
