import { useEffect, useRef, type ReactNode } from "react";

export function MentionableAvatarButton({ canMention, onMention, onOpen, ariaLabel, className, children }: {
  canMention: boolean;
  onMention: () => void;
  onOpen: () => void;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const cancelTimer = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <button
      type="button"
      className={`${canMention ? "mention-avatar-trigger" : ""} ${className ?? ""}`.trim() || undefined}
      aria-label={ariaLabel}
      onPointerDown={() => {
        longPressedRef.current = false;
        if (!canMention) return;
        cancelTimer();
        timerRef.current = window.setTimeout(() => {
          longPressedRef.current = true;
          onMention();
        }, 550);
      }}
      onPointerUp={cancelTimer}
      onPointerCancel={cancelTimer}
      onPointerLeave={cancelTimer}
      onContextMenu={(event) => {
        if (canMention) event.preventDefault();
      }}
      onDragStart={(event) => {
        if (canMention) event.preventDefault();
      }}
      onClick={(event) => {
        if (longPressedRef.current) {
          event.preventDefault();
          longPressedRef.current = false;
          return;
        }
        onOpen();
      }}
    >
      {children}
    </button>
  );
}
