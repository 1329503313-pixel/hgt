import { useEffect, useState } from "react";
import { Shell } from "lucide-react";
import { api } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { AssetCardVisual } from "../components/AssetCardVisual";
import { ListSkeleton } from "../components/Skeletons";
import type { AssetDrawOrder } from "../shared/digitalAssets";

export default function AssetDrawHistoryPage() {
  const [orders, setOrders] = useState<AssetDrawOrder[] | null>(null);
  useEffect(() => { api<{ orders: AssetDrawOrder[] }>("/api/me/asset-draw-history", { bypassCache: true }).then((data) => setOrders(data.orders)); }, []);
  return <section className="space-y-3"><PageTopBar title="抽卡记录" /><MineBackButton to="/mine/store" />{orders == null ? <ListSkeleton rows={6} /> : orders.length === 0 ? <div className="card p-8 text-center text-sm text-muted">暂无抽卡记录</div> : <div className="grid gap-4 xl:grid-cols-2">{orders.map((order) => <div key={order.id} className="card p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-black text-ink">{order.packName}</h2><p className="mt-1 text-xs text-muted">{new Date(order.createdAt).toLocaleString("zh-CN")} · {order.drawMode === "ten" ? "十连抽" : "单抽"}</p></div><span className="inline-flex items-center gap-1 text-xs font-black text-primary"><Shell size={14} />{order.usedFreeDraw ? "免费" : `-${order.shellCost}`}</span></div><div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10 xl:grid-cols-5">{order.results.map((result) => <AssetCardVisual key={result.drawIndex} card={result} historyCompact />)}</div></div>)}</div>}</section>;
}
