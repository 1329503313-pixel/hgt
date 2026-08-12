import { useState } from "react";
import { ChevronDown, ChevronUp, Gift, Heart, Shell } from "lucide-react";
import type { GiftMessage } from "../shared/types";

export function GiftMessageCard({ gift }: { gift: GiftMessage }) {
  return (
    <div className="h-[112px] w-[280px] max-w-[calc(100vw-80px)] shrink-0 overflow-hidden rounded-2xl border border-rose-100 bg-gradient-to-br from-white via-rose-50 to-amber-50 p-3 text-left shadow-sm">
      <p className="truncate text-xs font-bold text-slate-600">
        {gift.sender.nickname}送给{gift.recipient.nickname}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/80">
          <img className="h-12 w-12 object-contain" src={gift.iconUrl} alt={gift.giftName} loading="lazy" />
          <span className="absolute -bottom-1 -right-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
            ×{gift.quantity}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-black text-slate-900">{gift.giftName}</p>
          <div className="mt-1 grid h-6 grid-cols-2 gap-1.5 overflow-hidden text-[10px] font-bold tabular-nums">
            {gift.shellReward > 0 && <span className="inline-flex min-w-0 items-center justify-center gap-1 overflow-hidden rounded-full bg-amber-100 px-1.5 py-1 text-center text-amber-700" title={`贝壳 +${gift.shellReward}`}><Shell className="shrink-0" size={11} /><span className="truncate">贝壳 +{gift.shellReward}</span></span>}
            {gift.charmReward > 0 && <span className="inline-flex min-w-0 items-center justify-center gap-1 overflow-hidden rounded-full bg-rose-100 px-1.5 py-1 text-center text-rose-700" title={`魅力 +${gift.charmReward}`}><Heart className="shrink-0" size={11} /><span className="truncate">魅力 +{gift.charmReward}</span></span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GiftMessageBundle({
  gifts,
  align = "left",
  anchorIds = [],
  highlighted = false,
}: {
  gifts: GiftMessage[];
  align?: "left" | "right";
  anchorIds?: string[];
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!gifts.length) return null;
  const sender = gifts[0].sender.nickname;
  const totalQuantity = gifts.reduce((total, gift) => total + gift.quantity, 0);
  const previewGifts = gifts.slice(-3);
  return (
    <section className={`relative flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      {anchorIds.map((id) => <span key={id} id={id} className="pointer-events-none absolute inset-x-0 top-0 scroll-mt-24" aria-hidden="true" />)}
      <div className={`w-[280px] max-w-[calc(100vw-80px)] overflow-hidden rounded-2xl border bg-white shadow-sm transition ${highlighted ? "border-violet-400 ring-2 ring-violet-300 ring-offset-2" : "border-rose-100"}`}>
        <button
          type="button"
          className="flex min-h-16 w-full items-center gap-3 bg-gradient-to-r from-rose-50 to-amber-50 px-3 py-2 text-left transition hover:from-rose-100 hover:to-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={`${sender}又送出${totalQuantity}份礼物，共${gifts.length}条送礼记录，${expanded ? "收起" : "展开"}明细`}
        >
          <span className="relative flex h-10 w-[58px] shrink-0 items-center" aria-hidden="true">
            {previewGifts.map((gift, index) => (
              <span key={gift.giftSendId} className="absolute grid h-9 w-9 place-items-center overflow-hidden rounded-xl border-2 border-white bg-white shadow-sm" style={{ left: `${index * 10}px`, zIndex: index + 1 }}>
                <img className="h-7 w-7 object-contain" src={gift.iconUrl} alt="" loading="lazy" decoding="async" />
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-black text-slate-900"><Gift size={15} className="shrink-0 text-rose-500" />又送出 {totalQuantity} 份礼物</span>
            <span className="mt-0.5 block text-xs font-bold text-slate-600">{gifts.length} 条送礼记录 · {expanded ? "点击收起" : "点击查看"}</span>
          </span>
          {expanded ? <ChevronUp className="shrink-0 text-slate-500" size={19} /> : <ChevronDown className="shrink-0 text-slate-500" size={19} />}
        </button>
        {expanded && (
          <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain border-t border-rose-100 bg-white p-2" aria-label="连续送礼明细">
            {gifts.map((gift) => (
              <div key={gift.giftSendId} className="flex min-h-12 items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                <img className="h-9 w-9 shrink-0 rounded-lg bg-amber-50 object-contain p-1" src={gift.iconUrl} alt={gift.giftName} loading="lazy" decoding="async" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black text-ink">{gift.giftName} ×{gift.quantity}</span>
                  <span className="block truncate text-[11px] text-muted">送给 {gift.recipient.nickname}</span>
                </span>
                <time className="shrink-0 text-[10px] tabular-nums text-muted">{new Date(gift.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
