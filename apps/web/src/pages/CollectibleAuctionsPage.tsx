import { useCallback, useEffect, useState } from "react";
import { Bell, ChevronRight, Clock3, Gavel, Shell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { CollectibleVisual } from "../components/CollectibleVisual";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { subscribeServerEvent } from "../shared/serverEvents";
import type { CollectibleAuction } from "../shared/collectibles";

type Tab = "active" | "upcoming" | "history";
const labels: Record<Tab,string> = { active: "当前在拍", upcoming: "待拍藏品", history: "历史拍卖" };

function timeText(value: string, now: number) {
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - now) / 1000));
  if (!seconds) return "已结束";
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return `${h ? `${h}小时` : ""}${m}分${String(s).padStart(2,"0")}秒`;
}

export default function CollectibleAuctionsPage() {
  const navigate = useNavigate(); const [tab,setTab]=useState<Tab>("active"); const [items,setItems]=useState<CollectibleAuction[]|null>(null); const [now,setNow]=useState(Date.now());
  const load=useCallback(async()=>{const data=await api<{auctions:CollectibleAuction[]}>(`/api/collectible-auctions?tab=${tab}`,{bypassCache:true,dedupe:false});setItems(data.auctions);},[tab]);
  useEffect(()=>{setItems(null);void load();const timer=window.setInterval(()=>void load(),15_000);const clock=window.setInterval(()=>setNow(Date.now()),1000);const unsub=subscribeServerEvent("collectible_auction_changed",()=>void load());const visible=()=>{if(document.visibilityState==="visible")void load();};document.addEventListener("visibilitychange",visible);return()=>{window.clearInterval(timer);window.clearInterval(clock);unsub();document.removeEventListener("visibilitychange",visible);};},[load]);
  return <section className="space-y-3"><PageTopBar title="藏品拍卖"/><MineBackButton to="/mine/store" hideOnDesktop/>
    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-white p-2">{(Object.keys(labels) as Tab[]).map(key=><button key={key} className={`btn ${tab===key?"btn-primary":"btn-secondary"}`} onClick={()=>setTab(key)}>{labels[key]}</button>)}</div>
    {items==null?<div className="card h-40 animate-pulse"/>:items.length===0?<div className="card p-10 text-center"><Gavel className="mx-auto text-slate-300" size={42}/><p className="mt-3 text-sm text-muted">暂无{labels[tab]}</p></div>:<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(a=><button key={a.id} className="card group overflow-hidden p-0 text-left focus-visible:ring-2 focus-visible:ring-primary" onClick={()=>navigate(`/mine/store/auctions/${a.id}`)}><CollectibleVisual collectible={a.collectible} className="aspect-[5/4] rounded-none"/><div className="p-4"><div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1 font-black text-primary"><Shell size={16}/>{a.currentPrice??a.startingPrice}</span><ChevronRight size={18}/></div><p className="mt-2 flex items-center gap-1 text-xs font-bold text-muted"><Clock3 size={14}/>{a.status==="pending"?`开拍：${new Date(a.startsAt).toLocaleString("zh-CN")}`:a.status==="active"?`剩余 ${timeText(a.endsAt,now)}`:a.status==="sold"?`成交：${new Date(a.settledAt!).toLocaleString("zh-CN")}`:"已流拍"}</p>{a.collectible.followed&&<p className="mt-2 flex items-center gap-1 text-xs font-bold text-amber-600"><Bell size={13}/>已关注</p>}</div></button>)}</div>}
  </section>;
}
