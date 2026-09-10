import { useEffect, useMemo, useState } from "react";
import { Gem, Plus, Search } from "lucide-react";
import type { BattleCollectibleBinding, CardTowerFormation } from "@hgt/shared";
import type { OnlineCardBattleCard, OnlineCardBattleDeck } from "../shared/types";
import { filterCardBattleSelection, type CardBattleRoleFilter } from "../shared/cardBattleSelection";
import { CARD_BATTLE_ROLE_LABELS } from "../shared/digitalAssets";
import { BattleCollectiblePicker } from "./BattleCollectiblePicker";

export function CardBattleDeckEditor({ cards, actionLabel, onSave, initialDeck, lineupSize = 5, currentLineup, onSavingChange, tower }: {
  tower?: { formation: CardTowerFormation; onChange: (formation: CardTowerFormation) => Promise<void> };
  cards: OnlineCardBattleCard[];
  actionLabel: string;
  onSave: (name: string, cardIds: string[], bindings: BattleCollectibleBinding[]) => Promise<void>;
  initialDeck?: Pick<OnlineCardBattleDeck, "name" | "cardIds" | "collectibleBindings">;
  lineupSize?: 3 | 5;
  currentLineup?: { cardIds: string[]; collectibleBindings: BattleCollectibleBinding[] };
  onSavingChange?: (saving: boolean) => void;
}) {
  const slots = lineupSize === 3 ? ["前排 1", "后排 1", "后排 2"] : ["前排 1", "前排 2", "后排 1", "后排 2", "后排 3"];
  const [name, setName] = useState(initialDeck?.name ?? "默认卡组");
  const [selectedIds, setSelectedIds] = useState<Array<string | null>>(() => Array.from({ length: lineupSize }, (_, index) => tower?.formation.cardIds[index] ?? initialDeck?.cardIds[index] ?? null));
  const [slot, setSlot] = useState(0);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<CardBattleRoleFilter>("all");
  const [sort, setSort] = useState("number");
  const [view, setView] = useState<"stats" | "skill">("stats");
  const [bindings, setBindings] = useState<BattleCollectibleBinding[]>(tower?.formation.collectibleBindings ?? initialDeck?.collectibleBindings ?? []);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (tower && !saving) { setSelectedIds([...tower.formation.cardIds]); setBindings([...tower.formation.collectibleBindings]); } }, [tower?.formation, saving]);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const selected = selectedIds.map((id) => id ? cardsById.get(id) ?? null : null);
  const filtered = filterCardBattleSelection(cards, query, role).sort((a, b) =>
    (sort === "star" ? b.starLevel - a.starLevel : sort === "power" ? b.combatPower - a.combatPower : sort === "rarity" ? Number(b.rarity === "legend") - Number(a.rarity === "legend") : 0)
      || a.cardNo.localeCompare(b.cardNo, "zh-CN", { numeric: true }));
  const complete = selected.every(Boolean) && new Set(selectedIds).size === lineupSize;

  async function commitFormation(ids: Array<string | null>, nextBindings: BattleCollectibleBinding[]) {
    if (!tower || saving) return false;
    setSaving(true); onSavingChange?.(true); setError("");
    try { await tower.onChange({ cardIds: ids, collectibleBindings: nextBindings }); setSelectedIds(ids); setBindings(nextBindings); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "阵容保存失败，请重试"); return false; }
    finally { setSaving(false); onSavingChange?.(false); }
  }
  async function choose(cardId: string) {
    if (saving || selectedIds.some((id, index) => id === cardId && index !== slot)) return;
    const next = selectedIds.map((id, index) => index === slot ? cardId : id);
    const nextBindings = bindings.filter((binding) => next.includes(binding.cardId));
    if (tower) { if (!await commitFormation(next, nextBindings)) return; }
    else { setSelectedIds(next); setBindings(nextBindings); }
    const empty = next.findIndex((id) => !id);
    if (empty >= 0) setSlot(empty);
    setError("");
  }

  async function save() {
    if (saving || !complete) return;
    if (!name.trim()) { setError("请输入卡组名称"); return; }
    setSaving(true); onSavingChange?.(true); setError("");
    try { await onSave(name.trim(), selectedIds as string[], bindings); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "卡组保存失败，请重试"); }
    finally { setSaving(false); onSavingChange?.(false); }
  }

  return <section className="mt-5 space-y-4" aria-label={initialDeck ? "编辑卡组卡牌" : "配置默认卡组"}>
    <div className="rounded-xl bg-violet-50 p-3 text-sm leading-6 text-violet-800">{tower ? "点击卡位，再选择卡牌。每次修改自动保存；与其他阵容重复的卡牌或收藏品会从原阵容卸下。" : initialDeck ? "点击下方卡面选择要更换的位置，再从卡牌列表选择新卡。保存后生效。" : "还没有卡组，在这里选择五张不同卡牌。"}{lineupSize === 3 ? "第一个位置为前排，后两个位置为后排。" : "前两个位置为前排，后三个位置为后排。"}</div>
    {!tower && <label className="block"><span className="label">卡组名称</span><input className="field mt-1 min-h-11 w-full" maxLength={30} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} /></label>}
    {tower && <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" disabled={saving || !selectedIds[slot]} onClick={() => { const ids = selectedIds.map((id, i) => i === slot ? null : id); void commitFormation(ids, bindings.filter((binding) => ids.includes(binding.cardId))); }}>卸下当前卡位</button>{[-1, 1].map((direction) => <button key={direction} className="btn btn-secondary" disabled={saving || slot + direction < 0 || slot + direction >= 5} onClick={() => { const ids = [...selectedIds]; [ids[slot], ids[slot + direction]] = [ids[slot + direction]!, ids[slot]!]; void commitFormation(ids, bindings).then((ok) => { if (ok) setSlot(slot + direction); }); }}>{direction < 0 ? "与左侧换位" : "与右侧换位"}</button>)}</div>}
    {currentLineup?.cardIds.length === lineupSize && <button type="button" className="btn btn-secondary min-h-11 w-full" disabled={saving} onClick={() => { setSelectedIds([...currentLineup.cardIds]); setBindings([...currentLineup.collectibleBindings]); setError(""); }}>用当前阵容覆盖卡组</button>}
    <div className={`grid ${lineupSize === 3 ? "grid-cols-3" : "grid-cols-5"} gap-2`}>{selected.map((card, index) => <button key={index} type="button" disabled={saving} aria-label={`配置${slots[index]}`} aria-pressed={slot === index} onClick={() => setSlot(index)} className={`min-h-11 min-w-0 rounded-xl border-2 p-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${slot === index ? "border-violet-500 bg-violet-50" : "border-line bg-white"}`}>
      <span className="mb-1 block text-xs font-bold text-primary">{slots[index]}</span>
      <span className="relative block aspect-[5/7] overflow-hidden rounded-lg bg-slate-100">{card ? <img className="h-full w-full object-cover" src={card.imageUrl} alt={card.name} /> : <span className="grid h-full place-items-center text-slate-400"><Plus size={22} /></span>}</span>
      <span className="mt-1 block truncate text-xs font-bold text-ink">{card?.name ?? (selectedIds[index] ? "卡牌不可用，点击更换" : "选择卡牌")}</span>
    </button>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted" role="status">已选 {selected.filter(Boolean).length}/{lineupSize} 张 · 正在配置{slots[slot]}</p><button type="button" className="btn btn-secondary min-h-11" disabled={saving || !selected.some(Boolean)} onClick={() => setEquipmentOpen(true)}><Gem size={16} />装配收藏品{bindings.length ? `（${bindings.length}）` : ""}</button></div>
    <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
      <label><span className="label inline-flex items-center gap-1"><Search size={14} />搜索卡牌</span><input className="field mt-1 min-h-11 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称或编号" /></label>
      <label><span className="label">卡牌定位</span><select className="field mt-1 min-h-11 w-full" value={role} onChange={(event) => setRole(event.target.value as CardBattleRoleFilter)}><option value="all">全部</option>{Object.entries(CARD_BATTLE_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="min-w-0"><span className="sr-only">卡牌排序方式</span><select className="field min-h-11" value={sort} onChange={(event) => setSort(event.target.value)}><option value="number">按编号排序</option><option value="rarity">按品质排序</option><option value="star">按星级排序</option><option value="power">按战力排序</option></select></label>
      <div className="flex gap-2" aria-label="卡牌信息视角"><button type="button" aria-pressed={view === "stats"} className={`btn min-h-11 ${view === "stats" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("stats")}>数值</button><button type="button" aria-pressed={view === "skill"} className={`btn min-h-11 ${view === "skill" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("skill")}>技能</button></div>
    </div>
    {cards.length < lineupSize && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">当前只有 {cards.length} 张可参战卡牌，需要 {lineupSize} 张不同的史诗或传说卡牌才能保存卡组。</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{filtered.map((card) => {
      const usedAt = selectedIds.indexOf(card.id);
      return <button key={card.id} type="button" aria-label={`选择${card.name}`} aria-pressed={selectedIds[slot] === card.id} disabled={saving || (usedAt >= 0 && usedAt !== slot)} onClick={() => choose(card.id)} className="min-w-0 rounded-xl border border-line p-2 text-left transition hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
        <img className="aspect-[5/7] w-full rounded-lg object-cover" src={card.imageUrl} alt={card.name} loading="lazy" />
        <p className="mt-2 truncate text-sm font-bold text-ink">{card.name}</p><p className="mt-1 text-xs text-muted">{card.starLevel} 星 · {CARD_BATTLE_ROLE_LABELS[card.battleRole]}</p><p className="mt-1 text-xs font-bold text-amber-700">战力 {card.combatPower.toLocaleString()}</p>
        {view === "stats" ? <dl className="mt-2 space-y-1 text-xs text-muted">{[["生命",card.stats.maxHp],["攻击",card.stats.attack],["防御",card.stats.defense],["速度",card.stats.speed],["能量",card.stats.energyRequired]].map(([label,value]) => <div key={label} className="flex justify-between gap-1"><dt>{label}</dt><dd className="font-bold tabular-nums text-ink">{value}</dd></div>)}</dl> : <div className="mt-2 text-xs leading-5"><p className="font-bold text-violet-700">{card.skillName || "无技能"}</p><p className="whitespace-pre-wrap break-words text-muted">{card.skillDescription || "暂无技能描述"}</p></div>}
        {usedAt >= 0 && <p className="mt-1 text-xs font-bold text-violet-700">已配置{slots[usedAt]}</p>}
      </button>;
    })}</div>
    {!filtered.length && cards.length > 0 && <p className="py-6 text-center text-sm text-muted">没有匹配的卡牌</p>}
    <div className="sticky bottom-0 border-t border-line bg-white py-3">
      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}
      {tower ? <p role="status" className="text-center text-sm text-muted">{saving ? "正在保存阵容…" : "修改自动保存，下次进入仍会保留"}</p> : <button type="button" className="btn btn-primary min-h-12 w-full" disabled={!complete || saving || !name.trim()} onClick={() => void save()}>{saving ? "保存中…" : actionLabel}</button>}
    </div>
    {equipmentOpen && <BattleCollectiblePicker cards={selected} bindings={bindings} disabled={saving} onSave={async (next) => { if (tower) return commitFormation(selectedIds, next); setBindings(next); return true; }} onClose={() => setEquipmentOpen(false)} />}
  </section>;
}
