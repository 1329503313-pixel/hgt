import { Heart, Shell } from "lucide-react";
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
