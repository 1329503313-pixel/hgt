import { Plus, Trash2 } from "lucide-react";
import { ACTIVITY_CONDITION_LABELS, type ActivityBadgeCondition, type ActivityConditionKind } from "../BadgeVisuals";

export function newActivityCondition(): ActivityBadgeCondition {
  const today = new Date().toISOString().slice(0, 10);
  return { kind: "login", startDate: today, endDate: today };
}

export function ActivityConditionsEditor({ value, onChange, disabled = false, emptyText = "未设置条件" }: { value: ActivityBadgeCondition[]; onChange: (conditions: ActivityBadgeCondition[]) => void; disabled?: boolean; emptyText?: string }) {
  function update(index: number, patch: Partial<ActivityBadgeCondition>) {
    onChange(value.map((condition, conditionIndex) => conditionIndex === index ? { ...condition, ...patch } : condition));
  }

  function updateTimeMode(index: number, mode: "date" | "long_term") {
    const today = new Date().toISOString().slice(0, 10);
    update(index, mode === "long_term" ? { startDate: "long_term", endDate: "long_term" } : { startDate: today, endDate: today });
  }

  return (
    <div className="space-y-3">
      {value.map((condition, index) => (
        <div key={index} className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-[1.2fr_1fr_1fr_110px_auto] md:items-end">
          <label className="text-xs font-bold text-muted">条件类型<select className="field mt-1" value={condition.kind} disabled={disabled} onChange={(event) => { const kind = event.target.value as ActivityConditionKind; update(index, { kind, target: ["login", "user_joined"].includes(kind) ? undefined : (condition.target ?? 1) }); }}>{Object.entries(ACTIVITY_CONDITION_LABELS).map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}</select></label>
          <label className="text-xs font-bold text-muted">开始日期<select className="field mt-1" value={condition.startDate === "long_term" ? "long_term" : "date"} disabled={disabled} onChange={(event) => updateTimeMode(index, event.target.value as "date" | "long_term")}><option value="date">指定日期</option><option value="long_term">长期有效</option></select>{condition.startDate !== "long_term" && <input className="field mt-1" type="date" value={condition.startDate} disabled={disabled} onChange={(event) => update(index, { startDate: event.target.value })} />}</label>
          <label className="text-xs font-bold text-muted">结束日期<select className="field mt-1" value={condition.endDate === "long_term" ? "long_term" : "date"} disabled={disabled} onChange={(event) => updateTimeMode(index, event.target.value as "date" | "long_term")}><option value="date">指定日期</option><option value="long_term">长期有效</option></select>{condition.endDate !== "long_term" && <input className="field mt-1" type="date" value={condition.endDate} disabled={disabled} onChange={(event) => update(index, { endDate: event.target.value })} />}</label>
          {["login", "user_joined"].includes(condition.kind) ? <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs font-bold text-muted">无需设置次数</div> : <label className="text-xs font-bold text-muted">数量<input className="field mt-1" type="number" min={1} max={1000000} value={condition.target ?? 1} disabled={disabled} onChange={(event) => update(index, { target: Math.max(1, Number(event.target.value) || 1) })} /></label>}
          <button className="btn btn-danger h-11 px-3" type="button" disabled={disabled} onClick={() => onChange(value.filter((_, conditionIndex) => conditionIndex !== index))}><Trash2 size={15} /></button>
        </div>
      ))}
      {value.length === 0 && <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-muted">{emptyText}</p>}
      <button className="btn btn-secondary" type="button" disabled={value.length >= 8 || disabled} onClick={() => onChange([...value, newActivityCondition()])}><Plus size={15} />添加条件</button>
    </div>
  );
}
