type SoupMode = "human" | "ai";

export function OnlineSoupModePicker({ value, onChange, aiEnabled = true }: {
  value: SoupMode;
  onChange: (value: SoupMode) => void;
  aiEnabled?: boolean;
}) {
  return <div className="grid grid-cols-2 gap-2" role="group" aria-label="玩汤类型">
    {([{ value: "human", label: "文字玩汤" }, { value: "ai", label: "AI玩汤" }] as const).map(item =>
      <button type="button" key={item.value} aria-pressed={value === item.value}
        disabled={item.value === "ai" && !aiEnabled}
        className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${value === item.value ? "border-primary bg-blue-50 text-primary" : "border-line bg-white text-muted"}`}
        onClick={() => onChange(item.value)}>{item.label}</button>
    )}
  </div>;
}
