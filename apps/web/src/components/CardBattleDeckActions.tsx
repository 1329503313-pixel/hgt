import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Pencil, SquarePen, Trash2, X } from "lucide-react";
import type { BattleCollectibleBinding } from "@hgt/shared";
import { api } from "../api";
import type { OnlineCardBattleCard, OnlineCardBattleDeck } from "../shared/types";
import { Modal } from "./Modal";
import { CardBattleDeckEditor } from "./CardBattleDeckEditor";

type Props = {
  deck: OnlineCardBattleDeck;
  cards: OnlineCardBattleCard[];
  apiPath: string;
  lineupSize?: 3 | 5;
  currentLineup?: { cardIds: string[]; collectibleBindings: BattleCollectibleBinding[] };
  disabled: boolean;
  onChanged: (deck: OnlineCardBattleDeck) => void;
  onDeleted: (deckId: string) => void;
  onBusyChange: (busy: boolean) => void;
  showToast: (message: string) => void;
};

export function CardBattleDeckActions({ deck, cards, apiPath, lineupSize = 5, currentLineup, disabled, onChanged, onDeleted, onBusyChange, showToast }: Props) {
  const [mode, setMode] = useState<"rename" | "edit" | "delete" | null>(null);
  const [name, setName] = useState(deck.name);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const title = mode === "rename" ? "修改卡组名称" : mode === "delete" ? "删除卡组" : "编辑卡组";
  const path = `${apiPath}/${encodeURIComponent(deck.id)}`;

  useEffect(() => {
    if (!mode) return;
    const previousFocus = openerRef.current;
    if (mode !== "rename") dialogRef.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [mode]);

  function setSaving(value: boolean) { busyRef.current = value; setBusy(value); onBusyChange(value); }
  const close = useCallback(() => { if (!busyRef.current) setMode(null); }, []);
  function open(next: NonNullable<typeof mode>) {
    if (disabled || busy) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setName(deck.name); setError(""); setMode(next);
  }
  async function save(name: string, cardIds?: string[], collectibleBindings?: BattleCollectibleBinding[]) {
    const { deck: saved } = await api<{ deck: OnlineCardBattleDeck }>(path, { method: "PATCH", body: { name, ...(cardIds ? { cardIds, collectibleBindings } : {}) } });
    onChanged(saved);
    setMode(null);
    showToast(cardIds ? "卡组已更新" : "卡组名称已修改");
  }
  async function submit() {
    if (busyRef.current || (mode === "rename" && !name.trim())) return;
    setSaving(true); setError("");
    try {
      if (mode === "delete") {
        await api(path, { method: "DELETE" });
        setMode(null);
        onDeleted(deck.id);
        showToast("卡组已删除");
      } else await save(name.trim());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请重试"); }
    finally { setSaving(false); }
  }

  return <>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={`${deck.name}的管理操作`}>
      <button type="button" className="btn btn-secondary min-h-11 gap-1.5" disabled={disabled || busy} onClick={() => open("rename")}><Pencil size={16} />修改名称</button>
      <button type="button" className="btn btn-secondary min-h-11 gap-1.5" disabled={disabled || busy} onClick={() => open("edit")}><SquarePen size={16} />编辑卡组</button>
      <button type="button" className="btn btn-secondary col-span-2 min-h-11 gap-1.5 text-red-600 sm:col-span-1" disabled={disabled || busy} onClick={() => open("delete")}><Trash2 size={16} />删除卡组</button>
    </div>
    {mode && <Modal full={mode === "edit"} hideCloseButton overlayClassName="!z-[120] bg-slate-900/50" onClose={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="outline-none" onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]'));
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="text-xl font-black text-ink">{title}</h2><button type="button" className="btn btn-secondary min-h-11 min-w-11" disabled={busy} onClick={close} aria-label={`关闭${title}`}><X size={18} /></button></div>
        {mode === "edit" ? <CardBattleDeckEditor cards={cards} initialDeck={deck} lineupSize={lineupSize} currentLineup={currentLineup} actionLabel="保存卡组" onSavingChange={setSaving} onSave={save} /> : <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {mode === "rename" ? <label className="block"><span className="label">卡组名称</span><input autoFocus className="field mt-1 min-h-11 w-full" value={name} maxLength={30} disabled={busy} onChange={(event) => setName(event.target.value)} /><span className="mt-1 block text-right text-xs text-muted">{name.length}/30</span></label> : <p className="break-words text-sm leading-6 text-muted">确定删除卡组“{deck.name}”吗？删除后无法恢复。你拥有的卡牌、当前上场阵容和已保存的守榜阵容不受影响。</p>}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary min-h-11" disabled={busy} onClick={close}>取消</button><button type="submit" className={`btn min-h-11 ${mode === "delete" ? "bg-red-600 text-white hover:bg-red-700" : "btn-primary"}`} disabled={busy || (mode === "rename" && !name.trim())}>{busy ? "处理中…" : mode === "delete" ? "确认删除" : "保存名称"}</button></div>
        </form>}
      </div>
    </Modal>}
  </>;
}
