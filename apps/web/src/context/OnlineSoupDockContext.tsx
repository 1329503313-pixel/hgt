import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { LogOut, Maximize2, MessageCircle, Minimize2, Send, Wifi, WifiOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { sanitizeHtml } from "../sanitizeHtml";
import { connectOnlineSoupSocket } from "../shared/onlineSoupSocket";
import type { OnlineSoupMessage, OnlineSoupSnapshot } from "../shared/types";
import { useApp } from "./AppContext";

type DockSession = {
  snapshot: OnlineSoupSnapshot;
  unreadCount: number;
  latestActivitySequence: string;
};

type ActiveRoomResponse = { session: DockSession | null };
type DockMode = "collapsed" | "open";

type OnlineSoupDockValue = {
  minimizeRoom: (snapshot: OnlineSoupSnapshot) => void;
  showFullRoom: (roomId: string) => void;
};

const OnlineSoupDockContext = createContext<OnlineSoupDockValue | null>(null);

export function useOnlineSoupDock() {
  const value = useContext(OnlineSoupDockContext);
  if (!value) throw new Error("useOnlineSoupDock must be used within OnlineSoupDockProvider");
  return value;
}

function storageKey(userId: string) {
  return `hgt:online-soup:minimized:${userId}`;
}

export function OnlineSoupDockProvider({ children }: { children: ReactNode }) {
  const { user, showToast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<DockSession | null>(null);
  const [mode, setMode] = useState<DockMode>("collapsed");
  const [connected, setConnected] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [sending, setSending] = useState(false);
  const [content, setContent] = useState("");
  const [messageMode, setMessageMode] = useState<"discussion" | "question">("discussion");
  const minimizedRoomIdRef = useRef<string | null>(null);
  const sessionRef = useRef<DockSession | null>(null);
  const modeRef = useRef<DockMode>("collapsed");
  const refreshRequestStartedRef = useRef(0);
  const refreshRequestAppliedRef = useRef(0);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const clearDock = useCallback(() => {
    if (user) localStorage.removeItem(storageKey(user.id));
    minimizedRoomIdRef.current = null;
    setSession(null);
    setMode("collapsed");
    setConfirmLeave(false);
  }, [user]);

  const refreshSession = useCallback(async () => {
    if (!user || !minimizedRoomIdRef.current) return null;
    const requestedRoomId = minimizedRoomIdRef.current;
    const requestId = ++refreshRequestStartedRef.current;
    try {
      const data = await api<ActiveRoomResponse>("/api/online-soup/active-room", { bypassCache: true, dedupe: false });
      if (minimizedRoomIdRef.current !== requestedRoomId) return sessionRef.current;
      if (requestId < refreshRequestAppliedRef.current) return sessionRef.current;
      refreshRequestAppliedRef.current = requestId;
      if (!data.session || data.session.snapshot.room.id !== requestedRoomId) {
        clearDock();
        return null;
      }
      setSession(data.session);
      return data.session;
    } catch {
      // Reconnect and the next reconciliation pass recover transient failures.
      return null;
    }
  }, [clearDock, user]);

  const markRead = useCallback(async (target?: DockSession | null) => {
    const resolved = target ?? sessionRef.current;
    if (!resolved || resolved.latestActivitySequence === "0") return;
    setSession((current) => current ? { ...current, unreadCount: 0 } : current);
    try {
      await api(`/api/online-soup/rooms/${resolved.snapshot.room.id}/read`, {
        method: "PATCH",
        body: { through: resolved.latestActivitySequence }
      });
    } catch {
      void refreshSession();
    }
  }, [refreshSession]);

  const minimizeRoom = useCallback((snapshot: OnlineSoupSnapshot) => {
    if (!user) return;
    minimizedRoomIdRef.current = snapshot.room.id;
    localStorage.setItem(storageKey(user.id), snapshot.room.id);
    setSession({ snapshot, unreadCount: 0, latestActivitySequence: "0" });
    setMode("collapsed");
    void api<ActiveRoomResponse>("/api/online-soup/active-room", { bypassCache: true, dedupe: false }).then((data) => {
      if (!data.session || data.session.snapshot.room.id !== snapshot.room.id) return;
      setSession({ ...data.session, unreadCount: 0 });
      if (data.session.latestActivitySequence !== "0") {
        void api(`/api/online-soup/rooms/${snapshot.room.id}/read`, { method: "PATCH", body: { through: data.session.latestActivitySequence } });
      }
    }).catch(() => undefined);
  }, [user]);

  const showFullRoom = useCallback((roomId: string) => {
    if (minimizedRoomIdRef.current !== roomId) return;
    if (user) localStorage.removeItem(storageKey(user.id));
    minimizedRoomIdRef.current = null;
    setSession(null);
  }, [user]);

  useEffect(() => {
    if (!user) {
      clearDock();
      return;
    }
    const saved = localStorage.getItem(storageKey(user.id));
    if (!saved) return;
    minimizedRoomIdRef.current = saved;
    void refreshSession();
  }, [clearDock, refreshSession, user]);

  useEffect(() => {
    const roomId = session?.snapshot.room.id;
    if (!roomId || minimizedRoomIdRef.current !== roomId) return;
    return connectOnlineSoupSocket(roomId, (reason) => {
      if (reason === "room_closed" || reason === "member_left") {
        void refreshSession();
        return;
      }
      void refreshSession().then((latest) => {
        if (modeRef.current === "open" && document.visibilityState === "visible") void markRead(latest);
      });
    }, (nextConnected) => {
      setConnected(nextConnected);
      if (nextConnected) void refreshSession();
    });
  }, [markRead, refreshSession, session?.snapshot.room.id]);

  useEffect(() => {
    if (!session) return;
    const reconcile = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    const timer = window.setInterval(reconcile, 15_000);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [refreshSession, session]);

  async function sendMessage() {
    if (!session || !content.trim() || sending) return;
    setSending(true);
    try {
      await api(`/api/online-soup/rooms/${session.snapshot.room.id}/messages`, {
        method: "POST",
        body: { type: messageMode, content: content.trim() }
      });
      setContent("");
      await refreshSession();
      await markRead();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function leaveRoom() {
    if (!session) return;
    try {
      await api(`/api/online-soup/rooms/${session.snapshot.room.id}/leave`, { method: "POST" });
      clearDock();
      showToast(session.snapshot.me.isHost ? "房间已解散" : "已退出房间");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "退出房间失败");
    }
  }

  const contextValue = useMemo<OnlineSoupDockValue>(() => ({ minimizeRoom, showFullRoom }), [minimizeRoom, showFullRoom]);
  const inFullRoom = session ? location.pathname === `/online-soup/rooms/${session.snapshot.room.id}` : false;

  return <OnlineSoupDockContext.Provider value={contextValue}>
    {children}
    {session && !inFullRoom && <div className="online-soup-dock hidden lg:block">
      {mode === "collapsed" ? <button
        type="button"
        className="online-soup-dock-button"
        onClick={() => { setMode("open"); void markRead(); }}
        aria-label={`展开房间聊天${session.unreadCount ? `，${session.unreadCount} 条新动态` : ""}`}
        title={session.snapshot.room.name}
      >
        <MessageCircle size={34} fill="currentColor" />
        {session.unreadCount > 0 && <span>{session.unreadCount > 99 ? "99+" : session.unreadCount}</span>}
      </button> : <section className="online-soup-mini-chat" aria-label={`${session.snapshot.room.name}迷你聊天窗口`}>
        <header>
          <span className="min-w-0 flex-1"><strong>{session.snapshot.room.name}</strong><small>房间号 {session.snapshot.room.code} · {connected ? "实时连接" : "重新连接中"}</small></span>
          <span title={connected ? "实时连接正常" : "正在重新连接"}>{connected ? <Wifi size={17} className="text-emerald-500" /> : <WifiOff size={17} className="text-red-500" />}</span>
          <button type="button" onClick={() => { setMode("collapsed"); }} aria-label="收起聊天窗" title="收起"><Minimize2 size={17} /></button>
          <button type="button" onClick={() => { showFullRoom(session.snapshot.room.id); navigate(`/online-soup/rooms/${session.snapshot.room.id}`); }} aria-label="返回完整房间" title="放大"><Maximize2 size={17} /></button>
          <button type="button" className="text-red-500" onClick={() => setConfirmLeave(true)} aria-label="退出房间" title="退出房间"><LogOut size={17} /></button>
        </header>
        <MiniMessageList messages={session.snapshot.messages} currentUserId={user?.id ?? ""} />
        {session.snapshot.me.role !== "spectator" && <div className="online-soup-mini-composer">
          {session.snapshot.me.role === "player" && <button
            type="button"
            className={messageMode === "question" ? "is-question" : ""}
            disabled={session.snapshot.room.status !== "playing"}
            onClick={() => setMessageMode((current) => current === "discussion" ? "question" : "discussion")}
          >{messageMode === "question" ? "提问" : "讨论"}</button>}
          <textarea rows={1} maxLength={1000} value={content} onChange={(event) => setContent(event.target.value)} placeholder={messageMode === "question" ? "输入正式问题…" : "参与讨论…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
          <button type="button" className="is-send" disabled={sending || !content.trim()} onClick={() => void sendMessage()} aria-label="发送"><Send size={17} /></button>
        </div>}
      </section>}
    </div>}
    {confirmLeave && session && <Modal onClose={() => setConfirmLeave(false)}>
      <div className="space-y-4 text-center">
        <div><h2 className="text-xl font-black text-ink">{session.snapshot.me.isHost ? "确认退出并解散房间？" : "确认退出房间？"}</h2><p className="mt-2 text-sm leading-6 text-muted">{session.snapshot.me.isHost ? "主持人退出后房间会立即解散，所有成员都将离开。" : "退出后将释放当前席位，重新进入时可能需要再次验证。"}</p></div>
        <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>取消</button><button className="btn bg-red-500 text-white hover:bg-red-600" onClick={() => void leaveRoom()}>确认退出</button></div>
      </div>
    </Modal>}
  </OnlineSoupDockContext.Provider>;
}

function MiniMessageList({ messages, currentUserId }: { messages: OnlineSoupMessage[]; currentUserId: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages]);
  return <div className="online-soup-mini-messages">
    {messages.slice(-60).map((message) => <MiniMessage key={`${message.id}-${message.updatedAt}`} message={message} currentUserId={currentUserId} />)}
    <div ref={bottomRef} />
  </div>;
}

function MiniMessage({ message, currentUserId }: { message: OnlineSoupMessage; currentUserId: string }) {
  if (message.type === "system") return <p className="online-soup-mini-system">— {message.content} —</p>;
  if (message.type === "clue") return <article className="online-soup-mini-event is-clue"><strong>主持人线索</strong><p>{message.content}</p></article>;
  if (message.type === "supplemental_surface" || message.type === "bottom" || message.type === "manual") {
    const title = message.type === "supplemental_surface" ? "补充汤面" : message.type === "bottom" ? "汤底已公布" : "主持人手册";
    return <article className="online-soup-mini-event is-progress"><strong>{title}</strong><div dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} /></article>;
  }
  const question = message.type === "question";
  const host = message.type === "host" || message.senderIsHost;
  const mine = message.senderId === currentUserId;
  return <article className={`online-soup-mini-message ${mine ? "is-mine" : ""} ${question ? "is-question" : ""} ${host ? "is-host" : ""}`}>
    <span className="online-soup-mini-avatar">
      {message.senderAvatar
        ? <img src={message.senderAvatar} alt="" />
        : <span>{message.senderName?.slice(0, 1) ?? "?"}</span>}
      {host && <span className="is-host-mark">主</span>}
    </span>
    <div className="online-soup-mini-message-body">
      <div className="online-soup-mini-message-meta">
        <strong>{message.senderName ?? "未知用户"}</strong>
        {host && <span className="is-host-label">主持人</span>}
        {question && <span>正式提问 #{message.questionNumber}</span>}
      </div>
      <div className="online-soup-mini-bubble"><p>{message.type === "sticker" ? "[表情包]" : message.content}</p></div>
      {question && <small>{message.answer ? `主持人回答：${message.answer === "yes" ? "是" : message.answer === "no" ? "不是" : message.answer === "both" ? "是也不是" : message.answer === "unknown" ? "不知道" : "不重要"}` : "等待主持人回复"}</small>}
      <time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
  </article>;
}
