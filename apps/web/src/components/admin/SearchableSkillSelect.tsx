import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type SkillSelectOption<T extends string> = { value: T; label: string; disabled?: boolean };

/** Free text is only a search draft. Only an explicit option choice commits a value. */
export function SearchableSkillSelect<T extends string>({ label, value, options, onChange, hint }: {
  label: string;
  value: T | "";
  options: readonly SkillSelectOption<T>[];
  onChange: (value: T | "") => void;
  hint?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<T | null>(null);
  const [touched, setTouched] = useState(false);
  const matches = options.filter((option) => option.label.toLocaleLowerCase().includes((query ?? "").trim().toLocaleLowerCase()));
  const enabled = matches.filter((option) => !option.disabled);
  const selected = options.find((option) => option.value === value && !option.disabled);
  const activeOption = matches.find((option) => option.value === active && !option.disabled);
  const invalid = touched && !selected && !open;

  useEffect(() => {
    const container = list.current;
    const option = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !option) return;
    if (option.offsetTop < container.scrollTop) container.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = option.offsetTop + option.offsetHeight - container.clientHeight;
    }
  }, [active, open]);

  const dismiss = () => {
    setQuery(null);
    setOpen(false);
    setActive(null);
    setTouched(true);
  };
  const choose = (option: SkillSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery(null);
    setOpen(false);
    setActive(null);
  };
  return <div className="min-w-0">
    <label htmlFor={id} className="text-xs font-bold">{label}</label>
    <div className={`relative mt-1 ${open ? "z-30" : ""}`}>
      <input ref={input} id={id} role="combobox" type="text" autoComplete="off" required
        aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
        aria-activedescendant={open && activeOption ? `${id}-${activeOption.value}` : undefined}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="field min-h-11 w-full pr-9" placeholder={`搜索并选择${label}`}
        value={query ?? selected?.label ?? ""}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(null);
          if (value !== "") onChange("");
        }}
        onBlur={dismiss}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const index = enabled.findIndex((option) => option.value === active);
            const next = index < 0 ? (event.key === "ArrowDown" ? 0 : enabled.length - 1)
              : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
            setActive(enabled[next]?.value ?? null);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open && activeOption) choose(activeOption);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }
        }} />
      <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-3.5 text-muted" />
      {open && <div ref={list} id={`${id}-list`} role="listbox" aria-label={`${label}匹配选项`}
        className="absolute inset-x-0 top-full mt-1 max-h-60 min-h-3 overflow-y-auto overscroll-contain rounded-xl border border-line bg-white p-1 shadow-soft"
        onMouseDown={(event) => event.preventDefault()}>
        {matches.map((option) => <button key={option.value} id={`${id}-${option.value}`} role="option" type="button"
          tabIndex={-1} aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          disabled={option.disabled} data-value={option.value} data-active={option.value === active}
          className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm leading-5 ${option.disabled ? "cursor-not-allowed text-muted opacity-50" : option.value === active ? "bg-violet-100 text-violet-900" : "text-ink hover:bg-violet-50"}`}
          onClick={() => choose(option)}>{option.label}</button>)}
      </div>}
    </div>
    {hint && <span id={`${id}-hint`} className="mt-1 block text-[11px] leading-4 text-muted">{hint}</span>}
    {invalid && <span id={`${id}-error`} className="mt-1 block text-xs text-red-700">请从下拉列表选择{label}</span>}
    <span role="status" className="sr-only">{open ? `${matches.length} 个匹配选项` : ""}</span>
  </div>;
}
