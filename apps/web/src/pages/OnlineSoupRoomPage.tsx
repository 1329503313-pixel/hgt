import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, ArrowUp, Award, Bot, BookOpen, Check, ChevronDown, ChevronUp, Clapperboard, Crown, Eye, Lightbulb, ListChecks, LoaderCircle, LogOut, Menu, MessageCircle, MessageCircleQuestion, Minimize2, Play, Plus, RefreshCw, Reply, Send, Smile, Sparkles, Soup, Users, Wifi, WifiOff, X } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Modal } from "../components/Modal";
import { UnifiedBackButton } from "../components/UnifiedBackButton";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";
import { LevelBadge } from "../components/LevelBadge";
import { VipIdentity } from "../components/VipIdentity";
import { OnlineSoupInviteModal } from "../components/OnlineSoupInviteModal";
import { StickerKeyboard } from "../components/StickerKeyboard";
import { canRecallMessage, MessageActionMenu, RecalledMessageNotice } from "../components/MessageActionMenu";
import { useApp } from "../context/AppContext";
import { useOnlineSoupDock } from "../context/OnlineSoupDockContext";
import { sanitizeHtml } from "../sanitizeHtml";
import { connectOnlineSoupSocket } from "../shared/onlineSoupSocket";
import type { OnlineSoupAnswer, OnlineSoupMessage, OnlineSoupSnapshot, StickerAsset, StickerSeries } from "../shared/types";
import { GiftMessageBundle, GiftMessageCard } from "../components/GiftMessageCard";
import { ChatComposerIconButton } from "../components/ChatComposerIconButton";
import { MentionableAvatarButton } from "../components/MentionableAvatarButton";
import { isOnlineSoupAlreadyExited } from "../shared/onlineSoupExit";
import { giftTimelineEntries } from "../shared/giftTimeline";
import { onlineSoupAnswerPrefix } from "../shared/onlineSoupAnswerLabel";
import { copyTextToClipboard } from "../shared/clipboard";
import { OnlineSoupHonorCard } from "../components/OnlineSoupHonorCard";

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
  aiPreliminaryAnswer: OnlineSoupAnswer | null;
  aiStatus: OnlineSoupMessage["aiStatus"];
  aiError: string | null;
  aiProgressDelta: number | null;
  aiProgressAfter: number | null;
  aiFeedback: string | null;
  aiQueuePosition: number | null;
  sender: { id: string | null; nickname: string; avatar: string | null };
  createdAt: string;
};
type RoundClue = Pick<OnlineSoupMessage, "id" | "sequence" | "content" | "createdAt">;
type ProgressPage = { roundId: string | null; aiProgress: number | null; questions: ProgressQuestion[]; hasMore: boolean; nextCursor: string | null };
type CluePage = { roundId: string | null; clues: RoundClue[]; hasMore: boolean; nextCursor: string | null };
type MentionRequest = { userId: string; nickname: string; key: number };
type MaterialPublishTarget = {
  kind: "surface" | "bottom";
  index: number;
  title: string;
  content: string;
  endsRound: boolean;
  honors?: { mvpUserId: string; bestQuestionMessageId: string };
};
type HumanHonorSelection = {
  bottomIndex: number;
  step: "mvp" | "question";
  questions: ProgressQuestion[];
  mvpUserId: string;
  bestQuestionMessageId: string;
  submitting: boolean;
};
const structuralRoomEvents = new Set([
  "member_joined", "member_left", "member_kicked", "host_transferred", "soup_selected", "round_started",
  "supplemental_surface_published", "bottom_published", "round_ended", "host_mode_changed",
  "finish_vote_opened", "finish_vote_updated"
]);

function mergeMessages(older: OnlineSoupMessage[], newer: OnlineSoupMessage[]) {
  const byId = new Map(older.map((message) => [message.id, message]));
  for (const message of newer) byId.set(message.id, message);
  return refreshAiQueuePositions([...byId.values()].sort((left, right) => {
    const leftSequence = BigInt(left.sequence);
    const rightSequence = BigInt(right.sequence);
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
  }));
}

function refreshAiQueuePositions(messages: OnlineSoupMessage[]) {
  let position = 0;
  return messages.map((message) => {
    const active = !message.recalledAt && message.type === "question" && ["pending", "answering", "scoring"].includes(message.aiStatus);
    return { ...message, aiQueuePosition: active ? ++position : null };
  });
}

function refreshProgressQueuePositions(questions: ProgressQuestion[]) {
  let position = 0;
  return questions.map((question) => ({
    ...question,
    aiQueuePosition: ["pending", "answering", "scoring"].includes(question.aiStatus) ? ++position : null,
  }));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function activeMentionAt(content: string, cursor: number) {
  const beforeCursor = content.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;
  const query = beforeCursor.slice(atIndex + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: atIndex, end: cursor, query };
}

function onlineMessagePreview(message: OnlineSoupMessage | NonNullable<OnlineSoupMessage["replyTo"]>) {
  if (message.recalledAt) return "[消息已撤回]";
  if (message.type === "sticker") return "[表情]";
  return message.content.trim() || "[空消息]";
}

function OnlineMessageText({ message, currentUserId }: { message: OnlineSoupMessage; currentUserId: string }) {
  const selfMention = message.mentions.find((mention) => mention.userId === currentUserId);
  if (!selfMention) return <>{message.content}</>;
  const token = `@${selfMention.nickname}`;
  const parts = message.content.split(token);
  return <>{parts.map((part, index) => <span key={`${message.id}-${index}`}>{index > 0 && <span className="rounded bg-white/90 px-0.5 font-bold text-blue-600">{token}</span>}{part}</span>)}</>;
}

function OnlineReplyQuote({ reply, mine, onLocate }: {
  reply: NonNullable<OnlineSoupMessage["replyTo"]>;
  mine: boolean;
  onLocate: () => void;
}) {
  return <button type="button" className={`mb-2 block w-full truncate rounded-lg border-l-2 px-2.5 py-1.5 text-left text-xs ${mine ? "border-white/60 bg-white/15 text-white/85" : "border-blue-300 bg-slate-100/90 text-muted hover:bg-blue-50"}`} onClick={onLocate} title="点击定位到原消息"><span className={`mr-1 font-bold ${mine ? "text-white" : "text-primary"}`}>{reply.senderName ?? "已注销用户"}:</span>{onlineMessagePreview(reply)}</button>;
}

export default function OnlineSoupRoomPage() {
  const { roomId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite") ?? "";
  const requestedMessageId = searchParams.get("locateMessage") ?? "";
  const navigate = useNavigate();
  const location = useLocation();
  const inviteReturnToCandidate = (location.state as { onlineSoupInviteReturnTo?: string } | null)?.onlineSoupInviteReturnTo ?? "";
  const inviteReturnTo = inviteReturnToCandidate.startsWith("/circles/")
    || inviteReturnToCandidate.startsWith("/messages/chat/")
    ? inviteReturnToCandidate
    : "/online-soup";
  const { showToast, user, loadingUser, openAuth } = useApp();
  const { minimizeRoom, showFullRoom } = useOnlineSoupDock();
  const [snapshot, setSnapshot] = useState<OnlineSoupSnapshot | null>(null);
  const [requestingAiHint, setRequestingAiHint] = useState(false);
  const [submittingFinishVote, setSubmittingFinishVote] = useState(false);
  const [retryingAiMessageId, setRetryingAiMessageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [mode, setMode] = useState<"discussion" | "question">("discussion");
  const [content, setContent] = useState("");
  const [mentionedUsers, setMentionedUsers] = useState<Array<{ userId: string; nickname: string }>>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [mentionRequest, setMentionRequest] = useState<MentionRequest | null>(null);
  const [replyingTo, setReplyingTo] = useState<OnlineSoupMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [soupExpanded, setSoupExpanded] = useState(true);
  const [soupTab, setSoupTab] = useState<"surface" | "bottom" | "manual">("surface");
  const [hostPanelGroup, setHostPanelGroup] = useState<"materials" | "round">("materials");
  const [hostRoundTab, setHostRoundTab] = useState<"clues" | "progress">("clues");
  const [viewerPanelTab, setViewerPanelTab] = useState<"surface" | "clues" | "progress">("surface");
  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [clueOpen, setClueOpen] = useState(false);
  const [roundClues, setRoundClues] = useState<RoundClue[]>([]);
  const [cluesLoading, setCluesLoading] = useState(false);
  const [progressQuestions, setProgressQuestions] = useState<ProgressQuestion[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [surfacePublishOpen, setSurfacePublishOpen] = useState(false);
  const [clue, setClue] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [materialPublishTarget, setMaterialPublishTarget] = useState<MaterialPublishTarget | null>(null);
  const [materialPublishing, setMaterialPublishing] = useState(false);
  const [honorSelection, setHonorSelection] = useState<HumanHonorSelection | null>(null);
  const [preparingHonorBottomIndex, setPreparingHonorBottomIndex] = useState<number | null>(null);
  const [changingHostMode, setChangingHostMode] = useState(false);
  const [stickerSeries, setStickerSeries] = useState<StickerSeries[]>([]);
  const [stickersLoading, setStickersLoading] = useState(true);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [hostActionsOpen, setHostActionsOpen] = useState(true);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [showAssistantScrollToLatest, setShowAssistantScrollToLatest] = useState(false);
  const [showQuestionModeGuide, setShowQuestionModeGuide] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const [managedMemberId, setManagedMemberId] = useState<string | null>(null);
  const [memberManagementAction, setMemberManagementAction] = useState<"kick" | "transfer" | null>(null);
  const [memberManagementLoading, setMemberManagementLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"close" | "leave" | "end-round" | null>(null);
  const [exitChoiceOpen, setExitChoiceOpen] = useState(false);
  const [entryPasswordOpen, setEntryPasswordOpen] = useState(false);
  const [entryPassword, setEntryPassword] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const messageComposingRef = useRef(false);
  const assistantScrollRef = useRef<HTMLDivElement>(null);
  const assistantScrollBeforeUpdate = useRef<{
    tab: "clues" | "progress";
    roundId: string | null;
    identity: string | null;
    scrollTop: number;
    scrollHeight: number;
    nearTop: boolean;
  } | null>(null);
  const refreshPending = useRef(false);
  const refreshQueued = useRef(false);
  const incrementalPending = useRef(false);
  const incrementalQueued = useRef(false);
  const historyExpanded = useRef(false);
  const newestMessageId = useRef<string | null>(null);
  const isNearMessagesBottom = useRef(true);
  const snapshotRef = useRef<OnlineSoupSnapshot | null>(null);
  const entryStarted = useRef(false);
  const progressLoadedRoundId = useRef<string | null>(null);
  const progressPending = useRef(false);
  const progressQueued = useRef(false);
  const progressQuestionsRef = useRef<ProgressQuestion[]>([]);
  const cluesLoadedRoundId = useRef<string | null>(null);
  const cluesPending = useRef(false);
  const cluesQueued = useRef(false);
  const roundCluesRef = useRef<RoundClue[]>([]);
  const highlightTimerRef = useRef<number | null>(null);
  const locatedRequestRef = useRef("");
  const leavingRoomRef = useRef(false);
  const roomReadAbortRef = useRef(new AbortController());
  const stateRequestStarted = useRef(0);
  const stateRequestApplied = useRef(0);
  progressQuestionsRef.current = progressQuestions;
  roundCluesRef.current = roundClues;
  useEffect(() => { showFullRoom(roomId); }, [roomId, showFullRoom]);
  useEffect(() => () => {
    if (highlightTimerRef.current != null) window.clearTimeout(highlightTimerRef.current);
  }, []);
  const returnFromInvite = useCallback(() => {
    navigate(inviteReturnTo, { replace: true });
  }, [inviteReturnTo, navigate]);
  const updateMessagesScrollPosition = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
    isNearMessagesBottom.current = nearBottom;
    setShowScrollToLatest(!nearBottom);
  }, []);
  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = messagesRef.current;
    if (!container) return;
    isNearMessagesBottom.current = true;
    setShowScrollToLatest(false);
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);
  const updateAssistantScrollPosition = useCallback(() => {
    const container = assistantScrollRef.current;
    if (container?.scrollTop != null && container.scrollTop <= 48) {
      setShowAssistantScrollToLatest(false);
    }
  }, []);
  const scrollAssistantToLatest = useCallback(() => {
    setShowAssistantScrollToLatest(false);
    assistantScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (leavingRoomRef.current) return;
    if (refreshPending.current) {
      refreshQueued.current = true;
      return;
    }
    refreshPending.current = true;
    try {
      let quietPass = quiet;
      do {
        refreshQueued.current = false;
        try {
          const data = await api<OnlineSoupSnapshot>(`/api/online-soup/rooms/${roomId}`, { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal });
          if (leavingRoomRef.current) return;
          const isQuietPass = quietPass;
          setSnapshot((current) => {
            if (!isQuietPass || !current || !historyExpanded.current) return data;
            return {
              ...data,
              messages: mergeMessages(current.messages, data.messages),
              messagesHasMore: current.messagesHasMore,
              messagesNextCursor: current.messagesNextCursor
            };
          });
          if (data.room.status === "closed") { showToast("房间已关闭"); returnFromInvite(); }
        } catch (error) {
          if (leavingRoomRef.current || isAbortError(error)) return;
          if (!quietPass && error instanceof ApiError && error.code === "NOT_MEMBER") {
            try {
              const joined = await api<{ roomId: string; role: "player" | "spectator" }>(`/api/online-soup/rooms/${roomId}/join-auto`, {
                method: "POST",
                body: { inviteToken }
              });
              if (joined.role === "spectator") showToast("玩家席位已满，已作为旁观者进入");
              const data = await api<OnlineSoupSnapshot>(`/api/online-soup/rooms/${roomId}`, { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal });
              if (leavingRoomRef.current) return;
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
          } else if (!quietPass) {
            setEntryError(error instanceof ApiError && error.code === "ROOM_CLOSED" ? "房间不存在或已关闭" : null);
            showToast(error instanceof Error ? error.message : "房间加载失败");
          }
        }
        quietPass = true;
      } while (refreshQueued.current && !leavingRoomRef.current);
    } finally { refreshPending.current = false; setLoading(false); }
  }, [inviteToken, roomId, returnFromInvite, showToast]);

  useEffect(() => {
    if (loadingUser || entryStarted.current) return;
    entryStarted.current = true;
    if (!user) {
      sessionStorage.setItem("onlineSoupPendingInvite", JSON.stringify({ roomId, inviteToken }));
      const pendingInviteQuery = new URLSearchParams({ room: roomId });
      if (inviteToken) pendingInviteQuery.set("invite", inviteToken);
      navigate(`/online-soup?${pendingInviteQuery.toString()}`, { replace: true });
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
    if (leavingRoomRef.current) return;
    const requestId = ++stateRequestStarted.current;
    try {
      const data = await api<RoomState>(`/api/online-soup/rooms/${roomId}/state`, { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal });
      if (leavingRoomRef.current) return;
      if (requestId < stateRequestApplied.current) return;
      stateRequestApplied.current = requestId;
      setSnapshot((current) => current ? { ...current, ...data } : current);
      if (data.room.status === "closed") {
        navigate("/online-soup", { replace: true });
      }
    } catch (error) {
      if (leavingRoomRef.current || isAbortError(error)) return;
      if (requestId === stateRequestStarted.current) await load(true);
    }
  }, [load, navigate, roomId]);

  const loadNewMessages = useCallback(async () => {
    if (leavingRoomRef.current) return;
    if (incrementalPending.current) {
      incrementalQueued.current = true;
      return;
    }
    const current = snapshotRef.current;
    const lastSequence = current?.messages[current.messages.length - 1]?.sequence;
    if (!current || !lastSequence) {
      await load(true);
      return;
    }
    incrementalPending.current = true;
    try {
      let after = lastSequence;
      do {
        incrementalQueued.current = false;
        let hasMore = true;
        const incoming: OnlineSoupMessage[] = [];
        for (let pageNumber = 0; pageNumber < 10 && hasMore; pageNumber += 1) {
          const page = await api<MessagePage>(`/api/online-soup/rooms/${roomId}/messages?after=${encodeURIComponent(after)}&limit=100`, { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal });
          if (leavingRoomRef.current) return;
          incoming.push(...page.messages);
          hasMore = page.hasMore;
          if (!page.nextCursor) break;
          after = page.nextCursor;
        }
        if (incoming.length > 0) {
          after = incoming[incoming.length - 1].sequence;
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
        }
      } while (incrementalQueued.current);
    } catch (error) {
      if (leavingRoomRef.current || isAbortError(error)) return;
      await load(true);
    } finally {
      incrementalPending.current = false;
    }
  }, [load, roomId]);

  const loadProgress = useCallback(async (force = false) => {
    if (leavingRoomRef.current) return;
    const initialRoundId = snapshotRef.current?.room.currentRoundId;
    if (!initialRoundId) return;
    if (progressPending.current) {
      progressQueued.current = true;
      return;
    }
    if (!force && progressLoadedRoundId.current === initialRoundId) return;
    progressPending.current = true;
    const showInitialLoading = progressQuestionsRef.current.length === 0;
    if (showInitialLoading) setProgressLoading(true);
    try {
      do {
        progressQueued.current = false;
        const requestedRoundId = snapshotRef.current?.room.currentRoundId;
        if (!requestedRoundId) break;
        let after = "";
        let hasMore = true;
        let responseRoundId: string | null = requestedRoundId;
        let responseAiProgress: number | null = null;
        const questions: ProgressQuestion[] = [];
        while (hasMore) {
          const query = after ? `?after=${encodeURIComponent(after)}&limit=100` : "?limit=100";
          const page = await api<ProgressPage>(`/api/online-soup/rooms/${roomId}/progress${query}`, { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal });
          if (leavingRoomRef.current) return;
          responseRoundId = page.roundId;
          responseAiProgress = page.aiProgress;
          questions.push(...page.questions);
          hasMore = page.hasMore;
          if (!page.nextCursor) break;
          after = page.nextCursor;
        }
        const currentRoundId = snapshotRef.current?.room.currentRoundId;
        if (responseRoundId !== requestedRoundId) {
          void loadState();
          break;
        }
        if (progressQueued.current || currentRoundId !== requestedRoundId) {
          progressQueued.current = true;
          continue;
        }
        setProgressQuestions(questions);
        setSnapshot((current) => current ? { ...current, room: { ...current.room, aiProgress: responseAiProgress } } : current);
        progressLoadedRoundId.current = requestedRoundId;
      } while (progressQueued.current && !leavingRoomRef.current);
    } catch (error) {
      if (leavingRoomRef.current || isAbortError(error)) return;
      showToast(error instanceof Error ? error.message : "推理进度加载失败");
    } finally {
      progressPending.current = false;
      if (showInitialLoading) setProgressLoading(false);
    }
  }, [loadState, roomId, showToast]);

  const loadClues = useCallback(async (force = false) => {
    if (leavingRoomRef.current) return;
    const initialRoundId = snapshotRef.current?.room.currentRoundId;
    if (!initialRoundId) return;
    if (cluesPending.current) {
      cluesQueued.current = true;
      return;
    }
    if (!force && cluesLoadedRoundId.current === initialRoundId) return;
    cluesPending.current = true;
    const showInitialLoading = roundCluesRef.current.length === 0;
    if (showInitialLoading) setCluesLoading(true);
    try {
      do {
        cluesQueued.current = false;
        const requestedRoundId = snapshotRef.current?.room.currentRoundId;
        if (!requestedRoundId) break;
        let after = "";
        let hasMore = true;
        let responseRoundId: string | null = requestedRoundId;
        const clues: RoundClue[] = [];
        while (hasMore) {
          const query = after ? `?after=${encodeURIComponent(after)}&limit=100` : "?limit=100";
          const page = await api<CluePage>(`/api/online-soup/rooms/${roomId}/clues${query}`, { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal });
          if (leavingRoomRef.current) return;
          responseRoundId = page.roundId;
          clues.push(...page.clues);
          hasMore = page.hasMore;
          if (!page.nextCursor) break;
          after = page.nextCursor;
        }
        const currentRoundId = snapshotRef.current?.room.currentRoundId;
        if (responseRoundId !== requestedRoundId) {
          void loadState();
          break;
        }
        if (cluesQueued.current || currentRoundId !== requestedRoundId) {
          cluesQueued.current = true;
          continue;
        }
        setRoundClues(clues);
        cluesLoadedRoundId.current = requestedRoundId;
      } while (cluesQueued.current && !leavingRoomRef.current);
    } catch (error) {
      if (leavingRoomRef.current || isAbortError(error)) return;
      showToast(error instanceof Error ? error.message : "线索加载失败");
    } finally {
      cluesPending.current = false;
      if (showInitialLoading) setCluesLoading(false);
    }
  }, [loadState, roomId, showToast]);

  useEffect(() => connectOnlineSoupSocket(roomId, (reason, payload) => {
    if (leavingRoomRef.current) return;
    if (reason === "room_closed") {
      showToast("主持人已关闭房间");
      navigate("/online-soup", { replace: true });
      return;
    }
    if (reason === "member_kicked" && payload.userId === user?.id) {
      showToast("你已被主持人移出房间");
      navigate("/online-soup", { replace: true });
      return;
    }
    if (reason === "message" || reason === "clue") {
      if (reason === "message" && payload.activityType === "progress") void loadProgress(true);
      if (reason === "clue") void loadClues(true);
      void loadNewMessages();
      return;
    }
    if (reason === "message_recalled" && typeof payload.messageId === "string" && typeof payload.recalledAt === "string") {
      setSnapshot((current) => current ? {
        ...current,
        messages: refreshAiQueuePositions(current.messages.map((message) => {
          if (message.id === payload.messageId) return { ...message, content: "", stickerId: null, mentions: [], recalledAt: payload.recalledAt as string };
          const reply = message.replyTo;
          if (reply && reply.id === payload.messageId) {
            return { ...message, replyTo: { ...reply, content: "", stickerId: null, recalledAt: payload.recalledAt as string } };
          }
          return message;
        }))
      } : current);
      setReplyingTo((current) => current?.id === payload.messageId ? null : current);
      setProgressQuestions((current) => refreshProgressQueuePositions(current.filter((question) => question.id !== payload.messageId)));
      return;
    }
    if (reason === "answer_changed" && typeof payload.messageId === "string") {
      const nextAnswer = typeof payload.answer === "string" ? payload.answer as OnlineSoupAnswer : null;
      const nextAiStatus = typeof payload.aiStatus === "string"
        ? payload.aiStatus as OnlineSoupMessage["aiStatus"]
        : undefined;
      const nextAiError = typeof payload.aiError === "string" ? payload.aiError : null;
      const nextAiProgress = typeof payload.aiProgress === "number" ? payload.aiProgress : null;
      const nextAiProgressDelta = typeof payload.aiProgressDelta === "number" ? payload.aiProgressDelta : null;
      const nextAiProgressAfter = typeof payload.aiProgressAfter === "number" ? payload.aiProgressAfter : null;
      const nextAiFeedback = typeof payload.aiFeedback === "string" ? payload.aiFeedback : null;
      setSnapshot((current) => current ? {
        ...current,
        room: nextAiProgress === null ? current.room : { ...current.room, aiProgress: nextAiProgress },
        messages: refreshAiQueuePositions(current.messages.map((message) => message.id === payload.messageId ? {
          ...message,
          answer: nextAnswer,
          aiPreliminaryAnswer: null,
          aiStatus: nextAiStatus ?? message.aiStatus,
          aiError: nextAiStatus ? nextAiError : message.aiError,
          aiProgressDelta: nextAiStatus ? nextAiProgressDelta : message.aiProgressDelta,
          aiProgressAfter: nextAiStatus ? nextAiProgressAfter : message.aiProgressAfter,
          aiFeedback: nextAiStatus
            ? nextAiStatus === "completed" ? nextAiFeedback : message.aiFeedback
            : message.aiFeedback
        } : message))
      } : current);
      setProgressQuestions((current) => refreshProgressQueuePositions(current.map((question) => question.id === payload.messageId ? {
        ...question,
        answer: nextAnswer,
        aiPreliminaryAnswer: null,
        aiStatus: nextAiStatus ?? question.aiStatus,
        aiError: nextAiStatus ? nextAiError : question.aiError,
        aiProgressDelta: nextAiStatus ? nextAiProgressDelta : question.aiProgressDelta,
        aiProgressAfter: nextAiStatus ? nextAiProgressAfter : question.aiProgressAfter,
        aiFeedback: nextAiStatus
          ? nextAiStatus === "completed" ? nextAiFeedback : question.aiFeedback
          : question.aiFeedback
      } : question)));
      if (payload.activityType === "progress") void loadProgress(true);
      if (payload.notificationCreated) void loadNewMessages();
      return;
    }
    if (structuralRoomEvents.has(reason)) {
      void Promise.all([loadState(), loadNewMessages()]);
      return;
    }
    void load(true);
  }, (connected) => {
    if (leavingRoomRef.current) return;
    setSocketConnected(connected);
    if (connected) void load(true);
  }), [roomId, load, loadClues, loadNewMessages, loadProgress, loadState, navigate, showToast, user?.id]);
  useEffect(() => {
    const reconcile = () => {
      if (leavingRoomRef.current || document.visibilityState !== "visible") return;
      if (socketConnected) void loadNewMessages();
      else void load(true);
      if (snapshotRef.current?.room.currentRoundId) {
        void loadClues(true);
        void loadProgress(true);
      }
    };
    const timer = window.setInterval(reconcile, 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load, loadClues, loadNewMessages, loadProgress, socketConnected]);
  const latestMessageId = snapshot?.messages[snapshot.messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!latestMessageId || latestMessageId === newestMessageId.current) return;
    const isInitialLoad = newestMessageId.current == null;
    newestMessageId.current = latestMessageId;
    if (isInitialLoad || isNearMessagesBottom.current) {
      scrollToLatestMessage(isInitialLoad ? "auto" : "smooth");
    } else {
      setShowScrollToLatest(true);
    }
  }, [latestMessageId, scrollToLatestMessage]);
  useEffect(() => {
    const hostViewingProgress = snapshot?.me.isHost && hostPanelGroup === "round" && hostRoundTab === "progress";
    const viewerViewingProgress = !snapshot?.me.isHost && viewerPanelTab === "progress";
    if (soupExpanded && (hostViewingProgress || viewerViewingProgress)) void loadProgress();
  }, [hostPanelGroup, hostRoundTab, latestMessageId, loadProgress, snapshot?.me.isHost, snapshot?.room.currentRoundId, soupExpanded, viewerPanelTab]);
  useEffect(() => {
    const roundId = snapshot?.room.currentRoundId ?? null;
    setRoundClues([]);
    setProgressQuestions([]);
    cluesLoadedRoundId.current = null;
    progressLoadedRoundId.current = null;
    if (cluesPending.current) cluesQueued.current = true;
    if (progressPending.current) progressQueued.current = true;
    if (roundId) {
      void loadClues();
      void loadProgress();
    }
  }, [loadClues, loadProgress, snapshot?.room.currentRoundId]);
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
  const mysteryMode = snapshot?.room.contentType === "mystery";
  const aiHosted = snapshot?.room.hostMode === "ai";
  const canHumanHost = isHost && !aiHosted && !mysteryMode;
  const canDiscuss = snapshot && snapshot.me.role !== "spectator" && snapshot.room.status !== "closed";
  const canQuestion = Boolean(snapshot && snapshot.room.status === "playing" && (mysteryMode ? isHost : snapshot.me.role === "player"));
  const activeMention = activeMentionAt(content, cursorPosition);
  const mentionCandidates = activeMention && snapshot
    ? snapshot.members
      .filter((member) => member.id !== user?.id)
      .filter((member) => member.nickname.toLocaleLowerCase("zh-CN").includes(activeMention.query.toLocaleLowerCase("zh-CN")))
      .slice(0, 5)
    : [];
  const allStickers = useMemo(() => stickerSeries.flatMap((series) => series.stickers), [stickerSeries]);
  const stickersById = useMemo(() => new Map(allStickers.map((sticker) => [sticker.id, sticker])), [allStickers]);
  useEffect(() => {
    if (!canQuestion && mode === "question") setMode("discussion");
  }, [canQuestion, mode]);
  useEffect(() => {
    setShowQuestionModeGuide(mysteryMode ? isHost : snapshot?.me.role === "player");
  }, [isHost, mysteryMode, roomId, snapshot?.me.role]);
  useEffect(() => {
    setHostPanelGroup("materials");
    setSoupTab("surface");
    setHostRoundTab("clues");
  }, [snapshot?.room.currentRoundId, snapshot?.room.mystery?.id, snapshot?.room.soup?.id]);

  useEffect(() => {
    if (!mentionRequest) return;
    const token = `@${mentionRequest.nickname}`;
    setContent((current) => {
      if (current.includes(token)) return current;
      const spacer = current && !/\s$/.test(current) ? " " : "";
      return `${current}${spacer}${token} `.slice(0, 1000);
    });
    setMentionedUsers((current) => current.some((mention) => mention.userId === mentionRequest.userId)
      ? current
      : [...current, { userId: mentionRequest.userId, nickname: mentionRequest.nickname }]);
    window.requestAnimationFrame(() => {
      const nextCursor = messageInputRef.current?.value.length ?? 0;
      setCursorPosition(nextCursor);
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [mentionRequest?.key]);

  useEffect(() => {
    if (!replyingTo) return;
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  }, [replyingTo?.id]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let settleTimer: number | null = null;
    const keepLatestVisible = () => {
      if (document.activeElement !== messageInputRef.current || messageComposingRef.current) return;
      if (settleTimer != null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        if (document.activeElement !== messageInputRef.current || messageComposingRef.current) return;
        scrollToLatestMessage("auto");
      }, 120);
    };
    viewport.addEventListener("resize", keepLatestVisible);
    return () => {
      if (settleTimer != null) window.clearTimeout(settleTimer);
      viewport.removeEventListener("resize", keepLatestVisible);
    };
  }, [scrollToLatestMessage]);

  function requestMention(userId: string, nickname: string) {
    if (userId === user?.id || !canDiscuss) return;
    setStickersOpen(false);
    setMentionRequest({ userId, nickname, key: Date.now() });
  }

  function chooseMention(member: OnlineSoupSnapshot["members"][number]) {
    if (!activeMention) return;
    const before = content.slice(0, activeMention.start);
    const after = content.slice(activeMention.end);
    const inserted = `@${member.nickname} `;
    const next = `${before}${inserted}${after}`.slice(0, 1000);
    const nextCursor = Math.min(before.length + inserted.length, next.length);
    setContent(next);
    setCursorPosition(nextCursor);
    setMentionedUsers((current) => current.some((mention) => mention.userId === member.id)
      ? current
      : [...current, { userId: member.id, nickname: member.nickname }]);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function sendMessage() {
    const text = content.trim();
    if (!text || sending) return;
    const activeMentionIds = mentionedUsers.filter((mention) => text.includes(`@${mention.nickname}`)).map((mention) => mention.userId);
    setSending(true);
    try {
      await api(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: mode, content: text, mentionedUserIds: activeMentionIds, replyToMessageId: replyingTo?.id } });
      setContent("");
      setMentionedUsers([]);
      setReplyingTo(null);
      isNearMessagesBottom.current = true;
      setShowScrollToLatest(false);
      if (mode === "question" && !mysteryMode) await Promise.all([loadNewMessages(), loadProgress(true)]);
      else await loadNewMessages();
    } catch (error) { showToast(error instanceof Error ? error.message : "发送失败"); }
    finally { setSending(false); }
  }

  async function loadOlderMessages() {
    if (leavingRoomRef.current || !snapshot?.messagesHasMore || !snapshot.messagesNextCursor || loadingOlder) return;
    const container = messagesRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const page = await api<MessagePage>(`/api/online-soup/rooms/${roomId}/messages?before=${encodeURIComponent(snapshot.messagesNextCursor)}&limit=100`, { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal });
      if (leavingRoomRef.current) return;
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
      if (leavingRoomRef.current || isAbortError(error)) return;
      showToast(error instanceof Error ? error.message : "历史消息加载失败");
    } finally {
      setLoadingOlder(false);
    }
  }

  const locateRoomMessage = useCallback(async (messageId: string) => {
    if (leavingRoomRef.current) return false;
    const initial = snapshotRef.current;
    if (!initial) return false;
    let loadedMessages = initial.messages;
    let cursor = initial.messagesNextCursor;
    let hasMore = initial.messagesHasMore;
    try {
      while (!loadedMessages.some((message) => message.id === messageId) && hasMore && cursor) {
        const page = await api<MessagePage>(
          `/api/online-soup/rooms/${roomId}/messages?before=${encodeURIComponent(cursor)}&limit=100`,
          { bypassCache: true, dedupe: false, signal: roomReadAbortRef.current.signal }
        );
        if (leavingRoomRef.current) return false;
        loadedMessages = mergeMessages(page.messages, loadedMessages);
        cursor = page.nextCursor;
        hasMore = page.hasMore;
      }
      if (!loadedMessages.some((message) => message.id === messageId)) {
        showToast("未找到被变更回答的提问");
        return false;
      }
      historyExpanded.current = true;
      setSnapshot((current) => current ? {
        ...current,
        messages: mergeMessages(loadedMessages, current.messages),
        messagesHasMore: hasMore,
        messagesNextCursor: cursor
      } : current);
      isNearMessagesBottom.current = false;
      setShowScrollToLatest(true);
      if (highlightTimerRef.current != null) window.clearTimeout(highlightTimerRef.current);
      setHighlightedMessageId(messageId);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const container = messagesRef.current;
        const target = document.getElementById(`online-soup-message-${messageId}`);
        if (!container || !target) return;
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const centeredTop = container.scrollTop
          + targetRect.top - containerRect.top
          - Math.max(0, (container.clientHeight - targetRect.height) / 2);
        container.scrollTo({ top: centeredTop, behavior: "smooth" });
      }));
      highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(""), 1800);
      return true;
    } catch (error) {
      if (leavingRoomRef.current || isAbortError(error)) return false;
      showToast(error instanceof Error ? error.message : "定位提问失败");
      return false;
    }
  }, [roomId, showToast]);

  useEffect(() => {
    if (!snapshot || !requestedMessageId || locatedRequestRef.current === requestedMessageId) return;
    locatedRequestRef.current = requestedMessageId;
    void locateRoomMessage(requestedMessageId);
  }, [locateRoomMessage, requestedMessageId, snapshot]);

  async function sendSticker(sticker: StickerAsset) {
    if (sending) return;
    setSending(true);
    try {
      setStickersOpen(false);
      await api(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: "sticker", stickerId: sticker.id, replyToMessageId: replyingTo?.id } });
      setReplyingTo(null);
      isNearMessagesBottom.current = true;
      setShowScrollToLatest(false);
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
      setProgressQuestions((current) => current.map((question) => question.id === message.id ? { ...question, answer: nextAnswer } : question));
    } catch (error) { showToast(error instanceof Error ? error.message : "回答失败"); }
  }

  async function recallMessage(message: OnlineSoupMessage) {
    try {
      const result = await api<{ messageId: string; recalledAt: string }>(
        `/api/online-soup/rooms/${roomId}/messages/${message.id}/recall`,
        { method: "PATCH" }
      );
      setSnapshot((current) => current ? {
        ...current,
        messages: current.messages.map((item) => item.id === result.messageId
          ? { ...item, content: "", stickerId: null, mentions: [], recalledAt: result.recalledAt }
          : item.replyTo?.id === result.messageId
            ? { ...item, replyTo: { ...item.replyTo, content: "", stickerId: null, recalledAt: result.recalledAt } }
            : item)
      } : current);
      setReplyingTo((current) => current?.id === result.messageId ? null : current);
      setProgressQuestions((current) => current.filter((question) => question.id !== result.messageId));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "撤回失败");
    }
  }

  async function hostAction(path: string, body?: object) {
    try {
      await api(`/api/online-soup/rooms/${roomId}/${path}`, { method: "POST", body });
      if (path === "close") return;
      if (path === "clues") await Promise.all([loadNewMessages(), loadClues(true)]);
      else await Promise.all([loadState(), loadNewMessages()]);
    }
    catch (error) { showToast(error instanceof Error ? error.message : "操作失败"); throw error; }
  }

  async function publishClue() {
    if (!clue.trim()) return;
    try { await hostAction("clues", { content: clue }); setClue(""); setClueOpen(false); } catch { /* toast above */ }
  }

  async function publishSurface(surfaceIndex: number) {
    try {
      await hostAction("publish-surface", { surfaceIndex });
      setSurfacePublishOpen(false);
      return true;
    } catch { return false; }
  }

  async function publishBottom(bottomIndex: number, honors?: { mvpUserId: string; bestQuestionMessageId: string }) {
    try {
      await hostAction("publish-bottom", { bottomIndex, ...honors });
      setPublishOpen(false);
      setHonorSelection(null);
      return true;
    } catch { return false; }
  }

  async function confirmMaterialPublish() {
    if (!materialPublishTarget || materialPublishing) return;
    setMaterialPublishing(true);
    try {
      const published = materialPublishTarget.kind === "surface"
        ? await publishSurface(materialPublishTarget.index)
        : await publishBottom(materialPublishTarget.index, materialPublishTarget.honors);
      if (published) {
        if (materialPublishTarget.endsRound) showToast("汤底、主持人手册和本轮高光已发布");
        setMaterialPublishTarget(null);
      }
    } finally {
      setMaterialPublishing(false);
    }
  }

  async function prepareBottomPublish(bottomIndex: number) {
    const soup = snapshot?.room.soup;
    if (!soup || preparingHonorBottomIndex != null) return;
    const bottomsCount = 1 + (soup.supplementalBottoms?.length ?? 0);
    const published = new Set(soup.publishedBottomIndices ?? []);
    const publishesLastBottom = !published.has(bottomIndex) && published.size + 1 === bottomsCount;
    if (!publishesLastBottom) {
      const content = bottomIndex === 0 ? soup.bottom ?? "" : soup.supplementalBottoms?.[bottomIndex - 1] ?? "";
      setMaterialPublishTarget({
        kind: "bottom",
        index: bottomIndex,
        title: bottomIndex === 0 ? "主汤底" : `补充汤底 ${bottomIndex}`,
        content,
        endsRound: false,
      });
      return;
    }

    setPreparingHonorBottomIndex(bottomIndex);
    try {
      let after = "";
      let hasMore = true;
      const questions: ProgressQuestion[] = [];
      const expectedRoundId = snapshot.room.currentRoundId;
      while (hasMore) {
        const query = after ? `?after=${encodeURIComponent(after)}&limit=100` : "?limit=100";
        const page = await api<ProgressPage>(`/api/online-soup/rooms/${roomId}/progress${query}`, { bypassCache: true, dedupe: false });
        if (page.roundId !== expectedRoundId) throw new Error("本轮状态已变化，请重新选择汤底");
        questions.push(...page.questions);
        hasMore = page.hasMore;
        if (!page.nextCursor) break;
        after = page.nextCursor;
      }
      const questionerIds = new Set(questions.map((question) => question.sender.id).filter(Boolean));
      if (questionerIds.size === 0) {
        showToast("本轮暂无提问玩家，无法进行 MVP 结算");
        return;
      }
      if (!questions.some((question) => question.answer)) {
        showToast("本轮暂无已回答提问，请先完成至少一次回答");
        return;
      }
      setProgressQuestions(questions);
      progressLoadedRoundId.current = expectedRoundId;
      setPublishOpen(false);
      setHonorSelection({
        bottomIndex,
        step: "mvp",
        questions,
        mvpUserId: "",
        bestQuestionMessageId: "",
        submitting: false,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "评选候选加载失败");
    } finally {
      setPreparingHonorBottomIndex(null);
    }
  }

  async function confirmHumanHonors() {
    if (!honorSelection) return;
    if (honorSelection.step === "mvp") {
      if (!honorSelection.mvpUserId) return showToast("请选择本场 MVP");
      setHonorSelection((current) => current ? { ...current, step: "question" } : current);
      return;
    }
    if (!honorSelection.bestQuestionMessageId || honorSelection.submitting) return showToast("请选择本场最佳提问");
    const soup = snapshot?.room.soup;
    if (!soup) return showToast("当前海龟汤状态已变化，请重新操作");
    const bottomIndex = honorSelection.bottomIndex;
    const bottomContent = bottomIndex === 0 ? soup.bottom ?? "" : soup.supplementalBottoms?.[bottomIndex - 1] ?? "";
    setMaterialPublishTarget({
      kind: "bottom",
      index: bottomIndex,
      title: bottomIndex === 0 ? "主汤底" : `补充汤底 ${bottomIndex}`,
      content: bottomContent,
      endsRound: true,
      honors: {
        mvpUserId: honorSelection.mvpUserId,
        bestQuestionMessageId: honorSelection.bestQuestionMessageId,
      },
    });
  }

  function openSoupSelector() {
    navigate(`/online-soup/rooms/${roomId}/select-soup`);
  }

  function openMemberProfile(userId: string) {
    const member = snapshot?.members.find((item) => item.id === userId);
    if (isHost && userId !== user?.id && member) {
      setMembersOpen(false);
      setManagedMemberId(userId);
      setMemberManagementAction(null);
      return;
    }
    navigate(`/users/${userId}`, { state: { onlineSoupRoomId: roomId, onlineSoupMember: true } });
  }

  async function manageMember(action: "kick" | "transfer") {
    if (!managedMemberId || memberManagementLoading) return;
    setMemberManagementLoading(true);
    try {
      await api(`/api/online-soup/rooms/${roomId}/members/${managedMemberId}/${action === "kick" ? "kick" : "transfer-host"}`, { method: "POST" });
      setManagedMemberId(null);
      setMemberManagementAction(null);
      showToast(action === "kick" ? "已将该用户踢出房间" : "房主已转让");
      await Promise.all([loadState(), loadNewMessages()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "成员管理操作失败");
    } finally {
      setMemberManagementLoading(false);
    }
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
    if (leavingRoomRef.current) return;
    leavingRoomRef.current = true;
    roomReadAbortRef.current.abort();
    try {
      const result = await api<{ roomClosed?: boolean; hostTransferred?: boolean }>(`/api/online-soup/rooms/${roomId}/leave`, { method: "POST" });
      if (snapshot?.me.isHost) showToast(result.roomClosed ? "已退出并解散空房间" : "已退出房间，房主已转移");
      else showToast("已退出房间");
    } catch (error) {
      if (isOnlineSoupAlreadyExited(error)) {
        setConfirmAction(null);
        showToast("已退出房间");
        returnFromInvite();
        return;
      }
      leavingRoomRef.current = false;
      roomReadAbortRef.current = new AbortController();
      showToast(error instanceof Error ? error.message : "退出房间失败");
      return;
    }
    returnFromInvite();
  }

  function minimizeCurrentRoom() {
    if (!snapshot) return;
    minimizeRoom(snapshot);
    setExitChoiceOpen(false);
    navigate("/online-soup");
  }

  function requestRoomExit() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setExitChoiceOpen(true);
      return;
    }
    setConfirmAction("leave");
  }

  async function closeRoom() {
    try { await hostAction("close"); navigate("/online-soup", { replace: true }); } catch { /* toast above */ }
  }

  async function endRound() {
    try {
      await hostAction("end-round");
      setConfirmAction(null);
      showToast("本轮推理已关闭");
    } catch { /* toast above */ }
  }

  async function changeHostMode(hostMode: "human" | "ai") {
    if (changingHostMode || !snapshot || snapshot.room.hostMode === hostMode) return;
    setChangingHostMode(true);
    try {
      const result = await api<{ soupCleared?: boolean }>(`/api/online-soup/rooms/${roomId}/host-mode`, { method: "PATCH", body: { hostMode } });
      showToast(result.soupCleared
        ? (hostMode === "ai" ? "已切换为 AI 主持，原海龟汤不支持 AI 玩汤，已取消选择" : "已切换为真人主持，尚未获得原海龟汤汤底，已取消选择")
        : hostMode === "ai" ? "已切换为 AI 主持" : "已切换为真人主持");
      await load(true);
    } catch (error) { showToast(error instanceof Error ? error.message : "主持方式更改失败"); }
    finally { setChangingHostMode(false); }
  }

  async function requestAiHint() {
    if (requestingAiHint || !snapshot || snapshot.room.status !== "playing") return;
    setRequestingAiHint(true);
    try {
      const result = await api<{ hint: string; aiProgress: number }>(`/api/online-soup/rooms/${roomId}/ai-hint`, { method: "POST" });
      setSnapshot((current) => current ? { ...current, room: { ...current.room, aiProgress: result.aiProgress } } : current);
      showToast("AI 提示已发布到线索中");
      await Promise.all([loadClues(true), loadNewMessages()]);
    } catch { /* api 已统一提示 */ } finally {
      setRequestingAiHint(false);
    }
  }

  async function submitFinishVote(choice: "view_bottom" | "continue") {
    if (submittingFinishVote) return;
    setSubmittingFinishVote(true);
    try {
      const result = await api<{ ended: boolean }>(`/api/online-soup/rooms/${roomId}/finish-vote`, {
        method: "POST",
        body: { choice },
      });
      showToast(result.ended ? "已达到查看汤底门槛，本轮结束" : choice === "view_bottom" ? "已选择查看汤底" : "已选择继续游戏");
      await Promise.all([loadState(), loadNewMessages()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "投票失败");
    } finally {
      setSubmittingFinishVote(false);
    }
  }

  async function retryAiQuestion(message: Pick<OnlineSoupMessage, "id">) {
    if (retryingAiMessageId) return;
    setRetryingAiMessageId(message.id);
    try {
      await api(`/api/online-soup/rooms/${roomId}/questions/${message.id}/retry-ai`, { method: "POST" });
      setSnapshot((current) => current ? {
        ...current,
        messages: refreshAiQueuePositions(current.messages.map((item) => item.id === message.id
          ? { ...item, answer: null, aiPreliminaryAnswer: null, aiStatus: "pending", aiError: null }
          : item)),
      } : current);
      setProgressQuestions((current) => refreshProgressQueuePositions(current.map((item) => item.id === message.id
        ? { ...item, answer: null, aiPreliminaryAnswer: null, aiStatus: "pending", aiError: null }
        : item)));
      showToast("已重新提交给 AI 主持人");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "重试失败");
    } finally {
      setRetryingAiMessageId("");
    }
  }

  const groupedMembers = useMemo(() => ({
    host: snapshot?.members.find((member) => member.role === "host"),
    players: snapshot?.members.filter((member) => member.role === "player") ?? [],
    spectators: snapshot?.members.filter((member) => member.role === "spectator") ?? []
  }), [snapshot?.members]);
  const honorMvpCandidates = useMemo(() => {
    const byId = new Map<string, ProgressQuestion["sender"] & { id: string }>();
    for (const question of honorSelection?.questions ?? []) {
      if (question.sender.id && !byId.has(question.sender.id)) byId.set(question.sender.id, { ...question.sender, id: question.sender.id });
    }
    return [...byId.values()];
  }, [honorSelection?.questions]);
  const managedMember = snapshot?.members.find((member) => member.id === managedMemberId) ?? null;
  const unpublishedSurfaces = (snapshot?.room.soup?.supplementalSurfaces ?? [])
    .map((content, index) => ({ content, index }))
    .filter(({ index }) => !snapshot?.room.soup?.publishedSurfaceIndices?.includes(index));
  const visibleProgressQuestions = snapshot?.messages.filter((message) => message.type === "question" && message.roundId === snapshot.room.currentRoundId) ?? [];
  const newestFirstClueMessages = [...roundClues].reverse();
  const newestFirstProgressQuestions = [...progressQuestions].reverse();
  const unansweredProgressCount = (progressLoadedRoundId.current === snapshot?.room.currentRoundId
    ? progressQuestions
    : visibleProgressQuestions
  ).filter((question) => !question.answer).length;
  const assistantPanelTab = isHost
    ? hostPanelGroup === "round" ? hostRoundTab : null
    : viewerPanelTab === "surface" ? null : viewerPanelTab;
  const assistantListIdentity = assistantPanelTab === "clues"
    ? newestFirstClueMessages[0]?.id ?? null
    : assistantPanelTab === "progress" ? newestFirstProgressQuestions[0]?.id ?? null : null;
  const assistantRoundId = snapshot?.room.currentRoundId ?? null;
  useLayoutEffect(() => {
    const container = assistantScrollRef.current;
    const previous = assistantScrollBeforeUpdate.current;
    if (!soupExpanded || !assistantPanelTab || !container) {
      setShowAssistantScrollToLatest(false);
      assistantScrollBeforeUpdate.current = null;
      return;
    }

    const sameList = previous?.tab === assistantPanelTab && previous.roundId === assistantRoundId;
    const receivedNewItem = sameList && previous.identity !== assistantListIdentity && previous.identity !== null;
    if (receivedNewItem && previous) {
      if (previous.nearTop) {
        container.scrollTop = 0;
      } else {
        container.scrollTop = previous.scrollTop + Math.max(0, container.scrollHeight - previous.scrollHeight);
        setShowAssistantScrollToLatest(true);
      }
    } else if (!sameList) {
      container.scrollTop = 0;
      setShowAssistantScrollToLatest(false);
    }
    assistantScrollBeforeUpdate.current = null;

    return () => {
      const current = assistantScrollRef.current;
      if (!current) return;
      assistantScrollBeforeUpdate.current = {
        tab: assistantPanelTab,
        roundId: assistantRoundId,
        identity: assistantListIdentity,
        scrollTop: current.scrollTop,
        scrollHeight: current.scrollHeight,
        nearTop: current.scrollTop <= 48
      };
    };
  }, [assistantListIdentity, assistantPanelTab, assistantRoundId, soupExpanded]);

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

  const renderHostActions = (mobile = false) => <>
    {snapshot.room.status === "preparing" && !snapshot.room.soup && !snapshot.room.mystery && <FloatingAction tone="primary" label="选择内容" onClick={() => { if (mobile) setHostActionsOpen(false); openSoupSelector(); }} />}
    {snapshot.room.status !== "playing" && (snapshot.room.soup || snapshot.room.mystery) && <FloatingAction tone="primary" label="开始游戏" onClick={() => { if (mobile) setHostActionsOpen(false); void hostAction("start"); }} />}
    {snapshot.room.status === "preparing" && (snapshot.room.soup || snapshot.room.mystery) && <FloatingAction label={mysteryMode ? "更换谜局" : "更换海龟汤"} onClick={() => { if (mobile) setHostActionsOpen(false); openSoupSelector(); }} />}
    {snapshot.room.status === "playing" && <>
      {canHumanHost && <>
        <FloatingAction tone="amber" label="发布线索" onClick={() => { if (mobile) setHostActionsOpen(false); setClueOpen(true); }} />
        {unpublishedSurfaces.length > 0 && <FloatingAction tone="primary" label="发布补充汤面" onClick={() => { if (mobile) setHostActionsOpen(false); setSurfacePublishOpen(true); }} />}
        <FloatingAction tone="primary" label="发布汤底" onClick={() => { if (mobile) setHostActionsOpen(false); setPublishOpen(true); }} />
      </>}
      {!mysteryMode && <FloatingAction tone="amber" label="关闭本轮" onClick={() => { if (mobile) setHostActionsOpen(false); setConfirmAction("end-round"); }} />}
    </>}
    {!mysteryMode && snapshot.room.status !== "playing" && aiHosted && <FloatingAction label="真人主持" onClick={() => { if (mobile) setHostActionsOpen(false); void changeHostMode("human"); }} />}
    {!mysteryMode && snapshot.room.status !== "playing" && !aiHosted && snapshot.room.soup?.enableAiGame && <FloatingAction label="AI主持" onClick={() => { if (mobile) setHostActionsOpen(false); void changeHostMode("ai"); }} />}
    {snapshot.room.status === "ended" && <FloatingAction tone="primary" label={mysteryMode ? "更换谜局" : "更换海龟汤"} onClick={() => { if (mobile) setHostActionsOpen(false); openSoupSelector(); }} />}
    <FloatingAction tone="danger" label="关闭房间" onClick={() => { if (mobile) setHostActionsOpen(false); setConfirmAction("close"); }} />
  </>;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-page">
      <header className="top-nav-shell online-soup-room-header">
        <div className="mx-auto flex max-w-[1492px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <UnifiedBackButton compactOnMobile onClick={requestRoomExit} />
            <div className="min-w-0 flex-1"><h1 className="truncate font-black text-ink">{snapshot.room.name}</h1><p className="flex items-center gap-1 truncate text-xs text-muted">房间号 {snapshot.room.code} · {statusLabels[snapshot.room.status]} · {mysteryMode ? <><BookOpen size={12} />谜局</> : aiHosted ? <><Bot size={12} />AI 主持</> : <><Crown size={12} />真人主持</>}</p></div>
            <span className="shrink-0" title={socketConnected ? "实时连接正常" : "正在重新连接"}>{socketConnected ? <Wifi size={18} className="text-emerald-600" /> : <WifiOff size={18} className="text-red-500" />}</span>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3 lg:max-xl:w-full">
            <button className="btn btn-secondary !hidden h-10 px-3 text-xs lg:!inline-flex" onClick={minimizeCurrentRoom}><Minimize2 size={16} />收起房间</button>
            <button className="btn !hidden h-10 bg-red-50 px-3 text-xs text-red-600 hover:bg-red-100 lg:!inline-flex" onClick={() => setExitChoiceOpen(true)}><LogOut size={16} />退出</button>
            <button className="btn btn-secondary h-10 w-10 p-0" onClick={() => setMembersOpen(true)} aria-label={`房间成员，共 ${snapshot.members.length} 人`} title={`房间成员 · ${snapshot.members.length} 人`}>
              <span className="relative grid h-7 w-7 place-items-center">
                <Users size={19} />
                <span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-black leading-4 text-white ring-2 ring-white">{snapshot.members.length}</span>
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className={`online-soup-room-workspace mx-auto grid min-h-0 w-full flex-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 overflow-hidden px-4 pb-3 pt-3 lg:grid-rows-1 lg:gap-4 lg:px-6 lg:pb-5 lg:pt-5 ${isHost ? "max-w-[1480px] lg:grid-cols-[340px_minmax(0,1fr)_76px_76px]" : "max-w-[1388px] lg:grid-cols-[340px_minmax(0,1fr)_76px]"}`}>
        <aside className="flex max-h-[30dvh] min-h-0 flex-col gap-3 overflow-hidden lg:order-1 lg:max-h-none">
          {!snapshot.room.hostOnline && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">房主暂时离线，房间不会解散。若房主未在 {snapshot.room.hostOfflineDeadline ? new Date(snapshot.room.hostOfflineDeadline).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "15 分钟内"} 返回，本轮将结束、取消当前{mysteryMode ? "谜局" : "选汤"}，并由在线成员接任房主。</div>}
          {mysteryMode && snapshot.room.mystery && <section className={`card flex min-h-0 flex-col overflow-hidden ${soupExpanded ? "flex-1" : "shrink-0"}`}>
            <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
              {isHost && snapshot.room.status === "preparing" ? <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" onClick={openSoupSelector} aria-label="更换谜局"><BookOpen size={17} className="shrink-0 text-primary" /><span className="truncate text-sm font-black text-ink">{snapshot.room.mystery.title}</span></button> : <div className="flex min-w-0 flex-1 items-center gap-2"><BookOpen size={17} className="shrink-0 text-primary" /><span className="truncate text-sm font-black text-ink">{snapshot.room.mystery.title}</span></div>}
              <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-primary">谜局</span>
              <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-ink" onClick={() => setSoupExpanded((expanded) => !expanded)} aria-label={soupExpanded ? "收起背景介绍" : "展开背景介绍"}>{soupExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
            </div>
            {soupExpanded && <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-4">
              <h2 className="text-xs font-black tracking-wide text-muted">背景介绍</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink">{snapshot.room.mystery.background}</p>
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-800">房间不会展示故事内容、人物秘密、预设结局或内部规则。只有房主可提交正式行动，其他成员可在聊天区讨论。</div>
            </div>}
          </section>}
          {!mysteryMode && <section className={`card flex min-h-0 flex-col overflow-hidden ${soupExpanded && snapshot.room.soup ? "flex-1" : "shrink-0"}`}>
            <div className="shrink-0 px-3 py-2.5">
              <div className="flex items-center gap-2">
                {isHost && snapshot.room.status === "preparing" ? <button
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  onClick={openSoupSelector}
                  aria-label={snapshot.room.soup ? "更换海龟汤" : "选择海龟汤"}
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-black text-ink">{snapshot.room.soup?.title ?? "尚未选择海龟汤"}</span>
                  <Soup className="shrink-0 text-primary" size={16} />
                </button> : isHost ? <span className="min-w-0 flex-1 truncate text-xs font-black text-ink">{snapshot.room.soup?.title ?? "尚未选择海龟汤"}</span> : <button
                  className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs font-black transition ${viewerPanelTab === "surface" ? "bg-blue-50 text-primary" : "text-ink hover:bg-slate-50"}`}
                  onClick={() => { setViewerPanelTab("surface"); setSoupExpanded(true); }}
                  aria-pressed={viewerPanelTab === "surface"}
                  aria-label={`查看汤面：${snapshot.room.soup?.title ?? "尚未选择海龟汤"}`}
                >{snapshot.room.soup?.title ?? "尚未选择海龟汤"}</button>}
                {isHost && snapshot.room.soup && <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5" aria-label="主持人信息分组">
                  {([
                    ["materials", "资料"],
                    ["round", "本轮"]
                  ] as const).map(([value, label]) => <button key={value} className={`rounded-md px-2.5 py-1 text-[11px] font-black transition ${hostPanelGroup === value ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => { setHostPanelGroup(value); setSoupExpanded(true); }} aria-pressed={hostPanelGroup === value}>{label}</button>)}
                </div>}
                {!isHost && <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5" aria-label="汤面辅助视图">
                  <button className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-black transition ${viewerPanelTab === "clues" ? "bg-white text-amber-700 shadow-sm" : "text-muted"}`} onClick={() => { setViewerPanelTab("clues"); setSoupExpanded(true); void loadClues(); }} aria-pressed={viewerPanelTab === "clues"}><Lightbulb size={13} />线索</button>
                  <button className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-black transition ${viewerPanelTab === "progress" ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => { setViewerPanelTab("progress"); setSoupExpanded(true); }} aria-pressed={viewerPanelTab === "progress"}><ListChecks size={13} />进度</button>
                </div>}
                <button className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-ink active:scale-95" onClick={() => setSoupExpanded((expanded) => !expanded)} aria-label={soupExpanded ? "收起汤面卡片" : "展开汤面卡片"} title={soupExpanded ? "收起" : "展开"}>{soupExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
              </div>
              {isHost && snapshot.room.soup && <div className={`mt-2 grid gap-1 rounded-lg bg-slate-100 p-1 ${hostPanelGroup === "materials" ? "grid-cols-3" : "grid-cols-2"}`} aria-label={hostPanelGroup === "materials" ? "主持人资料页签" : "主持人本轮页签"}>
                {hostPanelGroup === "materials" ? canHumanHost ? ([
                  ["surface", "汤面"],
                  ["bottom", "汤底"],
                  ["manual", "手册"]
                ] as const).map(([value, label]) => <button key={value} className={`rounded-md px-2 py-1.5 text-[11px] font-black transition ${soupTab === value ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`} onClick={() => { setSoupTab(value); setSoupExpanded(true); }} aria-pressed={soupTab === value}>{label}</button>) : <button className="col-span-3 rounded-md bg-white px-2 py-1.5 text-[11px] font-black text-primary shadow-sm" onClick={() => { setSoupTab("surface"); setSoupExpanded(true); }} aria-pressed="true">汤面</button> : <>
                  <button className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-black transition ${hostRoundTab === "clues" ? "bg-white text-amber-700 shadow-sm" : "text-muted hover:text-ink"}`} onClick={() => { setHostRoundTab("clues"); setSoupExpanded(true); void loadClues(); }} aria-pressed={hostRoundTab === "clues"}><Lightbulb size={13} />线索{roundClues.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] leading-4 text-amber-800">{roundClues.length > 99 ? "99+" : roundClues.length}</span>}</button>
                  <button className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-black transition ${hostRoundTab === "progress" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`} onClick={() => { setHostRoundTab("progress"); setSoupExpanded(true); }} aria-pressed={hostRoundTab === "progress"}><ListChecks size={13} />进度{unansweredProgressCount > 0 && <span className="rounded-full bg-blue-100 px-1.5 text-[10px] leading-4 text-primary">{unansweredProgressCount > 99 ? "99+" : unansweredProgressCount}</span>}</button>
                </>}
              </div>}
            </div>
            {soupExpanded && snapshot.room.soup && <div ref={assistantPanelTab ? assistantScrollRef : undefined} className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line p-4" onScroll={assistantPanelTab ? updateAssistantScrollPosition : undefined}>
              {((isHost && hostPanelGroup === "materials" && (soupTab === "surface" || !canHumanHost)) || (!isHost && viewerPanelTab === "surface")) && <>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-muted">{snapshot.room.soup.type}</span>
                  {aiHosted && snapshot.room.currentRoundId && <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
                    <div
                      className="relative flex h-6 min-w-0 flex-1 items-center overflow-hidden rounded-full border border-blue-200 bg-blue-50 px-2"
                      role="progressbar"
                      aria-label="AI 推理进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={snapshot.room.aiProgress ?? 0}
                    >
                      <div className="absolute inset-y-0 left-0 bg-blue-200/80 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${snapshot.room.aiProgress ?? 0}%` }} />
                      <Bot size={12} className="relative shrink-0 text-primary" />
                      <span className="relative ml-1 truncate text-xs font-black text-blue-900">AI 进度</span>
                      <strong className="relative ml-auto pl-1.5 text-xs font-black tabular-nums text-primary">{snapshot.room.aiProgress ?? 0}%</strong>
                    </div>
                    {snapshot.me.role === "player" && snapshot.room.status === "playing" && <button
                      type="button"
                      className="relative inline-flex h-6 w-[76px] shrink-0 items-center justify-center gap-1 rounded-full border border-blue-200 bg-white px-2 text-xs font-black text-primary transition after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] hover:bg-blue-50 active:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-70"
                      disabled={requestingAiHint || (snapshot.room.aiProgress ?? 0) < 20}
                      onClick={() => void requestAiHint()}
                      aria-label={requestingAiHint ? "AI 正在生成提示" : (snapshot.room.aiProgress ?? 0) < 20 ? `推理进度达到 20% 后可获取提示，当前 ${snapshot.room.aiProgress ?? 0}%` : "获取 AI 提示"}
                      title={requestingAiHint ? "AI 正在生成提示" : (snapshot.room.aiProgress ?? 0) < 20 ? `进度达到 20% 后可提示，当前 ${snapshot.room.aiProgress ?? 0}%` : "获取 AI 提示"}
                    >
                      {requestingAiHint ? <LoaderCircle size={13} className="animate-spin" /> : <Lightbulb size={13} />}
                      <span>{requestingAiHint ? "生成中" : "提示"}</span>
                    </button>}
                  </div>}
                </div>
                <div className="content-block mt-3 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(snapshot.room.soup.surface) }} />
                {(canHumanHost
                  ? (snapshot.room.soup.supplementalSurfaces ?? []).map((content, index) => ({ content, index }))
                  : snapshot.room.soup.visibleSupplementalSurfaces
                ).map(({ content: surface, index }) => {
                  const published = snapshot.room.soup?.publishedSurfaceIndices?.includes(index) ?? !canHumanHost;
                  return <section key={`surface-${index}`} className="mt-3 rounded-xl bg-blue-50 p-3">
                    <h3 className="text-sm font-black text-blue-800">补充汤面 {index + 1}{published ? " · 已发布" : ""}</h3>
                    <div className="content-block mt-2 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sanitizeHtml(surface) }} />
                  </section>;
                })}
              </>}
              {assistantPanelTab === "progress" && aiHosted && snapshot.room.currentRoundId && <div className="sticky top-0 z-10 mb-3 hidden rounded-xl border border-blue-200 bg-blue-50/95 p-3 shadow-sm backdrop-blur lg:block">
                <div className="flex items-center gap-2 text-xs"><Bot size={14} className="shrink-0 text-primary" /><span className="font-black text-ink">AI 推理进度</span><span className="ml-auto font-black tabular-nums text-primary">{snapshot.room.aiProgress ?? 0}%</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100" role="progressbar" aria-label="AI 推理进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.room.aiProgress ?? 0}><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${snapshot.room.aiProgress ?? 0}%` }} /></div>
                {snapshot.me.role === "player" && snapshot.room.status === "playing" && <button type="button" className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-primary transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={requestingAiHint || (snapshot.room.aiProgress ?? 0) < 20} onClick={() => void requestAiHint()}>{requestingAiHint ? <LoaderCircle size={15} className="animate-spin" /> : <Lightbulb size={15} />}{requestingAiHint ? "AI 正在生成提示" : (snapshot.room.aiProgress ?? 0) < 20 ? "进度达到 20% 后可提示" : "获取 AI 提示"}</button>}
              </div>}
              {assistantPanelTab && showAssistantScrollToLatest && <div className={`pointer-events-none sticky z-20 flex h-0 justify-end ${assistantPanelTab === "progress" && aiHosted ? "top-0 lg:top-24" : "top-0"}`}><button type="button" className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full border border-blue-200 bg-white text-primary shadow-[0_6px_18px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 active:translate-y-0 active:scale-95" onClick={scrollAssistantToLatest} aria-label="回到最新线索或进度" title="回到最新"><ArrowUp size={19} strokeWidth={2.5} /></button></div>}
              {assistantPanelTab === "clues" && (cluesLoading ? <div className="space-y-2">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div> : newestFirstClueMessages.length > 0 ? <div className="room-assistant-cards space-y-2">{newestFirstClueMessages.map((message, index) => <article key={message.id} className="cursor-pointer rounded-xl border border-amber-200 bg-amber-50 p-3 transition hover:border-amber-400 hover:shadow-sm active:scale-[0.99]" onClick={() => void locateRoomMessage(message.id)}><div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-amber-800">线索 {roundClues.length - index}</span><time className="text-[11px] text-muted">{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{message.content}</p></article>)}</div> : <p className="rounded-xl bg-slate-50 py-10 text-center text-sm text-muted">主持人尚未发布线索</p>)}
              {assistantPanelTab === "progress" && (progressLoading ? <div className="space-y-2">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div> : newestFirstProgressQuestions.length > 0 ? <div className="room-assistant-cards space-y-2">{newestFirstProgressQuestions.map((question) => <ProgressQuestionCard key={question.id} question={question} canRetry={Boolean(snapshot.me.isHost || question.sender.id === user?.id)} retrying={retryingAiMessageId === question.id} onRetry={() => void retryAiQuestion(question)} onLocate={() => void locateRoomMessage(question.id)} onOpenUser={openMemberProfile} />)}</div> : <p className="rounded-xl bg-slate-50 py-10 text-center text-sm text-muted">本轮还没有正式提问</p>)}
              {canHumanHost && hostPanelGroup === "materials" && soupTab === "bottom" && <>
                {snapshot.room.soup.bottom && <section className="rounded-xl bg-amber-50 p-3">
                  <h3 className="text-sm font-black text-amber-800">主汤底{snapshot.room.soup.publishedBottomIndices?.includes(0) ? " · 已发布" : ""}</h3>
                  <div className="content-block mt-2 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sanitizeHtml(snapshot.room.soup.bottom) }} />
                </section>}
                {(snapshot.room.soup.supplementalBottoms ?? []).map((bottom, index) => <section key={`bottom-${index}`} className="mt-3 rounded-xl bg-amber-50 p-3">
                  <h3 className="text-sm font-black text-amber-800">补充汤底 {index + 1}{snapshot.room.soup?.publishedBottomIndices?.includes(index + 1) ? " · 已发布" : ""}</h3>
                  <div className="content-block mt-2 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sanitizeHtml(bottom) }} />
                </section>)}
              </>}
              {canHumanHost && hostPanelGroup === "materials" && soupTab === "manual" && (snapshot.room.soup.manual
                ? <div className="content-block rounded-xl bg-violet-50 p-3 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(snapshot.room.soup.manual) }} />
                : <p className="py-8 text-center text-sm text-muted">暂无主持人手册</p>)}
            </div>}
          </section>}

        </aside>

        <section className="online-soup-room-member-rail flex min-w-0 items-center gap-1.5 overflow-x-auto overscroll-contain rounded-xl border border-line bg-white/90 p-1.5 shadow-sm lg:order-3 lg:min-h-0 lg:flex-col lg:gap-2 lg:overflow-x-hidden lg:overflow-y-auto lg:py-3" aria-label="房间成员头像">
          {snapshot.members.map((member) => { const canManage = isHost && member.id !== user?.id; return <MentionableAvatarButton key={member.id} canMention={member.id !== user?.id && Boolean(canDiscuss)} onMention={() => requestMention(member.id, member.nickname)} onOpen={() => openMemberProfile(member.id)} className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full ring-2 transition active:scale-95 ${member.role === "host" ? "ring-amber-400" : member.role === "player" ? "ring-blue-300" : "ring-slate-300"}`} ariaLabel={canManage ? `管理成员${member.nickname}，长按@他` : `查看${member.nickname}的主页，长按@他`}>{member.avatar ? <img className="h-8 w-8 rounded-full object-cover" src={member.avatar} alt="" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-xs font-black text-primary">{member.nickname.slice(0, 1)}</span>}{member.role === "host" && <Crown className="absolute -right-1 -top-1 rounded-full bg-amber-400 p-0.5 text-white ring-1 ring-white" size={13} />}</MentionableAvatarButton>; })}
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-dashed border-blue-300 bg-blue-50/70 text-primary transition hover:border-primary hover:bg-blue-100 active:scale-95" onClick={() => setInviteOpen(true)} aria-label="邀请好友" title="邀请好友"><Plus size={16} strokeWidth={2.5} /></button>
        </section>

        {isHost && <aside className="online-soup-room-host-actions hidden min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white/90 p-1.5 shadow-sm lg:order-4 lg:flex lg:py-3" aria-label="主持人操作">
          <div className="online-soup-room-host-actions-list flex w-full min-h-0 flex-col items-center gap-3 overflow-y-auto overscroll-contain">
            {renderHostActions()}
          </div>
        </aside>}

        <section className="card relative flex min-h-0 flex-col overflow-hidden lg:order-2">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2"><h2 className="shrink-0 text-sm font-black text-ink">本轮讨论</h2><p className="truncate text-[11px] text-muted">{mysteryMode ? "讨论、房主行动和故事回应会实时同步" : "讨论、正式提问、主持人回复和线索会实时同步"}</p></div>
          <div className="relative min-h-0 flex-1">
            <div ref={messagesRef} className={`h-full space-y-3 overflow-y-auto overscroll-contain px-4 pt-4 ${showScrollToLatest ? "pb-16" : "pb-3"}`} onScroll={updateMessagesScrollPosition}>
              {snapshot.messagesHasMore && <button className="mx-auto block rounded-full border border-line bg-white px-4 py-2 text-xs font-bold text-primary shadow-sm transition hover:bg-blue-50 disabled:opacity-50" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? "加载中…" : "加载更早消息"}</button>}
              {giftTimelineEntries(snapshot.messages).map((entry) => {
                if (entry.kind === "gift_bundle") {
                  const mine = entry.gifts[0]?.sender.id === user?.id;
                  return <GiftMessageBundle
                    key={entry.key}
                    gifts={entry.gifts}
                    align={mine ? "right" : "left"}
                    anchorIds={entry.messages.map((message) => `online-soup-message-${message.id}`)}
                    highlighted={entry.messages.some((message) => message.id === highlightedMessageId)}
                  />;
                }
                const message = entry.message;
                if (isHost && message.type === "system" && message.targetMessageId) return null;
                return <div
                  id={`online-soup-message-${message.id}`}
                  key={message.id}
                  className={`scroll-mt-24 rounded-2xl transition duration-500 ${highlightedMessageId === message.id ? "bg-violet-100/80 ring-2 ring-violet-400 ring-offset-4" : ""}`}
                >
                  <MessageItem message={message} currentUserId={user?.id ?? ""} isHost={canHumanHost} mysteryMode={mysteryMode} canRetryAi={!mysteryMode && snapshot.me.isHost} canReply={Boolean(canDiscuss)} onAnswer={answer} onRetryAi={retryAiQuestion} retryingAi={retryingAiMessageId === message.id} onRecall={recallMessage} onReply={(item) => { setReplyingTo(item); setStickersOpen(false); }} onCopy={async (copyText) => { try { await copyTextToClipboard(copyText); showToast("消息已复制"); } catch { showToast("复制失败，请稍后重试"); } }} onMention={requestMention} onLocate={locateRoomMessage} soupId={message.type === "bottom" && message.allBottomsPublished ? message.soupId : null} stickers={stickersById} onOpenUser={openMemberProfile} onOpenSoup={(id) => navigate(`/soup/${id}`, { state: { onlineSoupRoomId: roomId, onlineSoupMember: true } })} />
                </div>;
              })}
            </div>
            {showScrollToLatest && <button
              className="absolute bottom-3 right-3 z-30 grid h-12 w-12 place-items-center rounded-full border border-blue-200 bg-white text-primary shadow-[0_8px_24px_rgba(15,23,42,0.2)] transition duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
              onClick={() => scrollToLatestMessage()}
              aria-label="滚动到最新消息"
              title="滚动到最新消息"
            >
              <ChevronDown size={24} strokeWidth={2.5} />
            </button>}
          </div>
          {canDiscuss && <div className="relative shrink-0 border-t border-line bg-white/95 p-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
            {mentionCandidates.length > 0 && <div className="absolute inset-x-0 bottom-full z-40 border-b border-line bg-white shadow-[0_-10px_30px_rgba(15,23,42,0.12)]"><div className="divide-y divide-line px-3">{mentionCandidates.map((member) => <button key={member.id} type="button" className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition hover:bg-slate-50 active:bg-slate-100" onPointerDown={(event) => event.preventDefault()} onClick={() => chooseMention(member)}>{member.avatar ? <img className="h-10 w-10 rounded-full object-cover" src={member.avatar} alt="" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-100 text-sm font-black text-primary">{member.nickname.slice(0, 1)}</span>}<span className="min-w-0 flex-1"><VipIdentity nickname={member.nickname} userLevel={member.level} vipLevel={member.vipLevel} vipActive={member.vipActive} equippedBadge={member.equippedBadge} className="max-w-full" /></span></button>)}</div></div>}
            {replyingTo && <div className="mb-2 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2"><Reply size={16} className="shrink-0 text-primary" /><p className="min-w-0 flex-1 truncate text-xs text-muted"><span className="font-bold text-primary">回复 {replyingTo.senderName ?? "已注销用户"}：</span>{onlineMessagePreview(replyingTo)}</p><button type="button" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-white hover:text-ink" onClick={() => setReplyingTo(null)} aria-label="取消回复"><X size={16} /></button></div>}
            <div className="flex items-end gap-1">
              {(mysteryMode ? isHost : snapshot.me.role === "player") && <div className="relative shrink-0">
                {showQuestionModeGuide && <div className="question-mode-guide absolute bottom-[calc(100%+14px)] left-0 z-50 w-56 rounded-xl bg-slate-900 px-3 py-2.5 pr-8 text-left text-xs font-bold leading-5 text-white shadow-xl" role="status">
                  {mysteryMode ? "房主可点击此处切换为正式行动" : "如需要提问，请点击此按钮变更为提问"}
                  <button type="button" className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white" onClick={() => setShowQuestionModeGuide(false)} aria-label="关闭提问指引"><X size={14} /></button>
                  <span className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45 bg-slate-900" aria-hidden="true" />
                </div>}
                <button
                  className={`group relative flex h-11 w-[68px] items-center justify-center gap-1.5 overflow-hidden rounded-xl border text-white shadow-md ring-2 ring-offset-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-95 ${mode === "question" ? "border-violet-500 bg-gradient-to-br from-violet-500 to-fuchsia-600 ring-violet-200" : "border-blue-500 bg-gradient-to-br from-blue-500 to-cyan-500 ring-blue-200"}`}
                  onClick={() => {
                    setShowQuestionModeGuide(false);
                    if (!canQuestion) {
                      showToast(mysteryMode ? "谜局开始后，只有房主可以切换为正式行动" : "游戏开始后才可以切换为正式提问");
                      return;
                    }
                    setMode((current) => current === "discussion" ? "question" : "discussion");
                  }}
                  aria-label={`当前为${mode === "question" ? mysteryMode ? "行动" : "提问" : "讨论"}模式，点击切换`}
                  title={canQuestion ? mysteryMode ? "点击切换讨论/行动" : "点击切换讨论/提问" : "游戏开始后可以切换"}
                >
                  <span className="text-xs font-black leading-5">{mode === "question" ? mysteryMode ? "行动" : "提问" : "讨论"}</span>
                  <ArrowRightLeft size={14} className="shrink-0 transition-transform duration-200 group-hover:rotate-180" />
                </button>
              </div>}
              <textarea ref={messageInputRef} className="field room-message-input min-w-0 flex-1 resize-none" rows={1} maxLength={1000} value={content} onChange={(event) => { setContent(event.target.value); if ((event.nativeEvent as InputEvent).isComposing) return; const cursor = event.target.selectionStart ?? event.target.value.length; setCursorPosition(cursor); if (stickersOpen && activeMentionAt(event.target.value, cursor)) setStickersOpen(false); }} onCompositionStart={() => { messageComposingRef.current = true; }} onCompositionEnd={(event) => { messageComposingRef.current = false; const cursor = event.currentTarget.selectionStart ?? event.currentTarget.value.length; setContent(event.currentTarget.value); setCursorPosition(cursor); }} onFocus={() => { setStickersOpen(false); isNearMessagesBottom.current = true; window.requestAnimationFrame(() => scrollToLatestMessage("auto")); }} onClick={(event) => setCursorPosition(event.currentTarget.selectionStart ?? content.length)} onKeyUp={(event) => { if (!event.nativeEvent.isComposing) setCursorPosition(event.currentTarget.selectionStart ?? content.length); }} placeholder={mysteryMode && mode === "question" ? "描述你的正式行动…" : isHost && !mysteryMode ? "主持人发言…" : mode === "question" ? "输入正式问题…" : "参与讨论…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} />
              <ChatComposerIconButton tone={stickersOpen ? "active" : "neutral"} onClick={() => { if (!stickersOpen) messageInputRef.current?.blur(); setStickersOpen((open) => !open); setHostActionsOpen(false); }} aria-label="表情包" title="表情包"><Smile size={23} /></ChatComposerIconButton>
              <ChatComposerIconButton tone="send" disabled={sending || (mode === "question" && !canQuestion)} onClick={sendMessage} aria-label="发送" title="发送"><Send size={22} /></ChatComposerIconButton>
            </div>
            {stickersOpen && <StickerKeyboard series={stickerSeries} loading={stickersLoading} sending={sending} onClose={() => setStickersOpen(false)} onSend={sendSticker} className="mt-3 border-t border-line pt-3" />}
          </div>}
        </section>
      </main>

      {isHost ? <div className={`fixed right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 transition duration-200 lg:hidden ${stickersOpen ? "pointer-events-none translate-y-2 opacity-0" : "opacity-100"}`}>
        {hostActionsOpen && <div className="absolute bottom-full right-1/2 mb-2 flex translate-x-1/2 flex-col items-center gap-2">
          {renderHostActions(true)}
        </div>}
        <button className={`grid h-12 w-12 place-items-center rounded-full border shadow-[0_8px_24px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${hostActionsOpen ? "border-blue-500 bg-primary text-white" : "border-blue-200 bg-white text-primary"}`} onClick={() => setHostActionsOpen((open) => !open)} aria-label="主持人更多操作" title="主持人更多操作"><Menu size={22} /></button>
      </div> : null}

      {managedMember && <Modal onClose={() => { if (!memberManagementLoading) { setManagedMemberId(null); setMemberManagementAction(null); } }}><div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-primary">{managedMember.avatar ? <img className="h-full w-full object-cover" src={managedMember.avatar} alt={`${managedMember.nickname}头像`} /> : managedMember.nickname.slice(0, 1)}</span>
          <div className="min-w-0"><h2 className="truncate text-xl font-black text-ink">{managedMember.nickname}</h2><p className="mt-1 text-xs text-muted">{managedMember.role === "player" ? "玩家" : "旁观者"} · Lv{managedMember.level}</p></div>
        </div>
        {memberManagementAction ? <>
          <div className={`rounded-xl p-4 text-sm leading-6 ${memberManagementAction === "kick" ? "bg-red-50 text-red-700" : "bg-violet-50 text-violet-700"}`}>
            {memberManagementAction === "kick"
              ? `确认将「${managedMember.nickname}」踢出房间？该成员的当前席位会立即释放。`
              : `确认将房主转让给「${managedMember.nickname}」？转让后你将变为${managedMember.role === "player" ? "玩家" : "旁观者"}，对方将立即获得主持权限。`}
          </div>
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={memberManagementLoading} onClick={() => setMemberManagementAction(null)}>返回</button><button className={`btn text-white ${memberManagementAction === "kick" ? "bg-red-500 hover:bg-red-600" : "bg-violet-600 hover:bg-violet-700"}`} disabled={memberManagementLoading} onClick={() => void manageMember(memberManagementAction)}>{memberManagementLoading ? "处理中…" : memberManagementAction === "kick" ? "确认踢出" : "确认转让"}</button></div>
        </> : <>
          <button className="btn w-full justify-start bg-violet-50 text-violet-700 hover:bg-violet-100" onClick={() => setMemberManagementAction("transfer")}><ArrowRightLeft size={17} />转让房主</button>
          <button className="btn w-full justify-start bg-red-50 text-red-600 hover:bg-red-100" onClick={() => setMemberManagementAction("kick")}><LogOut size={17} />踢出房间</button>
          <button className="btn btn-secondary w-full" onClick={() => setManagedMemberId(null)}>取消</button>
        </>}
      </div></Modal>}
      {membersOpen && <Modal onClose={() => setMembersOpen(false)}><div className="space-y-4"><h2 className="text-xl font-black text-ink">房间成员</h2><p className="text-xs font-bold text-muted">主持人和玩家 {(groupedMembers.host ? 1 : 0) + groupedMembers.players.length}/{snapshot.room.participantCapacity} 人</p>{groupedMembers.host && <MemberRow member={groupedMembers.host} onOpenUser={openMemberProfile} canManage={false} />}<div><p className="mb-2 text-xs font-bold text-muted">玩家 {groupedMembers.players.length}/{snapshot.room.playerCapacity}</p><div className="space-y-2">{groupedMembers.players.map((member) => <MemberRow key={member.id} member={member} onOpenUser={openMemberProfile} canManage={isHost && member.id !== user?.id} />)}{groupedMembers.players.length === 0 && <p className="text-sm text-muted">等待玩家加入</p>}</div></div>{groupedMembers.spectators.length > 0 && <div><p className="mb-2 text-xs font-bold text-muted">旁观者</p>{groupedMembers.spectators.map((member) => <MemberRow key={member.id} member={member} onOpenUser={openMemberProfile} canManage={isHost && member.id !== user?.id} />)}</div>}<button className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-2.5 text-left text-primary transition hover:border-primary hover:bg-blue-50" onClick={() => { setMembersOpen(false); setInviteOpen(true); }}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-dashed border-blue-300"><Plus size={18} /></span><span><span className="block font-black">分享房间</span><span className="block text-xs font-medium text-muted">分享到微信、圈子或好友</span></span></button><button className="btn btn-secondary w-full" onClick={() => { setMembersOpen(false); requestRoomExit(); }}><LogOut size={16} /> 房间退出选项</button></div></Modal>}
      {inviteOpen && <OnlineSoupInviteModal roomId={roomId} roomName={snapshot.room.name} roomCode={snapshot.room.code} onClose={() => setInviteOpen(false)} showToast={showToast} />}
      {snapshot.room.finishVote?.canVote && <Modal onClose={() => undefined} hideClose><div className="space-y-5 p-1 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-indigo-100 text-indigo-700"><BookOpen size={28} /></div>
        <div><h2 className="text-xl font-black text-ink">推理进度已达 {snapshot.room.aiProgress ?? 80}%</h2><p className="mt-2 text-sm leading-6 text-muted">现在可以选择查看汤底并尝试结束本轮，也可以继续游戏。达到正式玩家半数选择“查看汤底”时，本轮立即结束；进度达到 100% 时将无条件自动结束。</p></div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-muted">当前 {snapshot.room.finishVote.viewBottomCount}/{snapshot.room.finishVote.requiredViewBottomCount} 票选择查看汤底</div>
        <div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary min-h-11" disabled={submittingFinishVote} onClick={() => void submitFinishVote("continue")}>继续游戏</button><button type="button" className="btn btn-primary min-h-11" disabled={submittingFinishVote} onClick={() => void submitFinishVote("view_bottom")}>{submittingFinishVote ? <LoaderCircle size={16} className="animate-spin" /> : <Eye size={16} />}查看汤底</button></div>
      </div></Modal>}
      {exitChoiceOpen && <Modal onClose={() => setExitChoiceOpen(false)}><div className="space-y-4"><div className="text-center"><h2 className="text-xl font-black text-ink">离开完整房间</h2><p className="mt-2 text-sm leading-6 text-muted">收起后会继续保持在线，并在桌面右下角接收聊天、线索和进度。</p></div><button className="btn btn-primary !hidden w-full lg:!flex" onClick={minimizeCurrentRoom}><Minimize2 size={17} />收起到右下角</button><button className="btn w-full bg-red-50 text-red-600 hover:bg-red-100" onClick={() => { setExitChoiceOpen(false); setConfirmAction("leave"); }}><LogOut size={17} />{isHost ? "退出房间" : "退出并释放席位"}</button><button className="btn btn-secondary w-full" onClick={() => setExitChoiceOpen(false)}>取消</button></div></Modal>}
      {confirmAction && <Modal onClose={() => setConfirmAction(null)}><div className="space-y-4"><div className="text-center"><h2 className="text-xl font-black text-ink">{confirmAction === "end-round" ? "确认关闭本轮？" : confirmAction === "close" ? "确认解散房间？" : "确认退出房间？"}</h2><p className="mt-2 text-sm leading-6 text-muted">{confirmAction === "end-round" ? "关闭后将结束本轮推理，但不会解散房间，也不会自动发布尚未公布的汤底。" : confirmAction === "close" ? "解散后所有成员都会退出，此操作无法撤销。" : isHost ? snapshot.members.some((member) => member.id !== user?.id) ? "退出后将立即由房内成员接任房主；当前房间和正在进行的本轮会继续。" : "房间内暂无其他成员，退出后房间将立即解散。" : "退出后将释放当前席位，重新进入时可能需要再次验证。"}</p></div><div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>取消</button><button className="btn bg-red-500 text-white hover:bg-red-600" onClick={() => { if (confirmAction === "end-round") void endRound(); else if (confirmAction === "close") void closeRoom(); else void leaveRoom(); }}>{confirmAction === "end-round" ? "关闭本轮" : confirmAction === "close" ? "确认解散" : "确认退出"}</button></div></div></Modal>}
      {clueOpen && <Modal onClose={() => setClueOpen(false)}><div className="space-y-4"><h2 className="text-xl font-black text-ink">发布主持人线索</h2><textarea className="field min-h-32 w-full" maxLength={2000} value={clue} onChange={(e) => setClue(e.target.value)} placeholder="输入给所有玩家看的线索…" /><button className="btn btn-primary w-full" onClick={publishClue}><Lightbulb size={16} /> 发布线索</button></div></Modal>}
      {surfacePublishOpen && <Modal onClose={() => setSurfacePublishOpen(false)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">发布补充汤面</h2><p className="mt-1 text-sm text-muted">选择一条尚未发布的补充汤面。</p></div><div className="space-y-2">{unpublishedSurfaces.map(({ content: surface, index }) => <button key={index} className="w-full rounded-xl border border-blue-200 bg-blue-50 p-3 text-left transition hover:border-blue-400" onClick={() => setMaterialPublishTarget({ kind: "surface", index, title: `补充汤面 ${index + 1}`, content: surface, endsRound: false })}><span className="text-sm font-black text-blue-800">补充汤面 {index + 1}</span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted">{surface.replace(/<[^>]*>/g, "")}</span></button>)}</div><button className="btn btn-secondary w-full" onClick={() => setSurfacePublishOpen(false)}>取消</button></div></Modal>}
      {honorSelection && !materialPublishTarget && <Modal onClose={() => { if (!honorSelection.submitting) setHonorSelection(null); }} hideClose={honorSelection.submitting}>
        <div className="space-y-4">
          <div>
            <div className="mb-3 flex items-center gap-2" aria-label={`评选步骤 ${honorSelection.step === "mvp" ? "1" : "2"}/2`}>
              <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${honorSelection.step === "mvp" ? "bg-primary text-white" : "bg-emerald-500 text-white"}`}>{honorSelection.step === "mvp" ? "1" : <Check size={15} />}</span>
              <span className={`h-1 flex-1 rounded-full ${honorSelection.step === "question" ? "bg-primary" : "bg-slate-200"}`} />
              <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${honorSelection.step === "question" ? "bg-primary text-white" : "bg-slate-100 text-muted"}`}>2</span>
            </div>
            <h2 className="flex items-center gap-2 text-xl font-black text-ink">{honorSelection.step === "mvp" ? <Award className="text-amber-500" size={22} /> : <MessageCircleQuestion className="text-violet-600" size={22} />}{honorSelection.step === "mvp" ? "请选择本场 MVP" : "请选择本场最佳提问"}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{honorSelection.step === "mvp" ? "候选人为本轮所有至少提出过一次问题的玩家。" : "以下为本轮进度中的全部提问和回答；尚未回答的问题暂不可选择。"}</p>
          </div>

          {honorSelection.step === "mvp" ? <div className="max-h-[52dvh] space-y-2 overflow-y-auto overscroll-contain pr-1" role="radiogroup" aria-label="本场 MVP 候选人">
            {honorMvpCandidates.map((candidate) => {
              const selected = honorSelection.mvpUserId === candidate.id;
              return <label key={candidate.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${selected ? "border-primary bg-blue-50 ring-2 ring-blue-100" : "border-line bg-white hover:border-blue-300 hover:bg-slate-50"}`}>
                <input className="sr-only" type="radio" name="human-honor-mvp" value={candidate.id} checked={selected} onChange={() => setHonorSelection((current) => current ? { ...current, mvpUserId: candidate.id } : current)} />
                <HonorCandidateAvatar avatar={candidate.avatar} nickname={candidate.nickname} />
                <span className="min-w-0 flex-1 truncate font-black text-ink">{candidate.nickname}</span>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${selected ? "border-primary bg-primary text-white" : "border-slate-300 text-transparent"}`} aria-hidden="true"><Check size={14} /></span>
              </label>;
            })}
          </div> : <div className="max-h-[52dvh] space-y-2 overflow-y-auto overscroll-contain pr-1" role="radiogroup" aria-label="本场最佳提问候选">
            {honorSelection.questions.map((question) => {
              const selectable = Boolean(question.answer);
              const selected = honorSelection.bestQuestionMessageId === question.id;
              return <label key={question.id} className={`block rounded-2xl border p-3 transition focus-within:ring-2 focus-within:ring-violet-500 focus-within:ring-offset-2 ${!selectable ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70" : selected ? "cursor-pointer border-violet-500 bg-violet-50 ring-2 ring-violet-100" : "cursor-pointer border-line bg-white hover:border-violet-300"}`}>
                <input className="sr-only" type="radio" name="human-honor-question" value={question.id} disabled={!selectable} checked={selected} onChange={() => setHonorSelection((current) => current ? { ...current, bestQuestionMessageId: question.id } : current)} />
                <span className="flex items-center gap-2">
                  <HonorCandidateAvatar avatar={question.sender.avatar} nickname={question.sender.nickname} small />
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><strong className="shrink-0 text-xs text-violet-700">#{question.number}</strong><strong className="truncate text-xs text-ink">{question.sender.nickname}</strong></span><span className="mt-1 block whitespace-pre-wrap break-words text-sm font-bold leading-6 text-ink">{question.content}</span></span>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${selected ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 text-transparent"}`} aria-hidden="true"><Check size={14} /></span>
                </span>
                <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${question.answer ? "bg-primary text-white" : "bg-slate-200 text-muted"}`}>{question.answer ? `主持人回答：${answerLabels[question.answer]}` : "等待主持人回答"}</span>
              </label>;
            })}
          </div>}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary min-h-11" disabled={honorSelection.submitting} onClick={() => honorSelection.step === "question" ? setHonorSelection((current) => current ? { ...current, step: "mvp" } : current) : setHonorSelection(null)}>{honorSelection.step === "question" ? "上一步" : "取消"}</button>
            <button type="button" className="btn btn-primary min-h-11" disabled={honorSelection.submitting || (honorSelection.step === "mvp" ? !honorSelection.mvpUserId : !honorSelection.bestQuestionMessageId)} onClick={() => void confirmHumanHonors()}>{honorSelection.step === "mvp" ? "确定" : "确认评选"}</button>
          </div>
        </div>
      </Modal>}
      {publishOpen && snapshot.room.soup && <Modal onClose={() => setPublishOpen(false)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">选择要发布的汤底</h2><p className="mt-1 text-sm leading-6 text-muted">汤底可以按任意顺序发布。发布最后一条汤底前，需要先评选本场 MVP 和最佳提问；完成后将一并发布主持人手册和本轮高光。</p></div><div className="space-y-2">{[snapshot.room.soup.bottom ?? "", ...(snapshot.room.soup.supplementalBottoms ?? [])].map((bottom, index) => { const published = snapshot.room.soup?.publishedBottomIndices?.includes(index) ?? false; const preparing = preparingHonorBottomIndex === index; return <button key={index} className={`w-full rounded-xl border p-3 text-left transition ${published ? "border-slate-200 bg-slate-50 text-muted" : "border-amber-200 bg-amber-50 hover:border-amber-400"}`} disabled={published || preparingHonorBottomIndex != null} onClick={() => void prepareBottomPublish(index)}><span className="flex items-center gap-2 text-sm font-black">{preparing && <LoaderCircle size={15} className="animate-spin" />}{index === 0 ? "主汤底" : `补充汤底 ${index}`}{published ? " · 已发布" : ""}</span><span className="mt-1 block line-clamp-2 text-xs leading-5">{bottom.replace(/<[^>]*>/g, "")}</span></button>; })}</div><button className="btn btn-secondary w-full" disabled={preparingHonorBottomIndex != null} onClick={() => setPublishOpen(false)}>取消</button></div></Modal>}
      {materialPublishTarget && <Modal onClose={() => { if (!materialPublishing) setMaterialPublishTarget(null); }} hideClose={materialPublishing}><div className="space-y-4">
        <div className="text-center"><h2 className="text-xl font-black text-ink">确认发布{materialPublishTarget.title}？</h2><p className="mt-2 text-sm leading-6 text-muted">发布后房间内所有成员将立即看到该内容，无法撤回。</p></div>
        <div className={`rounded-xl border p-3 ${materialPublishTarget.kind === "surface" ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}><p className="text-xs font-black text-muted">即将发布</p><p className="mt-1 font-black text-ink">{materialPublishTarget.title}</p><p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{materialPublishTarget.content.replace(/<[^>]*>/g, "")}</p></div>
        {materialPublishTarget.endsRound && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold leading-6 text-red-700">这是最后一条尚未发布的汤底。确认后本轮将结束，并自动发布主持人手册和本轮高光。</p>}
        <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={materialPublishing} onClick={() => setMaterialPublishTarget(null)}>取消</button><button className="btn btn-primary" disabled={materialPublishing} onClick={() => void confirmMaterialPublish()}>{materialPublishing ? <><LoaderCircle size={16} className="animate-spin" />发布中…</> : "确认发布"}</button></div>
      </div></Modal>}
    </div>
  );
}

function HonorCandidateAvatar({ avatar, nickname, small = false }: { avatar: string | null; nickname: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = small ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm";
  return avatar && !failed
    ? <img className={`${size} shrink-0 rounded-full object-cover`} src={avatar} alt={`${nickname}头像`} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-blue-100 font-black text-primary`} aria-label={`${nickname}头像`}>{nickname.slice(0, 1)}</span>;
}

function MemberRow({ member, onOpenUser, canManage }: { member: OnlineSoupSnapshot["members"][number]; onOpenUser: (id: string) => void; canManage: boolean }) {
  return <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5"><button className="shrink-0 rounded-full transition active:scale-95" onClick={() => onOpenUser(member.id)} aria-label={canManage ? `管理成员${member.nickname}` : `查看${member.nickname}的主页`}>{member.avatar ? <img className="h-9 w-9 rounded-full object-cover" src={member.avatar} alt="" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 font-black text-primary">{member.nickname.slice(0, 1)}</span>}</button><div className="min-w-0 flex-1"><VipIdentity nickname={member.nickname} userLevel={member.level} vipLevel={member.vipLevel} vipActive={member.vipActive} equippedBadge={member.equippedBadge} className="max-w-full" /></div>{member.role === "host" && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700"><Crown size={12} /> 主持人</span>}{member.role === "spectator" && <span className="text-xs text-muted">旁观</span>}</div>;
}

function ProgressQuestionCard({
  question,
  canRetry,
  retrying,
  onRetry,
  onLocate,
  onOpenUser,
}: {
  question: ProgressQuestion;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
  onLocate: () => void;
  onOpenUser: (id: string) => void;
}) {
  const active = ["pending", "answering", "scoring"].includes(question.aiStatus);
  const statusText = question.aiStatus === "pending"
    ? question.aiQueuePosition && question.aiQueuePosition > 1
      ? `AI 队列第 ${question.aiQueuePosition} 位`
      : "即将由 AI 处理"
    : question.aiStatus === "answering"
      ? "AI 正在判断"
      : question.aiStatus === "scoring"
        ? "AI 正在结合汤底与上下文判断"
        : question.aiStatus === "cancelled"
          ? "本轮已结束，提问已取消"
          : null;
  return <article className="cursor-pointer rounded-xl border border-blue-100 bg-blue-50 p-3 transition hover:border-blue-300 hover:shadow-sm active:scale-[0.99]" onClick={onLocate}>
    <div className="flex items-center gap-2">
      <button className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full" disabled={!question.sender.id} onClick={(event) => { event.stopPropagation(); question.sender.id && onOpenUser(question.sender.id); }}>
        {question.sender.avatar ? <img className="h-8 w-8 rounded-full object-cover" src={question.sender.avatar} alt="" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-xs font-black text-primary">{question.sender.nickname.slice(0, 1)}</span>}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-xs font-black text-primary">#{question.number}</span>
          <span className="truncate text-xs font-bold text-ink">{question.sender.nickname}</span>
          {Boolean(question.aiProgressDelta) && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">进度+{question.aiProgressDelta}</span>}
          <time className="ml-auto shrink-0 text-[10px] text-muted">{new Date(question.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{question.content}</p>
      </div>
    </div>
    <div className="mt-2 space-y-1.5 pl-10">
      {question.answer
        ? <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-black text-white"><Check size={11} className="mr-1" />{onlineSoupAnswerPrefix(question.aiStatus)}{answerLabels[question.answer]}</span>
        : statusText
            ? <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-bold text-muted" role={active ? "status" : undefined}>{active && <LoaderCircle size={12} className="animate-spin" />}{statusText}</span>
            : null}
      {question.aiStatus === "failed" && <div className="flex flex-wrap items-center gap-2" role="alert">
        <span className="text-xs font-bold text-red-600">AI 核对失败：{question.aiError ?? "请稍后重试"}</span>
        {canRetry && <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-red-200 bg-white px-3 text-xs font-black text-red-600 disabled:opacity-50" disabled={retrying} onClick={(event) => { event.stopPropagation(); onRetry(); }}>{retrying ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}{retrying ? "重试中" : "重新请求"}</button>}
      </div>}
      {question.aiStatus === "completed" && question.aiFeedback && <p className={`rounded-lg px-2 py-1 text-xs font-bold ${question.aiProgressDelta ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-600"}`}>{question.aiFeedback}</p>}
      {question.aiStatus === "completed" && question.aiProgressAfter != null && <p className="text-xs font-bold text-muted">该题完成后进度：{question.aiProgressAfter}%</p>}
    </div>
  </article>;
}

function FloatingAction({ label, onClick, tone = "default" }: { label: string; onClick: () => void; tone?: "default" | "primary" | "amber" | "danger" }) {
  const tones = {
    default: "border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 text-slate-700 hover:border-slate-300",
    primary: "border-blue-200 bg-gradient-to-br from-white via-blue-50 to-blue-100 text-blue-700 hover:border-blue-300",
    amber: "border-amber-200 bg-gradient-to-br from-white via-amber-50 to-orange-100 text-amber-700 hover:border-amber-300",
    danger: "border-rose-200 bg-gradient-to-br from-white via-rose-50 to-red-100 text-rose-600 hover:border-rose-300"
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
    : label.includes("线索")
        ? <Lightbulb size={30} />
        : label.includes("汤底") || label.includes("谜局")
          ? <BookOpen size={30} />
          : label.includes("海龟汤") || label.includes("补充汤面")
            ? <Soup size={30} />
            : label.includes("关闭")
              ? <X size={30} />
              : null;
  return <button className={`group relative grid h-[58px] w-[58px] place-items-center overflow-hidden rounded-full border px-1 text-center text-[12px] font-black leading-[1.25] ring-1 ring-white/80 transition duration-200 hover:-translate-y-1 hover:scale-[1.03] active:translate-y-0 active:scale-95 ${tones[tone]}`} onClick={onClick} aria-label={label} title={label}><span className="pointer-events-none absolute inset-1 rounded-full border border-white/80" /><span className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.12] transition duration-200 group-hover:scale-110 group-hover:opacity-[0.18]">{icon}</span><span className="relative drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]">{lines.map((line) => <span className="block" key={line}>{line}</span>)}</span></button>;
}

const MessageItem = memo(function MessageItem({ message, currentUserId, isHost, mysteryMode, canRetryAi, canReply, onAnswer, onRetryAi, retryingAi, onRecall, onReply, onCopy, onMention, onLocate, soupId, stickers, onOpenUser, onOpenSoup }: { message: OnlineSoupMessage; currentUserId: string; isHost: boolean; mysteryMode: boolean; canRetryAi: boolean; canReply: boolean; onAnswer: (message: OnlineSoupMessage, answer: OnlineSoupAnswer) => void; onRetryAi: (message: OnlineSoupMessage) => void; retryingAi: boolean; onRecall: (message: OnlineSoupMessage) => void; onReply: (message: OnlineSoupMessage) => void; onCopy: (copyText: string) => void; onMention: (userId: string, nickname: string) => void; onLocate: (messageId: string) => Promise<boolean>; soupId: string | null; stickers: ReadonlyMap<string, StickerAsset>; onOpenUser: (id: string) => void; onOpenSoup: (id: string) => void }) {
  const mine = message.senderId === currentUserId;
  if (message.recalledAt) return <RecalledMessageNotice mine={mine} senderName={message.senderName} />;
  if (message.type === "gift" && message.gift) return <div className={`flex ${mine ? "justify-end" : "justify-start"}`}><GiftMessageCard gift={message.gift} /></div>;
  if (message.type === "system") return <div className="py-1 text-center text-xs font-bold text-muted">— {message.senderId && message.content.endsWith("进入了房间") ? <><VipIdentity nickname={message.senderName ?? "用户"} vipLevel={message.senderVipLevel} vipActive={message.senderVipActive} className="mx-1 inline-flex" /><span>进入了房间</span></> : message.content} {message.targetMessageId && !isHost && <button type="button" className="ml-1 font-black text-primary underline-offset-2 hover:underline" onClick={() => void onLocate(message.targetMessageId!)} aria-label={`定位到${message.content.match(/#\d+/)?.[0] ?? "被变更回答的提问"}`}>【定位】</button>} —</div>;
  if (message.type === "ai_honor" && message.aiHonors) return <OnlineSoupHonorCard honors={message.aiHonors} onOpenUser={onOpenUser} />;
  if (message.type === "ai_advice") return <article className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-black text-blue-800"><Sparkles size={17} />AI 玩汤建议</div><ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">{message.content.split("\n").filter(Boolean).map((line) => <li key={line} className="flex gap-2"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" /><span>{line}</span></li>)}</ul></article>;
  if (message.type === "mystery_narrative") return <article className="rounded-2xl border border-blue-200 bg-gradient-to-br from-white to-blue-50 p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-black text-blue-800"><BookOpen size={17} />故事回应</div><p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-ink">{message.content}</p></article>;
  if (message.type === "clue") return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-amber-800"><Lightbulb size={16} /> 主持人线索</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{message.content}</p></div>;
  if (message.type === "supplemental_surface") return <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-blue-800"><Soup size={16} /> 补充汤面 {(message.contentIndex ?? 0) + 1}</div><div className="content-block mt-2 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} /></div>;
  if (message.type === "bottom") return <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-indigo-700"><Clapperboard size={17} /> {message.contentIndex === 0 ? "汤底已公布" : `补充汤底 ${message.contentIndex} 已公布`}</div><div className="content-block mt-2 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} />{soupId && <button className="btn btn-primary mt-3" onClick={() => onOpenSoup(soupId)}><Eye size={16} /> 查看完整汤底</button>}</div>;
  if (message.type === "manual") return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-violet-800"><BookOpen size={16} /> 主持人手册</div><div className="content-block mt-2 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} /></div>;
  const sticker = message.stickerId ? stickers.get(message.stickerId) : null;
  const question = message.type === "question";
  const host = message.type === "host" || message.senderIsHost;
  const canRecall = mine
    && ["discussion", "question", "host", "sticker"].includes(message.type)
    && (!question || message.answer == null)
    && !(question && message.mysteryRunId && message.aiStatus === "completed")
    && canRecallMessage(message.createdAt, message.recalledAt);
  const bubbleTone = host
    ? "border-amber-500 bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-[0_7px_18px_rgba(245,158,11,0.2)]"
    : question
      ? "border-violet-500 bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-[0_7px_18px_rgba(124,58,237,0.18)]"
      : mine
        ? "border-primary bg-primary text-white shadow-[0_6px_16px_rgba(37,99,235,0.16)]"
        : "border-line bg-white text-ink shadow-sm";
  return (
    <div className={`flex items-start gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
      <MentionableAvatarButton
        canMention={Boolean(message.senderId && message.senderId !== currentUserId)}
        onMention={() => message.senderId && onMention(message.senderId, message.senderName ?? "用户")}
        onOpen={() => message.senderId && onOpenUser(message.senderId)}
        className={`relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full ring-2 ring-white transition active:scale-95 ${host ? "bg-amber-100 text-amber-700 shadow-[0_0_0_2px_#fbbf24]" : "bg-blue-100 text-primary shadow-sm"}`}
        ariaLabel={message.senderId ? `查看${message.senderName ?? "用户"}的主页，长按@他` : "未知用户"}
      >
        {message.senderAvatar
          ? <img className="h-10 w-10 rounded-full object-cover" src={message.senderAvatar} alt="" />
          : <span className="text-sm font-black">{message.senderName?.slice(0, 1) ?? "?"}</span>}
        {host && <Crown className="absolute -right-1 -top-1 rounded-full bg-amber-400 p-0.5 text-white ring-1 ring-white" size={15} />}
      </MentionableAvatarButton>
      <div className={`flex min-w-0 max-w-[78%] flex-col ${question ? "w-full max-w-[84%]" : ""} ${mine ? "items-end" : "items-start"}`}>
        <div className={`mb-1 flex max-w-full items-center gap-1.5 px-1 text-[11px] font-bold text-muted ${mine ? "flex-row-reverse" : ""}`}>
          <VipIdentity nickname={message.senderName ?? "未知用户"} userLevel={message.senderLevel} vipLevel={message.senderVipLevel} vipActive={message.senderVipActive} equippedBadge={message.senderEquippedBadge} className="max-w-full" />
          {host && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700"><Crown size={11} />主持人</span>}
          {question && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-black text-violet-700"><MessageCircle size={11} />{mysteryMode ? "正式行动" : "正式提问"} #{message.questionNumber}</span>}
        </div>
        <MessageActionMenu
          actions={[
            ...(canReply ? [{ label: "回复", onSelect: () => onReply(message) }] : []),
            { label: "复制", onSelect: () => onCopy(message.type === "sticker" ? `[表情] ${sticker?.text ?? "表情已下架"}` : message.content) },
            ...(canRecall ? [{ label: "撤回", tone: "danger" as const, availableUntil: new Date(message.createdAt).getTime() + 120_000, onSelect: () => onRecall(message) }] : [])
          ]}
          className="max-w-full"
        >
          <div className={`max-w-full rounded-2xl border px-3.5 py-2.5 text-sm leading-6 ${mine ? "rounded-br-md" : "rounded-bl-md"} ${bubbleTone}`}>
            {message.replyTo && <OnlineReplyQuote reply={message.replyTo} mine={mine || host || question} onLocate={() => void onLocate(message.replyTo!.id)} />}
            {message.type === "sticker"
              ? sticker
                ? <img className="h-28 w-28 object-contain sm:h-32 sm:w-32" src={sticker.animatedUrl} alt={sticker.text} loading="lazy" decoding="async" />
                : <span className={`inline-block rounded-xl px-3 py-2 text-sm ${host ? "bg-white/20 text-white" : "bg-slate-100 text-muted"}`}>表情已下架</span>
              : <p className="whitespace-pre-wrap break-words"><OnlineMessageText message={message} currentUserId={currentUserId} /></p>}
          </div>
        </MessageActionMenu>
        {question && (
          <div className={`mt-2 max-w-full rounded-xl border border-violet-200 bg-violet-50 px-2.5 py-2 ${mine ? "text-right" : "text-left"}`}>
            {isHost ? (
              <div className={`flex flex-wrap gap-1.5 ${mine ? "justify-end" : ""}`}>
                {(Object.keys(answerLabels) as OnlineSoupAnswer[]).map((value) => (
                  <button
                    key={value}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                      message.answer === value
                        ? "border-primary bg-primary text-white"
                        : "border-violet-200 bg-white text-violet-700 hover:border-violet-400"
                    }`}
                    onClick={() => onAnswer(message, value)}
                  >
                    {message.answer === value && <Check size={12} className="mr-1 inline" />}
                    {answerLabels[value]}
                  </button>
                ))}
              </div>
            ) : message.answer ? (
              <div className={`flex flex-wrap items-center gap-2 ${mine ? "justify-end" : ""}`}><span className="inline-flex items-center rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-bold text-white"><Check size={12} className="mr-1" />{onlineSoupAnswerPrefix(message.aiStatus)}{answerLabels[message.answer]}</span></div>
            ) : ["pending", "answering", "scoring"].includes(message.aiStatus) ? (
              <p className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-600" role="status"><LoaderCircle className="animate-spin" size={14} />{mysteryMode ? message.aiStatus === "pending" ? "行动等待裁决" : "正在行动中" : message.aiStatus === "pending" && message.aiQueuePosition && message.aiQueuePosition > 1 ? `AI 队列第 ${message.aiQueuePosition} 位` : message.aiStatus === "pending" ? "即将由 AI 处理" : "AI 正在结合汤底与上下文判断"}</p>
            ) : message.aiStatus === "failed" ? (
              <div className={`flex flex-wrap items-center gap-2 ${mine ? "justify-end" : ""}`}>
                <p className="text-xs font-bold text-red-600" role="alert">AI 回复失败：{message.aiError ?? "请稍后重试"}</p>
                {(mysteryMode ? mine : mine || canRetryAi) && <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-red-200 bg-white px-3 text-xs font-black text-red-600 transition hover:bg-red-50 disabled:opacity-50" disabled={retryingAi} onClick={() => onRetryAi(message)}>{retryingAi ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}{retryingAi ? "重试中" : "重新请求"}</button>}
              </div>
            ) : message.aiStatus === "completed" && mysteryMode ? (
              <p className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Check size={14} />行动已完成</p>
            ) : message.aiStatus === "cancelled" ? (
              <p className="text-xs font-bold text-muted">本轮已结束，AI 不再回复此提问</p>
            ) : (
              <p className="text-xs font-bold text-violet-500">等待主持人回复</p>
            )}
          </div>
        )}
        {question && Boolean(message.aiProgressDelta) && message.aiProgressAfter != null && (
          <div className={`mt-1.5 max-w-full px-1 text-xs font-bold text-muted ${mine ? "text-right" : "text-left"}`} role="status">
            — 进度+{message.aiProgressDelta}，该题完成后进度：{message.aiProgressAfter}% —
          </div>
        )}
        {question && message.aiStatus === "completed" && message.aiFeedback && (
          <div className={`mt-1.5 max-w-full rounded-lg px-2.5 py-1.5 text-xs font-bold ${message.aiProgressDelta ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"} ${mine ? "text-right" : "text-left"}`} role="status">{message.aiFeedback}</div>
        )}
        <time className="mt-1 select-none px-1 text-[10px] text-muted [-webkit-touch-callout:none]">{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
      </div>
    </div>
  );
}, (previous, next) => (
  previous.message === next.message
  && previous.currentUserId === next.currentUserId
  && previous.isHost === next.isHost
  && previous.mysteryMode === next.mysteryMode
  && previous.canRetryAi === next.canRetryAi
  && previous.retryingAi === next.retryingAi
  && previous.canReply === next.canReply
  && previous.soupId === next.soupId
  && previous.stickers === next.stickers
));
