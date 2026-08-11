import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ShieldCheck, Shell } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { AssetCardVisual, AssetMotionMedia } from "../components/AssetCardVisual";
import { AssetDrawOverlay } from "../components/AssetDrawOverlay";
import { AssetPackStoryModal } from "../components/AssetPackStoryModal";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { useApp } from "../context/AppContext";
import type { AssetDrawOrder, AssetPack } from "../shared/digitalAssets";
import { ASSET_RARITY_LABELS, warmAssetImage } from "../shared/digitalAssets";
import { publishShellBalance } from "../shared/useShellBalance";

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AssetPackPage() {
  const { packId = "" } = useParams();
  const navigate = useNavigate();
  const { user, showToast } = useApp();
  const [data, setData] = useState<{ balance: number; pack: AssetPack } | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  const [order, setOrder] = useState<AssetDrawOrder | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);

  const load = useCallback((fresh = false, showLoading = true) => {
    if (showLoading) setLoading(true);
    const path = `/api/asset-store/packs/${packId}${fresh ? `?refresh=${Date.now()}` : ""}`;
    return api<{ balance: number; pack: AssetPack }>(path, fresh ? { bypassCache: true } : { cacheTtlMs: 60_000 })
      .then((nextData) => {
        setData(nextData);
        publishShellBalance(user?.id, nextData.balance);
      }).catch((error) => showToast((error as Error).message)).finally(() => { if (showLoading) setLoading(false); });
  }, [packId, user?.id]);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => { warmAssetImage("/card-back.webp?v=20260721"); }, []);

  async function draw(mode: "single" | "ten") {
    if (drawingRef.current) return;
    drawingRef.current = true;
    setOrder(null);
    setDrawing(true);
    try {
      const result = await api<{ order: AssetDrawOrder; balance: number }>(`/api/asset-store/packs/${packId}/draw`, { method: "POST", body: { mode, requestId: requestId() } });
      for (const card of result.order.results) warmAssetImage(card.thumbnailUrl || card.imageUrl);
      setData((current) => current ? {
        ...current,
        balance: result.balance,
        pack: result.order.usedFreeDraw
          ? { ...current.pack, freeDrawsRemaining: Math.max(0, current.pack.freeDrawsRemaining - 1) }
          : current.pack
      } : current);
      publishShellBalance(user?.id, result.balance);
      setOrder(result.order);
      void load(true, false);
    } catch (error) { showToast((error as Error).message); }
    finally {
      drawingRef.current = false;
      setDrawing(false);
    }
  }

  if (loading || !data) return <section className="min-h-screen bg-page"><PageTopBar title="卡包详情" backTo="/mine/store/cards" /><div className="mx-auto max-w-6xl space-y-3 px-4"><ListSkeleton rows={6} /></div></section>;
  const { pack } = data;
  const singleFree = pack.freeDrawsRemaining > 0;
  const singleUnavailable = !singleFree && data.balance < pack.singlePrice;
  const tenUnavailable = data.balance < pack.tenPrice;

  return (
    <section className="min-h-screen bg-page">
      <PageTopBar title="卡包详情" backTo="/mine/store/cards" />
      <div className="asset-pack-detail-layout mx-auto max-w-6xl space-y-4 px-4 pb-32 lg:space-y-0">
        <div className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-soft">
          <div className="relative h-72 sm:h-96">{pack.coverCard ? <AssetMotionMedia card={pack.coverCard} className="h-full w-full object-cover opacity-75" eager /> : <div className="h-full w-full bg-slate-900" />}<div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/15 to-transparent" /><div className="absolute inset-x-0 bottom-0 p-5"><span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black backdrop-blur">{pack.packTypeLabel}</span><h1 className="mt-3 text-3xl font-black">{pack.name}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">{pack.description}</p></div></div>
          <div className="grid grid-cols-3 gap-px bg-white/10 text-center text-xs"><div className="bg-slate-950/80 p-3"><p className="text-slate-400">稀有保底</p><p className="mt-1 font-black">{pack.pity.rare}/{pack.pity.rareLimit}</p></div><div className="bg-slate-950/80 p-3"><p className="text-slate-400">史诗保底</p><p className="mt-1 font-black">{pack.pity.epic}/{pack.pity.epicLimit}</p></div><div className="bg-slate-950/80 p-3"><p className="text-slate-400">传说保底</p><p className="mt-1 font-black">{pack.pity.legend}/{pack.pity.legendLimit}</p></div></div>
        </div>

        <div className="card p-4">
          <h2 className="font-black text-ink">卡包内容</h2>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {(pack.cards ?? []).map((card) => <AssetCardVisual key={card.id} card={card} owned={card.owned} compactBadges />)}
          </div>
          <div className="mt-5 border-t border-line pt-5">
            <div className="flex items-center justify-between"><div><h3 className="font-black text-ink">卡包概率</h3><p className="mt-1 text-xs text-muted">按卡牌品质展示抽取概率</p></div><ShieldCheck className="text-primary" size={24} /></div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{(["normal", "rare", "epic", "legend"] as const).map((rarity) => <div key={rarity} className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-muted">{ASSET_RARITY_LABELS[rarity]}</p><p className="mt-1 text-lg font-black text-ink">{pack.rarityProbabilities[rarity]}%</p></div>)}</div>
          </div>
        </div>
      </div>

      <div className="site-footer-safe-bottom-0 fixed inset-x-0 z-30 border-t border-line bg-white/96 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,.08)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 sm:gap-3"><div className="hidden sm:block"><p className="text-xs text-muted">贝壳余额</p><p className="flex items-center gap-1 font-black text-ink"><Shell size={16} />{data.balance.toLocaleString()}</p></div><button className="btn btn-secondary min-h-12 flex-1 px-2 text-xs sm:max-w-52 sm:text-sm" disabled={drawing || singleUnavailable} onClick={() => void draw("single")}><Shell size={17} />{drawing ? "抽取中…" : singleUnavailable ? "贝壳不足" : singleFree ? `免费单抽 (${pack.freeDrawsRemaining})` : `单抽 ${pack.singlePrice}`}</button><button className="btn btn-primary min-h-12 flex-1 px-2 text-xs sm:max-w-52 sm:text-sm" disabled={drawing || tenUnavailable} onClick={() => void draw("ten")}><Shell size={17} />{drawing ? "抽取中…" : tenUnavailable ? "贝壳不足" : `十连 ${pack.tenPrice}`}</button><button className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-2 text-xs font-black text-amber-800 shadow-[0_4px_12px_rgba(180,83,9,.10)] transition hover:brightness-105 active:scale-[.97] sm:max-w-52 sm:text-sm" onClick={() => setStoryOpen(true)}><BookOpen size={17} />卡包故事</button></div>
      </div>

      {order && <AssetDrawOverlay key={order.id} order={order} balance={data.balance} onClose={() => setOrder(null)} onDrawAgain={(mode) => void draw(mode)} />}
      {storyOpen && <AssetPackStoryModal pack={pack} onClose={() => setStoryOpen(false)} />}
    </section>
  );
}
