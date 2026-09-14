import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Minus, Shell, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { GiftCatalogItem, GiftMessage } from "../shared/types";
import { removeSessionCache, removeSessionCachePrefix } from "../shared/sessionCache";
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
  onSent?: (gift: GiftMessage, recipientCharmValue: number, senderGenerosityValue: number) => void;
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
  const holdTriggered = useRef(false);
  const holdPointer = useRef<{ id: number; x: number; y: number } | null>(null);

  function stopHold() {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    if (holdInterval.current !== null) window.clearInterval(holdInterval.current);
    holdTimer.current = null;
    holdInterval.current = null;
  }

  function cancelHold() {
    stopHold();
    holdPointer.current = null;
    // A cancelled drag/hold must not turn into a trailing click.
    holdTriggered.current = true;
  }

  useEffect(() => {
    if (!open) return;
    const onVisibilityChange = () => {
      if (document.hidden) cancelHold();
    };
    window.addEventListener("blur", cancelHold);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelHold();
      window.removeEventListener("blur", cancelHold);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [open]);

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

  function selectGift(id: string, keyboardClick: boolean) {
    if (holdTriggered.current && !keyboardClick) {
      holdTriggered.current = false;
      return;
    }
    cancelHold();
    if (selectedId === id) {
      setQuantity((value) => Math.min(666, value + 1));
      return;
    }
    setSelectedId(id);
    setQuantity(1);
  }

  function startHold(event: PointerEvent<HTMLButtonElement>, selectedGift: boolean) {
    if (!event.isPrimary || event.button !== 0 || holdPointer.current) return;
    stopHold();
    holdTriggered.current = false;
    holdPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!selectedGift) return;
    holdTimer.current = window.setTimeout(() => {
      holdTriggered.current = true;
      setQuantity((value) => Math.min(666, value + 1));
      holdInterval.current = window.setInterval(() => setQuantity((value) => Math.min(666, value + 1)), 90);
    }, 420);
  }

  function moveHold(event: PointerEvent<HTMLButtonElement>) {
    const pointer = holdPointer.current;
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) {
      cancelHold();
    }
  }

  function finishHold(event: PointerEvent<HTMLButtonElement>) {
    if (holdPointer.current?.id !== event.pointerId) return;
    stopHold();
    holdPointer.current = null;
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
      const result = await api<{
        gift: GiftMessage;
        shellBalance: number;
        recipientCharmValue: number;
        senderGenerosityValue: number;
        inventoryQuantity: number;
      }>(
        `/api/users/${recipient.id}/gifts/send`,
        { method: "POST", body: { giftId: selected.id, quantity, requestId, source } }
      );
      publishShellBalance(user?.id, result.shellBalance);
      setGifts((current) => current.map((gift) => gift.id === selected.id
        ? { ...gift, inventoryQuantity: result.inventoryQuantity }
        : gift));
      if (user) {
        removeSessionCache(`hgt:mine:profile:${user.id}`);
        removeSessionCache(`hgt:user-profile:${user.id}:${user.id}`);
        removeSessionCachePrefix(`hgt:rankings:`);
      }
      showToast(`已送出 ${selected.name} ×${quantity}`);
      onSent?.(result.gift, result.recipientCharmValue, result.senderGenerosityValue);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col rounded-t-[28px] bg-white px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />
        <div className="flex shrink-0 items-center justify-between">
          <div><h2 className="text-lg font-black text-ink">送给 {recipient.nickname}</h2><p className="text-xs text-muted">{isFollowing ? "选择一种礼物，可一次送出多份" : "关注对方后才可送礼"}</p></div>
          <button className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-muted" onClick={onClose} aria-label="关闭送礼弹框"><X size={18} /></button>
        </div>

        <div className="mt-4 min-h-0 max-h-[288px] overflow-y-auto overscroll-contain pr-1">
          {loading ? <div className="py-16 text-center text-sm text-muted">正在加载礼物…</div> : gifts.length === 0 ? (
            <div className="py-16 text-center"><p className="font-bold text-ink">暂时没有可赠送的礼物</p><p className="mt-1 text-xs text-muted">管理员上架礼物后会显示在这里</p></div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {gifts.map((gift) => {
                const selectedGift = selectedId === gift.id;
                return (
                  <div key={gift.id} className="relative min-w-0">
                    <button
                      type="button"
                      aria-label={`选择${gift.name}，再次点击增加数量`}
                      aria-pressed={selectedGift}
                      className={`relative w-full min-w-0 touch-manipulation select-none rounded-2xl border p-2 pt-11 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selectedGift ? "border-primary bg-blue-50 ring-1 ring-primary" : "border-line bg-slate-50"}`}
                      onClick={(event) => selectGift(gift.id, event.detail === 0)}
                      onPointerDown={(event) => startHold(event, selectedGift)}
                      onPointerMove={moveHold}
                      onPointerUp={finishHold}
                      onPointerCancel={cancelHold}
                      onLostPointerCapture={(event) => { if (holdPointer.current?.id === event.pointerId) cancelHold(); }}
                      onContextMenu={(event) => { event.preventDefault(); cancelHold(); }}
                    >
                      {selectedGift && <span aria-label="礼物数量" className="pointer-events-none absolute left-1 top-1 rounded-full bg-primary px-1.5 text-[10px] font-black text-white">{quantity}</span>}
                      <span className="pointer-events-none relative mx-auto block h-12 w-12">
                        <img className="h-12 w-12 object-contain" src={gift.iconUrl} alt={gift.name} loading="lazy" draggable={false} />
                        {gift.inventoryQuantity > 0 && (
                          <span
                            className="absolute -bottom-0.5 -right-1 min-w-4 rounded-full bg-slate-900/85 px-1 py-0.5 text-center text-[9px] font-black leading-none text-white shadow-sm"
                            aria-label={`拥有 ${gift.inventoryQuantity} 个`}
                          >
                            {gift.inventoryQuantity}
                          </span>
                        )}
                      </span>
                      <p className="mt-1 truncate text-xs font-black text-ink">{gift.name}</p>
                      <p className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700"><Shell size={10} />{gift.costAmount}</p>
                    </button>
                    {selectedGift && (
                      // Sibling controls keep decrement out of the increment event path.
                      // Keep the disabled target at 1 so repeated taps cannot fall through.
                      <button
                        type="button"
                        aria-label="减少礼物数量"
                        disabled={quantity <= 1}
                        className="group absolute right-0 top-0 z-10 h-11 w-11 touch-manipulation rounded-tr-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed"
                        onPointerDown={cancelHold}
                        onClick={() => { cancelHold(); setQuantity((value) => Math.max(1, value - 1)); }}
                      >
                        <span className="pointer-events-none absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white transition-colors group-hover:bg-red-600 group-active:bg-red-700 group-disabled:bg-slate-300">
                          <Minus size={12} strokeWidth={3} />
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selected && (
          <div className="mt-4 shrink-0">
            <div className="flex gap-1.5 overflow-x-auto pb-2">
              {quickQuantities.map((value) => <button key={value} type="button" className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${quantity === value ? "border-primary bg-primary text-white" : "border-line text-ink"}`} onClick={() => { cancelHold(); setQuantity(value); }}>送出{value}份</button>)}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="min-w-0 flex-1 text-xs text-muted">
                <p className="truncate">{selected.description || selected.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-bold">
                  <span className="text-amber-700">
                    贝壳补购 {(selected.costAmount * Math.max(0, quantity - selected.inventoryQuantity)).toLocaleString()}
                  </span>
                  {selected.inventoryQuantity > 0 && (
                    <span>库存消耗 {Math.min(quantity, selected.inventoryQuantity).toLocaleString()} 个</span>
                  )}
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
