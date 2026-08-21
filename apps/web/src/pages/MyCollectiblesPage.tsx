import { Gem } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { CollectibleVisual } from "../components/CollectibleVisual";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { COLLECTIBLE_TYPE_LABELS, type Collectible, type CollectibleType } from "../shared/collectibles";

type CollectibleFilter = "all" | CollectibleType;

const filters: Array<{ key: CollectibleFilter; label: string }> = [
  { key: "all", label: "全部" },
  ...Object.entries(COLLECTIBLE_TYPE_LABELS).map(([key, label]) => ({ key: key as CollectibleType, label }))
];

export default function MyCollectiblesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Collectible[] | null>(null);
  const [activeType, setActiveType] = useState<CollectibleFilter>("all");

  useEffect(() => {
    void api<{ collectibles: Collectible[] }>("/api/me/collectibles", { bypassCache: true })
      .then((data) => setItems(data.collectibles));
  }, []);

  const filteredItems = useMemo(
    () => items?.filter((item) => activeType === "all" || item.collectibleType === activeType) ?? [],
    [activeType, items]
  );

  return <section className="space-y-3">
    <PageTopBar title="我的收藏品" />
    <MineBackButton to="/mine/collection" hideOnDesktop />
    {items == null ? <div className="card h-40 animate-pulse" /> : items.length === 0 ? <div className="card p-10 text-center"><Gem className="mx-auto text-slate-300" size={42} /><p className="mt-3 text-sm text-muted">还没有收藏品</p></div> : <>
      <div className="card grid grid-cols-4 gap-2 p-2" role="tablist" aria-label="按收藏品类型筛选">
        {filters.map((filter) => {
          const count = filter.key === "all" ? items.length : items.filter((item) => item.collectibleType === filter.key).length;
          const selected = activeType === filter.key;
          return <button key={filter.key} type="button" role="tab" aria-selected={selected} className={`min-h-11 rounded-xl px-2 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? "bg-primary text-white shadow-sm" : "text-muted hover:bg-slate-100"}`} onClick={() => setActiveType(filter.key)}><span>{filter.label}</span><span className={`ml-1 text-xs ${selected ? "text-white/80" : "text-muted"}`}>{count}</span></button>;
        })}
      </div>
      {filteredItems.length === 0 ? <div className="card p-10 text-center"><p className="text-sm text-muted">暂无{filters.find((filter) => filter.key === activeType)?.label}类型收藏品</p></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {filteredItems.map((item) => <button key={item.id} type="button" aria-label={`查看${item.collectibleTypeLabel}收藏品${item.name}`} onClick={() => navigate(`/mine/collectibles/${item.id}`)} className="min-h-11 rounded-2xl text-left transition hover:ring-2 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><CollectibleVisual collectible={item} className="aspect-[5/6]" /></button>)}
      </div>}
    </>}
  </section>;
}
