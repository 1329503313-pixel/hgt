import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { StickerAsset, StickerSeries } from "../shared/types";

type StickerKeyboardProps = {
  series: StickerSeries[];
  loading?: boolean;
  sending: boolean;
  onClose: () => void;
  onSend: (sticker: StickerAsset) => void | Promise<void>;
  className?: string;
};

export function StickerKeyboard({ series, loading = false, sending, onClose, onSend, className = "" }: StickerKeyboardProps) {
  const [activeSeriesId, setActiveSeriesId] = useState("");
  const [page, setPage] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const swipeHandled = useRef(false);
  const ownedSeries = useMemo(() => series.filter((item) => item.stickers.some((sticker) => sticker.owned)), [series]);
  const activeSeries = ownedSeries.find((item) => item.id === activeSeriesId) ?? ownedSeries[0] ?? null;
  const stickers = useMemo(() => activeSeries?.stickers.filter((sticker) => sticker.owned) ?? [], [activeSeries]);
  const pages = useMemo(
    () => Array.from({ length: Math.ceil(stickers.length / 8) }, (_, index) => stickers.slice(index * 8, index * 8 + 8)),
    [stickers]
  );
  const pageCount = Math.max(1, pages.length);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  useEffect(() => {
    if (!ownedSeries.length) { setActiveSeriesId(""); return; }
    if (!ownedSeries.some((item) => item.id === activeSeriesId)) setActiveSeriesId(ownedSeries[0].id);
  }, [activeSeriesId, ownedSeries]);

  return (
    <div className={`bg-white ${className}`}>
      <div className="mb-2 flex h-7 items-center justify-between">
        <span className="text-sm font-black text-ink">表情包</span>
        <button type="button" className="grid h-7 w-7 place-items-center rounded-full text-muted transition hover:bg-slate-100" onClick={onClose} aria-label="收起表情包">
          <ChevronDown size={17} />
        </button>
      </div>
      {!loading && ownedSeries.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="表情包系列">
          {ownedSeries.map((item) => {
            const active = item.id === activeSeries?.id;
            return <button key={item.id} type="button" role="tab" aria-selected={active} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? "bg-primary text-white shadow-sm" : "bg-slate-100 text-muted hover:bg-blue-50 hover:text-primary"}`} onClick={() => { setActiveSeriesId(item.id); setPage(0); setDragX(0); }}>{item.name}</button>;
          })}
        </div>
      )}
      {loading ? (
        <div className="grid h-[152px] grid-cols-4 grid-rows-2 gap-1.5 sm:h-[168px]" aria-label="表情包加载中">
          {Array.from({ length: 8 }, (_, index) => <span key={index} className="m-auto h-14 w-14 animate-pulse rounded-2xl bg-slate-100 sm:h-16 sm:w-16" />)}
        </div>
      ) : stickers.length > 0 ? (
        <div
          className="touch-pan-y overflow-hidden"
          onTouchStart={(event) => {
            swipeHandled.current = false;
            setDragging(true);
            setDragX(0);
            touchStartX.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchMove={(event) => {
            const startX = touchStartX.current;
            const currentX = event.touches[0]?.clientX;
            if (startX == null || currentX == null) return;
            let distance = currentX - startX;
            if ((page === 0 && distance > 0) || (page === pageCount - 1 && distance < 0)) distance *= 0.28;
            if (Math.abs(distance) > 8) swipeHandled.current = true;
            setDragX(distance);
          }}
          onTouchEnd={(event) => {
            const startX = touchStartX.current;
            const endX = event.changedTouches[0]?.clientX;
            touchStartX.current = null;
            setDragging(false);
            setDragX(0);
            if (startX == null || endX == null) return;
            const distance = endX - startX;
            if (Math.abs(distance) < 40) return;
            swipeHandled.current = true;
            setPage((current) => distance < 0 ? Math.min(pageCount - 1, current + 1) : Math.max(0, current - 1));
          }}
          onTouchCancel={() => {
            touchStartX.current = null;
            setDragging(false);
            setDragX(0);
          }}
        >
          <div
            className={`flex ${dragging ? "" : "transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]"}`}
            style={{ transform: `translate3d(calc(${-page * 100}% + ${dragX}px), 0, 0)` }}
          >
            {pages.map((items, pageIndex) => (
              <div key={pageIndex} className="grid h-[152px] w-full shrink-0 grid-cols-4 grid-rows-2 gap-1.5 sm:h-[168px]">
                {items.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    className="flex min-h-0 items-center justify-center rounded-xl border border-transparent p-1 transition hover:border-blue-100 hover:bg-blue-50 active:scale-95"
                    disabled={sending}
                    onClick={() => {
                      if (swipeHandled.current) {
                        swipeHandled.current = false;
                        return;
                      }
                      void onSend(sticker);
                    }}
                    aria-label={sticker.text || sticker.name}
                  >
                    <img className="h-16 w-16 object-contain sm:h-[72px] sm:w-[72px]" src={sticker.staticUrl} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid h-[152px] place-items-center text-sm text-muted sm:h-[168px]">暂无可用表情</div>
      )}
      {pageCount > 1 && !loading && (
        <nav className="mt-2 flex h-7 items-center justify-center overflow-x-auto" aria-label="表情包分页">
          {Array.from({ length: pageCount }, (_, index) => (
            <button
              key={index}
              type="button"
              className="group grid h-7 w-7 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
              onClick={() => {
                setDragging(false);
                setDragX(0);
                touchStartX.current = null;
                swipeHandled.current = false;
                setPage(index);
              }}
              aria-label={`第 ${index + 1} 页，共 ${pageCount} 页`}
              aria-current={index === page ? "page" : undefined}
            >
              <span className={`block rounded-full transition-all duration-200 group-hover:bg-blue-400 ${index === page ? "h-2 w-4 bg-primary" : "h-2 w-2 bg-slate-300"}`} aria-hidden="true" />
            </button>
          ))}
          <span className="sr-only" aria-live="polite">当前第 {page + 1} 页，共 {pageCount} 页</span>
        </nav>
      )}
    </div>
  );
}
