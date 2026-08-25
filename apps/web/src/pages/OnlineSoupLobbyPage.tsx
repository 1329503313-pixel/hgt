import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Bot, Crown, DoorOpen, LockKeyhole, MessageCircleQuestion, Plus, RefreshCw, Search, Soup, Users, VenetianMask } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { Modal } from "../components/Modal";
import { useApp } from "../context/AppContext";
import { connectOnlineSoupLobbySocket } from "../shared/onlineSoupSocket";
import { isClosedOnlineSoupInvite, isTerminalOnlineSoupJoinError } from "../shared/onlineSoupInviteRecovery";
import { getRandomOnlineSoupRoomName } from "../shared/onlineSoupRoomNames";
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
type MysteryEntry = { id: string; title: string; coverUrl: string | null; tags: string[] };

export default function OnlineSoupLobbyPage() {
  const { user, openAuth, showToast } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [entryMystery, setEntryMystery] = useState<MysteryEntry | null>(null);
  const [mysteryChoice, setMysteryChoice] = useState<"continue" | "restart">("restart");
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [pendingInvitePassword, setPendingInvitePassword] = useState("");
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [inviteEntryError, setInviteEntryError] = useState<string | null>(null);
  const [inviteRestoreError, setInviteRestoreError] = useState<string | null>(null);
  const [inviteRestoreAttempt, setInviteRestoreAttempt] = useState(0);
  const restoringInvite = useRef(false);
  const [form, setForm] = useState({
    contentType: null as "soup" | "mystery" | "impostor" | null,
    name: "",
    type: "public" as "public" | "password",
    password: "",
    hostMode: "human" as "human" | "ai",
  });

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

  useEffect(() => {
    const mysteryId = searchParams.get("mystery")?.trim();
    if (!mysteryId) return;
    if (!user) {
      openAuth();
      return;
    }
    let cancelled = false;
    const choice = searchParams.get("choice") === "continue" ? "continue" : "restart";
    void api<{ mystery: MysteryEntry }>(`/api/mysteries/${encodeURIComponent(mysteryId)}`, { bypassCache: true })
      .then((data) => {
        if (cancelled) return;
        setEntryMystery(data.mystery);
        setMysteryChoice(choice);
        setForm({ contentType: "mystery", name: getRandomOnlineSoupRoomName(), type: "public", password: "", hostMode: "human" });
        setCreateOpen(true);
        const next = new URLSearchParams(searchParams);
        next.delete("mystery");
        next.delete("choice");
        setSearchParams(next, { replace: true });
      })
      .catch((error) => showToast(error instanceof Error ? error.message : "谜局信息加载失败"));
    return () => { cancelled = true; };
  }, [openAuth, searchParams, setSearchParams, showToast, user]);

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
    if (!user || pendingInvite || restoringInvite.current) return;
    const roomIdFromUrl = searchParams.get("room")?.trim() ?? "";
    const inviteTokenFromUrl = searchParams.get("invite")?.trim() ?? "";
    const raw = sessionStorage.getItem("onlineSoupPendingInvite");
    try {
      let saved: { roomId?: string; inviteToken?: string } | null = null;
      if (raw) {
        try { saved = JSON.parse(raw) as { roomId?: string; inviteToken?: string }; }
        catch { sessionStorage.removeItem("onlineSoupPendingInvite"); }
      }
      const roomId = roomIdFromUrl || saved?.roomId?.trim() || "";
      const inviteToken = inviteTokenFromUrl || saved?.inviteToken?.trim() || "";
      if (!roomId) return;
      restoringInvite.current = true;
      setInviteRestoreError(null);
      void (async () => {
        const { room } = await api<{ room: InvitePreview }>(`/api/online-soup/rooms/${roomId}/invite-preview`, { bypassCache: true, dedupe: false });
        let validInviteToken = inviteToken;
        if (inviteToken) {
          try {
            await api(`/api/online-soup/rooms/${roomId}/invite-status?inviteToken=${encodeURIComponent(inviteToken)}`, { bypassCache: true, dedupe: false });
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 403) throw error;
            validInviteToken = "";
            showToast(room.hasPassword ? "邀请验证已失效，请输入房间密码" : "邀请验证已失效，将按普通方式加入房间");
          }
        }
        setPendingInvite({ roomId, inviteToken: validInviteToken, room });
      })().catch((error) => {
        if (isClosedOnlineSoupInvite(error)) {
          sessionStorage.removeItem("onlineSoupPendingInvite");
          const next = new URLSearchParams(searchParams);
          next.delete("room");
          next.delete("invite");
          setSearchParams(next, { replace: true });
          setInviteEntryError(error.message);
          return;
        }
        setInviteRestoreError(error instanceof Error ? error.message : "邀请信息加载失败，请重试");
      }).finally(() => { restoringInvite.current = false; });
    } catch {
      sessionStorage.removeItem("onlineSoupPendingInvite");
    }
  }, [inviteRestoreAttempt, pendingInvite, searchParams, setSearchParams, showToast, user]);

  function cancelPendingInvite() {
    sessionStorage.removeItem("onlineSoupPendingInvite");
    const next = new URLSearchParams(searchParams);
    next.delete("room");
    next.delete("invite");
    setSearchParams(next, { replace: true });
    setPendingInvite(null);
    setPendingInvitePassword("");
    setInviteRestoreError(null);
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
      if (error instanceof ApiError && isTerminalOnlineSoupJoinError(error)) {
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
    setEntryMystery(null);
    setMysteryChoice("restart");
    setForm({ contentType: null, name: getRandomOnlineSoupRoomName(), type: "public", password: "", hostMode: "human" });
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setEntryMystery(null);
  }

  async function createRoom() {
    if (!form.contentType) return showToast("请选择房间类型");
    if (!form.name.trim()) return showToast("请填写房间名称");
    if (form.type === "password" && form.password.length !== 4) return showToast("房间密码必须为 4 位");
    setCreating(true);
    try {
      const data = await api<{ roomId: string }>("/api/online-soup/rooms", {
        method: "POST",
        body: entryMystery ? { ...form, contentType: "mystery", hostMode: "human", mysteryId: entryMystery.id, mysteryChoice } : form,
      });
      navigate(`/online-soup/rooms/${data.roomId}`);
    } catch (error) { showToast(error instanceof Error ? error.message : "创建房间失败"); }
    finally { setCreating(false); }
  }

  function requestJoin(room: OnlineSoupLobbyRoom) {
    if (!user) { openAuth(); return; }
    if (room.viewerRole) {
      navigate(`/online-soup/rooms/${room.id}`);
      return;
    }
    setPasswordRoom(room);
    setPassword("");
    setJoinRole(room.playerCount >= room.playerCapacity || (room.contentType === "impostor" && room.status === "playing") ? "spectator" : "player");
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
      <PageTopBar title="游戏大厅" />
      <section className="online-soup-mobile-intro relative isolate overflow-hidden rounded-[20px] border border-blue-300/20 bg-[#0b2147] px-5 py-4 text-white shadow-[0_12px_32px_rgba(15,45,100,0.22)] sm:px-6 sm:py-5">
        <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-blue-500/25 blur-3xl" />
        <div className="pointer-events-none absolute right-5 top-1/2 grid h-16 w-16 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-blue-200/20">
          <MessageCircleQuestion size={36} strokeWidth={1.25} />
        </div>

        <div className="relative pr-16">
          <p className="text-[11px] font-black tracking-[0.12em] text-blue-300">游戏大厅</p>
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
                <div className="min-w-0"><h3 className="truncate text-base font-black text-ink">{room.name}</h3><p className="mt-1 text-xs font-semibold text-muted">房间号 {room.code} · 房主 {room.host.nickname}</p></div>
                <div className="flex shrink-0 items-center gap-1.5">{room.hasPassword && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"><LockKeyhole size={12} /> 密码房</span>}<span className={`rounded-full px-2 py-1 text-xs font-bold ${room.status === "playing" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-primary"}`}>{statusText[room.status]}</span></div>
              </div>
              <div className="online-soup-room-current"><span className="flex items-center gap-1">{room.contentType === "impostor" ? <VenetianMask size={13} /> : room.contentType === "mystery" ? <MessageCircleQuestion size={13} /> : room.hostMode === "ai" ? <Bot size={13} /> : <Crown size={13} />}{room.contentType === "impostor" ? "阵营推理" : room.contentType === "mystery" ? "谜局" : room.hostMode === "ai" ? "AI 主持" : "真人主持"}</span><strong title={room.contentType === "impostor" ? "谁是伪人" : room.mysteryTitle ?? room.soupTitle ?? "尚未选择内容"}>{room.contentType === "impostor" ? "谁是伪人" : room.mysteryTitle ?? room.soupTitle ?? "尚未选择内容"}</strong></div>
              <div className="mt-4 flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted"><Users size={16} /> {room.participantCount}/{room.participantCapacity} 人</span><button className="online-soup-join-button" onClick={() => requestJoin(room)}>{room.viewerRole ? "返回房间" : "加入房间"}</button></div>
            </article>
          ))}
        </div>
      )}

      {createOpen && <Modal onClose={closeCreate}>
        <div className="space-y-4">
          <div><h2 className="text-xl font-black text-ink">{entryMystery ? "创建谜局房间" : "创建游戏房间"}</h2><p className="mt-1 text-sm text-muted">{entryMystery ? "你将成为房主；进程、正式行动和存档都绑定当前账号" : "请先选择房间类型，再补充房间信息"}</p></div>
          {entryMystery && <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-3"><span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white text-primary">{entryMystery.coverUrl ? <img src={entryMystery.coverUrl} alt="" className="h-full w-full object-cover" /> : <BookOpen size={20} />}</span><div className="min-w-0"><p className="text-xs font-bold text-primary">已选择谜局</p><p className="truncate text-sm font-black text-ink">{entryMystery.title}</p></div></div>}
          {!entryMystery && <fieldset><legend className="mb-2 text-sm font-bold text-ink">房间类型</legend><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><button type="button" aria-pressed={form.contentType === "soup"} className={`btn segmented-choice ${form.contentType === "soup" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, contentType: "soup" })}><Soup size={16} />海龟汤</button><button type="button" aria-pressed={form.contentType === "mystery"} className={`btn segmented-choice ${form.contentType === "mystery" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, contentType: "mystery", hostMode: "human" })}><BookOpen size={16} />谜局</button><button type="button" aria-pressed={form.contentType === "impostor"} className={`btn segmented-choice ${form.contentType === "impostor" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, contentType: "impostor", hostMode: "human" })}><VenetianMask size={16} />谁是伪人</button></div></fieldset>}
          {form.contentType && <>
            <label className="block text-sm font-bold text-ink">房间名称<input className="field mt-1 w-full" maxLength={50} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：周五夜猫局" /></label>
            {form.contentType === "soup" && <fieldset><legend className="mb-2 text-sm font-bold text-ink">主持方式</legend><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={form.hostMode === "human"} className={`btn segmented-choice ${form.hostMode === "human" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, hostMode: "human" })}><Crown size={16} />真人主持</button><button type="button" aria-pressed={form.hostMode === "ai"} className={`btn segmented-choice ${form.hostMode === "ai" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, hostMode: "ai" })}><Bot size={16} />AI 主持</button></div><p className="mt-2 text-xs leading-5 text-muted">AI 主持房只能选择已开放 AI 主持的作品。</p></fieldset>}
            {form.contentType === "impostor" && <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold leading-5 text-violet-800"><span className="font-black">4–6 人阵营推理</span> · 系统自动发放侦探、平民与伪人身份；开局后新成员只能旁观。</div>}
            <fieldset><legend className="mb-2 text-sm font-bold text-ink">房间权限</legend><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={form.type === "public"} className={`btn segmented-choice ${form.type === "public" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, type: "public", password: "" })}><DoorOpen size={16} />公开房</button><button type="button" aria-pressed={form.type === "password"} className={`btn segmented-choice ${form.type === "password" ? "btn-primary" : "btn-secondary"}`} onClick={() => setForm({ ...form, type: "password" })}><LockKeyhole size={16} />密码房</button></div></fieldset>
            {form.type === "password" && <label className="block text-sm font-bold text-ink">4 位房间密码<input className="field mt-1 w-full text-center tracking-[.3em]" type="password" inputMode="numeric" maxLength={4} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value.replace(/\D/g, "") })} placeholder="••••" /></label>}
          </>}
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={closeCreate}>取消</button><button className="btn btn-primary" disabled={creating || !form.contentType} onClick={createRoom}>{creating ? "创建中…" : "创建并进入"}</button></div>
        </div>
      </Modal>}

      {joinOpen && <Modal onClose={() => setJoinOpen(false)}><div className="space-y-4"><h2 className="text-xl font-black text-ink">通过房间号加入</h2><div className="flex gap-2"><input className="field flex-1 text-center text-lg tracking-[.3em]" inputMode="numeric" maxLength={6} value={roomCode} onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ""))} placeholder="6 位房间号" /><button className="btn btn-primary" onClick={lookupRoom}><Search size={17} /> 查找</button></div></div></Modal>}

      {passwordRoom && <Modal onClose={() => setPasswordRoom(null)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">加入「{passwordRoom.name}」</h2><p className="mt-1 text-sm text-muted">#{passwordRoom.code} · 当前{passwordRoom.contentType === "impostor" ? "游戏者" : "主持人和玩家"} {passwordRoom.participantCount}/{passwordRoom.participantCapacity} 人</p></div>{passwordRoom.hasPassword && <input className="field w-full" type="password" maxLength={4} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入 4 位房间密码" />}<div className="grid grid-cols-2 gap-2"><button className={`btn segmented-choice ${joinRole === "player" ? "btn-primary" : "btn-secondary"}`} disabled={passwordRoom.playerCount >= passwordRoom.playerCapacity || (passwordRoom.contentType === "impostor" && passwordRoom.status === "playing")} onClick={() => setJoinRole("player")}>作为玩家</button><button className={`btn segmented-choice ${joinRole === "spectator" ? "btn-primary" : "btn-secondary"}`} onClick={() => setJoinRole("spectator")}>作为旁观者</button></div>{passwordRoom.contentType === "impostor" && passwordRoom.status === "playing" && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">对局已经开始，本次只能以旁观者身份加入。</p>}<button className="btn btn-primary w-full" onClick={() => joinRoom()}>进入房间</button></div></Modal>}

      {pendingInvite && <Modal onClose={cancelPendingInvite}>
        <div className="space-y-5">
          <div className="text-center"><h2 className="text-xl font-black text-ink">您是否进入这个房间？</h2><p className="mt-2 text-sm text-muted">好友邀请你进入游戏房间</p></div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
            <p className="text-xs font-bold text-muted">房间名称</p><p className="mt-1 text-lg font-black text-ink">{pendingInvite.room.name}</p>
            <p className="mt-3 text-xs font-bold text-muted">房间号</p><p className="mt-1 font-mono text-xl font-black tracking-[.18em] text-primary">{pendingInvite.room.code}</p>
          </div>
          {pendingInvite.room.hasPassword && !pendingInvite.inviteToken && <input className="field w-full text-center text-lg tracking-[.3em]" type="password" inputMode="numeric" maxLength={4} value={pendingInvitePassword} onChange={(event) => setPendingInvitePassword(event.target.value.replace(/\D/g, ""))} placeholder="输入 4 位房间密码" />}
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={cancelPendingInvite}>取消</button><button className="btn btn-primary" disabled={joiningInvite} onClick={() => void enterPendingInvite()}>{joiningInvite ? "进入中…" : "进入"}</button></div>
        </div>
      </Modal>}

      {inviteRestoreError && !pendingInvite && <Modal onClose={cancelPendingInvite}>
        <div className="space-y-4 text-center">
          <div><h2 className="text-xl font-black text-ink">邀请信息加载失败</h2><p className="mt-2 text-sm leading-6 text-muted">{inviteRestoreError}</p></div>
          <p className="text-xs leading-5 text-muted">房间邀请仍已保留，可以在网络恢复后重新尝试。</p>
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={cancelPendingInvite}>取消</button><button className="btn btn-primary" onClick={() => setInviteRestoreAttempt((attempt) => attempt + 1)}>重新加载</button></div>
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
