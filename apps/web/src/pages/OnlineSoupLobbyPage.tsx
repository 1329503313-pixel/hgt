import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorOpen, LockKeyhole, MessageCircleQuestion, Plus, RefreshCw, Search, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { Modal } from "../components/Modal";
import { useApp } from "../context/AppContext";
import { connectOnlineSoupLobbySocket } from "../shared/onlineSoupSocket";
import type { OnlineSoupLobbyRoom } from "../shared/types";

const statusText = { preparing: "准备中", playing: "推理中", ended: "本轮已结束", closed: "已关闭" } as const;
type InvitePreview = {
  id: string;
  code: string;
  name: string;
  type: "public" | "password";
  status: "preparing" | "playing" | "ended" | "closed";
  hasPassword: boolean;
};
type PendingInvite = { roomId: string; inviteToken: string; room: InvitePreview };

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
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [pendingInvitePassword, setPendingInvitePassword] = useState("");
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [inviteEntryError, setInviteEntryError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!user || pendingInvite) return;
    const raw = sessionStorage.getItem("onlineSoupPendingInvite");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { roomId?: string; inviteToken?: string };
      if (!saved.roomId) throw new Error("invalid invite");
      void api<{ room: InvitePreview }>(`/api/online-soup/rooms/${saved.roomId}/invite-preview`, { bypassCache: true })
        .then(({ room }) => setPendingInvite({ roomId: saved.roomId!, inviteToken: saved.inviteToken ?? "", room }))
        .catch((error) => {
          sessionStorage.removeItem("onlineSoupPendingInvite");
          showToast(error instanceof Error ? error.message : "邀请房间不存在或已关闭");
        });
    } catch {
      sessionStorage.removeItem("onlineSoupPendingInvite");
    }
  }, [pendingInvite, showToast, user]);

  function cancelPendingInvite() {
    sessionStorage.removeItem("onlineSoupPendingInvite");
    setPendingInvite(null);
    setPendingInvitePassword("");
  }

  async function enterPendingInvite() {
    if (!pendingInvite || joiningInvite) return;
    if (pendingInvite.room.hasPassword && !pendingInvite.inviteToken && pendingInvitePassword.length !== 4) {
      return showToast("请输入 4 位房间密码");
    }
    setJoiningInvite(true);
    try {
      const joined = await api<{ role: "player" | "spectator" }>(`/api/online-soup/rooms/${pendingInvite.roomId}/join-auto`, {
        method: "POST",
        body: { inviteToken: pendingInvite.inviteToken, password: pendingInvitePassword }
      });
      sessionStorage.removeItem("onlineSoupPendingInvite");
      if (joined.role === "spectator") showToast("玩家席位已满，已作为旁观者进入");
      navigate(`/online-soup/rooms/${pendingInvite.roomId}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && (error.code === "ROOM_FULL" || error.code === "ROOM_CLOSED")) {
        setInviteEntryError(error.message);
        cancelPendingInvite();
      } else {
        showToast(error instanceof Error ? error.message : "加入房间失败");
      }
    } finally {
      setJoiningInvite(false);
    }
  }

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
    setJoinRole(room.playerCount >= room.playerCapacity ? "spectator" : "player");
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
    <section className="online-soup-lobby space-y-4">
      <PageTopBar title="在线玩汤" />
      <section className="online-soup-mobile-intro relative isolate overflow-hidden rounded-[20px] border border-blue-300/20 bg-[#0b2147] px-5 py-4 text-white shadow-[0_12px_32px_rgba(15,45,100,0.22)] sm:px-6 sm:py-5">
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

      <div className="online-soup-lobby-toolbar">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-black text-ink lg:text-2xl">在线房间</h1>
            {!loading && <span className="online-soup-room-count">{rooms.length} 间</span>}
          </div>
          <p className="online-soup-connection-state">
            <span className={socketConnected ? "is-online" : ""} aria-hidden="true" />
            {socketConnected ? "大厅动态实时更新" : "实时连接恢复中，列表仍会自动刷新"}
          </p>
        </div>
        <div className="online-soup-lobby-actions">
          <button className="online-soup-refresh-button" onClick={loadRooms} aria-label="刷新房间列表" title="刷新房间列表">
            <RefreshCw size={16} />
          </button>
          <button className="online-soup-code-button" onClick={() => setJoinOpen(true)}>
            <Search size={17} />
            <span>房间号加入</span>
          </button>
          <button className="online-soup-create-button" onClick={openCreate}>
            <Plus size={18} strokeWidth={2.6} />
            <span>创建房间</span>
          </button>
        </div>
      </div>

      {loading ? <div className="online-soup-room-grid" aria-label="房间列表加载中">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="online-soup-room-card h-[174px] animate-pulse bg-slate-100" />)}
      </div> : rooms.length === 0 ? (
        <div className="online-soup-empty-state card py-12 text-center">
          <DoorOpen className="mx-auto text-slate-300" size={40} />
          <h2 className="mt-4 text-lg font-black text-ink">暂时没有在线房间</h2>
          <p className="mt-1 text-sm text-muted">创建一个房间，邀请朋友开始今天的推理。</p>
          <button className="online-soup-create-button mx-auto mt-5" onClick={openCreate}><Plus size={18} />创建第一个房间</button>
        </div>
      ) : (
        <div className="online-soup-room-grid">
          {rooms.map((room) => (
            <article key={room.id} className="online-soup-room-card card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate text-base font-black text-ink">{room.name}</h3><p className="mt-1 text-xs font-semibold text-muted">房间号 {room.code} · 主持人 {room.host.nickname}</p></div>
                <div className="flex shrink-0 items-center gap-1.5">{room.hasPassword && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"><LockKeyhole size={12} /> 密码房</span>}<span className={`rounded-full px-2 py-1 text-xs font-bold ${room.status === "playing" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-primary"}`}>{statusText[room.status]}</span></div>
              </div>
              <div className="online-soup-room-current"><span>当前海龟汤</span><strong title={room.soupTitle ?? "尚未选择海龟汤"}>{room.soupTitle ?? "尚未选择海龟汤"}</strong></div>
              <div className="mt-4 flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted"><Users size={16} /> {room.participantCount}/{room.participantCapacity} 人</span><button className="online-soup-join-button" onClick={() => requestJoin(room)}>加入房间</button></div>
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

      {passwordRoom && <Modal onClose={() => setPasswordRoom(null)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">加入「{passwordRoom.name}」</h2><p className="mt-1 text-sm text-muted">#{passwordRoom.code} · 当前主持人和玩家 {passwordRoom.participantCount}/{passwordRoom.participantCapacity} 人</p></div>{passwordRoom.hasPassword && <input className="field w-full" type="password" maxLength={4} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入 4 位房间密码" />}<div className="grid grid-cols-2 gap-2"><button className={`btn ${joinRole === "player" ? "btn-primary" : "btn-secondary"}`} disabled={passwordRoom.playerCount >= passwordRoom.playerCapacity} onClick={() => setJoinRole("player")}>作为玩家</button><button className={`btn ${joinRole === "spectator" ? "btn-primary" : "btn-secondary"}`} onClick={() => setJoinRole("spectator")}>作为旁观者</button></div><button className="btn btn-primary w-full" onClick={() => joinRoom()}>进入房间</button></div></Modal>}

      {pendingInvite && <Modal onClose={cancelPendingInvite}>
        <div className="space-y-5">
          <div className="text-center"><h2 className="text-xl font-black text-ink">您是否进入这个房间？</h2><p className="mt-2 text-sm text-muted">好友邀请你一起在线玩汤</p></div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
            <p className="text-xs font-bold text-muted">房间名称</p><p className="mt-1 text-lg font-black text-ink">{pendingInvite.room.name}</p>
            <p className="mt-3 text-xs font-bold text-muted">房间号</p><p className="mt-1 font-mono text-xl font-black tracking-[.18em] text-primary">{pendingInvite.room.code}</p>
          </div>
          {pendingInvite.room.hasPassword && !pendingInvite.inviteToken && <input className="field w-full text-center text-lg tracking-[.3em]" type="password" inputMode="numeric" maxLength={4} value={pendingInvitePassword} onChange={(event) => setPendingInvitePassword(event.target.value.replace(/\D/g, ""))} placeholder="输入 4 位房间密码" />}
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={cancelPendingInvite}>取消</button><button className="btn btn-primary" disabled={joiningInvite} onClick={() => void enterPendingInvite()}>{joiningInvite ? "进入中…" : "进入"}</button></div>
        </div>
      </Modal>}

      {inviteEntryError && <Modal onClose={() => setInviteEntryError(null)}>
        <div className="space-y-4 text-center"><h2 className="text-xl font-black text-ink">{inviteEntryError}</h2><p className="text-sm text-muted">暂时无法进入该房间</p><button className="btn btn-primary w-full" onClick={() => setInviteEntryError(null)}>确认</button></div>
      </Modal>}

      <div className="online-soup-mobile-actions fixed right-5 bottom-[calc(92px+env(safe-area-inset-bottom))] z-30 flex flex-col gap-3">
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
