import { X } from "lucide-react";

export function Modal({
  children,
  onClose,
  full = false
}: {
  children: React.ReactNode;
  onClose: () => void;
  full?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-900/30 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className={`w-full overflow-auto bg-white p-4 shadow-soft sm:rounded-[20px] ${full ? "h-full max-w-3xl sm:h-[88vh]" : "max-h-[80vh] max-w-md rounded-t-lg"}`}>
        {!full && (
          <div className="mb-3 flex justify-end sm:hidden">
            <button className="btn btn-secondary px-3" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
