import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FastForward, Shell, Sparkles, X } from "lucide-react";
import type { AssetDrawOrder } from "../shared/digitalAssets";
import { AssetCardVisual } from "./AssetCardVisual";

function NewCardBurst({ delayed = false }: { delayed?: boolean }) {
  return <img src="/new-card-burst.png?v=20260721-4" alt="新卡" className={`asset-card-new-burst ${delayed ? "asset-card-new-burst-delayed" : ""}`} draggable={false} />;
}

export function AssetDrawOverlay({ order, onClose, onDrawAgain }: { order: AssetDrawOrder; onClose: () => void; onDrawAgain: (mode: "single" | "ten") => void }) {
  const [revealed, setRevealed] = useState(0);
  const [started, setStarted] = useState(false);
  const complete = revealed > order.results.length;
  const current = order.results[Math.min(order.results.length - 1, Math.max(0, revealed - 1))];
  const waitingForLegend = started && !complete && current?.rarity === "legend";

  useEffect(() => {
    const timer = window.setTimeout(() => { setStarted(true); setRevealed(1); }, 850);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!started || complete || waitingForLegend) return;
    const timer = window.setTimeout(() => setRevealed((value) => Math.min(order.results.length + 1, value + 1)), 680);
    return () => window.clearTimeout(timer);
  }, [started, revealed, complete, waitingForLegend, order.results.length]);

  const totalRefund = order.results.reduce((sum, result) => sum + result.shellRefund, 0);
  function continueAfterLegend() {
    if (!waitingForLegend) return;
    setRevealed((value) => Math.min(order.results.length + 1, value + 1));
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] text-white" role="dialog" aria-modal="true" aria-label="抽卡结果">
      <div className={`absolute inset-0 overflow-y-auto bg-slate-950/95 px-4 pb-28 pt-[max(20px,env(safe-area-inset-top))] backdrop-blur-md ${waitingForLegend ? "cursor-pointer" : ""}`} onClick={continueAfterLegend}>
        <div className="mx-auto flex min-h-full max-w-5xl flex-col">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-bold tracking-[0.22em] text-cyan-200">{order.packName}</p><h2 className="mt-1 text-xl font-black">{complete ? "本次抽卡结果" : "正在开启卡包"}</h2></div>
          <div className="flex gap-2">
            {!complete && <button className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/25 px-4 text-sm font-bold" onClick={(event) => { event.stopPropagation(); setStarted(true); setRevealed(order.results.length + 1); }}><FastForward size={17} />跳过动画</button>}
            <button className="grid h-10 w-10 place-items-center rounded-full border border-white/25" onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label="关闭抽卡结果"><X size={20} /></button>
          </div>
        </div>

        {!started ? (
          <div className="grid flex-1 place-items-center py-12">
            <div className="text-center">
              <div className="asset-pack-sealed mx-auto h-72 w-52 overflow-hidden rounded-3xl border-2 border-cyan-200/70 bg-slate-800 shadow-2xl">
                <img src="/card-back.webp?v=20260721" alt="通用卡背" className="h-full w-full object-cover" decoding="async" />
              </div>
              <p className="mt-8 animate-pulse text-sm font-bold text-cyan-100">卡包共鸣中…</p>
            </div>
          </div>
        ) : !complete && current ? (
          <div className="grid flex-1 place-items-center py-8">
            <div className={`asset-draw-reveal asset-draw-aura asset-draw-aura-${current.rarity} w-60 sm:w-72`} key={`${current.id}-${revealed}`}>
              <div className="asset-draw-flip-card">
                <div className="asset-draw-flip-inner">
                  <div className="asset-draw-flip-face asset-draw-flip-back" aria-hidden="true">
                    <img src="/card-back.webp?v=20260721" alt="" className="h-full w-full object-cover" decoding="async" draggable={false} />
                  </div>
                  <div className="asset-draw-flip-face asset-draw-flip-front">
                    <AssetCardVisual card={current} animated />
                  </div>
                </div>
                {current.firstObtained && <NewCardBurst delayed />}
              </div>
              <div className="asset-draw-caption mt-5 text-center">
                <p className="text-lg font-black">{current.name}</p>
                <p className="mt-1 text-sm text-cyan-100">
                  {current.firstObtained ? "首次获得" : current.fullStarDuplicate ? `满星转化 +${current.shellRefund} 贝壳` : current.starUpgraded ? `升至 ${current.starAfter} 星` : "重复卡 · 升星进度已增加"}
                  {current.pityType ? ` · ${current.pityType === "legend" ? "传说" : current.pityType === "epic" ? "史诗" : "稀有"}保底` : ""}
                </p>
                <p className="mt-3 text-xs font-bold text-white/55">{Math.min(revealed, order.results.length)} / {order.results.length}</p>
                {waitingForLegend && <p className="mt-4 animate-pulse text-sm font-black tracking-[0.16em] text-fuchsia-200">传说降临 · 点击屏幕继续</p>}
              </div>
            </div>
          </div>
        ) : (
          <div className="asset-result-pop py-8">
            <div className={`mx-auto grid gap-3 ${order.results.length === 1 ? "max-w-xs grid-cols-1" : "grid-cols-2 sm:grid-cols-5"}`}>
              {order.results.map((result) => (
                <div key={result.drawIndex} className="relative min-w-0">
                  <AssetCardVisual card={result} animated={result.rarity === "legend"} />
                  {result.firstObtained && <NewCardBurst />}
                  <p className="mt-2 truncate text-center text-[11px] font-bold text-cyan-100">
                    {result.firstObtained ? "NEW" : result.fullStarDuplicate ? `转化 +${result.shellRefund}` : result.starUpgraded ? `${result.starAfter}星` : "重复"}
                  </p>
                </div>
              ))}
            </div>
            <div className="mx-auto mt-7 flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 text-sm font-bold">
              <span>{order.usedFreeDraw ? "使用免费单抽" : `消耗 ${order.shellCost} 贝壳`}</span>
              {totalRefund > 0 && <span className="inline-flex items-center gap-1 text-emerald-300"><Shell size={16} />满星返还 +{totalRefund}</span>}
              <span className="inline-flex items-center gap-1 text-amber-200"><Sparkles size={16} />收藏值已自动更新</span>
            </div>
          </div>
        )}
        </div>
      </div>
      {complete && (
        <div className="absolute inset-x-0 bottom-0 z-[90] border-t border-white/15 bg-slate-950/90 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(0,0,0,.35)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-xl gap-3">
            <button className="min-h-12 flex-1 rounded-xl border border-white/25 bg-white/10 px-4 text-sm font-black text-white transition hover:bg-white/15 active:scale-[.98]" onClick={(event) => { event.stopPropagation(); onClose(); }}>收下卡片</button>
            <button className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 text-sm font-black text-white shadow-[0_8px_24px_rgba(99,102,241,.35)] transition hover:brightness-110 active:scale-[.98]" onClick={(event) => { event.stopPropagation(); onDrawAgain(order.drawMode); }}><Shell size={17} />{order.drawMode === "ten" ? "再来十连" : "再来一次"}</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
