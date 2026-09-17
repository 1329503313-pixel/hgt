import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OnlineCardBattleEvent } from "../shared/types";
import { FX_MATERIALS, type FxQuality } from "../shared/cardBattleFx";

type Preference = "auto" | FxQuality;
type FxContext = { quality: FxQuality; reduced: boolean; visible: boolean; eventKey: string; elapsedMs: number; getElapsedMs: () => number; playing: boolean; preference: Preference; setPreference: (value: Preference) => void };
const Context = createContext<FxContext>({ quality: "standard", reduced: false, visible: true, eventKey: "", elapsedMs: 0, getElapsedMs: () => 0, playing: true, preference: "auto", setPreference: () => {} });
export const useCardBattleFx = () => useContext(Context);
const storageKey = "hgt.battle.fx-quality.v1";
function readPreference(): Preference { try { const value = localStorage.getItem(storageKey); return value === "standard" || value === "economy" ? value : "auto"; } catch { return "auto"; } }
let preloaded = false;
function preload() {
  if (preloaded) return;
  preloaded = true;
  // Three small local images, decoded sequentially, never delaying a battle.
  void (async () => { for (const src of Object.values(FX_MATERIALS)) { const image = new Image(); image.src = src; try { await image.decode(); } catch { /* vector fallback stays visible */ } } })();
}

export function CardBattleFxProvider({ gameId, event, elapsedMs = 0, playing = true, children }: { gameId?: string; event: OnlineCardBattleEvent | null; elapsedMs?: number; playing?: boolean; children: ReactNode }) {
  const [preference, setPreferenceState] = useState<Preference>(readPreference);
  const [economy, setEconomy] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const active = Boolean(event && playing);
  const activeRef = useRef(active); activeRef.current = active;
  useEffect(() => {
    preload();
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    const visibility = () => setVisible(!document.hidden);
    const changed = () => setPreferenceState(readPreference());
    document.addEventListener("visibilitychange", visibility); media.addEventListener("change", motion);
    window.addEventListener("storage", changed); window.addEventListener("hgt-fx-quality", changed);
    return () => { document.removeEventListener("visibilitychange", visibility); media.removeEventListener("change", motion); window.removeEventListener("storage", changed); window.removeEventListener("hgt-fx-quality", changed); };
  }, []);
  useEffect(() => setEconomy(false), [gameId]);
  useEffect(() => {
    if (preference !== "auto" || economy || reduced || !visible || !active) return;
    let frame = 0, last = 0, start = 0, samples = 0, slow = 0, windows = 0;
    const sample = (now: number) => {
      if (!activeRef.current) return;
      if (!start) start = now;
      // Ignore first-second loading/decoding. Two three-second samples below
      // 45fps cause one downgrade for this game; no mid-game oscillation.
      if (last && now - start > 1000) { samples++; if (now - last > 22.3) slow++; }
      last = now;
      if (now - start > 4000) {
        windows = samples && slow / samples > .5 ? windows + 1 : 0;
        if (windows >= 2) { setEconomy(true); return; }
        start = now - 1000; samples = slow = 0;
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [active, visible, reduced, preference, economy, gameId]);
  // Delay automatic quality change until the next event boundary.
  const eventKey = `${gameId ?? "preview"}:${event?.sequence ?? "idle"}`;
  const clock = useRef({ key:eventKey, elapsedMs, playing, at:performance.now() });
  if (clock.current.key !== eventKey || clock.current.elapsedMs !== elapsedMs || clock.current.playing !== playing) clock.current = { key:eventKey, elapsedMs, playing, at:performance.now() };
  const getElapsedMs = () => Math.min(event?.durationMs ?? 0, clock.current.elapsedMs + (clock.current.playing ? performance.now()-clock.current.at : 0));
  const automatic = useRef<{ gameId?: string; key: string; quality: FxQuality }>({ gameId, key: "", quality: "standard" });
  if (automatic.current.key !== eventKey) automatic.current = { gameId, key: eventKey, quality: automatic.current.gameId !== gameId ? "standard" : economy ? "economy" : "standard" };
  const quality = preference === "auto" ? automatic.current.quality : preference;
  const setPreference = (value: Preference) => { setPreferenceState(value); try { localStorage.setItem(storageKey, value); window.dispatchEvent(new Event("hgt-fx-quality")); } catch { /* private browsing */ } };
  const value = useMemo(() => ({ quality, reduced, visible, eventKey, elapsedMs, getElapsedMs, playing, preference, setPreference }), [quality, reduced, visible, eventKey, elapsedMs, playing, preference]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function CardBattleFxQualityControl() {
  const { preference, setPreference } = useCardBattleFx();
  return <label className="card-battle-quality">特效<select aria-label="战斗特效质量" value={preference} onChange={e => setPreference(e.target.value as Preference)}><option value="auto">自动</option><option value="standard">标准</option><option value="economy">节能</option></select></label>;
}
