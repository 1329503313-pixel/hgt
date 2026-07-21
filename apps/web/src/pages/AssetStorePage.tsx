import { useEffect, useState } from "react";
import { BookOpen, Clock3, GalleryVerticalEnd, History, Shell, Sparkles, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, prefetchApi } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { ListSkeleton } from "../components/Skeletons";
import { AssetPackStoryModal } from "../components/AssetPackStoryModal";
import { useApp } from "../context/AppContext";
import type { AssetPack } from "../shared/digitalAssets";
import { warmAssetImage } from "../shared/digitalAssets";

function fullPackCover(url: string) {
  return url.replace("/thumbnail", "/cover");
}

function remainingText(endAt: string | null) {
  if (!endAt) return "长期上架";
  const ms = new Date(endAt).getTime() - Date.now();
  if (ms <= 0) return "已结束";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `剩余 ${days} 天 ${hours} 小时` : `剩余 ${Math.max(1, hours)} 小时`;
}

export default function AssetStorePage() {
  const navigate = useNavigate();
  const { user, loadingUser, openAuth, showToast } = useApp();
  const [data, setData] = useState<{ balance: number; packs: AssetPack[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [storyPack, setStoryPack] = useState<AssetPack | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ balance: number; packs: AssetPack[] }>("/api/asset-store/packs", { cacheTtlMs: 30_000 })
      .then(setData).catch((error) => showToast((error as Error).message)).finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    if (!data?.packs.length) return;
    const warm = () => {
      void import("./AssetPackPage");
      for (const pack of data.packs.slice(0, 2)) {
        void prefetchApi(`/api/asset-store/packs/${pack.id}`, 60_000);
        warmAssetImage(fullPackCover(pack.coverUrl));
      }
    };
    const idleWindow = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warm, { timeout: 800 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 250);
    return () => window.clearTimeout(id);
  }, [data?.packs]);

  function warmPack(pack: AssetPack) {
    void import("./AssetPackPage");
    void prefetchApi(`/api/asset-store/packs/${pack.id}`, 60_000);
    warmAssetImage(fullPackCover(pack.coverUrl));
  }

  if (loadingUser || (user && loading)) return <section className="space-y-3"><PageTopBar title="商城" /><MineBackButton /><ListSkeleton rows={5} /></section>;
  if (!user) return <section className="space-y-3"><PageTopBar title="商城" /><MineBackButton /><div className="card p-8 text-center"><p className="text-sm text-muted">登录后可进入商城。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div></section>;

  const groups = (["limited", "collaboration", "permanent"] as const).map((type) => ({ type, packs: (data?.packs ?? []).filter((pack) => pack.packType === type) })).filter((group) => group.packs.length);

  return (
    <section className="space-y-3">
      <PageTopBar title="商城" />
      <MineBackButton />
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 p-5 text-white shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-xs font-bold text-blue-100">当前贝壳余额</p><p className="mt-1 flex items-center gap-2 text-3xl font-black"><Shell size={25} />{(data?.balance ?? 0).toLocaleString()}</p></div>
          <Sparkles size={48} className="text-cyan-200/70" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <button className="rounded-xl bg-white/12 px-2 py-3 text-xs font-bold" onPointerEnter={() => { void import("./CardCabinetPage"); void prefetchApi("/api/me/card-cabinet", 60_000); }} onFocus={() => { void import("./CardCabinetPage"); void prefetchApi("/api/me/card-cabinet", 60_000); }} onClick={() => navigate("/mine/cards")}><GalleryVerticalEnd className="mx-auto mb-1" size={18} />收藏柜</button>
          <button className="rounded-xl bg-white/12 px-2 py-3 text-xs font-bold" onClick={() => navigate("/mine/rankings", { state: { tab: "collection" } })}><Trophy className="mx-auto mb-1" size={18} />收藏榜</button>
          <button className="rounded-xl bg-white/12 px-2 py-3 text-xs font-bold" onClick={() => navigate("/mine/asset-draw-history")}><History className="mx-auto mb-1" size={18} />抽卡记录</button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card p-10 text-center"><GalleryVerticalEnd className="mx-auto text-slate-300" size={44} /><h2 className="mt-4 font-black text-ink">商城正在准备卡包</h2><p className="mt-2 text-sm leading-6 text-muted">管理员上传卡牌素材、配置概率并启用卡包后，会自动展示在这里。</p></div>
      ) : groups.map((group) => (
        <div key={group.type} className="space-y-3">
          <h2 className="px-1 text-base font-black text-ink">{group.packs[0].packTypeLabel}</h2>
          {group.packs.map((pack) => (
            <article key={pack.id} className="card block w-full overflow-hidden p-0 text-left" onPointerEnter={() => warmPack(pack)} onFocusCapture={() => warmPack(pack)} onTouchStart={() => warmPack(pack)}>
              <div className="grid grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)]">
                <img src={pack.coverUrl} alt="" className="h-full min-h-44 w-full object-cover" loading="lazy" decoding="async" />
                <div className="min-w-0 p-4">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-lg font-black text-ink">{pack.name}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{pack.description}</p></div><span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-primary">{pack.packTypeLabel}</span></div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-muted"><span className="inline-flex items-center gap-1"><Clock3 size={13} />{remainingText(pack.saleEndAt)}</span><span>稀有保底 {pack.pity.rare}/{pack.pity.rareLimit}</span><span>传说保底 {pack.pity.legend}/{pack.pity.legendLimit}</span></div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="flex -space-x-4">{(pack.previewCards ?? []).slice(0, 4).map((card) => <img key={card.id} src={card.thumbnailUrl || card.imageUrl} alt="" className="aspect-[5/7] w-12 rounded-lg border-2 border-white object-cover first:ml-0" loading="lazy" decoding="async" />)}</div>
                    <div className="flex w-[100px] shrink-0 flex-col gap-2"><button type="button" className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-2 text-[13px] font-black leading-none text-white shadow-[0_6px_14px_rgba(37,99,235,.24)] transition hover:brightness-105 active:scale-[.97]" onClick={() => navigate(`/mine/store/${pack.id}`)}><Shell size={15} strokeWidth={2.4} />抽取卡牌</button><button type="button" className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-2 text-[13px] font-black leading-none text-amber-800 shadow-[0_4px_12px_rgba(180,83,9,.10)] transition hover:brightness-105 active:scale-[.97]" onClick={() => setStoryPack(pack)}><BookOpen size={15} strokeWidth={2.4} />卡包故事</button></div>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ))}

      {storyPack && <AssetPackStoryModal pack={storyPack} onClose={() => setStoryPack(null)} />}
    </section>
  );
}
