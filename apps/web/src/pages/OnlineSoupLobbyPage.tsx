import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorOpen, LockKeyhole, MessageCircleQuestion, RefreshCw, Search, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { Modal } from "../components/Modal";
import { useApp } from "../context/AppContext";
import { connectOnlineSoupLobbySocket } from "../shared/onlineSoupSocket";
import type { OnlineSoupLobbyRoom } from "../shared/types";

const statusText = { preparing: "准备中", playing: "推理中", ended: "本轮已结束", closed: "已关闭" } as const;

export default function OnlineSoupLobbyPage() {
  const { user, openAuth, showToast } = useApp();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<OnlineSoupLobbyRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [passwordRoom, setPasswordRoom] = useState<OnlineSoupLobbyRoom | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [password, setPassword] = useState("");
  const [joinRole, setJoinRole] = useState<"player" | "spectator">("player");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", type: "public" as "public" | "password", password: "" });

  const loadRooms = useCallback(async () => {
    try {
      const data = await api<{ rooms: OnlineSoupLobbyRoom[] }>("/api/online-soup/rooms", { bypassCache: true });
      setRooms(data.rooms);
    } catch (error) { showToast(error instanceof Error ? error.message : "房间列表加载失败"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => connectOnlineSoupLobbySocket(
    () => void loadRooms(),
    setSocketConnected
  ), [loadRooms]);

  useEffect(() => {
    if (socketConnected) return;
    const timer = window.setInterval(() => void loadRooms(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadRooms, socketConnected]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadRooms();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [loadRooms]);

  function openCreate() {
    if (!user) { openAuth(); return; }
    setCreateOpen(true);
  }

  async function createRoom() {
    if (!form.name.trim()) return showToast("请填写房间名称");
    if (form.type === "password" && form.password.length !== 4) return showToast("房间密码必须为 4 位");
    setCreating(true);
    try {
      const data = await api<{ roomId: string }>("/api/online-soup/rooms", { method: "POST", body: form });
      navigate(`/online-soup/rooms/${data.roomId}`);
    } catch (error) { showToast(error instanceof Error ? error.message : "创建房间失败"); }
    finally { setCreating(false); }
  }

  function requestJoin(room: OnlineSoupLobbyRoom) {
    if (!user) { openAuth(); return; }
    setPasswordRoom(room);
    setPassword("");
    setJoinRole(room.playerCount >= 8 ? "spectator" : "player");
  }

  async function joinRoom(room = passwordRoom) {
    if (!room) return;
    if (room.hasPassword && password.length !== 4) return showToast("请输入 4 位房间密码");
    try {
      await api(`/api/online-soup/rooms/${room.id}/join`, { method: "POST", body: { password, role: joinRole } });
      navigate(`/online-soup/rooms/${room.id}`);
    } catch (error) { showToast(error instanceof Error ? error.message : "加入房间失败"); }
  }

  async function lookupRoom() {
    const code = roomCode.trim();
    if (!/^\d{6}$/.test(code)) return showToast("请输入 6 位房间号");
    try {
      const data = await api<{ room: OnlineSoupLobbyRoom }>(`/api/online-soup/rooms/lookup/${code}`, { bypassCache: true });
      setJoinOpen(false); requestJoin(data.room);
    } catch (error) { showToast(error instanceof Error ? error.message : "未找到房间"); }
  }

  return (
    <section className="space-y-4">
      <PageTopBar title="在线玩汤" />
      <section className="relative isolate overflow-hidden rounded-[20px] border border-blue-300/20 bg-[#0b2147] px-5 py-4 text-white shadow-[0_12px_32px_rgba(15,45,100,0.22)] sm:px-6 sm:py-5">
        <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-blue-500/25 blur-3xl" />
        <div className="pointer-events-none absolute right-5 top-1/2 grid h-16 w-16 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-blue-200/20">
          <MessageCircleQuestion size={36} strokeWidth={1.25} />
        </div>

        <div className="relative pr-16">
          <p className="text-[11px] font-black tracking-[0.12em] text-blue-300">在线玩汤</p>
          <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">多人实时推理</h1>
          <p className="mt-1.5 text-sm font-medium leading-6 text-blue-100/70">
            创建或加入房间，参与讨论和提问。
          </p>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-ink">在线房间</h2>
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-muted transition hover:bg-slate-50 hover:text-primary" onClick={loadRooms} aria-label="刷新房间列表" title="刷新">
          <RefreshCw size={14} />
        </button>
      </div>

      {loading ? <div className="card h-32 animate-pulse bg-slate-100" /> : rooms.length === 0 ? (
        <div className="card py-12 text-center"><DoorOpen className="mx-auto text-slate-300" size={36} /><p className="mt-3 font-bold text-muted">暂时没有在线房间</p></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rooms.map((room) => (
            <article key={room.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate font-black text-ink">{room.name}</h3><p className="mt-1 text-xs text-muted">#{room.code} · 主持人 {room.host.nickname}</p></div>
                <div className="flex shrink-0 items-center gap-1.5">{room.hasPassword && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"><LockKeyhole size={12} /> 密码房</span>}<span className={`rounded-full px-2 py-1 text-xs font-bold ${room.status === "playing" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-primary"}`}>{statusText[room.status]}</span></div>
              </div>
              <p className="mt-3 truncate text-sm text-ink">当前汤：{room.soupTitle ?? "尚未选择"}</p>
              <div className="mt-4 flex items-center justify-between"><span className="inline-flex items-center gap-1 text-sm text-muted"><Users size={15} /> {room.playerCount}/8</span><button className="btn btn-primary px-4" onClick={() => requestJoin(room)}>加入</button></div>
            </article>
          ))}
        </div>
      )}

      {createOpen && <Modal onClose={() => setCreateOpen(false)}>
        <div className="space-y-4">
          <div><h2 className="text-xl font-black text-ink">创建玩汤房间</h2><p className="mt-1 text-sm text-muted">你将成为本房间主持人</p></div>
          <label className="block text-sm font-bold text-ink">房间名称<input className="field mt-1 w-full" maxLength={50} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：周五夜猫局" /></label>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn ${form.type === "public" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, type: "public", password: "" })}>公开房</button>
            <button className={`btn ${form.type === "password" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, type: "password" })}><LockKeyhole size={16} /> 密码房</button>
          </div>
          {form.type === "password" && <input className="field w-full" type="password" maxLength={4} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="设置 4 位房间密码" />}
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>取消</button><button className="btn btn-primary" disabled={creating} onClick={createRoom}>{creating ? "创建中…" : "创建并进入"}</button></div>
        </div>
      </Modal>}

      {joinOpen && <Modal onClose={() => setJoinOpen(false)}><div className="space-y-4"><h2 className="text-xl font-black text-ink">通过房间号加入</h2><div className="flex gap-2"><input className="field flex-1 text-center text-lg tracking-[.3em]" inputMode="numeric" maxLength={6} value={roomCode} onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ""))} placeholder="6 位房间号" /><button className="btn btn-primary" onClick={lookupRoom}><Search size={17} /> 查找</button></div></div></Modal>}

      {passwordRoom && <Modal onClose={() => setPasswordRoom(null)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">加入「{passwordRoom.name}」</h2><p className="mt-1 text-sm text-muted">#{passwordRoom.code} · 当前 {passwordRoom.playerCount}/8 名玩家</p></div>{passwordRoom.hasPassword && <input className="field w-full" type="password" maxLength={4} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入 4 位房间密码" />}<div className="grid grid-cols-2 gap-2"><button className={`btn ${joinRole === "player" ? "btn-primary" : "btn-secondary"}`} disabled={passwordRoom.playerCount >= 8} onClick={() => setJoinRole("player")}>作为玩家</button><button className={`btn ${joinRole === "spectator" ? "btn-primary" : "btn-secondary"}`} onClick={() => setJoinRole("spectator")}>作为旁观者</button></div><button className="btn btn-primary w-full" onClick={() => joinRoom()}>进入房间</button></div></Modal>}

      <div className="fixed right-5 bottom-[calc(92px+env(safe-area-inset-bottom))] z-30 flex flex-col gap-3">
        <button
          className="grid h-14 w-14 place-items-center rounded-full bg-primary text-white shadow-[0_10px_28px_rgba(37,99,235,0.35)] transition hover:bg-blue-600 active:scale-95"
          onClick={openCreate}
          aria-label="创建房间"
          title="创建房间"
        >
          <span className="text-center text-xs font-black leading-4">创建<br />房间</span>
        </button>
        <button
          className="grid h-14 w-14 place-items-center rounded-full border border-blue-200 bg-white text-primary shadow-[0_10px_28px_rgba(15,23,42,0.18)] transition hover:bg-blue-50 active:scale-95"
          onClick={() => setJoinOpen(true)}
          aria-label="房间号加入"
          title="房间号加入"
        >
          <span className="text-center text-xs font-black leading-4">加入<br />房间</span>
        </button>
      </div>
    </section>
  );
}
