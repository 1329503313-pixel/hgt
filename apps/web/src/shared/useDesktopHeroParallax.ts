import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const MAX_OFFSET_PERCENT = 1.5;
const HERO_PARALLAX_STORAGE_KEY = "hgt:desktop-hero-parallax";

type HeroOffset = { x: number; y: number };

function readStoredOffset(): HeroOffset {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(HERO_PARALLAX_STORAGE_KEY) ?? "");
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
      return {
        x: Math.max(-MAX_OFFSET_PERCENT, Math.min(MAX_OFFSET_PERCENT, Number(parsed.x))),
        y: Math.max(-MAX_OFFSET_PERCENT, Math.min(MAX_OFFSET_PERCENT, Number(parsed.y)))
      };
    }
  } catch {
    // Ignore unavailable or malformed session storage.
  }
  return { x: 0, y: 0 };
}

let sharedOffset = readStoredOffset();

function applySharedOffset() {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--hero-parallax-x", `${sharedOffset.x}%`);
  document.documentElement.style.setProperty("--hero-parallax-y", `${sharedOffset.y}%`);
  try {
    window.sessionStorage.setItem(HERO_PARALLAX_STORAGE_KEY, JSON.stringify(sharedOffset));
  } catch {
    // The visual interaction still works when session storage is unavailable.
  }
}

export function useDesktopHeroParallax<T extends HTMLElement>() {
  const heroRef = useRef<T | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef<HeroOffset>(sharedOffset);

  const applyPendingOffset = useCallback(() => {
    frameRef.current = null;
    sharedOffset = pendingOffsetRef.current;
    applySharedOffset();
  }, []);

  const queueOffset = useCallback((x: number, y: number) => {
    pendingOffsetRef.current = { x, y };
    sharedOffset = pendingOffsetRef.current;
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyPendingOffset);
  }, [applyPendingOffset]);

  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    if (event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const normalizedX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
    const normalizedY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1));
    queueOffset(-normalizedX * MAX_OFFSET_PERCENT, -normalizedY * MAX_OFFSET_PERCENT);
  }, [queueOffset]);

  // Keep the last pointer-driven position when navigation replaces the current page.
  const onPointerLeave = useCallback(() => {}, []);

  useLayoutEffect(() => {
    pendingOffsetRef.current = sharedOffset;
    applySharedOffset();
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      sharedOffset = pendingOffsetRef.current;
      applySharedOffset();
    }
  }, []);

  return { heroRef, onPointerMove, onPointerLeave };
}
