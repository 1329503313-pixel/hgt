import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Ban, LogOut, Maximize2, MessageCircle, Minimize2, Send, Sparkles, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { canRecallMessage, MessageActionMenu, RecalledMessageNotice } from "../components/MessageActionMenu";
import { sanitizeHtml } from "../sanitizeHtml";
import { connectOnlineSoupSocket } from "../shared/onlineSoupSocket";
import type { OnlineSoupBackgroundMusic, OnlineSoupMessage, OnlineSoupSnapshot } from "../shared/types";
import { GiftMessageBundle, GiftMessageCard } from "../components/GiftMessageCard";
import { isOnlineSoupAlreadyExited } from "../shared/onlineSoupExit";
import { useApp } from "./AppContext";
import { giftTimelineEntries } from "../shared/giftTimeline";
import { onlineSoupAnswerPrefix } from "../shared/onlineSoupAnswerLabel";
import { OnlineSoupHonorCard } from "../components/OnlineSoupHonorCard";
import { copyTextToClipboard } from "../shared/clipboard";
import { VipIdentity } from "../components/VipIdentity";
import { MutedAvatarIndicator } from "../components/MutedAvatarIndicator";
import { useOnlineSoupBackgroundMusic } from "../shared/useOnlineSoupBackgroundMusic";

type DockSession = {
  snapshot: OnlineSoupSnapshot;
  unreadCount: number;
  latestActivitySequence: string;
};

type ActiveRoomResponse = { session: DockSession | null };
type DockMode = "collapsed" | "open";

const impostorPhaseLabels: Record<NonNullable<OnlineSoupSnapshot["room"]["impostorGame"]>["phase"], string> = {
  night: "夜间行动",
  clue: "留下线索",
  day_ready: "白天准备",
  day_vote: "任务人选投票",
  mission: "执行任务",
  assassination: "伪人刺杀",
  accusation: "最终指认",
  ended: "本局结束",
};

type OnlineSoupDockValue = {
  minimizeRoom: (snapshot: OnlineSoupSnapshot) => void;
  showFullRoom: (roomId: string) => void;
  syncRoomBackgroundMusic: (roomId: string, track: OnlineSoupBackgroundMusic | null) => void;
  backgroundMusicMuted: boolean;
  backgroundMusicAutoplayBlocked: boolean;
  toggleBackgroundMusicMuted: () => void;
};

const OnlineSoupDockContext = createContext<OnlineSoupDockValue | null>(null);

function isActiveMute(mutedUntil: string | null | undefined) {
  return Boolean(mutedUntil && new Date(mutedUntil).getTime() > Date.now());
}

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
  const [fullRoomBackgroundMusic, setFullRoomBackgroundMusic] = useState<{ roomId: string; track: OnlineSoupBackgroundMusic | null } | null>(null);
  const minimizedRoomIdRef = useRef<string | null>(null);
  const sessionRef = useRef<DockSession | null>(null);
  const modeRef = useRef<DockMode>("collapsed");
  const refreshRequestStartedRef = useRef(0);
  const refreshRequestAppliedRef = useRef(0);
  const activeBackgroundMusic = session ? session.snapshot.room.backgroundMusic : fullRoomBackgroundMusic?.track ?? null;
  const backgroundMusicPlayback = useOnlineSoupBackgroundMusic(activeBackgroundMusic);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    if (session?.snapshot.room.contentType === "impostor") setMessageMode("discussion");
  }, [session?.snapshot.room.contentType]);
  useEffect(() => {
    if (session?.snapshot.room.remainingQuestionCount === 0) setMessageMode("discussion");
  }, [session?.snapshot.room.remainingQuestionCount]);

  const clearDock = useCallback(() => {
    if (user) localStorage.removeItem(storageKey(user.id));
    minimizedRoomIdRef.current = null;
    setSession(null);
    setFullRoomBackgroundMusic(null);
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

  const syncRoomBackgroundMusic = useCallback((roomId: string, track: OnlineSoupBackgroundMusic | null) => {
    setFullRoomBackgroundMusic({ roomId, track });
  }, []);

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
        body: { type: session.snapshot.room.contentType === "impostor" ? "discussion" : messageMode, content: content.trim() }
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

  async function recallMessage(message: OnlineSoupMessage) {
    if (!session) return;
    try {
      await api(`/api/online-soup/rooms/${session.snapshot.room.id}/messages/${message.id}/recall`, { method: "PATCH" });
      await refreshSession();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "撤回失败");
    }
  }

  async function copyMessage(message: OnlineSoupMessage) {
    try {
      await copyTextToClipboard(message.type === "sticker" ? "[表情包]" : message.content);
      showToast("消息已复制");
    } catch {
      showToast("复制失败，请稍后重试");
    }
  }

  async function leaveRoom() {
    if (!session) return;
    try {
      const result = await api<{ roomClosed?: boolean; hostTransferred?: boolean }>(`/api/online-soup/rooms/${session.snapshot.room.id}/leave`, { method: "POST" });
      clearDock();
      showToast(session.snapshot.me.isHost ? result.roomClosed ? "已退出并解散空房间" : "已退出房间，房主已转移" : "已退出房间");
    } catch (error) {
      if (isOnlineSoupAlreadyExited(error)) {
        clearDock();
        showToast("已退出房间");
        return;
      }
      showToast(error instanceof Error ? error.message : "退出房间失败");
    }
  }

  const contextValue = useMemo<OnlineSoupDockValue>(() => ({
    minimizeRoom,
    showFullRoom,
    syncRoomBackgroundMusic,
    backgroundMusicMuted: backgroundMusicPlayback.muted,
    backgroundMusicAutoplayBlocked: backgroundMusicPlayback.autoplayBlocked,
    toggleBackgroundMusicMuted: backgroundMusicPlayback.toggleMuted,
  }), [backgroundMusicPlayback.autoplayBlocked, backgroundMusicPlayback.muted, backgroundMusicPlayback.toggleMuted, minimizeRoom, showFullRoom, syncRoomBackgroundMusic]);
  const inFullRoom = session ? location.pathname === `/online-soup/rooms/${session.snapshot.room.id}` : false;
  const currentMemberMuted = isActiveMute(session?.snapshot.members.find((member) => member.id === user?.id)?.mutedUntil);
  const mutedUserIds = useMemo(() => new Set(session?.snapshot.members.filter((member) => isActiveMute(member.mutedUntil)).map((member) => member.id) ?? []), [session?.snapshot.members]);
  const miniImpostorGame = session?.snapshot.room.contentType === "impostor" ? session.snapshot.room.impostorGame : null;

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
          {session.snapshot.room.backgroundMusic && <button type="button" className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full" onClick={backgroundMusicPlayback.toggleMuted} aria-label={`${backgroundMusicPlayback.muted ? "恢复" : "静音"}背景音乐：${session.snapshot.room.backgroundMusic.name}`} aria-pressed={backgroundMusicPlayback.muted} title={`${session.snapshot.room.backgroundMusic.name} · ${backgroundMusicPlayback.muted ? "已静音" : "点击仅在本机静音"}`}><Volume2 size={17} />{backgroundMusicPlayback.muted && <Ban className="absolute bottom-1 right-1 rounded-full bg-white text-red-500" size={11} strokeWidth={2.5} aria-hidden="true" />}</button>}
          <span title={connected ? "实时连接正常" : "正在重新连接"}>{connected ? <Wifi size={17} className="text-emerald-500" /> : <WifiOff size={17} className="text-red-500" />}</span>
          <button type="button" onClick={() => { setMode("collapsed"); }} aria-label="收起聊天窗" title="收起"><Minimize2 size={17} /></button>
          <button type="button" onClick={() => { showFullRoom(session.snapshot.room.id); navigate(`/online-soup/rooms/${session.snapshot.room.id}`); }} aria-label="返回完整房间" title="放大"><Maximize2 size={17} /></button>
          <button type="button" className="text-red-500" onClick={() => setConfirmLeave(true)} aria-label="退出房间" title="退出房间"><LogOut size={17} /></button>
        </header>
        <MiniMessageList
          messages={session.snapshot.messages}
          contentType={session.snapshot.room.contentType}
          currentAiProgress={session.snapshot.room.aiProgress}
          remainingQuestionCount={session.snapshot.room.remainingQuestionCount}
          currentUserId={user?.id ?? ""}
          mutedUserIds={mutedUserIds}
          onRecall={recallMessage}
          onCopy={copyMessage}
          showAnswerChangeNotices={!session.snapshot.me.isHost}
          onLocate={(messageId) => {
            const activeRoomId = session.snapshot.room.id;
            showFullRoom(activeRoomId);
            navigate(`/online-soup/rooms/${activeRoomId}?locateMessage=${encodeURIComponent(messageId)}`);
          }}
        />
        {miniImpostorGame && miniImpostorGame.phase !== "ended" && <button type="button" className="online-soup-mini-impostor-action" onClick={() => { const activeRoomId = session.snapshot.room.id; showFullRoom(activeRoomId); navigate(`/online-soup/rooms/${activeRoomId}`); }}>
          <span>第 {miniImpostorGame.day} 天 · {impostorPhaseLabels[miniImpostorGame.phase]}</span>
          <strong>{miniImpostorGame.me ? "返回完整房间操作" : "返回完整房间查看"}<Maximize2 size={14} /></strong>
        </button>}
        {session.snapshot.me.role !== "spectator" && !currentMemberMuted && <div className="online-soup-mini-composer">
          {session.snapshot.me.role === "player" && session.snapshot.room.contentType !== "impostor" && <button
            type="button"
            className={messageMode === "question" ? "is-question" : ""}
            disabled={session.snapshot.room.status !== "playing"}
            onClick={() => setMessageMode((current) => {
              if (current === "discussion" && session.snapshot.room.remainingQuestionCount === 0) {
                showToast("本轮提问次数已用尽，请等待主持人完成回答");
                return current;
              }
              return current === "discussion" ? "question" : "discussion";
            })}
          >{messageMode === "question" ? "提问" : "讨论"}</button>}
          <textarea rows={1} maxLength={1000} value={content} onChange={(event) => setContent(event.target.value)} placeholder={session.snapshot.room.contentType !== "impostor" && messageMode === "question" ? "输入正式问题…" : "参与讨论…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
          <button type="button" className="is-send" disabled={sending || !content.trim()} onClick={() => void sendMessage()} aria-label="发送"><Send size={17} /></button>
        </div>}
        {session.snapshot.me.role !== "spectator" && currentMemberMuted && <div className="flex items-center justify-center gap-1.5 border-t border-red-100 bg-red-50 px-3 py-3 text-xs font-bold text-red-600" role="status"><VolumeX size={15} />你已被房主禁言</div>}
      </section>}
    </div>}
    {confirmLeave && session && <Modal onClose={() => setConfirmLeave(false)}>
      <div className="space-y-4 text-center">
        <div><h2 className="text-xl font-black text-ink">确认退出房间？</h2><p className="mt-2 text-sm leading-6 text-muted">{session.snapshot.room.contentType === "impostor" && session.snapshot.room.status === "playing" && session.snapshot.me.role === "player" ? "你是本局游戏者，退出会立即终止本局并按平局结算；你的房间席位随后释放。" : session.snapshot.me.isHost ? session.snapshot.members.some((member) => member.id !== user?.id) ? "退出后将立即由房内成员接任房主；当前房间和正在进行的游戏会继续。" : "房间内暂无其他成员，退出后房间将立即解散。" : "退出后将释放当前席位，重新进入时可能需要再次验证。"}</p></div>
        <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>取消</button><button className="btn bg-red-500 text-white hover:bg-red-600" onClick={() => void leaveRoom()}>确认退出</button></div>
      </div>
    </Modal>}
  </OnlineSoupDockContext.Provider>;
}

function MiniMessageList({ messages, contentType, currentAiProgress, remainingQuestionCount, currentUserId, mutedUserIds, onRecall, onCopy, showAnswerChangeNotices, onLocate }: { messages: OnlineSoupMessage[]; contentType: OnlineSoupSnapshot["room"]["contentType"]; currentAiProgress: number | null; remainingQuestionCount: number | null; currentUserId: string; mutedUserIds: ReadonlySet<string>; onRecall: (message: OnlineSoupMessage) => void; onCopy: (message: OnlineSoupMessage) => void; showAnswerChangeNotices: boolean; onLocate: (messageId: string) => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages]);
  const visibleMessages = messages.filter((message) => showAnswerChangeNotices || !message.targetMessageId).slice(-60);
  return <div className="online-soup-mini-messages">
    {giftTimelineEntries(visibleMessages).map((entry) => entry.kind === "gift_bundle"
      ? <GiftMessageBundle key={entry.key} gifts={entry.gifts} align={entry.gifts[0]?.sender.id === currentUserId ? "right" : "left"} />
      : <MiniMessage key={`${entry.message.id}-${entry.message.updatedAt}`} message={entry.message} clueLabel={contentType === "impostor" ? "身份线索" : "主持人线索"} currentAiProgress={currentAiProgress} remainingQuestionCount={remainingQuestionCount} currentUserId={currentUserId} muted={Boolean(entry.message.senderId && mutedUserIds.has(entry.message.senderId))} onRecall={onRecall} onCopy={onCopy} onLocate={onLocate} />)}
    <div ref={bottomRef} />
  </div>;
}

function MiniMessage({ message, clueLabel, currentAiProgress, remainingQuestionCount, currentUserId, muted, onRecall, onCopy, onLocate }: { message: OnlineSoupMessage; clueLabel: string; currentAiProgress: number | null; remainingQuestionCount: number | null; currentUserId: string; muted: boolean; onRecall: (message: OnlineSoupMessage) => void; onCopy: (message: OnlineSoupMessage) => void; onLocate: (messageId: string) => void }) {
  const mine = message.senderId === currentUserId;
  if (message.recalledAt) return <RecalledMessageNotice mine={mine} senderName={message.senderName} />;
  if (message.type === "gift" && message.gift) return <div className={`flex ${mine ? "justify-end" : "justify-start"}`}><GiftMessageCard gift={message.gift} /></div>;
  if (message.type === "system") return <p className="online-soup-mini-system">— {message.content} {message.targetMessageId && <button type="button" className="font-black text-primary hover:underline" onClick={() => onLocate(message.targetMessageId!)}>【定位】</button>} —</p>;
  if (message.type === "ai_honor" && message.aiHonors) return <OnlineSoupHonorCard honors={message.aiHonors} compact />;
  if (message.type === "ai_advice") return <article className="online-soup-mini-event is-progress"><strong className="flex items-center gap-1"><Sparkles size={14} />AI 主持建议</strong><p className="whitespace-pre-line">{message.content}</p></article>;
  if (message.type === "clue") return <article className="online-soup-mini-event is-clue"><strong>{clueLabel}</strong><p>{message.content}</p></article>;
  if (message.type === "supplemental_surface" || message.type === "bottom" || message.type === "manual") {
    const title = message.type === "supplemental_surface" ? "补充汤面" : message.type === "bottom" ? "汤底已公布" : "主持人手册";
    return <article className="online-soup-mini-event is-progress"><strong>{title}</strong><div dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} /></article>;
  }
  const question = message.type === "question";
  const host = message.type === "host" || message.senderIsHost;
  const canRecall = mine
    && ["discussion", "question", "host", "sticker"].includes(message.type)
    && (!question || message.answer == null)
    && canRecallMessage(message.createdAt, message.recalledAt);
  return <article className={`online-soup-mini-message ${mine ? "is-mine" : ""} ${question ? "is-question" : ""} ${host ? "is-host" : ""}`}>
    <span className="online-soup-mini-avatar">
      {message.senderAvatar
        ? <img src={message.senderAvatar} alt="" />
        : <span>{message.senderName?.slice(0, 1) ?? "?"}</span>}
      {host && <span className="is-host-mark">主</span>}
      {muted && <MutedAvatarIndicator size="sm" />}
    </span>
    <div className="online-soup-mini-message-body">
      <div className="online-soup-mini-message-meta">
        <VipIdentity nickname={message.senderName ?? "未知用户"} vipLevel={message.senderVipLevel} vipActive={message.senderVipActive} showUserLevel={false} vipIconBeforeNickname className="online-soup-mini-message-identity" iconClassName="h-3.5 w-3.5" />
        {host && <span className="is-host-label">主持人</span>}
        {question && <span>正式提问 #{message.questionNumber}</span>}
      </div>
      <MessageActionMenu actions={[
        { label: "复制", onSelect: () => onCopy(message) },
        ...(canRecall ? [{ label: "撤回", tone: "danger" as const, availableUntil: new Date(message.createdAt).getTime() + 120_000, onSelect: () => onRecall(message) }] : [])
      ]}>
        <div className="online-soup-mini-bubble"><p>{message.type === "sticker" ? "[表情包]" : message.content}</p></div>
      </MessageActionMenu>
      {question && <small role={message.aiStatus === "failed" ? "alert" : ["pending", "answering", "scoring"].includes(message.aiStatus) ? "status" : undefined}>{message.answer ? `${onlineSoupAnswerPrefix(message.aiStatus)}${message.answer === "yes" ? "是" : message.answer === "no" ? "不是" : message.answer === "both" ? "是也不是" : message.answer === "unknown" ? "不知道" : "不重要"}${message.aiStatus === "scoring" ? " · 正在核对本次发现" : message.aiStatus === "failed" ? " · 进度核对失败，请到完整房间重新核对" : ""}` : message.aiStatus === "failed" ? "AI 回复失败，请到完整房间重新请求" : message.aiStatus === "pending" && message.aiQueuePosition && message.aiQueuePosition > 1 ? `AI 队列第 ${message.aiQueuePosition} 位` : ["pending", "answering", "scoring"].includes(message.aiStatus) ? "AI 正在结合汤底与上下文判断" : message.aiStatus === "cancelled" ? "本轮已结束，提问已取消" : "等待主持人回复"}</small>}
      {question && remainingQuestionCount !== null && <small className="font-black text-violet-700">剩余提问次数：{remainingQuestionCount}</small>}
      {question && message.isBestQuestion && <small className="font-black text-amber-600">最佳提问</small>}
      {question && Boolean(message.aiProgressDelta) && (currentAiProgress ?? message.aiProgressAfter) != null && <small>— 进度+{message.aiProgressDelta}，当前进度：{currentAiProgress ?? message.aiProgressAfter}% —</small>}
      <time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
  </article>;
}
