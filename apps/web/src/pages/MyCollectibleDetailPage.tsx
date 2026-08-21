import { CalendarClock, CircleUserRound, Gem, Hash, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../api";
import { CollectibleVisual } from "../components/CollectibleVisual";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { useApp } from "../context/AppContext";
import type { Collectible } from "../shared/collectibles";

function detailDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

export default function MyCollectibleDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { showToast } = useApp();
  const [item, setItem] = useState<Collectible | null>(null);
  const backTo = (location.state as { backTo?: string } | null)?.backTo ?? "/mine/collectibles";

  useEffect(() => {
    let cancelled = false;
    void api<{ collectible: Collectible }>(`/api/collectibles/${id}`, { bypassCache: true })
      .then((data) => { if (!cancelled) setItem(data.collectible); })
      .catch((error) => showToast((error as Error).message));
    return () => { cancelled = true; };
  }, [id, showToast]);

  if (!item) return <section><PageTopBar title="收藏品详情"/><MineBackButton to={backTo} hideOnDesktop/><div className="card h-72 animate-pulse"/></section>;

  const facts = [
    { icon: Hash, label: "收藏品序号", value: `NO.${item.collectibleNo}` },
    { icon: Sparkles, label: "品质", value: item.rarityLabel },
    { icon: Gem, label: "类型", value: item.collectibleTypeLabel },
    { icon: ShieldCheck, label: "状态", value: item.statusLabel },
    { icon: Gem, label: "收藏品价值", value: item.collectibleValue.toLocaleString() },
    { icon: CircleUserRound, label: "拥有者", value: item.owner ? `${item.owner.nickname}（${item.owner.username}）` : "暂无拥有者" },
    { icon: CalendarClock, label: "获取时间", value: detailDate(item.acquiredAt) }
  ];

  return <section className="space-y-3"><PageTopBar title="收藏品详情"/><MineBackButton to={backTo} hideOnDesktop/>
    <article className="grid gap-5 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] lg:items-start">
      <CollectibleVisual collectible={item} className="aspect-[5/6] w-full shadow-soft"/>
      <div className="space-y-4">
        <header className="card p-5 sm:p-6"><p className="text-xs font-black tracking-[0.12em] text-primary">{item.rarityLabel} · NO.{item.collectibleNo}</p><h1 className="mt-2 text-2xl font-black text-ink sm:text-3xl">{item.name}</h1><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted">{item.description || "暂无介绍"}</p></header>
        <section className="card p-4 sm:p-5" aria-labelledby="collectible-record-title"><h2 id="collectible-record-title" className="font-black text-ink">收藏品档案</h2><dl className="mt-4 grid gap-3 sm:grid-cols-2">{facts.map(({ icon: Icon, label, value })=><div key={label} className="rounded-2xl border border-line bg-slate-50 p-4"><dt className="flex items-center gap-2 text-xs font-bold text-muted"><Icon size={16}/>{label}</dt><dd className="mt-2 break-words text-sm font-black text-ink">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-5 text-muted">收藏品价值仅用于平台收藏品展示与排行榜统计，不代表价格、估值或可兑换资产。</p></section>
      </div>
    </article>
  </section>;
}
