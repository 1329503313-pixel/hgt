import { CalendarClock, Gavel, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { Collectible, CollectibleAuction } from "../../shared/collectibles";
import { CollectibleVisual } from "../CollectibleVisual";
import { Modal } from "../Modal";

type AuctionTab = "active" | "upcoming" | "history";

function localDate(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function CollectibleAuctionManagement() {
  const [tab, setTab] = useState<AuctionTab>("active");
  const [auctions, setAuctions] = useState<Record<AuctionTab, CollectibleAuction[]>>({ active: [], upcoming: [], history: [] });
  const [collectibles, setCollectibles] = useState<Collectible[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [collectibleId, setCollectibleId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [price, setPrice] = useState("100");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const [active, upcoming, history, catalog] = await Promise.all([
      api<{ auctions: CollectibleAuction[] }>("/api/collectible-auctions?tab=active", { bypassCache: true }),
      api<{ auctions: CollectibleAuction[] }>("/api/collectible-auctions?tab=upcoming", { bypassCache: true }),
      api<{ auctions: CollectibleAuction[] }>("/api/collectible-auctions?tab=history", { bypassCache: true }),
      api<{ collectibles: Collectible[] }>("/api/admin/collectibles", { bypassCache: true })
    ]);
    setAuctions({ active: active.auctions, upcoming: upcoming.auctions, history: history.auctions });
    setCollectibles(catalog.collectibles);
  }
  useEffect(() => {
    void load().catch((error) => setMessage((error as Error).message));
    const timer = window.setInterval(() => void load().catch(() => undefined), 15_000);
    const refresh = () => void load().catch(() => undefined);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  const available = useMemo(() => collectibles.filter((item) => item.status === "unowned" && (!keyword.trim() || `${item.collectibleNo}${item.name}${item.collectibleTypeLabel}${item.rarityLabel}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))), [collectibles, keyword]);

  function openCreate() {
    const start = new Date(Date.now() + 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const first = collectibles.find((item) => item.status === "unowned");
    setCollectibleId(first?.id ?? "");
    setKeyword("");
    setPrice("100");
    setStartsAt(localDate(start));
    setEndsAt(localDate(end));
    setMessage("");
    setCreateOpen(true);
  }

  async function createAuction() {
    if (!collectibleId || !startsAt || !endsAt) return;
    setSaving(true);
    try {
      await api(`/api/admin/collectibles/${collectibleId}/auction`, { method: "POST", body: { startingPrice: Number(price), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() } });
      setCreateOpen(false);
      await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  }

  async function cancelAuction(auction: CollectibleAuction) {
    if (!window.confirm(`确认取消“${auction.collectible.name}”的拍卖任务吗？`)) return;
    try { await api(`/api/admin/collectible-auctions/${auction.id}`, { method: "DELETE" }); await load(); }
    catch (error) { setMessage((error as Error).message); }
  }

  const statusLabel = (status: CollectibleAuction["status"]) => ({ pending: "待拍卖", active: "拍卖中", sold: "已成交", unsold: "已流拍", cancelled: "已取消" }[status]);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">收藏品拍卖</h2><p className="mt-1 text-sm text-muted">从一级“收藏品”目录已创建的无主收藏品中选择，并创建拍卖任务。</p></div><button className="btn btn-primary" onClick={openCreate}><Plus size={17} />创建拍卖任务</button></div>
    {message && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{message}</p>}
    <div className="card grid grid-cols-3 gap-2 p-2" role="tablist" aria-label="拍卖任务状态">{([['active','拍卖中'],['upcoming','待拍卖'],['history','历史记录']] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={`min-h-11 rounded-xl px-3 text-sm font-black ${tab === key ? "bg-primary text-white" : "text-muted hover:bg-slate-100"}`} onClick={() => setTab(key)}>{label} {auctions[key].length}</button>)}</div>
    <div className="grid gap-3">{auctions[tab].length === 0 ? <div className="card p-10 text-center text-sm text-muted">暂无{tab === "active" ? "正在进行的" : tab === "upcoming" ? "待开始的" : "历史"}拍卖任务</div> : auctions[tab].map((auction) => <article key={auction.id} className="card flex flex-col gap-4 p-4 lg:flex-row lg:items-center"><CollectibleVisual collectible={auction.collectible} className="aspect-[5/4] w-full lg:w-36" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-ink">{auction.collectible.name}</h3><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-primary">NO.{auction.collectible.collectibleNo}</span><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{statusLabel(auction.status)}</span></div><p className="mt-2 text-sm text-muted">起拍价 {auction.startingPrice.toLocaleString()} 贝壳 · 当前价 {auction.currentPrice?.toLocaleString() ?? "暂无出价"}</p><p className="mt-1 text-xs text-muted"><CalendarClock size={14} className="mr-1 inline" />{new Date(auction.startsAt).toLocaleString("zh-CN")} 至 {new Date(auction.endsAt).toLocaleString("zh-CN")}</p>{auction.status === "sold" && <p className="mt-1 text-xs font-bold text-emerald-700">成交人：{auction.highestBidder?.nickname ?? "—"} · 成交价：{auction.currentPrice?.toLocaleString() ?? "—"} 贝壳</p>}</div>{(auction.status === "pending" || auction.status === "active") && <button className="btn btn-secondary text-xs" disabled={auction.currentPrice != null} title={auction.currentPrice != null ? "已经有人出价，不可下架" : "取消拍卖任务"} onClick={() => void cancelAuction(auction)}>取消任务</button>}</article>)}</div>

    {createOpen && <Modal full onClose={() => !saving && setCreateOpen(false)}><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">创建拍卖任务</h2><p className="mt-1 text-sm text-muted">拍卖任务只关联已有收藏品，不在此创建或编辑收藏品。</p></div><button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100" aria-label="关闭创建拍卖任务弹窗" disabled={saving} onClick={() => setCreateOpen(false)}><X size={20} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="label">搜索收藏品</span><span className="relative mt-1 block"><Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={16} /><input className="field pr-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称、编号、类型或品质" /></span></label><label className="sm:col-span-2"><span className="label">关联已有收藏品</span><select className="field mt-1" value={collectibleId} onChange={(event) => setCollectibleId(event.target.value)}><option value="">请选择无主收藏品</option>{available.map((item) => <option key={item.id} value={item.id}>NO.{item.collectibleNo} · {item.name} · {item.collectibleTypeLabel} · {item.rarityLabel}</option>)}</select><span className="mt-1 block text-xs text-muted">仅无主且未关联卡包或其他拍卖任务的收藏品可选。</span></label><label><span className="label">起拍价（贝壳）</span><input className="field mt-1" type="number" min="1" step="1" value={price} onChange={(event) => setPrice(event.target.value)} /></label><div /><label><span className="label">开始时间</span><input className="field mt-1" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label><span className="label">结束时间</span><input className="field mt-1" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label><p className="sm:col-span-2 text-xs leading-5 text-muted"><Gavel size={14} className="mr-1 inline" />结束前 1 分钟内出现新出价时，截止时间自动顺延到该次出价后 1 分钟；已有出价的任务不可取消。</p></div><button className="btn btn-primary mt-5 w-full" disabled={saving || !collectibleId || !Number.isInteger(Number(price)) || Number(price) <= 0 || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)} onClick={() => void createAuction()}>{saving ? "创建中…" : "确认创建拍卖任务"}</button></Modal>}
  </div>;
}
