import { X } from "lucide-react";
import { createPortal } from "react-dom";

export function Modal({
  children,
  onClose,
  full = false,
  bare = false,
  overlayClassName,
  contentClassName
}: {
  children: React.ReactNode;
  onClose: () => void;
  full?: boolean;
  bare?: boolean;
  overlayClassName?: string;
  contentClassName?: string;
}) {
  const modal = (
    <div className={`fixed inset-0 z-[100] flex items-end justify-center px-3 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center sm:p-4 ${overlayClassName ?? (bare ? "bg-slate-950/80 backdrop-blur-sm" : "bg-slate-900/40")}`}>
      <div className={`w-full overflow-auto overscroll-contain rounded-2xl ${bare ? "bg-transparent p-0 shadow-none" : "bg-white p-4 shadow-soft"} ${full ? "h-full max-h-[calc(100dvh-24px)] max-w-3xl sm:h-[88vh]" : "max-h-[calc(100dvh-24px)] max-w-md"} ${contentClassName ?? ""}`}>
        {!full && !bare && (
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
