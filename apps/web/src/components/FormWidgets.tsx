export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="truncate text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

export function CheckRow({
  label,
  desc,
  checked,
  onChange
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex gap-2 text-xs leading-5 text-muted">
      <input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="font-semibold text-ink">{label}</span>
        <span className="ml-1">{desc}</span>
      </span>
    </label>
  );
}

export function ScoreInput({
  label,
  desc,
  guide,
  value,
  onChange,
  required
}: {
  label: string;
  desc?: string;
  guide?: string[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="label flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {required && <span className="text-danger">*</span>}
        <span>{label}</span>
        {desc && <span className="text-xs font-normal leading-5 text-slate-600">{desc}</span>}
      </span>
      <input
        className="field"
        type="number"
        min={required ? 1 : 0}
        max={5}
        step={0.5}
        placeholder={required ? "1-5" : "可选"}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
      {guide && (
        <span className="block space-y-1 pt-1 text-xs leading-5 text-slate-600">
          {guide.map((item) => (
            <span className="block" key={item}>{item}</span>
          ))}
        </span>
      )}
    </label>
  );
}
