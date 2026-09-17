import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

type Options = {
  arenaRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  lineupKey: string;
  onReorder: (from: number, to: number) => Promise<boolean>;
  hasCard: (slot: number) => boolean;
  onAnnounce: (message: string) => void;
};
type FlyingCard = { element: HTMLDivElement; face: HTMLElement; rect: DOMRect };
type Drag = {
  pointerId: number;
  slot: number;
  source: HTMLButtonElement;
  x: number;
  y: number;
  dx: number;
  dy: number;
  ghost: FlyingCard | null;
  finishing: boolean;
};

// The floating copies live above the arena, so clipping and pointer capture do
// not move the actual hit targets or interfere with battle attack transforms.
export function useCardBattleDrag(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const drag = useRef<Drag | null>(null);
  const flying = useRef<FlyingCard[]>([]);
  const hidden = useRef(new Map<HTMLElement, string>());
  const animations = useRef<Animation[]>([]);
  const frame = useRef(0);
  const busy = useRef(false);
  const suppressClick = useRef(false);
  const [dropSlot, setDropSlot] = useState<number | null>(null);

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = (element: HTMLElement, frames: Keyframe[], duration: number) => {
    const animation = element.animate(frames, { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    animations.current.push(animation);
    return animation.finished.catch(() => undefined);
  };
  const cleanup = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.source.hasPointerCapture(current.pointerId)) current.source.releasePointerCapture(current.pointerId);
    cancelAnimationFrame(frame.current);
    animations.current.splice(0).forEach((animation) => animation.cancel());
    flying.current.splice(0).forEach((card) => card.element.remove());
    hidden.current.forEach((opacity, element) => { element.style.opacity = opacity; });
    hidden.current.clear();
    setDropSlot(null);
  };
  const cancel = () => {
    if (drag.current?.ghost) suppressClick.current = true;
    cleanup();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const onVisibility = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    // A scroll changes viewport coordinates; cancel instead of dropping onto a stale slot.
    window.addEventListener("scroll", cancel, true);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", cancel, true);
      cleanup();
    };
  }, [options.enabled, options.lineupKey]);

  const copy = (source: HTMLElement): FlyingCard => {
    const rect = source.getBoundingClientRect();
    const element = document.createElement("div");
    element.className = "card-battle-drag-overlay";
    element.setAttribute("aria-hidden", "true");
    element.inert = true;
    Object.assign(element.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: "150", pointerEvents: "none" });
    const face = source.cloneNode(true) as HTMLElement;
    for (const node of [face, ...face.querySelectorAll<HTMLElement>("*")]) {
      node.removeAttribute("id");
      node.removeAttribute("data-card-battle-slot");
      node.removeAttribute("data-battle-instance");
      node.style.pointerEvents = "none";
    }
    // Do not create a second video decoder just to show the dragged card.
    face.querySelectorAll("video").forEach((video) => {
      const poster = document.createElement("img");
      poster.src = video.poster;
      poster.className = video.className;
      video.replaceWith(poster);
    });
    Object.assign(face.style, { width: "100%", height: "100%", margin: "0", opacity: "1", transform: "none", animation: "none", boxShadow: "0 20px 36px rgb(0 0 0 / 45%)" });
    element.append(face);
    document.body.append(element);
    hidden.current.set(source, source.style.opacity);
    source.style.opacity = "0";
    const card = { element, face, rect };
    flying.current.push(card);
    return card;
  };
  const targetAt = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("[data-card-battle-slot]");
    return target && latest.current.arenaRef.current?.contains(target) ? target : null;
  };
  const flight = async (card: FlyingCard, dx: number, dy: number, fromX = 0, fromY = 0, lifted = false) => {
    if (reducedMotion()) {
      await animate(card.element, [{ opacity: 1 }, { opacity: 0 }], 80);
      return;
    }
    const transform = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0)`;
    await Promise.all([
      animate(card.element, [
        { transform: transform(fromX, fromY) },
        { transform: transform((fromX + dx) / 2, (fromY + dy) / 2 - 24), offset: .45 },
        { transform: transform(dx, dy) },
      ], 300),
      animate(card.face, [
        { transform: lifted ? "translateY(-12px) scale(1.08)" : "none" },
        { transform: "translateY(-16px) scale(1.1)", offset: .35 },
        { transform: "none", boxShadow: "0 4px 8px rgb(0 0 0 / 20%)" },
      ], 300),
    ]);
  };
  const finish = async (interaction: Drag, target: HTMLButtonElement | null) => {
    interaction.finishing = true;
    if (interaction.source.hasPointerCapture(interaction.pointerId)) interaction.source.releasePointerCapture(interaction.pointerId);
    cancelAnimationFrame(frame.current);
    const ghost = interaction.ghost!;
    const to = target ? Number(target.dataset.cardBattleSlot) : interaction.slot;
    const dest = target?.getBoundingClientRect() ?? ghost.rect;
    const displaced = to !== interaction.slot && latest.current.hasCard(to) && target ? copy(target) : null;
    setDropSlot(null);
    await Promise.all([
      flight(ghost, dest.left - ghost.rect.left, dest.top - ghost.rect.top, interaction.dx, interaction.dy, true),
      displaced ? flight(displaced, ghost.rect.left - displaced.rect.left, ghost.rect.top - displaced.rect.top) : Promise.resolve(),
    ]);
    if (drag.current !== interaction) return; // cancelled, unmounted, or room state changed
    cleanup();
    if (to === interaction.slot || !latest.current.enabled) return;
    busy.current = true;
    try {
      if (await latest.current.onReorder(interaction.slot, to)) latest.current.onAnnounce(displaced
        ? `已交换第 ${interaction.slot} 和第 ${to} 个卡位`
        : `已将第 ${interaction.slot} 张卡牌移至第 ${to} 个卡位`);
    } finally { busy.current = false; }
  };
  return {
    dropSlot,
    blocksClick: () => suppressClick.current || busy.current || Boolean(drag.current?.finishing),
    pointerDown(slot: number, event: ReactPointerEvent<HTMLButtonElement>) {
      if (!latest.current.enabled || busy.current || drag.current || !event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      drag.current = { pointerId: event.pointerId, slot, source: event.currentTarget, x: event.clientX, y: event.clientY, dx: 0, dy: 0, ghost: null, finishing: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (!current || current.finishing || current.pointerId !== event.pointerId) return;
      current.dx = event.clientX - current.x;
      current.dy = event.clientY - current.y;
      if (!current.ghost && Math.hypot(current.dx, current.dy) < 10) return;
      event.preventDefault();
      if (!current.ghost) {
        suppressClick.current = true;
        current.ghost = copy(current.source);
        if (!reducedMotion()) void animate(current.ghost.face, [{ transform: "none" }, { transform: "translateY(-12px) scale(1.08)" }], 150);
      }
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        if (drag.current === current && current.ghost) current.ghost.element.style.transform = `translate3d(${current.dx}px, ${current.dy}px, 0)`;
      });
      const target = targetAt(event.clientX, event.clientY);
      const to = target ? Number(target.dataset.cardBattleSlot) : null;
      setDropSlot(to !== current.slot ? to : null);
    },
    pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (!current || current.finishing || current.pointerId !== event.pointerId) return;
      if (!current.ghost) { cleanup(); return; }
      event.preventDefault();
      void finish(current, targetAt(event.clientX, event.clientY));
    },
    pointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
      if (drag.current?.pointerId === event.pointerId && !drag.current.finishing) cancel();
    },
    clearClickSuppression() { if (!drag.current && !busy.current) suppressClick.current = false; },
  };
}
