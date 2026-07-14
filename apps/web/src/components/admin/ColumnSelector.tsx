import { Columns3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type AdminColumn<Key extends string = string> = {
  key: Key;
  label: string;
  width: string;
};

export function ColumnSelector<Key extends string>({
  columns,
  visible,
  onChange
}: {
  columns: readonly AdminColumn<Key>[];
  visible: ReadonlySet<Key>;
  onChange: (next: Set<Key>) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(key: Key) {
    const next = new Set(visible);
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        className="btn btn-secondary h-9 px-3 text-xs whitespace-nowrap"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Columns3 size={15} />
        显示字段
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-line bg-white p-2 shadow-soft">
          <div className="mb-1 px-2 py-1 text-xs font-bold text-muted">选择列表字段</div>
          {columns.map((column) => (
            <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-blue-50">
              <input
                type="checkbox"
                checked={visible.has(column.key)}
                onChange={() => toggle(column.key)}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function gridTemplate<Key extends string>(columns: readonly AdminColumn<Key>[], visible: ReadonlySet<Key>) {
  return columns.filter((column) => visible.has(column.key)).map((column) => column.width).join(" ");
}
