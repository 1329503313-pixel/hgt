import type { OnlineCardBattlePlayback } from "./types";

export function cardBattleEventTiming(playback: OnlineCardBattlePlayback, sinceReceivedMs = 0) {
  const event = playback.activeEvent;
  const elapsed = Math.max(0, playback.activeEventElapsedMs + Math.max(0, sinceReceivedMs));
  return {
    elapsed,
    remaining: event ? Math.max(0, event.durationMs - elapsed) : 0,
    impactRemaining: event ? Math.max(0, Math.max(120, Math.round(event.durationMs * .55)) - elapsed) : 0,
  };
}

/** Seek existing CSS animations, preserving card/video DOM and reduced-motion styles. */
export function seekCardBattleAnimations(root: HTMLElement, elapsedMs: number) {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (!("animationName" in animation) || !String(animation.animationName).startsWith("card-battle-")) continue;
    animation.currentTime = Math.max(0, elapsedMs);
    const endTime = Number(animation.effect?.getComputedTiming().endTime ?? 0);
    if (elapsedMs < endTime && animation.playState !== "running") animation.play();
  }
}
