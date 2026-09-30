import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { registerAndroidBackHandler } from "../android/backStack";

export function Modal({
  children,
  onClose,
  full = false,
  bare = false,
  overlayClassName,
  contentClassName,
  contentRef,
  onContentScroll,
  hideClose = false,
  hideCloseButton = false,
  ariaLabel
}: {
  children: React.ReactNode;
  onClose: () => void;
  full?: boolean;
  bare?: boolean;
  overlayClassName?: string;
  contentClassName?: string;
  contentRef?: React.Ref<HTMLDivElement>;
  onContentScroll?: React.UIEventHandler<HTMLDivElement>;
  hideClose?: boolean;
  hideCloseButton?: boolean;
  ariaLabel?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (hideClose) return;
    return registerAndroidBackHandler(onClose);
  }, [hideClose, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!ariaLabel) {
      const heading = dialog.querySelector<HTMLElement>("h1, h2, h3");
      if (heading?.textContent?.trim()) dialog.setAttribute("aria-label", heading.textContent.trim());
    }
    if (!dialog.contains(document.activeElement)) {
      const first = dialog.querySelector<HTMLElement>("[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      (first ?? dialog).focus({ preventScroll: true });
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll("[data-hgt-modal]");
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape" && !hideClose) {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
    };
  }, [ariaLabel, hideClose]);

  function setContentRef(node: HTMLDivElement | null) {
    dialogRef.current = node;
    if (typeof contentRef === "function") contentRef(node);
    else if (contentRef) (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }

  const modal = (
    <div className={`fixed inset-0 z-[100] flex items-end justify-center px-3 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center sm:p-4 ${overlayClassName ?? (bare ? "bg-slate-950/80 backdrop-blur-sm" : "bg-slate-900/40")}`}>
      <div ref={setContentRef} data-hgt-modal role="dialog" aria-modal="true" aria-label={ariaLabel ?? "对话框"} tabIndex={-1} onScroll={onContentScroll} className={`w-full overflow-auto overscroll-contain rounded-2xl ${bare ? "bg-transparent p-0 shadow-none" : "bg-white p-4 shadow-soft"} ${full ? "h-full max-h-[calc(100dvh-24px)] max-w-3xl sm:h-[88vh]" : "max-h-[calc(100dvh-24px)] max-w-md"} ${contentClassName ?? ""}`}>
        {!full && !bare && !hideClose && !hideCloseButton && (
          <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-2 flex justify-end bg-white/95 py-1 backdrop-blur">
            <button
              type="button"
              className="btn btn-secondary px-3"
              onClick={onClose}
              aria-label="关闭窗口"
              title="关闭"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}
