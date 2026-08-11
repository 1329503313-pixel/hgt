import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useApp } from "../context/AppContext";

export function GlobalToast() {
  const { toast, showToast } = useApp();
  if (!toast) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-[max(1rem,env(safe-area-inset-top))] z-[1000] flex justify-center" role="status" aria-live="polite">
      <div className="pointer-events-auto flex w-fit max-w-[min(36rem,calc(100vw-1.5rem))] items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-primary shadow-lg">
        <span>{toast}</span>
        <button type="button" onClick={() => showToast("")} className="ml-2 flex min-h-11 min-w-11 items-center justify-center" aria-label="关闭提示">
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body
  );
}
