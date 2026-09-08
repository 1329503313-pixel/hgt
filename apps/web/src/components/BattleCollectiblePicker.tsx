import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Gem, Search, X } from "lucide-react";
import type { BattleCollectible, BattleCollectibleBinding } from "@hgt/shared";
import { api } from "../api";
import type { OnlineCardBattleCard } from "../shared/types";
import { Modal } from "./Modal";

type Props = {
  cards: Array<OnlineCardBattleCard | null>;
  bindings: BattleCollectibleBinding[];
  disabled: boolean;
  onSave: (bindings: BattleCollectibleBinding[]) => Promise<boolean>;
  onClose: () => void;
};

export function BattleCollectiblePicker({ cards, bindings, disabled, onSave, onClose }: Props) {
  const [items, setItems] = useState<BattleCollectible[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BattleCollectible | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void api<{ collectibles: BattleCollectible[] }>("/api/me/collectibles", { bypassCache: true })
      .then((data) => { if (!cancelled) setItems(data.collectibles); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "收藏品加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => { if (!saving) dialogRef.current?.focus(); }, [selected, saving]);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (!saving) selected ? setSelected(null) : onClose();
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [selected, saving, onClose]);
  async function save(next: BattleCollectibleBinding[]) {
    if (saving || disabled) return;
    setSaving(true);
    try { if (await onSave(next)) setSelected(null); }
    finally { setSaving(false); }
  }
  const filtered = items.filter((item) => `${item.collectibleNo} ${item.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Modal full overlayClassName="!z-[130] bg-slate-950/70" onClose={() => { if (!saving) selected ? setSelected(null) : onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="battle-collectible-title" tabIndex={-1} className="outline-none" onKeyDown={(event) => {
      if (event.key === "Tab") {
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]'));
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-white pb-3">
        {selected && <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-slate-100" disabled={saving} aria-label="返回收藏品列表" onClick={() => setSelected(null)}><ArrowLeft size={20} /></button>}
        <div className="min-w-0 flex-1"><h2 id="battle-collectible-title" className="text-xl font-black text-ink">{selected ? "选择绑定卡牌" : "装配收藏品"}</h2><p className="mt-1 text-sm text-muted">{selected ? `将“${selected.name}”绑定到一张在场卡牌` : "先选择收藏品，再选择在场卡牌。每张卡最多装配一件。"}</p></div>
        <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-slate-100" disabled={saving} aria-label="关闭装配收藏品" onClick={onClose}><X size={20} /></button>
      </header>
      {selected ? <>
        <p className="mb-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm leading-6 text-muted">{selected.battleEffectDescription || "暂无卡牌对战效果描述"}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{cards.map((card, index) => {
          const previous = bindings.find((b) => b.cardId === card?.id);
          const equipped = items.find((item) => item.id === previous?.collectibleId);
          return card && <button key={card.id} type="button" disabled={saving || disabled} aria-pressed={previous?.collectibleId === selected.id} onClick={() => void save([...bindings.filter((b) => b.cardId !== card.id && b.collectibleId !== selected.id), { cardId: card.id, collectibleId: selected.id }])} className="min-h-11 overflow-hidden rounded-xl border border-line p-2 text-left transition hover:border-primary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
            <img className="aspect-[5/7] w-full rounded-lg object-cover" src={card.imageUrl} alt={card.name} />
            <p className="mt-2 text-xs font-bold text-primary">卡位 {index + 1} · {equipped ? `替换：${equipped.name}` : previous ? "替换失效收藏品" : "未装配"}</p>
            <p className="mt-1 break-words text-sm font-black text-ink">{card.name}</p>
          </button>;
        })}</div>
        {!cards.some(Boolean) && <p className="py-10 text-center text-muted">请先在战场选择卡牌。</p>}
      </> : <>
        <label className="mb-4 block"><span className="label flex items-center gap-1"><Search size={15} />搜索收藏品名称或序号</span><input className="field mt-1 min-h-11" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        {loading && <p className="py-10 text-center text-muted" role="status">收藏品加载中…</p>}
        {error && <div role="alert" className="py-6 text-center text-red-600"><p>{error}</p><button className="btn btn-secondary mt-3" onClick={() => setAttempt((value) => value + 1)}>重试</button></div>}
        {!loading && !error && <div className="space-y-3">{filtered.map((item) => {
          const binding = bindings.find((b) => b.collectibleId === item.id);
          const card = cards.find((card) => card?.id === binding?.cardId);
          return <article key={item.id} className={`rounded-xl border p-3 ${binding ? "border-primary bg-blue-50/40" : "border-line bg-white"}`}>
            <button type="button" disabled={disabled || saving} onClick={() => setSelected(item)} className="flex min-h-11 w-full gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
              <img className="h-24 w-20 shrink-0 rounded-lg object-cover" src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" />
              <div className="min-w-0 flex-1"><p className="text-xs font-bold text-primary">NO.{item.collectibleNo}</p><h3 className="mt-1 break-words text-base font-black text-ink">{item.name}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{item.battleEffectDescription || "暂无卡牌对战效果描述"}</p></div>
            </button>
            {binding && <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2"><span className="flex min-w-0 items-center gap-1 text-sm font-bold text-primary"><Check size={16} className="shrink-0" />已绑定：{card?.name ?? "当前卡牌"}</span><button type="button" className="btn btn-secondary min-h-11 shrink-0" disabled={saving || disabled} onClick={() => void save(bindings.filter((b) => b.collectibleId !== item.id))}>卸下</button></div>}
          </article>;
        })}</div>}
        {!loading && !error && bindings.some((b) => !items.some((item) => item.id === b.collectibleId)) && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"><p>部分已绑定收藏品不再拥有，请卸下后重新准备。</p><button type="button" className="btn btn-secondary mt-2" disabled={saving || disabled} onClick={() => void save(bindings.filter((b) => items.some((item) => item.id === b.collectibleId)))}>卸下失效收藏品</button></div>}
        {!loading && !error && !filtered.length && <div className="py-10 text-center text-muted"><Gem className="mx-auto mb-3" size={32} /><p>{items.length ? "没有匹配的收藏品" : "暂无拥有的收藏品"}</p></div>}
      </>}
      {saving && <p role="status" className="mt-4 text-center text-sm text-primary">正在保存绑定…</p>}
    </div>
  </Modal>;
}
