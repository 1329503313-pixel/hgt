import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { OnlineCardBattlePlayback } from "./types";
import { cardBattleEventTiming } from "./cardBattlePlayback";

type Game = { id: string; playback: OnlineCardBattlePlayback };

/** Timers only render the current server event and request another snapshot, never advance a sequence. */
export function useServerCardBattlePlayback(roomId: string, game: Game | null, onReload: () => Promise<unknown>, playbackPath?: string) {
  const [playback, setPlayback] = useState<OnlineCardBattlePlayback | null>(game?.playback ?? null);
  const [cardStates, setCardStates] = useState(game?.playback.states ?? []);
  const [activeEvent, setActiveEvent] = useState<OnlineCardBattlePlayback["activeEvent"]>(null);
  const [animationDelayMs, setAnimationDelayMs] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const reloadRef = useRef(onReload);
  const consumeRef = useRef<((next: OnlineCardBattlePlayback) => void) | null>(null);
  reloadRef.current = onReload;

  useEffect(() => {
    let disposed = false;
    let requestVersion = 0;
    let refreshTimer: number | undefined;
    let impactTimer: number | undefined;
    let latest: OnlineCardBattlePlayback | null = null;
    let reloadedComplete = false;
    const gameId = game?.id;
    const clearTimers = () => {
      window.clearTimeout(refreshTimer);
      window.clearTimeout(impactTimer);
    };
    const consume = (next: OnlineCardBattlePlayback) => {
      if (disposed || (latest && (Date.parse(next.serverNow) < Date.parse(latest.serverNow)
        || next.completedSequence < latest.completedSequence && !next.complete))) return;
      clearTimers();
      latest = next;
      setPlayback(next);
      setSyncing(false);
      const event = next.activeEvent;
      const timing = cardBattleEventTiming(next);
      setAnimationDelayMs(timing.elapsed);
      setActiveEvent(event && timing.remaining > 0 ? event : null);
      setCardStates(event && timing.impactRemaining === 0 ? event.states : next.states);
      if (next.complete) {
        if (!reloadedComplete) {
          reloadedComplete = true;
          void reloadRef.current().catch(() => {});
        }
        return;
      }
      if (event && timing.impactRemaining > 0) {
        impactTimer = window.setTimeout(() => { if (!disposed) setCardStates(event.states); }, timing.impactRemaining);
      }
      refreshTimer = window.setTimeout(() => void sync(), Math.min(1000, Math.max(30, timing.remaining)));
    };
    const sync = async () => {
      if (disposed || !gameId) return;
      const version = ++requestVersion;
      try {
        const data = await api<{ gameId: string; playback: OnlineCardBattlePlayback }>(playbackPath ?? `/api/online-soup/rooms/${roomId}/card-battle/playback`, { bypassCache: true, dedupe: false });
        if (disposed || version !== requestVersion) return;
        if (data.gameId !== gameId) {
          setActiveEvent(null);
          await reloadRef.current();
          return;
        }
        consume(data.playback);
      } catch {
        if (disposed || version !== requestVersion) return;
        setActiveEvent(null);
        setSyncing(true);
        refreshTimer = window.setTimeout(() => void sync(), 1000);
      }
    };
    const resume = () => {
      if (!gameId) return;
      clearTimers();
      setActiveEvent(null);
      setSyncing(true);
      void sync();
    };
    const visibility = () => { if (document.visibilityState === "visible") resume(); };
    consumeRef.current = consume;
    setActiveEvent(null);
    if (game) { consume(game.playback); void sync(); }
    else { setPlayback(null); setCardStates([]); setSyncing(false); }
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      consumeRef.current = null;
      clearTimers();
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [roomId, game?.id, playbackPath]);

  useEffect(() => {
    if (game) consumeRef.current?.(game.playback);
  }, [game?.id, game?.playback]);
  return { playback, cardStates, activeEvent, animationDelayMs, syncing };
}
