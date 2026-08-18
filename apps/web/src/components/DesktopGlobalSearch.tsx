import { useId } from "react";
import { Search } from "lucide-react";

export function DesktopGlobalSearch({
  value,
  onChange,
  onSubmit,
  placeholder = "搜索海龟汤或用户昵称...",
  className = ""
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  className?: string;
}) {
  const inputId = useId();

  return (
    <form
      className={`home-desktop-search-box ${className}`}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="sr-only" htmlFor={inputId}>{placeholder.replace(/\.{3}$/, "")}</label>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="submit" aria-label="搜索"><Search size={18} /></button>
    </form>
  );
}
