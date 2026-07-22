import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const MAX_OFFSET_PERCENT = 1.5;

export function useDesktopHeroParallax<T extends HTMLElement>() {
  const heroRef = useRef<T | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef({ x: 0, y: 0 });

  const applyPendingOffset = useCallback(() => {
    frameRef.current = null;
    const hero = heroRef.current;
    if (!hero) return;
    hero.style.setProperty("--hero-parallax-x", `${pendingOffsetRef.current.x}%`);
    hero.style.setProperty("--hero-parallax-y", `${pendingOffsetRef.current.y}%`);
  }, []);

  const queueOffset = useCallback((x: number, y: number) => {
    pendingOffsetRef.current = { x, y };
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

  const onPointerLeave = useCallback(() => queueOffset(0, 0), [queueOffset]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return { heroRef, onPointerMove, onPointerLeave };
}
