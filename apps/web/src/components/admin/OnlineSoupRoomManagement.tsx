import { useCallback, useEffect, useState } from "react";
import { Eye, LockKeyhole, RefreshCw, Radio, Users } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../Modal";
import type { OnlineSoupLobbyRoom, OnlineSoupSnapshot } from "../../shared/types";

type AdminRoom = OnlineSoupLobbyRoom & { hostUsername: string };
const statusText = { preparing: "准备中", playing: "推理中", ended: "本轮已结束", closed: "已关闭" } as const;

export function OnlineSoupRoomManagement() {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<OnlineSoupSnapshot | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setRooms((await api<{ rooms: AdminRoom[] }>("/api/online-soup/admin/rooms", { bypassCache: true })).rooms); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "房间列表加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openDetail(roomId: string) {
    try { setDetail(await api<OnlineSoupSnapshot>(`/api/online-soup/admin/rooms/${roomId}`, { bypassCache: true })); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "房间详情加载失败"); }
  }

  return <div className="space-y-4">
    <div className="flex items-center justify-between"><div><h2 className="text-xl font-black text-ink">多人在线玩汤</h2><p className="text-sm text-muted">查看全部房间及当前成员、汤面和轮次状态</p></div><button className="btn btn-secondary" onClick={load}><RefreshCw size={16} /> 刷新</button></div>
    {error && <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{error}</div>}
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-line bg-slate-50 text-xs text-muted"><tr><th className="p-3">房间</th><th className="p-3">类型</th><th className="p-3">房主</th><th className="p-3">玩家</th><th className="p-3">当前海龟汤</th><th className="p-3">状态</th><th className="p-3">创建时间</th><th className="p-3">操作</th></tr></thead><tbody>{rooms.map((room) => <tr key={room.id} className="border-b border-line last:border-0"><td className="p-3"><p className="font-bold text-ink">{room.name}</p><p className="text-xs text-muted">#{room.code}</p></td><td className="p-3">{room.hasPassword ? <span className="inline-flex items-center gap-1"><LockKeyhole size={14} />密码房</span> : "公开房"}</td><td className="p-3"><p>{room.host.nickname}</p><p className="text-xs text-muted">{room.hostUsername}</p></td><td className="p-3"><span className="inline-flex items-center gap-1"><Users size={14} />{room.playerCount}/8</span></td><td className="max-w-48 truncate p-3">{room.soupTitle ?? "—"}</td><td className="p-3">{statusText[room.status]}</td><td className="p-3 text-xs">{new Date(room.createdAt).toLocaleString("zh-CN")}</td><td className="p-3"><button className="btn btn-secondary px-3" onClick={() => openDetail(room.id)}><Eye size={15} /> 详情</button></td></tr>)}</tbody></table>
      {loading && <div className="p-8 text-center text-muted">加载中…</div>}{!loading && rooms.length === 0 && <div className="p-10 text-center text-muted"><Radio className="mx-auto mb-2" />暂无房间</div>}
    </div>
    {detail && <Modal onClose={() => setDetail(null)} full><div className="space-y-5"><div className="flex items-start justify-between"><div><h2 className="text-xl font-black text-ink">{detail.room.name}</h2><p className="text-sm text-muted">#{detail.room.code} · {statusText[detail.room.status]} · {detail.room.hostOnline ? "主持人在线" : "主持人离线"}</p></div><button className="btn btn-secondary" onClick={() => setDetail(null)}>关闭</button></div><section className="card p-4"><h3 className="font-black text-ink">当前海龟汤</h3><p className="mt-2 font-bold">{detail.room.soup?.title ?? "尚未选择海龟汤"}</p>{detail.room.soup && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6">{detail.room.soup.surface.replace(/<[^>]*>/g, "")}</div>}<p className="mt-2 text-xs text-muted">汤底状态：{detail.room.status === "ended" ? "已发布" : "未发布"}</p></section><section><h3 className="mb-2 font-black text-ink">成员（{detail.members.length}）</h3><div className="grid gap-2 sm:grid-cols-2">{detail.members.map((member) => <div key={member.id} className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-ink">{member.nickname}</span><span className="ml-2 text-xs text-muted">{member.role === "host" ? "主持人" : member.role === "player" ? "玩家" : "旁观者"}</span></div>)}</div></section></div></Modal>}
  </div>;
}
