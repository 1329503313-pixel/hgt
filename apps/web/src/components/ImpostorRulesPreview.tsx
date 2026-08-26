import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { registerAndroidBackHandler } from "../android/backStack";

const RULE_IMAGES = [
  "/impostor/game-guide-3.webp",
  "/impostor/game-guide-2.webp",
  "/impostor/game-guide-1.webp",
] as const;

export function ImpostorRulesPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActiveIndex(0);
    scrollerRef.current?.scrollTo({ left: 0 });
    closeButtonRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    const unregisterAndroidBack = registerAndroidBackHandler(() => onCloseRef.current());
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      unregisterAndroidBack();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  function goTo(index: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({
      left: index * scroller.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    setActiveIndex(index);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="谁是伪人玩法介绍"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative w-[min(88vw,calc((100dvh-88px)*0.563))] min-w-0 max-w-[680px]" onPointerDown={(event) => event.stopPropagation()}>
        <button
          ref={closeButtonRef}
          type="button"
          className="absolute right-2 top-2 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/25 bg-slate-950/75 text-white shadow-lg backdrop-blur transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:bg-black"
          aria-label="关闭玩法介绍"
          onClick={onClose}
        >
          <X size={22} />
        </button>

        <div
          ref={scrollerRef}
          className="impostor-rules-scroller flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl bg-slate-900 shadow-2xl"
          aria-roledescription="轮播图"
          aria-label="谁是伪人玩法介绍，共三页"
          onScroll={(event) => {
            const scroller = event.currentTarget;
            if (scroller.clientWidth > 0) {
              setActiveIndex(Math.max(0, Math.min(RULE_IMAGES.length - 1, Math.round(scroller.scrollLeft / scroller.clientWidth))));
            }
          }}
        >
          {RULE_IMAGES.map((src, index) => (
            <div key={src} className="w-full shrink-0 snap-center snap-always" role="group" aria-label={`第 ${index + 1} 页，共 ${RULE_IMAGES.length} 页`}>
              <img
                className="block h-auto max-h-[calc(100dvh-88px)] w-full object-contain"
                src={src}
                width={941}
                height={1672}
                alt={`谁是伪人玩法介绍第 ${index + 1} 页`}
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
              />
            </div>
          ))}
        </div>

        <div className="impostor-rules-dots" aria-label="玩法介绍分页">
          {RULE_IMAGES.map((src, index) => (
            <button
              key={src}
              type="button"
              className={index === activeIndex ? "is-active" : ""}
              aria-label={`切换到第 ${index + 1} 页`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => goTo(index)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
        <span className="sr-only" aria-live="polite">当前第 {activeIndex + 1} 页，共 {RULE_IMAGES.length} 页</span>
      </div>
    </div>,
    document.body,
  );
}
