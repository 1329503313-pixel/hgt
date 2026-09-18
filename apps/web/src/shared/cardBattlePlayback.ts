import type { OnlineCardBattleEvent, OnlineCardBattlePlayback } from "./types";

/** Historical replay only: old recordings get the same reading time as new games. */
export function readableCardBattleEvent(event: OnlineCardBattleEvent): OnlineCardBattleEvent {
  const minimum = event.kind === "attack" ? 1375
    : event.kind === "skill" ? event.visual === "damage" ? 1625 : event.visual === "energy" && !event.effects.length ? 375 : 1250
      : event.kind === "extra_action" || event.kind === "stun" ? 812.5
        : event.kind === "end" ? 1500 : 625;
  return event.durationMs >= minimum ? event : { ...event, durationMs: minimum };
}

export function cardBattleEventTiming(playback: OnlineCardBattlePlayback, sinceReceivedMs = 0) {
  const event = playback.activeEvent;
  const elapsed = Math.max(0, playback.activeEventElapsedMs + Math.max(0, sinceReceivedMs));
  return {
    elapsed,
    remaining: event ? Math.max(0, event.durationMs - elapsed) : 0,
    impactRemaining: event ? Math.max(0, Math.max(120, Math.round(event.durationMs * .55)) - elapsed) : 0,
  };
}

export function isCardBattleAnimation(animation: Animation) {
  return animation.id?.startsWith("card-battle-") || ("animationName" in animation && String(animation.animationName).startsWith("card-battle-"));
}

/** Seek CSS effects and the measured card flight without remounting card/video DOM. */
export function seekCardBattleAnimations(root: HTMLElement, elapsedMs: number) {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (!isCardBattleAnimation(animation)) continue;
    animation.currentTime = Math.max(0, elapsedMs);
    const endTime = Number(animation.effect?.getComputedTiming().endTime ?? 0);
    if (elapsedMs < endTime && animation.playState !== "running") animation.play();
  }
}
