import { useCallback, useEffect, useRef, useState } from "react";

/** React observes battle boundaries; the progress control reads this clock separately. */
export function useCardBattleReplayClock(boundaries: readonly number[], duration: number, initiallyPlaying: boolean) {
  const clock = useRef({ elapsed: 0, at: performance.now(), playing: initiallyPlaying, duration });
  clock.current.duration = duration;
  const [snapshot, setSnapshot] = useState({ elapsed: 0, playing: initiallyPlaying, revision: 0 });
  const getElapsed = useCallback(() => {
    const current = clock.current;
    return Math.min(current.duration, current.elapsed + (current.playing ? performance.now() - current.at : 0));
  }, []);
  const update = useCallback((elapsed: number, playing: boolean) => {
    const value = Math.max(0, Math.min(clock.current.duration, elapsed));
    clock.current = { ...clock.current, elapsed: value, at: performance.now(), playing: playing && value < clock.current.duration };
    setSnapshot(previous => ({ elapsed: value, playing: clock.current.playing, revision: previous.revision + 1 }));
  }, []);
  const seek = useCallback((elapsed: number) => update(elapsed, clock.current.playing), [update]);
  const toggle = useCallback(() => update(getElapsed() >= clock.current.duration ? 0 : getElapsed(), !clock.current.playing), [getElapsed, update]);
  const restart = useCallback(() => update(0, false), [update]);
  useEffect(() => {
    if (!snapshot.playing) return;
    const now = getElapsed();
    if (now >= duration) { update(duration, false); return; }
    const next = boundaries.find(boundary => boundary > now) ?? duration;
    const timer = window.setTimeout(() => {
      // A throttled/background timer catches up to authoritative wall time.
      const elapsed = getElapsed();
      if (elapsed >= duration) update(duration, false);
      else setSnapshot(previous => ({ ...previous, elapsed, revision: previous.revision + 1 }));
    }, Math.max(1, Math.ceil(next - now)));
    return () => window.clearTimeout(timer);
  }, [boundaries, duration, snapshot, getElapsed, update]);
  return { ...snapshot, getElapsed, seek, toggle, restart };
}
