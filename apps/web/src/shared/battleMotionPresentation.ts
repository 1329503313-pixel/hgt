type Listener = (canvas: boolean) => void;
type Surface = { listener: Listener; active: boolean };
const surfaces = new Set<Surface>();
let frame = 0, generation = 0, canvas = false, decided = false;

/** Bounded, per-mounted-scene A/B probe. Native stays native when already smooth. */
function probe() {
  if (frame || decided || document.hidden || [...surfaces].filter(surface => surface.active).length < 2) return;
  const currentGeneration = ++generation;
  let start = 0, last = 0, count = 0, baseline = 0, phase = 0;
  const change = (value: boolean) => { canvas = value; for (const surface of surfaces) surface.listener(value); };
  const sample = (now: number) => {
    if (currentGeneration !== generation) return;
    if (document.hidden || [...surfaces].filter(surface => surface.active).length < 2) { frame = 0; change(false); return; }
    if (!start) start = last = now;
    count++; last = now;
    if (now - start >= 2000) {
      const hz = (count - 1) * 1000 / (last - start);
      if (phase === 0) {
        if (hz >= 48) { decided = true; frame = 0; return; }
        baseline = hz; phase = 1; change(true);
      } else {
        // Keep the extra copies only when they deliver a material improvement.
        if (hz < Math.max(30, baseline * 1.2)) change(false);
        decided = true; frame = 0; return;
      }
      start = last = now; count = 1;
    }
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
}

export function observeBattleMotionPresentation(listener: Listener) {
  const surface: Surface = { listener, active: false }; surfaces.add(surface); listener(canvas);
  return {
    active(value: boolean) {
      surface.active = value;
      if (frame && (document.hidden || [...surfaces].filter(item => item.active).length < 2)) {
        cancelAnimationFrame(frame); frame = 0; generation++; canvas = false;
        for (const item of surfaces) item.listener(false);
      }
      probe();
    },
    dispose() {
      surfaces.delete(surface);
      if (!surfaces.size) { cancelAnimationFrame(frame); frame = 0; generation++; canvas = false; decided = false; }
    },
  };
}
