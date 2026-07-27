import { useEffect, useRef, useState } from "react";
import { Check, Minus, Shell, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { GiftCatalogItem, GiftMessage } from "../shared/types";
import { publishShellBalance, useShellBalance } from "../shared/useShellBalance";

export type GiftSource = {
  type: "profile" | "private" | "circle" | "online_soup";
  id?: string;
};

const quickQuantities = [1, 9, 66, 188, 666];

export function GiftDrawer({
  open,
  recipient,
  isFollowing,
  source,
  onClose,
  onSent
}: {
  open: boolean;
  recipient: { id: string; nickname: string };
  isFollowing: boolean;
  source: GiftSource;
  onClose: () => void;
  onSent?: (gift: GiftMessage, recipientCharmValue: number) => void;
}) {
  const { user, showToast } = useApp();
  const [gifts, setGifts] = useState<GiftCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const shellBalance = useShellBalance(user?.id);
  const holdTimer = useRef<number | null>(null);
  const holdInterval = useRef<number | null>(null);

  function stopHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (holdInterval.current) window.clearInterval(holdInterval.current);
    holdTimer.current = null;
    holdInterval.current = null;
  }

  useEffect(() => () => stopHold(), []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void api<{ gifts: GiftCatalogItem[] }>("/api/gifts", { bypassCache: true })
      .then((data) => {
        setGifts(data.gifts);
        if (data.gifts.length) {
          setSelectedId((current) => data.gifts.some((gift) => gift.id === current) ? current : data.gifts[0].id);
          setQuantity(1);
        }
      })
      .catch((error) => showToast((error as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;
  const selected = gifts.find((gift) => gift.id === selectedId) ?? null;

  function selectGift(id: string) {
    if (selectedId === id) return;
    setSelectedId(id);
    setQuantity(1);
  }

  function startHold() {
    stopHold();
    holdTimer.current = window.setTimeout(() => {
      holdInterval.current = window.setInterval(() => setQuantity((value) => Math.min(666, value + 1)), 90);
    }, 420);
  }

  async function sendGift() {
    if (!selected || sending) return;
    if (!isFollowing) {
      showToast("必须先关注该用户才能送礼");
      return;
    }
    setSending(true);
    try {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await api<{ gift: GiftMessage; shellBalance: number; recipientCharmValue: number }>(
        `/api/users/${recipient.id}/gifts/send`,
        { method: "POST", body: { giftId: selected.id, quantity, requestId, source } }
      );
      publishShellBalance(user?.id, result.shellBalance);
      showToast(`已送出 ${selected.name} ×${quantity}`);
      onSent?.(result.gift, result.recipientCharmValue);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-full max-w-2xl rounded-t-[28px] bg-white px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-black text-ink">送给 {recipient.nickname}</h2><p className="text-xs text-muted">{isFollowing ? "选择一种礼物，可一次送出多份" : "关注对方后才可送礼"}</p></div>
          <button className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-muted" onClick={onClose} aria-label="关闭送礼弹框"><X size={18} /></button>
        </div>

        <div className="mt-4 max-h-[184px] overflow-y-auto overscroll-contain pr-1">
          {loading ? <div className="py-16 text-center text-sm text-muted">正在加载礼物…</div> : gifts.length === 0 ? (
            <div className="py-16 text-center"><p className="font-bold text-ink">暂时没有可赠送的礼物</p><p className="mt-1 text-xs text-muted">管理员上架礼物后会显示在这里</p></div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {gifts.map((gift) => {
                const selectedGift = selectedId === gift.id;
                return (
                  <button
                    key={gift.id}
                    className={`relative min-w-0 rounded-2xl border p-2 text-center transition ${selectedGift ? "border-primary bg-blue-50 ring-1 ring-primary" : "border-line bg-slate-50"}`}
                    onClick={() => selectGift(gift.id)}
                    onPointerDown={() => selectedGift && startHold()}
                    onPointerUp={stopHold}
                    onPointerCancel={stopHold}
                    onPointerLeave={stopHold}
                  >
                    {selectedGift && <span className="absolute left-1 top-1 rounded-full bg-primary px-1.5 text-[10px] font-black text-white">{quantity}</span>}
                    {selectedGift && quantity > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white"
                        onClick={(event) => { event.stopPropagation(); setQuantity((value) => Math.max(1, value - 1)); }}
                      ><Minus size={12} strokeWidth={3} /></span>
                    )}
                    <img className="mx-auto h-12 w-12 object-contain" src={gift.iconUrl} alt={gift.name} loading="lazy" />
                    <p className="mt-1 truncate text-xs font-black text-ink">{gift.name}</p>
                    <p className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700"><Shell size={10} />{gift.costAmount}</p>
                    {selectedGift && <Check className="absolute bottom-1 right-1 text-primary" size={13} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected && (
          <div className="mt-4">
            <div className="flex gap-1.5 overflow-x-auto pb-2">
              {quickQuantities.map((value) => <button key={value} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${quantity === value ? "border-primary bg-primary text-white" : "border-line text-ink"}`} onClick={() => setQuantity(value)}>送出{value}份</button>)}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="min-w-0 flex-1 text-xs text-muted">
                <p className="truncate">{selected.description || selected.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-bold">
                  <span className="text-amber-700">合计消耗 {(selected.costAmount * quantity).toLocaleString()} 贝壳</span>
                  <span>贝壳余额 <strong className="text-ink">{shellBalance == null ? "—" : shellBalance.toLocaleString()}</strong></span>
                </p>
              </div>
              <button className="btn btn-primary min-w-28" disabled={!isFollowing || sending} onClick={() => void sendGift()}>{sending ? "送出中…" : "送出"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
