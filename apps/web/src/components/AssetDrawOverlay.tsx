import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FastForward, Shell, Sparkles, X } from "lucide-react";
import { sortAssetDrawResultsForDisplay, warmAssetImage, type AssetDrawOrder } from "../shared/digitalAssets";
import { AssetAnimationPausedContext, AssetCardVisual } from "./AssetCardVisual";
import { CollectibleVisual } from "./CollectibleVisual";

const AUTO_SKIP_DRAW_ANIMATION_KEY = "hgt:auto-skip-draw-animation";

function getAutoSkipDrawAnimation() {
  try {
    return window.localStorage.getItem(AUTO_SKIP_DRAW_ANIMATION_KEY) === "true";
  } catch {
    return false;
  }
}

function saveAutoSkipDrawAnimation(enabled: boolean) {
  try {
    window.localStorage.setItem(AUTO_SKIP_DRAW_ANIMATION_KEY, String(enabled));
  } catch {
    // The preference still applies to the current page when storage is unavailable.
  }
}

function NewCardBurst({ delayed = false }: { delayed?: boolean }) {
  return <img src="/new-card-burst.png?v=20260721-4" alt="新卡" className={`asset-card-new-burst ${delayed ? "asset-card-new-burst-delayed" : ""}`} draggable={false} />;
}

export function AssetDrawPending({ packName }: { packName: string }) {
  return createPortal(<div className="fixed inset-0 z-[140] grid place-items-center bg-slate-950 px-4 text-white" role="status" aria-live="polite">
    <div className="text-center"><p className="mb-8 text-sm font-bold text-cyan-200">{packName}</p>
      <div className="asset-pack-sealed mx-auto h-72 w-52 overflow-hidden rounded-3xl border-2 border-cyan-200/70 bg-slate-800 shadow-2xl"><img src="/card-back.webp?v=20260721" alt="通用卡背" className="h-full w-full object-cover" decoding="async" /></div>
      <p className="mt-8 text-sm font-bold text-cyan-100">正在抽取，请稍候…</p>
    </div>
  </div>, document.body);
}

export function AssetDrawOverlay({ order, balance, onClose, onDrawAgain }: { order: AssetDrawOrder; balance: number; onClose: () => void; onDrawAgain: (mode: "single" | "ten") => void }) {
  const [autoSkipAnimation, setAutoSkipAnimation] = useState(getAutoSkipDrawAnimation);
  const [revealed, setRevealed] = useState(() => getAutoSkipDrawAnimation() ? order.results.length + 1 : 0);
  const [started, setStarted] = useState(getAutoSkipDrawAnimation);
  const [prepared, setPrepared] = useState(-1);
  const [flipped, setFlipped] = useState(-1);
  const [resultMotionReady, setResultMotionReady] = useState(false);
  const complete = revealed > order.results.length;
  const current = order.results[Math.min(order.results.length - 1, Math.max(0, revealed - 1))];
  const displayResults = useMemo(
    () => order.drawMode === "ten" ? sortAssetDrawResultsForDisplay(order.results) : order.results,
    [order.drawMode, order.results]
  );
  const waitingForLegend = started && !complete && current?.rarity === "legend";

  useEffect(() => {
    for (const card of order.results) void warmAssetImage(card.thumbnailUrl || card.imageUrl);
    void warmAssetImage("/card-back.webp?v=20260721");
    void warmAssetImage("/new-card-burst.png?v=20260721-4");
  }, [order]);

  useEffect(() => {
    if (started) return;
    const timer = window.setTimeout(() => { setStarted(true); setRevealed(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [started]);

  useEffect(() => {
    if (!started || complete || !current) return;
    let cancelled = false;
    let frame = 0;
    // Decode the actual thumbnail before rotating the front into view. A failed
    // or slow image must never trap the user in the animation.
    const timer = window.setTimeout(ready, 1500);
    function ready() {
      if (cancelled) return;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => { if (!cancelled) setPrepared(revealed); });
    }
    void warmAssetImage(current.thumbnailUrl || current.imageUrl).then(ready);
    return () => { cancelled = true; window.clearTimeout(timer); window.cancelAnimationFrame(frame); };
  }, [started, complete, current, revealed]);

  useEffect(() => {
    if (prepared !== revealed || complete) return;
    // Reduced motion disables animationend; the timeout also covers interrupted
    // WebView animations. Normal playback advances from animationend below.
    const timer = window.setTimeout(() => setFlipped(revealed), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100);
    return () => window.clearTimeout(timer);
  }, [prepared, revealed, complete]);

  useEffect(() => {
    if (!started || complete || waitingForLegend || flipped !== revealed) return;
    const timer = window.setTimeout(() => setRevealed((value) => Math.min(order.results.length + 1, value + 1)), 260);
    return () => window.clearTimeout(timer);
  }, [started, revealed, flipped, complete, waitingForLegend, order.results.length]);

  useEffect(() => {
    if (!complete) return;
    const timer = window.setTimeout(() => setResultMotionReady(true), 600);
    return () => window.clearTimeout(timer);
  }, [complete]);

  const totalRefund = order.results.reduce((sum, result) => sum + result.shellRefund, 0);
  function continueAfterLegend() {
    if (!waitingForLegend || flipped !== revealed) return;
    setRevealed((value) => Math.min(order.results.length + 1, value + 1));
  }

  function toggleAutoSkipAnimation() {
    const nextEnabled = !autoSkipAnimation;
    setAutoSkipAnimation(nextEnabled);
    saveAutoSkipDrawAnimation(nextEnabled);
    if (nextEnabled) {
      setStarted(true);
      setRevealed(order.results.length + 1);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] text-white" role="dialog" aria-modal="true" aria-label="抽卡结果">
      <div className={`absolute inset-0 overflow-y-auto bg-slate-950 px-4 pb-28 pt-[max(20px,env(safe-area-inset-top))] ${waitingForLegend ? "cursor-pointer" : ""}`} onClick={continueAfterLegend}>
        <div className="mx-auto flex min-h-full max-w-5xl flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full sm:w-auto"><p className="text-xs font-bold tracking-[0.22em] text-cyan-200">{order.packName}</p><h2 className="mt-1 text-xl font-black">{complete ? "本次抽卡结果" : "正在开启卡包"}</h2></div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="mr-auto inline-flex min-h-10 items-center gap-2 rounded-full border border-cyan-200/25 bg-cyan-100/10 px-3.5 text-sm font-black text-cyan-50 sm:mr-0" aria-label={`当前贝壳余额 ${balance}`}>
              <Shell size={17} className="text-cyan-200" />
              <span className="hidden text-xs font-bold text-cyan-100/75 min-[380px]:inline">贝壳余额</span>
              <span>{balance.toLocaleString()}</span>
            </div>
            <button
              type="button"
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold transition ${autoSkipAnimation ? "border-cyan-200/70 bg-cyan-200 text-slate-950 shadow-[0_0_18px_rgba(165,243,252,.3)]" : "border-white/25 bg-transparent text-white hover:bg-white/10"}`}
              aria-pressed={autoSkipAnimation}
              aria-label={autoSkipAnimation ? "取消自动跳过抽卡动画" : "自动跳过所有抽卡动画"}
              onClick={(event) => { event.stopPropagation(); toggleAutoSkipAnimation(); }}
            >
              <FastForward size={17} />自动跳过
            </button>
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
            <div className={`asset-draw-reveal asset-draw-aura asset-draw-aura-${current.rarity} ${prepared !== revealed ? "asset-draw-loading" : ""} w-60 sm:w-72`} key={`${current.id}-${revealed}`}>
              <div className="asset-draw-flip-card">
                <div className="asset-draw-flip-inner" onAnimationEnd={(event) => { if (event.target === event.currentTarget && event.animationName === "asset-draw-card-flip") setFlipped(revealed); }}>
                  <div className="asset-draw-flip-face asset-draw-flip-back" aria-hidden="true">
                    <img src="/card-back.webp?v=20260721" alt="" className="h-full w-full object-cover" decoding="async" draggable={false} />
                  </div>
                  <div className="asset-draw-flip-face asset-draw-flip-front">
                    <AssetAnimationPausedContext.Provider value={flipped !== revealed}>
                      <AssetCardVisual card={current} eager motion={waitingForLegend && flipped === revealed} packType={order.packType} />
                    </AssetAnimationPausedContext.Provider>
                  </div>
                </div>
                {current.firstObtained && <NewCardBurst delayed />}
              </div>
              <div className="asset-draw-caption mt-5 text-center">
                <p className="text-lg font-black">{current.name}</p>
                <p className="mt-1 text-sm text-cyan-100">
                  {current.firstObtained ? "首次获得" : current.fullStarDuplicate ? `满星转化 +${current.shellRefund} 贝壳` : current.starUpgraded ? `升至 ${current.starAfter} 星` : "重复卡 · 升星进度已增加"}
                  {current.pityType === "legend" && current.rarity === "epic" ? " · 传说保底转 UP 史诗" : current.pityType ? ` · ${current.pityType === "legend" ? "传说" : current.pityType === "epic" ? "史诗" : "稀有"}保底` : ""}
                </p>
                <p className="mt-3 text-xs font-bold text-white/55">{Math.min(revealed, order.results.length)} / {order.results.length}</p>
                {waitingForLegend && <p className="mt-4 animate-pulse text-sm font-black tracking-[0.16em] text-fuchsia-200">传说降临 · 点击屏幕继续</p>}
              </div>
            </div>
          </div>
        ) : (
          <AssetAnimationPausedContext.Provider value={!resultMotionReady}>
          <div className="asset-result-pop py-8">
            {order.collectibleAwards?.length > 0 && (
              <div className="mx-auto mb-8 max-w-3xl rounded-3xl border border-amber-300/30 bg-amber-300/10 p-5">
                <h3 className="text-center text-lg font-black text-amber-200">获得收藏品</h3>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  {order.collectibleAwards.map((item) => (
                    <div key={item.id} className="w-[calc(50%-0.375rem)] sm:w-[calc(25%-0.5625rem)]">
                      <CollectibleVisual collectible={item} className="aspect-[5/6]" />
                      <p className="mt-1 text-center text-xs font-bold text-amber-100">第 {item.packDrawNumber} 抽</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className={`mx-auto grid gap-3 ${order.results.length === 1 ? "max-w-xs grid-cols-1" : "grid-cols-2 sm:grid-cols-5"}`}>
              {displayResults.map((result) => (
                <div key={result.drawIndex} className="relative min-w-0">
                  <AssetCardVisual card={result} animated={result.rarity === "legend"} motion packType={order.packType} />
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
          </AssetAnimationPausedContext.Provider>
        )}
        </div>
      </div>
      {complete && (
        <div className="absolute inset-x-0 bottom-0 z-[90] border-t border-white/15 bg-slate-950/90 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(0,0,0,.35)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-xl gap-3">
            <button className="min-h-12 flex-1 rounded-xl border border-white/25 bg-white/10 px-4 text-sm font-black text-white transition hover:bg-white/15 active:scale-[.98]" onClick={(event) => { event.stopPropagation(); onClose(); }}>收下奖励</button>
            <button className="btn btn-primary min-h-12 flex-1" onClick={(event) => { event.stopPropagation(); onDrawAgain(order.drawMode); }}><Shell size={17} />{order.drawMode === "ten" ? "再来十连" : "再来一次"}</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
