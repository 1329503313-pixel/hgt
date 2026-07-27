import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { api } from "../api";
import type { GiftMessage } from "../shared/types";

export function RecentGiftsSection({
  userId,
  refreshKey = 0,
  onError,
  onSendGift,
  canSendGift = true
}: {
  userId: string;
  refreshKey?: number;
  onError: (message: string) => void;
  onSendGift?: () => void;
  canSendGift?: boolean;
}) {
  const [gifts, setGifts] = useState<GiftMessage[]>([]);

  useEffect(() => {
    void api<{ gifts: GiftMessage[] }>(`/api/users/${userId}/gifts/recent`, { bypassCache: true })
      .then((data) => setGifts(data.gifts))
      .catch((error) => onError((error as Error).message));
  }, [userId, refreshKey]);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="min-w-0 text-sm font-black text-ink">最近收到的礼物</h2>
        {onSendGift && <button className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-rose-50 px-3 text-xs font-black text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45" disabled={!canSendGift} onClick={onSendGift} title={canSendGift ? "送礼物" : "关注后可送礼物"}><Gift size={14} />送礼</button>}
      </div>
      {gifts.length === 0 ? <p className="py-8 text-center text-sm text-muted">还没有收到礼物</p> : (
        <div className="recent-gifts-row p-3">
          {gifts.map((gift) => (
            <div key={gift.giftSendId} className="recent-gift-item min-w-0 rounded-xl bg-rose-50/70 p-2 text-center" title={`${gift.sender.nickname} 送出 ${gift.quantity} 份`}>
              <div className="relative mx-auto h-12 w-12"><img className="h-12 w-12 object-contain" src={gift.iconUrl} alt={gift.giftName} loading="lazy" /><span className="absolute -bottom-1 -right-1 rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">×{gift.quantity}</span></div>
              <p className="mt-2 truncate text-[11px] font-black text-ink">{gift.giftName}</p>
              <p className="truncate text-[9px] text-muted">{gift.sender.nickname}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
