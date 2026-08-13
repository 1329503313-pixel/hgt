import { useId } from "react";
import { Search } from "lucide-react";

export function DesktopGlobalSearch({
  value,
  onChange,
  onSubmit,
  className = ""
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
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
      <label className="sr-only" htmlFor={inputId}>搜索海龟汤或用户昵称</label>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        placeholder="搜索海龟汤或用户昵称..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="submit" aria-label="搜索"><Search size={18} /></button>
    </form>
  );
}
