import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const MESSAGE_RECALL_WINDOW_MS = 2 * 60_000;

export function canRecallMessage(createdAt: string, recalledAt?: string | null) {
  const createdTime = new Date(createdAt).getTime();
  const age = Date.now() - createdTime;
  return !recalledAt && Number.isFinite(createdTime) && age >= 0 && age <= MESSAGE_RECALL_WINDOW_MS;
}

type MessageAction = {
  label: string;
  tone?: "default" | "danger";
  availableUntil?: number;
  onSelect: () => void;
};

export function MessageActionMenu({
  actions,
  className = "",
  children
}: {
  actions: MessageAction[];
  className?: string;
  children: React.ReactNode;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [visibleActions, setVisibleActions] = useState<MessageAction[]>([]);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const ignoreContextMenuUntilRef = useRef(0);

  function cancelTimer() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }

  function open(x: number, y: number) {
    const available = actions.filter((action) => action.availableUntil == null || Date.now() <= action.availableUntil);
    if (!available.length) return;
    const horizontalInset = Math.min(
      Math.max(72, available.length * 32),
      Math.max(8, window.innerWidth / 2 - 8)
    );
    suppressClickRef.current = true;
    setVisibleActions(available);
    setPosition({
      x: Math.max(horizontalInset, Math.min(window.innerWidth - horizontalInset, x)),
      y: Math.max(64, Math.min(window.innerHeight - 12, y))
    });
  }

  useEffect(() => () => cancelTimer(), []);
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [position]);

  return (
    <>
      <div
        className={`touch-pan-y select-none [-webkit-touch-callout:none] ${className}`}
        onPointerDown={(event) => {
          if (!actions.length || event.button !== 0) return;
          cancelTimer();
          suppressClickRef.current = false;
          startRef.current = { x: event.clientX, y: event.clientY };
          timerRef.current = window.setTimeout(() => {
            ignoreContextMenuUntilRef.current = Date.now() + 800;
            open(event.clientX, event.clientY);
          }, 550);
        }}
        onPointerMove={(event) => {
          const start = startRef.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelTimer();
        }}
        onPointerUp={cancelTimer}
        onPointerCancel={cancelTimer}
        onPointerLeave={cancelTimer}
        onContextMenu={(event) => {
          if (!actions.length) return;
          event.preventDefault();
          cancelTimer();
          if (Date.now() >= ignoreContextMenuUntilRef.current) open(event.clientX, event.clientY);
        }}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }}
        onDragStart={(event) => {
          if (actions.length) event.preventDefault();
        }}
      >
        {children}
      </div>
      {position && createPortal(
        <div className="fixed inset-0 z-[180]" onPointerDown={() => setPosition(null)} role="presentation">
          <div
            className="absolute flex -translate-x-1/2 -translate-y-full overflow-hidden rounded-lg bg-slate-800 py-1 text-sm font-bold text-white shadow-[0_12px_32px_rgba(15,23,42,.35)]"
            style={{ left: position.x, top: position.y - 8 }}
            role="menu"
            aria-label="消息操作"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {visibleActions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                className={`min-h-11 min-w-16 whitespace-nowrap px-4 py-2.5 transition hover:bg-white/10 active:bg-white/15 ${
                  action.tone === "danger" ? "text-red-300" : "text-white"
                }`}
                onClick={() => {
                  setPosition(null);
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export function RecalledMessageNotice({ mine, senderName }: { mine: boolean; senderName?: string | null }) {
  return (
    <p className="py-1 text-center text-xs text-slate-400" role="status">
      {mine ? "你撤回了一条消息" : `${senderName || "对方"}撤回了一条消息`}
    </p>
  );
}
