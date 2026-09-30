import { useCallback, useEffect, useRef, useState } from "react";
import type { OnlineSoupBackgroundMusic } from "./types";

const MUTED_STORAGE_KEY = "hgt:online-soup:bgm-muted";
const BACKGROUND_MUSIC_VOLUME = 0.4;

function storedMuted() {
  try { return window.localStorage.getItem(MUTED_STORAGE_KEY) === "1"; }
  catch { return false; }
}

function expectedTrackTime(track: OnlineSoupBackgroundMusic, duration: number) {
  if (!track.startedAt || !Number.isFinite(duration) || duration <= 0) return 0;
  const elapsedSeconds = Math.max(0, (Date.now() - new Date(track.startedAt).getTime()) / 1000);
  return elapsedSeconds % duration;
}

export function useOnlineSoupBackgroundMusic(track: OnlineSoupBackgroundMusic | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef(track);
  const mutedRef = useRef(false);
  const [muted, setMuted] = useState(storedMuted);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  trackRef.current = track;
  mutedRef.current = muted;

  const syncAndPlay = useCallback(async () => {
    const audio = audioRef.current;
    const currentTrack = trackRef.current;
    if (!audio || !currentTrack || mutedRef.current) return;
    if (audio.duration > 0) {
      const expected = expectedTrackTime(currentTrack, audio.duration);
      const difference = Math.abs(audio.currentTime - expected);
      const loopDifference = Math.min(difference, Math.max(0, audio.duration - difference));
      if (loopDifference > 1.5) audio.currentTime = expected;
    }
    try {
      await audio.play();
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
    }
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = BACKGROUND_MUSIC_VOLUME;
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAutoplayBlocked(false);
    if (!track?.audioUrl) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    audio.src = track.audioUrl;
    audio.load();
    const onReady = () => void syncAndPlay();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncAndPlay();
    };
    audio.addEventListener("loadedmetadata", onReady);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => void syncAndPlay(), 15_000);
    return () => {
      audio.removeEventListener("loadedmetadata", onReady);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [syncAndPlay, track?.audioUrl, track?.id, track?.startedAt]);

  useEffect(() => {
    try { window.localStorage.setItem(MUTED_STORAGE_KEY, muted ? "1" : "0"); }
    catch { /* 隐私模式下仅保留当前页面状态。 */ }
    const audio = audioRef.current;
    if (!audio) return;
    if (muted) {
      audio.pause();
      setAutoplayBlocked(false);
    } else {
      void syncAndPlay();
    }
  }, [muted, syncAndPlay]);

  useEffect(() => {
    if (!track || muted || !autoplayBlocked) return;
    const retry = () => void syncAndPlay();
    document.addEventListener("pointerdown", retry, { capture: true });
    document.addEventListener("keydown", retry, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", retry, { capture: true });
      document.removeEventListener("keydown", retry, { capture: true });
    };
  }, [autoplayBlocked, muted, syncAndPlay, track]);

  return {
    muted,
    autoplayBlocked,
    toggleMuted: useCallback(() => {
      if (autoplayBlocked && !muted) {
        void syncAndPlay();
        return;
      }
      setMuted((current) => !current);
    }, [autoplayBlocked, muted, syncAndPlay]),
  };
}
