import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, Shell, ShoppingBag, SmilePlus } from "lucide-react";
import { api } from "../api";
import { MineBackButton } from "../components/MineBackButton";
import { Modal } from "../components/Modal";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { useApp } from "../context/AppContext";
import type { StickerAsset, StickerSeries } from "../shared/types";
import { publishShellBalance } from "../shared/useShellBalance";

type StoreData = { balance: number; series: StickerSeries[] };

function StickerPreviewImage({ sticker, reducedMotion }: { sticker: StickerAsset; reducedMotion: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !("IntersectionObserver" in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "160px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <img ref={ref} src={!reducedMotion && visible && sticker.animatedUrl ? sticker.animatedUrl : sticker.staticUrl} alt={sticker.name} className="h-full w-full object-contain" loading="lazy" decoding="async" />;
}

export default function StickerStorePage() {
  const { user, loadingUser, openAuth, showToast } = useApp();
  const [data, setData] = useState<StoreData | null>(null);
  const [activeSeriesId, setActiveSeriesId] = useState("");
  const [confirming, setConfirming] = useState<StickerAsset | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  async function load() {
    const next = await api<StoreData>("/api/asset-store/stickers", { bypassCache: true, dedupe: false });
    setData(next);
    setActiveSeriesId((current) => next.series.some((item) => item.id === current) ? current : next.series[0]?.id ?? "");
  }

  useEffect(() => { if (user) void load().catch((error) => showToast((error as Error).message)); }, [user?.id]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const activeSeries = useMemo(() => data?.series.find((item) => item.id === activeSeriesId) ?? data?.series[0] ?? null, [activeSeriesId, data]);

  async function purchase() {
    if (!confirming || purchasing) return;
    setPurchasing(true);
    try {
      const result = await api<{ owned: boolean; balance: number }>(`/api/asset-store/stickers/${confirming.id}/purchase`, {
        method: "POST",
        body: { requestId: crypto.randomUUID() }
      });
      setData((current) => current ? { ...current, balance: result.balance, series: current.series.map((series) => ({ ...series, stickers: series.stickers.map((sticker) => sticker.id === confirming.id ? { ...sticker, owned: true } : sticker) })) } : current);
      publishShellBalance(user?.id, result.balance);
      setConfirming(null);
      showToast("购买成功，表情已加入聊天键盘");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setPurchasing(false);
    }
  }

  if (loadingUser || (user && !data)) return <section className="space-y-3"><PageTopBar title="表情包" /><MineBackButton to="/mine/store" hideOnDesktop /><ListSkeleton rows={6} /></section>;
  if (!user) return <section className="space-y-3"><PageTopBar title="表情包" /><MineBackButton to="/mine/store" hideOnDesktop /><div className="card p-8 text-center"><p className="text-sm text-muted">登录后可购买表情包。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div></section>;

  return (
    <section className="space-y-4">
      <PageTopBar title="表情包" />
      <MineBackButton to="/mine/store" hideOnDesktop />
      <div className="card flex items-center justify-between gap-4 overflow-hidden bg-gradient-to-r from-cyan-500 to-blue-600 p-5 text-white">
        <div><p className="text-xs font-bold text-cyan-50">当前贝壳余额</p><p className="mt-1 flex items-center gap-2 text-3xl font-black tabular-nums"><Shell size={25} />{(data?.balance ?? 0).toLocaleString()}</p></div>
        <SmilePlus size={48} className="text-white/65" aria-hidden="true" />
      </div>

      {(data?.series.length ?? 0) > 0 && <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="表情包系列">
        {data!.series.map((series) => <button key={series.id} type="button" role="tab" aria-selected={series.id === activeSeries?.id} className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${series.id === activeSeries?.id ? "bg-primary text-white shadow-sm" : "border border-line bg-white text-muted hover:border-blue-200 hover:text-primary"}`} onClick={() => setActiveSeriesId(series.id)}>{series.name}</button>)}
      </div>}

      {!activeSeries ? <div className="card p-10 text-center"><ShoppingBag className="mx-auto text-slate-300" size={44} /><h2 className="mt-4 font-black text-ink">暂无在售表情</h2><p className="mt-2 text-sm text-muted">管理员上架表情后会展示在这里。</p></div> : <div>
        <div className="mb-3 px-1"><h2 className="text-lg font-black text-ink">{activeSeries.name}</h2>{activeSeries.description && <p className="mt-1 text-sm leading-6 text-muted">{activeSeries.description}</p>}</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {activeSeries.stickers.map((sticker) => <article key={sticker.id} className="card flex min-w-0 flex-col overflow-hidden p-3">
            <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50 p-2">
              <StickerPreviewImage sticker={sticker} reducedMotion={reducedMotion} />
            </div>
            <h3 className="mt-3 truncate font-black text-ink" title={sticker.name}>{sticker.name}</h3>
            <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted">{sticker.description || `来自“${activeSeries.name}”系列`}</p>
            <button type="button" disabled={sticker.owned} className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${sticker.owned ? "cursor-not-allowed bg-emerald-50 text-emerald-700" : "bg-primary text-white shadow-sm hover:brightness-105 active:opacity-80"}`} onClick={() => setConfirming(sticker)}>
              {sticker.owned ? <><Check size={17} />已拥有</> : <><Shell size={17} />{sticker.price.toLocaleString()}</>}
            </button>
          </article>)}
        </div>
      </div>}

      {confirming && <Modal onClose={() => { if (!purchasing) setConfirming(null); }}>
        <div className="text-center"><img src={confirming.staticUrl} alt="" className="mx-auto h-28 w-28 object-contain" /><h2 className="mt-3 text-xl font-black text-ink">购买“{confirming.name}”</h2><p className="mt-2 text-sm text-muted">将支付 <strong className="text-ink">{confirming.price.toLocaleString()} 贝壳</strong>，购买后立即加入聊天表情键盘。</p><p className="mt-1 text-xs text-muted">购买后余额：{Math.max(0, (data?.balance ?? 0) - confirming.price).toLocaleString()}</p></div>
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" className="btn btn-secondary min-h-11" disabled={purchasing} onClick={() => setConfirming(null)}>取消</button><button type="button" className="btn btn-primary min-h-11" disabled={purchasing || confirming.price > (data?.balance ?? 0)} onClick={() => void purchase()}>{purchasing ? <><LoaderCircle className="animate-spin" size={17} />购买中</> : confirming.price > (data?.balance ?? 0) ? "贝壳不足" : "确认购买"}</button></div>
      </Modal>}
    </section>
  );
}
