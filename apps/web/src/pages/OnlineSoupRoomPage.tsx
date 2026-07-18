import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRightLeft, BookOpen, Check, ChevronDown, ChevronUp, Clapperboard, Crown, Eye, Lightbulb, ListChecks, LogOut, Menu, MessageCircle, Play, Plus, RefreshCw, Send, Smile, Soup, Users, Wifi, WifiOff, X } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Modal } from "../components/Modal";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";
import { OnlineSoupInviteModal } from "../components/OnlineSoupInviteModal";
import { StickerKeyboard } from "../components/StickerKeyboard";
import { useApp } from "../context/AppContext";
import { sanitizeHtml } from "../sanitizeHtml";
import { connectOnlineSoupSocket } from "../shared/onlineSoupSocket";
import { useOnlineSoupExitGuard } from "../shared/onlineSoupExitGuard";
import type { OnlineSoupAnswer, OnlineSoupMessage, OnlineSoupSnapshot, StickerAsset, StickerSeries } from "../shared/types";

const answerLabels: Record<OnlineSoupAnswer, string> = { yes: "是", no: "不是", both: "是也不是", unknown: "不知道", irrelevant: "不重要" };
const statusLabels = { preparing: "准备中", playing: "推理中", ended: "本轮已结束", closed: "已关闭" } as const;
type MessagePage = { messages: OnlineSoupMessage[]; hasMore: boolean; nextCursor: string | null };
type RoomState = Pick<OnlineSoupSnapshot, "room" | "me" | "members">;
type ProgressQuestion = {
  id: string;
  sequence: string;
  number: number;
  content: string;
  answer: OnlineSoupAnswer | null;
  sender: { id: string | null; nickname: string; avatar: string | null };
  createdAt: string;
};
type ProgressPage = { questions: ProgressQuestion[]; hasMore: boolean; nextCursor: string | null };
const structuralRoomEvents = new Set([
  "member_joined", "member_left", "soup_selected", "round_started",
  "supplemental_surface_published", "bottom_published", "round_ended"
]);

function mergeMessages(older: OnlineSoupMessage[], newer: OnlineSoupMessage[]) {
  const byId = new Map(older.map((message) => [message.id, message]));
  for (const message of newer) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => {
    const leftSequence = BigInt(left.sequence);
    const rightSequence = BigInt(right.sequence);
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
  });
}

export default function OnlineSoupRoomPage() {
  const { roomId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite") ?? "";
  const navigate = useNavigate();
  const location = useLocation();
  const inviteReturnToCandidate = (location.state as { onlineSoupInviteReturnTo?: string } | null)?.onlineSoupInviteReturnTo ?? "";
  const inviteReturnTo = inviteReturnToCandidate.startsWith("/circles/")
    || inviteReturnToCandidate.startsWith("/messages/chat/")
    ? inviteReturnToCandidate
    : "/online-soup";
  const { showToast, user, loadingUser, openAuth } = useApp();
  const [snapshot, setSnapshot] = useState<OnlineSoupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [mode, setMode] = useState<"discussion" | "question">("discussion");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [soupExpanded, setSoupExpanded] = useState(true);
  const [soupTab, setSoupTab] = useState<"surface" | "bottom" | "manual">("surface");
  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [clueOpen, setClueOpen] = useState(false);
  const [clueListOpen, setClueListOpen] = useState(false);
  const [cluePanelTab, setCluePanelTab] = useState<"clues" | "progress">("clues");
  const [progressQuestions, setProgressQuestions] = useState<ProgressQuestion[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [surfacePublishOpen, setSurfacePublishOpen] = useState(false);
  const [clue, setClue] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [stickerSeries, setStickerSeries] = useState<StickerSeries[]>([]);
  const [stickersLoading, setStickersLoading] = useState(true);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [hostActionsOpen, setHostActionsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"back" | "close" | null>(null);
  const [entryPasswordOpen, setEntryPasswordOpen] = useState(false);
  const [entryPassword, setEntryPassword] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const refreshPending = useRef(false);
  const incrementalPending = useRef(false);
  const historyExpanded = useRef(false);
  const newestMessageId = useRef<string | null>(null);
  const snapshotRef = useRef<OnlineSoupSnapshot | null>(null);
  const entryStarted = useRef(false);
  const progressLoadedRoundId = useRef<string | null>(null);
  const progressPending = useRef(false);
  const returnFromInvite = useCallback(() => {
    navigate(inviteReturnTo, { replace: true });
  }, [inviteReturnTo, navigate]);

  const load = useCallback(async (quiet = false) => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    try {
      const data = await api<OnlineSoupSnapshot>(`/api/online-soup/rooms/${roomId}`, { bypassCache: true, dedupe: false });
      setSnapshot((current) => {
        if (!quiet || !current || !historyExpanded.current) return data;
        return {
          ...data,
          messages: mergeMessages(current.messages, data.messages),
          messagesHasMore: current.messagesHasMore,
          messagesNextCursor: current.messagesNextCursor
        };
      });
      if (data.room.status === "closed") { showToast("房间已关闭"); returnFromInvite(); }
    } catch (error) {
      if (!quiet && error instanceof ApiError && error.code === "NOT_MEMBER") {
        try {
          const joined = await api<{ roomId: string; role: "player" | "spectator" }>(`/api/online-soup/rooms/${roomId}/join-auto`, {
            method: "POST",
            body: { inviteToken }
          });
          if (joined.role === "spectator") showToast("玩家席位已满，已作为旁观者进入");
          const data = await api<OnlineSoupSnapshot>(`/api/online-soup/rooms/${roomId}`, { bypassCache: true, dedupe: false });
          setSnapshot(data);
        } catch (joinError) {
          if (joinError instanceof ApiError && joinError.code === "PASSWORD_REQUIRED") {
            setEntryPasswordOpen(true);
          } else if (joinError instanceof ApiError && joinError.code === "ROOM_FULL") {
            setEntryError("房间已满");
          } else if (joinError instanceof ApiError && joinError.code === "ROOM_CLOSED") {
            setEntryError("房间不存在或已关闭");
          } else {
            showToast(joinError instanceof Error ? joinError.message : "加入房间失败");
          }
        }
      } else if (!quiet) {
        setEntryError(error instanceof ApiError && error.code === "ROOM_CLOSED" ? "房间不存在或已关闭" : null);
        showToast(error instanceof Error ? error.message : "房间加载失败");
      }
    } finally { refreshPending.current = false; setLoading(false); }
  }, [inviteToken, roomId, returnFromInvite, showToast]);

  useEffect(() => {
    if (loadingUser || entryStarted.current) return;
    entryStarted.current = true;
    if (!user) {
      sessionStorage.setItem("onlineSoupPendingInvite", JSON.stringify({ roomId, inviteToken }));
      navigate("/online-soup", { replace: true });
      window.setTimeout(openAuth, 0);
      return;
    }
    void load();
  }, [inviteToken, load, loadingUser, navigate, openAuth, roomId, user]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => {
    void api<{ series: StickerSeries[] }>("/api/stickers", { cacheTtlMs: 30 * 60_000 })
      .then((data) => setStickerSeries(data.series))
      .catch((error) => showToast(error instanceof Error ? error.message : "表情包加载失败"))
      .finally(() => setStickersLoading(false));
  }, [showToast]);
  const loadState = useCallback(async () => {
    try {
      const data = await api<RoomState>(`/api/online-soup/rooms/${roomId}/state`, { bypassCache: true, dedupe: false });
      setSnapshot((current) => current ? { ...current, ...data } : current);
      if (data.room.status === "closed") {
        navigate("/online-soup", { replace: true });
      }
    } catch {
      await load(true);
    }
  }, [load, navigate, roomId]);

  const loadNewMessages = useCallback(async () => {
    if (incrementalPending.current) return;
    const current = snapshotRef.current;
    const lastSequence = current?.messages[current.messages.length - 1]?.sequence;
    if (!current || !lastSequence) {
      await load(true);
      return;
    }
    incrementalPending.current = true;
    try {
      let after = lastSequence;
      let hasMore = true;
      const incoming: OnlineSoupMessage[] = [];
      for (let pageNumber = 0; pageNumber < 10 && hasMore; pageNumber += 1) {
        const page = await api<MessagePage>(`/api/online-soup/rooms/${roomId}/messages?after=${encodeURIComponent(after)}&limit=100`, { bypassCache: true, dedupe: false });
        incoming.push(...page.messages);
        hasMore = page.hasMore;
        if (!page.nextCursor) break;
        after = page.nextCursor;
      }
      if (!incoming.length) return;
      setSnapshot((latest) => {
        if (!latest) return latest;
        const merged = mergeMessages(latest.messages, incoming);
        if (historyExpanded.current || merged.length <= 100) return { ...latest, messages: merged };
        const visible = merged.slice(-100);
        return {
          ...latest,
          messages: visible,
          messagesHasMore: true,
          messagesNextCursor: visible[0]?.sequence ?? latest.messagesNextCursor
        };
      });
    } catch {
      await load(true);
    } finally {
      incrementalPending.current = false;
    }
  }, [load, roomId]);

  const loadProgress = useCallback(async (force = false) => {
    const roundId = snapshotRef.current?.room.currentRoundId;
    if (!roundId || progressPending.current) return;
    if (!force && progressLoadedRoundId.current === roundId) return;
    progressPending.current = true;
    setProgressLoading(true);
    try {
      let after = "";
      let hasMore = true;
      const questions: ProgressQuestion[] = [];
      while (hasMore) {
        const query = after ? `?after=${encodeURIComponent(after)}&limit=100` : "?limit=100";
        const page = await api<ProgressPage>(`/api/online-soup/rooms/${roomId}/progress${query}`, { bypassCache: true, dedupe: false });
        questions.push(...page.questions);
        hasMore = page.hasMore;
        if (!page.nextCursor) break;
        after = page.nextCursor;
      }
      setProgressQuestions(questions);
      progressLoadedRoundId.current = roundId;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "推理进度加载失败");
    } finally {
      progressPending.current = false;
      setProgressLoading(false);
    }
  }, [roomId, showToast]);

  useEffect(() => connectOnlineSoupSocket(roomId, (reason, payload) => {
    if (reason === "room_closed") {
      showToast("主持人已关闭房间");
      navigate("/online-soup", { replace: true });
      return;
    }
    if (reason === "message" || reason === "clue") {
      if (reason === "message") progressLoadedRoundId.current = null;
      void loadNewMessages();
      return;
    }
    if (reason === "answer_changed" && typeof payload.messageId === "string") {
      const nextAnswer = typeof payload.answer === "string" ? payload.answer as OnlineSoupAnswer : null;
      setSnapshot((current) => current ? {
        ...current,
        messages: current.messages.map((message) => message.id === payload.messageId ? { ...message, answer: nextAnswer } : message)
      } : current);
      setProgressQuestions((current) => current.map((question) => question.id === payload.messageId ? { ...question, answer: nextAnswer } : question));
      return;
    }
    if (structuralRoomEvents.has(reason)) {
      void Promise.all([loadState(), loadNewMessages()]);
      return;
    }
    void load(true);
  }, setSocketConnected), [roomId, load, loadNewMessages, loadState, navigate, showToast]);
  useEffect(() => {
    if (socketConnected) return;
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load, socketConnected]);
  const latestMessageId = snapshot?.messages[snapshot.messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!latestMessageId || latestMessageId === newestMessageId.current) return;
    const behavior = newestMessageId.current == null ? "auto" : "smooth";
    newestMessageId.current = latestMessageId;
    bottomRef.current?.scrollIntoView({ behavior });
  }, [latestMessageId]);
  useEffect(() => {
    if (clueListOpen && cluePanelTab === "progress") void loadProgress();
  }, [clueListOpen, cluePanelTab, latestMessageId, loadProgress, snapshot?.room.currentRoundId]);
  useEffect(() => {
    const input = messageInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    const minHeight = 40;
    const maxHeight = 100;
    input.style.height = `${Math.max(minHeight, Math.min(input.scrollHeight, maxHeight))}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [content]);

  const isHost = snapshot?.me.isHost ?? false;
  const disarmExitGuard = useOnlineSoupExitGuard(roomId, true, "room");
  const canDiscuss = snapshot && snapshot.me.role !== "spectator" && snapshot.room.status !== "closed";
  const canQuestion = snapshot?.me.role === "player" && snapshot.room.status === "playing" && snapshot.room.hostOnline;
  const allStickers = useMemo(() => stickerSeries.flatMap((series) => series.stickers), [stickerSeries]);
  const stickersById = useMemo(() => new Map(allStickers.map((sticker) => [sticker.id, sticker])), [allStickers]);
  useEffect(() => {
    if (!canQuestion && mode === "question") setMode("discussion");
  }, [canQuestion, mode]);

  async function sendMessage() {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: mode, content: text } });
      setContent(""); await loadNewMessages();
    } catch (error) { showToast(error instanceof Error ? error.message : "发送失败"); }
    finally { setSending(false); }
  }

  async function loadOlderMessages() {
    if (!snapshot?.messagesHasMore || !snapshot.messagesNextCursor || loadingOlder) return;
    const container = messagesRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const page = await api<MessagePage>(`/api/online-soup/rooms/${roomId}/messages?before=${encodeURIComponent(snapshot.messagesNextCursor)}&limit=100`, { bypassCache: true, dedupe: false });
      historyExpanded.current = true;
      setSnapshot((current) => current ? {
        ...current,
        messages: mergeMessages(page.messages, current.messages),
        messagesHasMore: page.hasMore,
        messagesNextCursor: page.nextCursor
      } : current);
      window.requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - previousHeight;
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "历史消息加载失败");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function sendSticker(sticker: StickerAsset) {
    if (sending) return;
    setSending(true);
    try {
      setStickersOpen(false);
      await api(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: "sticker", stickerId: sticker.id } });
      await loadNewMessages();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "表情发送失败");
    } finally {
      setSending(false);
    }
  }

  async function answer(message: OnlineSoupMessage, answerValue: OnlineSoupAnswer) {
    const nextAnswer = message.answer === answerValue ? null : answerValue;
    try {
      await api(`/api/online-soup/rooms/${roomId}/questions/${message.id}/answer`, { method: "PATCH", body: { answer: nextAnswer } });
      setSnapshot((current) => current ? {
        ...current,
        messages: current.messages.map((item) => item.id === message.id ? { ...item, answer: nextAnswer } : item)
      } : current);
    } catch (error) { showToast(error instanceof Error ? error.message : "回答失败"); }
  }

  async function hostAction(path: string, body?: object) {
    try {
      await api(`/api/online-soup/rooms/${roomId}/${path}`, { method: "POST", body });
      if (path === "close") return;
      if (path === "clues") await loadNewMessages();
      else await Promise.all([loadState(), loadNewMessages()]);
    }
    catch (error) { showToast(error instanceof Error ? error.message : "操作失败"); throw error; }
  }

  async function publishClue() {
    if (!clue.trim()) return;
    try { await hostAction("clues", { content: clue }); setClue(""); setClueOpen(false); } catch { /* toast above */ }
  }

  async function publishSurface(surfaceIndex: number) {
    try { await hostAction("publish-surface", { surfaceIndex }); setSurfacePublishOpen(false); }
    catch { /* toast above */ }
  }

  async function publishBottom(bottomIndex: number) {
    try {
      await hostAction("publish-bottom", { bottomIndex });
      setPublishOpen(false);
    } catch { /* toast above */ }
  }

  function openSoupSelector() {
    navigate(`/online-soup/rooms/${roomId}/select-soup`);
  }

  function openMemberProfile(userId: string) {
    navigate(`/users/${userId}`, { state: { onlineSoupRoomId: roomId, onlineSoupMember: true } });
  }

  async function submitEntryPassword() {
    if (entryPassword.length !== 4) return showToast("请输入 4 位房间密码");
    try {
      const joined = await api<{ role: "player" | "spectator" }>(`/api/online-soup/rooms/${roomId}/join-auto`, {
        method: "POST",
        body: { password: entryPassword }
      });
      setEntryPasswordOpen(false);
      if (joined.role === "spectator") showToast("玩家席位已满，已作为旁观者进入");
      setLoading(true);
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === "ROOM_FULL") {
        setEntryPasswordOpen(false);
        setEntryError("房间已满");
      } else {
        showToast(error instanceof Error ? error.message : "加入房间失败");
      }
    }
  }

  async function leaveRoom() {
    try {
      await api(`/api/online-soup/rooms/${roomId}/leave`, { method: "POST" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "退出房间失败");
      return;
    }
    disarmExitGuard();
    navigate("/online-soup");
  }

  async function closeRoom() {
    try { await hostAction("close"); disarmExitGuard(); navigate("/online-soup", { replace: true }); } catch { /* toast above */ }
  }

  const groupedMembers = useMemo(() => ({
    host: snapshot?.members.find((member) => member.role === "host"),
    players: snapshot?.members.filter((member) => member.role === "player") ?? [],
    spectators: snapshot?.members.filter((member) => member.role === "spectator") ?? []
  }), [snapshot?.members]);
  const unpublishedSurfaces = (snapshot?.room.soup?.supplementalSurfaces ?? [])
    .map((content, index) => ({ content, index }))
    .filter(({ index }) => !snapshot?.room.soup?.publishedSurfaceIndices?.includes(index));
  const clueMessages = snapshot?.messages.filter((message) => message.type === "clue" && message.roundId === snapshot.room.currentRoundId) ?? [];

  if (loading || !snapshot) return <div className="min-h-screen bg-page p-4 pt-24">
    {!entryPasswordOpen && !entryError && <div className="mx-auto h-48 max-w-5xl animate-pulse rounded-2xl bg-slate-200" />}
    {entryPasswordOpen && <Modal onClose={() => navigate("/online-soup", { replace: true })}>
      <div className="space-y-4">
        <div><h2 className="text-xl font-black text-ink">输入房间密码</h2><p className="mt-1 text-sm text-muted">该房间需要验证四位密码</p></div>
        <input className="field w-full text-center text-xl tracking-[.35em]" type="password" inputMode="numeric" maxLength={4} value={entryPassword} onChange={(event) => setEntryPassword(event.target.value.replace(/\D/g, ""))} placeholder="••••" />
        <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => navigate("/online-soup", { replace: true })}>取消</button><button className="btn btn-primary" onClick={() => void submitEntryPassword()}>进入房间</button></div>
      </div>
    </Modal>}
    {entryError && <Modal onClose={returnFromInvite}>
      <div className="space-y-4 text-center"><h2 className="text-xl font-black text-ink">{entryError}</h2><p className="text-sm text-muted">暂时无法进入该房间</p><button className="btn btn-primary w-full" onClick={returnFromInvite}>确认</button></div>
    </Modal>}
  </div>;

  return (
    <div className="h-[100dvh] overflow-hidden bg-page">
      <header className="top-nav-shell">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <button className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100" onClick={() => isHost ? setConfirmAction("back") : void leaveRoom()}><ArrowLeft size={20} /></button>
          <div className="min-w-0 flex-1"><h1 className="truncate font-black text-ink">{snapshot.room.name}</h1><p className="text-xs text-muted">房间号 {snapshot.room.code} · {statusLabels[snapshot.room.status]}</p></div>
          <span title={socketConnected ? "实时连接正常" : "正在重新连接"}>{socketConnected ? <Wifi size={18} className="text-emerald-600" /> : <WifiOff size={18} className="text-red-500" />}</span>
          <button className="btn btn-secondary h-10 w-10 p-0" onClick={() => setMembersOpen(true)} aria-label={`房间成员，共 ${snapshot.members.length} 人`} title={`房间成员 · ${snapshot.members.length} 人`}>
            <span className="relative grid h-7 w-7 place-items-center">
              <Users size={19} />
              <span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-black leading-4 text-white ring-2 ring-white">{snapshot.members.length}</span>
            </span>
          </button>
        </div>
      </header>

      <main className="mx-auto grid h-full max-w-6xl grid-rows-[auto_auto_minmax(0,1fr)] gap-2 overflow-hidden px-4 pb-3 pt-[76px] lg:grid-cols-[320px_44px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-3">
        <aside className="flex max-h-[30dvh] min-h-0 flex-col gap-3 overflow-hidden lg:max-h-none">
          {!snapshot.room.hostOnline && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">主持人暂时离线，正式提问已暂停，等待主持人重新连接。</div>}
          <section className={`card flex min-h-0 flex-col overflow-hidden ${soupExpanded && snapshot.room.soup ? "flex-1" : "shrink-0"}`}>
            <div className="shrink-0 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <button className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => setSoupExpanded(!soupExpanded)}>
                  <span className="min-w-0 flex-1 truncate text-xs font-black text-ink">{snapshot.room.soup?.title ?? "尚未选择"}</span>
                  {soupExpanded ? <ChevronUp className="shrink-0" size={16} /> : <ChevronDown className="shrink-0" size={16} />}
                </button>
                {isHost && snapshot.room.soup && <div className="flex min-w-0 rounded-lg bg-slate-100 p-0.5">
                  {([
                    ["surface", "汤面"],
                    ["bottom", "汤底"],
                    ["manual", "手册"]
                  ] as const).map(([value, label]) => <button key={value} className={`rounded-md px-2 py-1 text-[11px] font-black transition ${soupTab === value ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => { setSoupTab(value); setSoupExpanded(true); }}>{label}</button>)}
                </div>}
              </div>
            </div>
            {soupExpanded && snapshot.room.soup && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line p-4">
              {(!isHost || soupTab === "surface") && <>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-muted">{snapshot.room.soup.type}</span>
                <div className="content-block mt-3 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(snapshot.room.soup.surface) }} />
                {(isHost
                  ? (snapshot.room.soup.supplementalSurfaces ?? []).map((content, index) => ({ content, index }))
                  : snapshot.room.soup.visibleSupplementalSurfaces
                ).map(({ content: surface, index }) => {
                  const published = snapshot.room.soup?.publishedSurfaceIndices?.includes(index) ?? !isHost;
                  return <section key={`surface-${index}`} className="mt-3 rounded-xl bg-blue-50 p-3">
                    <h3 className="text-sm font-black text-blue-800">补充汤面 {index + 1}{published ? " · 已发布" : ""}</h3>
                    <div className="content-block mt-2 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sanitizeHtml(surface) }} />
                  </section>;
                })}
              </>}
              {isHost && soupTab === "bottom" && <>
                {snapshot.room.soup.bottom && <section className="rounded-xl bg-amber-50 p-3">
                  <h3 className="text-sm font-black text-amber-800">主汤底{snapshot.room.soup.publishedBottomIndices?.includes(0) ? " · 已发布" : ""}</h3>
                  <div className="content-block mt-2 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sanitizeHtml(snapshot.room.soup.bottom) }} />
                </section>}
                {(snapshot.room.soup.supplementalBottoms ?? []).map((bottom, index) => <section key={`bottom-${index}`} className="mt-3 rounded-xl bg-amber-50 p-3">
                  <h3 className="text-sm font-black text-amber-800">补充汤底 {index + 1}{snapshot.room.soup?.publishedBottomIndices?.includes(index + 1) ? " · 已发布" : ""}</h3>
                  <div className="content-block mt-2 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sanitizeHtml(bottom) }} />
                </section>)}
              </>}
              {isHost && soupTab === "manual" && (snapshot.room.soup.manual
                ? <div className="content-block rounded-xl bg-violet-50 p-3 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(snapshot.room.soup.manual) }} />
                : <p className="py-8 text-center text-sm text-muted">暂无主持人手册</p>)}
            </div>}
          </section>

        </aside>

        <section className="flex min-w-0 items-center gap-1.5 overflow-x-auto overscroll-contain rounded-xl border border-line bg-white/90 p-1.5 shadow-sm lg:min-h-0 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto" aria-label="房间成员头像">
          {snapshot.members.map((member) => <button key={member.id} className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full ring-2 transition active:scale-95 ${member.role === "host" ? "ring-amber-400" : member.role === "player" ? "ring-blue-300" : "ring-slate-300"}`} onClick={() => openMemberProfile(member.id)} aria-label={`查看${member.nickname}的主页`} title={`${member.nickname} · ${member.role === "host" ? "主持人" : member.role === "player" ? "玩家" : "旁观者"}`}>{member.avatar ? <img className="h-8 w-8 rounded-full object-cover" src={member.avatar} alt="" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-xs font-black text-primary">{member.nickname.slice(0, 1)}</span>}{member.role === "host" && <Crown className="absolute -right-1 -top-1 rounded-full bg-amber-400 p-0.5 text-white ring-1 ring-white" size={13} />}</button>)}
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-dashed border-blue-300 bg-blue-50/70 text-primary transition hover:border-primary hover:bg-blue-100 active:scale-95" onClick={() => setInviteOpen(true)} aria-label="邀请好友" title="邀请好友"><Plus size={16} strokeWidth={2.5} /></button>
        </section>

        <section className="card flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2"><h2 className="shrink-0 text-sm font-black text-ink">本轮讨论</h2><p className="truncate text-[11px] text-muted">讨论、正式提问、主持人回复和线索会实时同步</p></div>
          <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
            {snapshot.messagesHasMore && <button className="mx-auto block rounded-full border border-line bg-white px-4 py-2 text-xs font-bold text-primary shadow-sm transition hover:bg-blue-50 disabled:opacity-50" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? "加载中…" : "加载更早消息"}</button>}
            {snapshot.messages.map((message) => <MessageItem key={message.id} message={message} isHost={isHost} onAnswer={answer} soupId={message.type === "bottom" && message.allBottomsPublished ? message.soupId : null} stickers={stickersById} onOpenSoup={(id) => navigate(`/soup/${id}`, { state: { onlineSoupRoomId: roomId, onlineSoupMember: true } })} />)}
            <div ref={bottomRef} />
          </div>
          {canDiscuss && <div className="shrink-0 border-t border-line bg-white/95 p-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
            <div className="flex items-end gap-1.5">
              {!isHost && <button
                className={`group relative flex h-10 w-[68px] shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-xl border text-white shadow-md ring-2 ring-offset-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-95 ${mode === "question" ? "border-violet-500 bg-gradient-to-br from-violet-500 to-fuchsia-600 ring-violet-200" : "border-blue-500 bg-gradient-to-br from-blue-500 to-cyan-500 ring-blue-200"}`}
                onClick={() => {
                  if (!canQuestion) {
                    showToast("游戏开始后才可以切换为正式提问");
                    return;
                  }
                  setMode((current) => current === "discussion" ? "question" : "discussion");
                }}
                aria-label={`当前为${mode === "question" ? "提问" : "讨论"}模式，点击切换`}
                title={canQuestion ? "点击切换讨论/提问" : "游戏开始后可以切换为提问"}
              >
                <span className="text-xs font-black leading-5">{mode === "question" ? "提问" : "讨论"}</span>
                <ArrowRightLeft size={14} className="shrink-0 transition-transform duration-200 group-hover:rotate-180" />
              </button>}
              <textarea ref={messageInputRef} className="field room-message-input min-w-0 flex-1 resize-none" rows={1} maxLength={1000} value={content} onChange={(e) => setContent(e.target.value)} onFocus={() => setStickersOpen(false)} placeholder={isHost ? "主持人发言…" : mode === "question" ? "输入正式问题…" : "参与讨论…"} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} />
              <button className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition ${stickersOpen ? "border-amber-300 bg-amber-50 text-amber-700" : "border-line bg-white text-muted hover:bg-slate-50"}`} onClick={() => { if (!stickersOpen) messageInputRef.current?.blur(); setStickersOpen((open) => !open); setHostActionsOpen(false); }} aria-label="表情包" title="表情包"><Smile size={18} /></button>
              <button className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-white shadow-sm transition hover:bg-blue-600 active:scale-95 disabled:opacity-50" disabled={sending || (mode === "question" && !canQuestion)} onClick={sendMessage} aria-label="发送" title="发送"><Send size={18} /></button>
            </div>
            {stickersOpen && <StickerKeyboard series={stickerSeries} loading={stickersLoading} sending={sending} onClose={() => setStickersOpen(false)} onSend={sendSticker} className="mt-3 border-t border-line pt-3" />}
          </div>}
        </section>
      </main>

      {isHost ? <div className={`fixed right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 transition duration-200 ${stickersOpen ? "pointer-events-none translate-y-2 opacity-0" : "opacity-100"}`}>
        {hostActionsOpen && <div className="absolute bottom-full right-1/2 mb-2 flex translate-x-1/2 flex-col items-center gap-2">
          {snapshot.room.status === "preparing" && !snapshot.room.soup && <FloatingAction tone="primary" label="选择海龟汤" onClick={() => { setHostActionsOpen(false); openSoupSelector(); }} />}
          {snapshot.room.status === "preparing" && snapshot.room.soup && <><FloatingAction tone="primary" label="开始游戏" onClick={() => { setHostActionsOpen(false); void hostAction("start"); }} /><FloatingAction label="更换海龟汤" onClick={() => { setHostActionsOpen(false); openSoupSelector(); }} /></>}
          {snapshot.room.status === "playing" && <><FloatingAction tone="amber" label="发布线索" onClick={() => { setHostActionsOpen(false); setClueOpen(true); }} />{unpublishedSurfaces.length > 0 && <FloatingAction tone="primary" label="发布补充汤面" onClick={() => { setHostActionsOpen(false); setSurfacePublishOpen(true); }} />}<FloatingAction tone="primary" label="发布汤底" onClick={() => { setHostActionsOpen(false); setPublishOpen(true); }} /></>}
          {snapshot.room.status === "ended" && <FloatingAction tone="primary" label="更换海龟汤" onClick={() => { setHostActionsOpen(false); openSoupSelector(); }} />}
          <FloatingAction tone="danger" label="关闭房间" onClick={() => { setHostActionsOpen(false); setConfirmAction("close"); }} />
        </div>}
        <button className={`grid h-12 w-12 place-items-center rounded-full border shadow-[0_8px_24px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${hostActionsOpen ? "border-blue-500 bg-primary text-white" : "border-blue-200 bg-white text-primary"}`} onClick={() => setHostActionsOpen((open) => !open)} aria-label="主持人更多操作" title="主持人更多操作"><Menu size={22} /></button>
      </div> : <button className={`fixed right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 grid h-12 w-12 place-items-center rounded-full border border-amber-200 bg-gradient-to-br from-amber-50 to-blue-50 text-amber-700 shadow-[0_8px_24px_rgba(15,23,42,0.2)] transition duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${stickersOpen ? "pointer-events-none translate-y-2 opacity-0" : "opacity-100"}`} onClick={() => { setCluePanelTab("clues"); setClueListOpen(true); }} aria-label={`查看线索与推理进度，当前 ${clueMessages.length} 条线索`} title="线索与进度"><span className="flex items-center gap-0.5"><Lightbulb size={18} /><ListChecks size={16} className="text-primary" /></span><span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-4 text-white ring-2 ring-white">{clueMessages.length}</span></button>}

      {membersOpen && <Modal onClose={() => setMembersOpen(false)}><div className="space-y-4"><h2 className="text-xl font-black text-ink">房间成员</h2>{groupedMembers.host && <MemberRow member={groupedMembers.host} onOpenUser={openMemberProfile} />}<div><p className="mb-2 text-xs font-bold text-muted">玩家 {groupedMembers.players.length}/8</p><div className="space-y-2">{groupedMembers.players.map((member) => <MemberRow key={member.id} member={member} onOpenUser={openMemberProfile} />)}{groupedMembers.players.length === 0 && <p className="text-sm text-muted">等待玩家加入</p>}</div></div>{groupedMembers.spectators.length > 0 && <div><p className="mb-2 text-xs font-bold text-muted">旁观者</p>{groupedMembers.spectators.map((member) => <MemberRow key={member.id} member={member} onOpenUser={openMemberProfile} />)}</div>}<button className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-2.5 text-left text-primary transition hover:border-primary hover:bg-blue-50" onClick={() => { setMembersOpen(false); setInviteOpen(true); }}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-dashed border-blue-300"><Plus size={18} /></span><span><span className="block font-black">分享房间</span><span className="block text-xs font-medium text-muted">分享到微信、圈子或好友</span></span></button><button className="btn btn-secondary w-full" onClick={() => isHost ? setConfirmAction("back") : void leaveRoom()}><LogOut size={16} /> {isHost ? "退出并解散房间" : "退出并释放席位"}</button></div></Modal>}
      {inviteOpen && <OnlineSoupInviteModal roomId={roomId} roomName={snapshot.room.name} roomCode={snapshot.room.code} onClose={() => setInviteOpen(false)} showToast={showToast} />}
      {clueListOpen && <Modal onClose={() => setClueListOpen(false)}><div className="space-y-4">
        <div className="pr-10"><h2 className="text-xl font-black text-ink">推理辅助</h2><p className="mt-1 text-sm text-muted">{snapshot.room.soup?.title ?? "当前海龟汤"}</p></div>
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button className={`rounded-lg px-3 py-2 text-sm font-black transition ${cluePanelTab === "clues" ? "bg-white text-amber-700 shadow-sm" : "text-muted"}`} onClick={() => setCluePanelTab("clues")}><span className="inline-flex items-center gap-1.5"><Lightbulb size={15} />线索<span className="rounded-full bg-amber-100 px-1.5 text-[10px]">{clueMessages.length}</span></span></button>
          <button className={`rounded-lg px-3 py-2 text-sm font-black transition ${cluePanelTab === "progress" ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => setCluePanelTab("progress")}><span className="inline-flex items-center gap-1.5"><ListChecks size={15} />进度{progressLoadedRoundId.current === snapshot.room.currentRoundId && <span className="rounded-full bg-blue-100 px-1.5 text-[10px]">{progressQuestions.length}</span>}</span></button>
        </div>
        {cluePanelTab === "clues" && (clueMessages.length > 0 ? <div className="max-h-[60dvh] space-y-2 overflow-y-auto overscroll-contain">{clueMessages.map((message, index) => <article key={message.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-amber-800">线索 {index + 1}</span><time className="text-[11px] text-muted">{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{message.content}</p></article>)}</div> : <p className="rounded-xl bg-slate-50 py-10 text-center text-sm text-muted">主持人尚未发布线索</p>)}
        {cluePanelTab === "progress" && (progressLoading ? <div className="space-y-2">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div> : progressQuestions.length > 0 ? <div className="max-h-[60dvh] space-y-2 overflow-y-auto overscroll-contain">{progressQuestions.map((question) => <article key={question.id} className="rounded-xl border border-blue-100 bg-blue-50/60 p-3"><div className="flex items-center gap-2"><button className="shrink-0 rounded-full" disabled={!question.sender.id} onClick={() => question.sender.id && openMemberProfile(question.sender.id)}>{question.sender.avatar ? <img className="h-8 w-8 rounded-full object-cover" src={question.sender.avatar} alt="" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-xs font-black text-primary">{question.sender.nickname.slice(0, 1)}</span>}</button><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="shrink-0 text-xs font-black text-primary">#{question.number}</span><span className="truncate text-xs font-bold text-ink">{question.sender.nickname}</span><time className="ml-auto shrink-0 text-[10px] text-muted">{new Date(question.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{question.content}</p></div></div><div className="mt-2 pl-10">{question.answer ? <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-black text-white"><Check size={11} className="mr-1" />{answerLabels[question.answer]}</span> : <span className="inline-flex rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-bold text-muted">等待主持人回复</span>}</div></article>)}</div> : <p className="rounded-xl bg-slate-50 py-10 text-center text-sm text-muted">本轮还没有正式提问</p>)}
        <button className="btn btn-secondary w-full" onClick={() => setClueListOpen(false)}>关闭</button>
      </div></Modal>}
      {confirmAction && <Modal onClose={() => setConfirmAction(null)}><div className="space-y-4"><div className="text-center"><h2 className="text-xl font-black text-ink">{confirmAction === "close" ? "确认解散房间？" : "确认返回并解散房间？"}</h2><p className="mt-2 text-sm leading-6 text-muted">主持人离开后房间将立即解散，所有玩家都会退出，此操作无法撤销。</p></div><div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>取消</button><button className="btn bg-red-500 text-white hover:bg-red-600" onClick={() => { if (confirmAction === "close") void closeRoom(); else void leaveRoom(); }}>确认解散</button></div></div></Modal>}
      {clueOpen && <Modal onClose={() => setClueOpen(false)}><div className="space-y-4"><h2 className="text-xl font-black text-ink">发布主持人线索</h2><textarea className="field min-h-32 w-full" maxLength={2000} value={clue} onChange={(e) => setClue(e.target.value)} placeholder="输入给所有玩家看的线索…" /><button className="btn btn-primary w-full" onClick={publishClue}><Lightbulb size={16} /> 发布线索</button></div></Modal>}
      {surfacePublishOpen && <Modal onClose={() => setSurfacePublishOpen(false)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">发布补充汤面</h2><p className="mt-1 text-sm text-muted">选择一条尚未发布的补充汤面。</p></div><div className="space-y-2">{unpublishedSurfaces.map(({ content: surface, index }) => <button key={index} className="w-full rounded-xl border border-blue-200 bg-blue-50 p-3 text-left transition hover:border-blue-400" onClick={() => void publishSurface(index)}><span className="text-sm font-black text-blue-800">补充汤面 {index + 1}</span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted">{surface.replace(/<[^>]*>/g, "")}</span></button>)}</div><button className="btn btn-secondary w-full" onClick={() => setSurfacePublishOpen(false)}>取消</button></div></Modal>}
      {publishOpen && snapshot.room.soup && <Modal onClose={() => setPublishOpen(false)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">选择要发布的汤底</h2><p className="mt-1 text-sm leading-6 text-muted">汤底可以按任意顺序发布。全部发布后本轮结束，并自动发布主持人手册。</p></div><div className="space-y-2">{[snapshot.room.soup.bottom ?? "", ...(snapshot.room.soup.supplementalBottoms ?? [])].map((bottom, index) => { const published = snapshot.room.soup?.publishedBottomIndices?.includes(index) ?? false; return <button key={index} className={`w-full rounded-xl border p-3 text-left transition ${published ? "border-slate-200 bg-slate-50 text-muted" : "border-amber-200 bg-amber-50 hover:border-amber-400"}`} disabled={published} onClick={() => void publishBottom(index)}><span className="text-sm font-black">{index === 0 ? "主汤底" : `补充汤底 ${index}`}{published ? " · 已发布" : ""}</span><span className="mt-1 block line-clamp-2 text-xs leading-5">{bottom.replace(/<[^>]*>/g, "")}</span></button>; })}</div><button className="btn btn-secondary w-full" onClick={() => setPublishOpen(false)}>取消</button></div></Modal>}
    </div>
  );
}

function MemberRow({ member, onOpenUser }: { member: OnlineSoupSnapshot["members"][number]; onOpenUser: (id: string) => void }) {
  return <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5"><button className="shrink-0 rounded-full transition active:scale-95" onClick={() => onOpenUser(member.id)} aria-label={`查看${member.nickname}的主页`}>{member.avatar ? <img className="h-9 w-9 rounded-full object-cover" src={member.avatar} alt="" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 font-black text-primary">{member.nickname.slice(0, 1)}</span>}</button><div className="flex min-w-0 flex-1 items-center gap-1.5"><span className="truncate font-bold text-ink">{member.nickname}</span><EquippedBadgeIcon badge={member.equippedBadge} className="h-4 w-4" /></div>{member.role === "host" && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700"><Crown size={12} /> 主持人</span>}{member.role === "spectator" && <span className="text-xs text-muted">旁观</span>}</div>;
}

function FloatingAction({ label, onClick, tone = "default" }: { label: string; onClick: () => void; tone?: "default" | "primary" | "amber" | "danger" }) {
  const tones = {
    default: "border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 text-slate-700 shadow-[0_9px_24px_rgba(51,65,85,0.18)] hover:border-slate-300",
    primary: "border-blue-200 bg-gradient-to-br from-white via-blue-50 to-blue-100 text-blue-700 shadow-[0_9px_24px_rgba(37,99,235,0.2)] hover:border-blue-300",
    amber: "border-amber-200 bg-gradient-to-br from-white via-amber-50 to-orange-100 text-amber-700 shadow-[0_9px_24px_rgba(217,119,6,0.2)] hover:border-amber-300",
    danger: "border-rose-200 bg-gradient-to-br from-white via-rose-50 to-red-100 text-rose-600 shadow-[0_9px_24px_rgba(225,29,72,0.18)] hover:border-rose-300"
  } as const;
  const characters = Array.from(label);
  let lines = [label];
  if (characters.length >= 4) {
    const semanticSplit = label.includes("海龟汤") || label.startsWith("发布") ? 2 : Math.ceil(characters.length / 2);
    lines = [characters.slice(0, semanticSplit).join(""), characters.slice(semanticSplit).join("")];
  }
  const icon = label === "开始游戏"
    ? <Play size={30} fill="currentColor" />
    : label.includes("更换")
      ? <RefreshCw size={30} />
      : label === "发布线索"
        ? <Lightbulb size={30} />
        : label.includes("汤底")
          ? <BookOpen size={30} />
          : label.includes("海龟汤") || label.includes("补充汤面")
            ? <Soup size={30} />
            : label.includes("关闭")
              ? <X size={30} />
              : null;
  return <button className={`group relative grid h-[58px] w-[58px] place-items-center overflow-hidden rounded-full border px-1 text-center text-[12px] font-black leading-[1.25] ring-1 ring-white/80 transition duration-200 hover:-translate-y-1 hover:scale-[1.03] active:translate-y-0 active:scale-95 ${tones[tone]}`} onClick={onClick} aria-label={label} title={label}><span className="pointer-events-none absolute inset-1 rounded-full border border-white/80" /><span className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.12] transition duration-200 group-hover:scale-110 group-hover:opacity-[0.18]">{icon}</span><span className="relative drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]">{lines.map((line) => <span className="block" key={line}>{line}</span>)}</span></button>;
}

const MessageItem = memo(function MessageItem({ message, isHost, onAnswer, soupId, stickers, onOpenSoup }: { message: OnlineSoupMessage; isHost: boolean; onAnswer: (message: OnlineSoupMessage, answer: OnlineSoupAnswer) => void; soupId: string | null; stickers: ReadonlyMap<string, StickerAsset>; onOpenSoup: (id: string) => void }) {
  if (message.type === "system") return <div className="py-1 text-center text-xs font-bold text-muted">— {message.content} —</div>;
  if (message.type === "clue") return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-amber-800"><Lightbulb size={16} /> 主持人线索</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{message.content}</p></div>;
  if (message.type === "supplemental_surface") return <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-blue-800"><Soup size={16} /> 补充汤面 {(message.contentIndex ?? 0) + 1}</div><div className="content-block mt-2 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} /></div>;
  if (message.type === "bottom") return <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-indigo-700"><Clapperboard size={17} /> {message.contentIndex === 0 ? "汤底已公布" : `补充汤底 ${message.contentIndex} 已公布`}</div><div className="content-block mt-2 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} />{soupId && <button className="btn btn-primary mt-3" onClick={() => onOpenSoup(soupId)}><Eye size={16} /> 查看完整汤底</button>}</div>;
  if (message.type === "manual") return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-violet-800"><BookOpen size={16} /> 主持人手册</div><div className="content-block mt-2 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} /></div>;
  const sticker = message.stickerId ? stickers.get(message.stickerId) : null;
  const question = message.type === "question";
  const host = message.type === "host" || message.senderIsHost;
  return <div className={`rounded-2xl border p-3 ${question ? "border-violet-200 bg-violet-50" : host ? "border-amber-200 bg-amber-50" : "border-line bg-white"}`}><div className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-muted">{message.senderAvatar ? <img className="h-6 w-6 shrink-0 rounded-full object-cover" src={message.senderAvatar} alt="" /> : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-[10px] font-black text-primary">{message.senderName?.slice(0, 1) ?? "?"}</span>}<span className="max-w-28 truncate text-ink">{message.senderName ?? "未知用户"}</span><EquippedBadgeIcon badge={message.senderEquippedBadge} className="h-4 w-4" />{host && <span className="inline-flex shrink-0 items-center gap-0.5 text-amber-700"><Crown size={13} /> 主持人</span>}{question && <span className="inline-flex shrink-0 items-center gap-0.5 text-violet-700"><MessageCircle size={13} /> 正式提问 #{message.questionNumber}</span>}<span className="ml-auto shrink-0">· {new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span></div>{message.type === "sticker" ? <div className="mt-2">{sticker ? <img className="h-28 w-28 object-contain sm:h-32 sm:w-32" src={sticker.animatedUrl} alt={sticker.text} loading="lazy" decoding="async" /> : <span className="inline-block rounded-xl bg-slate-100 px-3 py-2 text-sm text-muted">表情已下架</span>}</div> : <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{message.content}</p>}{question && <div className="mt-3">{isHost ? <div className="flex flex-wrap gap-1.5">{(Object.keys(answerLabels) as OnlineSoupAnswer[]).map((value) => <button key={value} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${message.answer === value ? "border-primary bg-primary text-white" : "border-violet-200 bg-white text-violet-700"}`} onClick={() => onAnswer(message, value)}>{message.answer === value && <Check size={12} className="mr-1 inline" />}{answerLabels[value]}</button>)}</div> : message.answer ? <span className="inline-flex items-center rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-bold text-white"><Check size={12} className="mr-1" />{answerLabels[message.answer]}</span> : <p className="text-xs font-bold text-violet-500">等待主持人回复</p>}</div>}</div>;
}, (previous, next) => (
  previous.message === next.message
  && previous.isHost === next.isHost
  && previous.soupId === next.soupId
  && previous.stickers === next.stickers
));
