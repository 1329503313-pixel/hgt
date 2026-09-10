import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { VipIdentity } from "./VipIdentity";

type Entry = { vipLevel: number; vipActive: boolean; userId: string; nickname: string; ranking: number; totalPower: number; floorNumber: number; clearedAt: string };
export function CardTowerRankingBoard({ currentUserId }: { currentUserId: string }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false), [refresh, setRefresh] = useState(0), [error, setError] = useState("");
  const [data, setData] = useState<{ entries: Entry[]; me: Entry | null } | null>(null);
  useEffect(() => { let active = true; setData(null); setError("");
    void api<NonNullable<typeof data>>(`/api/online-soup/card-tower/ranking?limit=${expanded ? 100 : 10}`, { bypassCache: true }).then((result) => { if (active) setData(result); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [expanded, refresh, currentUserId]);
  const row = (entry: Entry) => <tr key={entry.userId} className={`border-t border-line ${entry.userId === currentUserId ? "bg-blue-50/60" : ""}`}><td className="px-2 py-3 text-center font-black tabular-nums">{entry.ranking}</td><td className="min-w-0 px-2 py-3"><button className="min-h-11 max-w-full break-words text-left font-bold text-primary" onClick={() => navigate(entry.userId === currentUserId ? "/mine" : `/users/${entry.userId}`, { state: { returnTo: "/mine/rankings?tab=card_battle&mode=tower" } })}><VipIdentity nickname={entry.nickname} vipLevel={entry.vipLevel} vipActive={entry.vipActive} /></button></td><td className="px-2 py-3 text-right tabular-nums">{entry.totalPower.toLocaleString()}</td><td className="px-2 py-3 text-right font-bold tabular-nums">{entry.floorNumber}</td></tr>;
  return <section className="card overflow-hidden"><div className="border-b border-line px-4 py-3"><h2 className="font-black">卡牌闯关</h2><p className="mt-1 text-xs leading-5 text-muted">可通关大厅-创建-卡牌对战-卡牌闯关来参与闯关赢取排名</p></div>
    {error ? <div role="alert" className="p-6 text-center"><p className="text-red-700">{error}</p><button className="btn btn-secondary mt-3" onClick={() => setRefresh((v) => v + 1)}>重试</button></div> : !data ? <p role="status" className="py-12 text-center text-muted">加载中…</p> : <><table className="w-full table-fixed text-sm"><thead><tr className="bg-slate-50 text-xs text-muted"><th className="w-12 px-2 py-3">排名</th><th className="px-2 py-3 text-left">用户昵称</th><th className="w-[30%] px-2 py-3 text-right">通关战力</th><th className="w-20 px-2 py-3 text-right">通关层数</th></tr></thead><tbody>{data.entries.map(row)}{data.me && !data.entries.some((entry) => entry.userId === currentUserId) && row(data.me)}</tbody></table>{!data.entries.length && <p className="py-12 text-center text-muted">暂无通关记录，等待首位挑战者</p>}{!data.me && <p className="border-t border-line p-3 text-center text-xs text-muted">你尚未通关</p>}<div className="border-t border-line p-3 text-center"><button className="btn btn-secondary" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "查看更多"}</button></div></>}
  </section>;
}
