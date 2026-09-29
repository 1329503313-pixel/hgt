import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { CardBattleTrait } from "@hgt/shared";

export function CardBattleTraitFilter({
  traits,
  selectedTraitId,
  onSelect,
}: {
  traits: Pick<CardBattleTrait, "id" | "name" | "description">[];
  selectedTraitId: string | null;
  onSelect: (traitId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = traits.find((trait) => trait.id === selectedTraitId);
  return <div className="relative min-w-0">
    <button type="button" className={`inline-flex h-9 max-w-48 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-black transition active:scale-95 ${selected ? "border-violet-200 bg-violet-50 text-violet-800" : "border-line bg-white text-ink"}`} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((value) => !value)}>
      <Search size={14} /><span className="truncate">{selected?.name ?? "查找特质"}</span><ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="absolute left-0 top-full z-30 mt-2 w-[min(88vw,34rem)] rounded-2xl border border-line bg-white p-3 shadow-xl" role="listbox" aria-label="全部特质">
      <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
        <button type="button" role="option" aria-selected={selectedTraitId === null} className={`max-w-full truncate rounded-full border px-3 py-1.5 text-xs font-bold ${selectedTraitId === null ? "border-primary bg-primary text-white" : "border-line bg-slate-50 text-ink"}`} onClick={() => { onSelect(null); setOpen(false); }}>全部特质</button>
        {traits.map((trait) => <button key={trait.id} type="button" role="option" aria-selected={selectedTraitId === trait.id} title={trait.description ? `${trait.name}：${trait.description}` : trait.name} className={`max-w-full truncate rounded-full border px-3 py-1.5 text-xs font-bold ${selectedTraitId === trait.id ? "border-primary bg-primary text-white" : "border-violet-100 bg-violet-50 text-violet-800 hover:border-violet-300"}`} onClick={() => { onSelect(selectedTraitId === trait.id ? null : trait.id); setOpen(false); }}>{trait.name}</button>)}
        {!traits.length && <p className="px-1 py-2 text-xs text-muted">暂无可查找的特质</p>}
      </div>
    </div>}
  </div>;
}
