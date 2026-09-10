import { useEffect, useState } from "react";
import { NavLink, Navigate, useLocation } from "react-router-dom";
import { Plus, Pencil, Users, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../Modal";
import { AdminPagination } from "./AdminPagination";
import { BossEditor, CardBattleBossManagement } from "./CardBattleBossManagement";
import type { BossCard, CardBattleBoss } from "../../shared/cardBattleBoss";
import { cardBattleAdminRoutes } from "./adminRouteManifest";

type Floor = { id: string; floorNumber: number; enabled: boolean; rewardShells: number; cards: Array<BossCard | null>; revision: number; clearCount: number };
function asBoss(floor: Floor): CardBattleBoss {
  return { roomId: floor.id, name: `第 ${floor.floorNumber} 层`, code: "", enabled: floor.enabled, available: floor.enabled,
    startsAt: "2000-01-01T00:00:00Z", endsAt: "2100-01-01T00:00:00Z", rewardShells: floor.rewardShells, cards: floor.cards, revision: floor.revision };
}
export function CardBattleManagement() {
  const { pathname } = useLocation();
  if (!cardBattleAdminRoutes.some((route) => route.path === pathname)) return <Navigate to={cardBattleAdminRoutes[0].path} replace />;
  return <div className="space-y-4"><h1 className="text-xl font-black text-ink">卡牌对战</h1><nav aria-label="卡牌对战管理" className="flex gap-2">
    {cardBattleAdminRoutes.map((route) => <NavLink key={route.path} to={route.path} className={({ isActive }) => `btn ${isActive ? "btn-primary" : "btn-secondary"}`}>{route.label}</NavLink>)}
  </nav>{pathname.endsWith("/tower") ? <CardTowerManagement /> : <CardBattleBossManagement />}</div>;
}
function Clears({ floor, onClose }: { floor: Floor; onClose: () => void }) {
  const [page, setPage] = useState(1), [error, setError] = useState("");
  const [data, setData] = useState<{ clears: Array<{ userId: string; nickname: string; username: string; clearedAt: string }>; total: number } | null>(null);
  useEffect(() => { let active = true; setData(null); setError("");
    void api<NonNullable<typeof data>>(`/api/online-soup/admin/card-tower/floors/${floor.id}/clears?offset=${(page - 1) * 10}`, { bypassCache: true }).then((value) => { if (active) setData(value); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [floor.id, page]);
  return <Modal onClose={onClose}><h2 className="pr-8 text-xl font-black">第 {floor.floorNumber} 层 · 通关列表</h2>{error && <p role="alert" className="py-4 text-red-700">{error}</p>}
    {!data && !error ? <p className="py-8">加载中…</p> : data && <><div className="mt-4 space-y-3">{data.clears.map((entry) => <article key={entry.userId} className="rounded-xl border border-line p-3"><p className="font-bold">{entry.nickname}</p><p className="break-all text-sm text-muted">账号：{entry.username}</p><p className="mt-1 text-xs tabular-nums text-muted">{new Date(entry.clearedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</p></article>)}{!data.total && <p className="py-8 text-center text-muted">暂无通关记录</p>}</div><AdminPagination page={page} pageSize={10} total={data.total} onPageChange={setPage} /></>}
  </Modal>;
}
function CardTowerManagement() {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [error, setError] = useState("");
  const [data, setData] = useState<{ floors: Floor[]; total: number; canCreate: boolean } | null>(null);
  const [editor, setEditor] = useState<Floor | "new" | null>(null), [records, setRecords] = useState<Floor | null>(null);
  useEffect(() => { let active = true; setError(""); setData(null);
    void api<NonNullable<typeof data>>(`/api/online-soup/admin/card-tower/floors?offset=${(page - 1) * 10}`, { bypassCache: true }).then((value) => { if (active) setData(value); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [page, refresh]);
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black">通天塔</h2><p className="mt-1 text-sm text-muted">层级不可删除，上架后不可下架。上一层上架后可新增下一层。</p></div><div className="flex gap-2"><button className="btn btn-secondary" onClick={() => setRefresh((v) => v + 1)} aria-label="刷新层级"><RefreshCw size={16} /></button><button className="btn btn-primary" disabled={!data?.canCreate} onClick={() => setEditor("new")}><Plus size={16} />新增层级</button></div></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}{data?.canCreate === false && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">请先编辑并上架第 {data.total} 层，再创建下一层。</p>}
    {!data && !error ? <p className="py-8 text-center">加载中…</p> : data && <>{data.floors.map((floor) => <article key={floor.id} className="card p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-black">第 {floor.floorNumber} 层</h3><span className={`text-sm font-bold ${floor.enabled ? "text-emerald-700" : "text-muted"}`}>{floor.enabled ? "已上架" : "未上架草稿"}</span></div><p className="mt-3 text-sm text-amber-700">通关奖励 {floor.rewardShells} 贝壳</p><p className="mt-2 text-sm text-muted">通关人数：{floor.clearCount}</p><div className="mt-3 flex gap-2">{floor.cards.map((card, i) => <div key={i} className="min-w-0 flex-1 text-center">{card ? <img className="mx-auto aspect-[5/7] w-full max-w-20 rounded-lg object-cover" src={card.imageUrl} alt={card.name} /> : <div className="mx-auto grid aspect-[5/7] w-full max-w-20 place-items-center rounded-lg bg-slate-100 text-xs text-muted">待配置</div>}<p className="mt-1 truncate text-xs">{card?.name || "空卡位"}</p></div>)}</div><div className="mt-4 flex gap-2"><button className="btn btn-secondary" onClick={() => setEditor(floor)}><Pencil size={15} />编辑</button><button className="btn btn-secondary" onClick={() => setRecords(floor)}><Users size={15} />通关列表</button></div></article>)}{!data.total && <p className="card py-12 text-center text-muted">暂无层级，新增第一层开始配置。</p>}<AdminPagination page={page} pageSize={10} total={data.total} onPageChange={setPage} /></>}
    {editor && <BossEditor boss={editor === "new" ? null : asBoss(editor)} tower={editor === "new" ? { floorNumber: (data?.total ?? 0) + 1 } : { id: editor.id, floorNumber: editor.floorNumber }} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRefresh((v) => v + 1); }} />}
    {records && <Clears floor={records} onClose={() => setRecords(null)} />}
  </section>;
}
