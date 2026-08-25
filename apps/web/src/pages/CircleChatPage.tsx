import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, AtSign, ChevronDown, Gift, Reply, Send, Smile, Users, Wifi, WifiOff, X } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { CircleMember, CircleMessage, CircleMessageReply, CircleRedPacketDetail, CircleSummary, StickerAsset, StickerSeries } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { Modal } from "../components/Modal";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";
import { LevelBadge } from "../components/LevelBadge";
import { VipIdentity } from "../components/VipIdentity";
import { connectCircleSocket } from "../shared/circleSocket";
import { OnlineSoupRoomInviteCard } from "../components/OnlineSoupRoomInviteCard";
import { SoupShareCard } from "../components/SoupShareCard";
import { GiftMessageBundle, GiftMessageCard } from "../components/GiftMessageCard";
import { CircleRedPacketCard } from "../components/CircleRedPacketCard";
import { StickerKeyboard } from "../components/StickerKeyboard";
import { ChatComposerIconButton } from "../components/ChatComposerIconButton";
import { canRecallMessage, MessageActionMenu, RecalledMessageNotice } from "../components/MessageActionMenu";
import { MentionableAvatarButton } from "../components/MentionableAvatarButton";
import { giftTimelineEntries } from "../shared/giftTimeline";
import { useKeepMessageListPinned } from "../shared/useKeepMessageListPinned";

type CircleState = {
  circle: Omit<CircleSummary, "isJoined" | "latestMessage" | "unreadMention" | "unclaimedRedPacket">;
  members: CircleMember[];
};
type MessagePage = { messages: CircleMessage[]; hasMore: boolean; nextCursor: string | null };
type SendResponse = { message: CircleMessage };
type UnreadMention = { id: string; sequence: number };
type UnclaimedRedPacket = { packetId: string; messageId: string; sequence: number; expiresAt: string };
type MentionRequest = { userId: string; nickname: string; key: number };

function circleMemberOrder(a: CircleMember, b: CircleMember) {
  const onlineRank = Number(b.isOnline) - Number(a.isOnline);
  if (onlineRank) return onlineRank;
  const vipRank = Number(b.vipActive) - Number(a.vipActive);
  if (vipRank) return vipRank;
  const levelRank = b.level - a.level;
  if (levelRank) return levelRank;
  const joinedRank = a.joinedAt.localeCompare(b.joinedAt);
  if (joinedRank) return joinedRank;
  return a.id.localeCompare(b.id);
}

function Avatar({ avatar, nickname, online, grayscaleWhenOffline = false, size = "h-10 w-10" }: { avatar: string | null; nickname: string; online: boolean; grayscaleWhenOffline?: boolean; size?: string }) {
  return (
    <span className={`relative grid shrink-0 place-items-center ${size}`}>
      <span className={`grid h-full w-full place-items-center overflow-hidden rounded-full bg-blue-100 text-sm font-black text-primary ${grayscaleWhenOffline && !online ? "grayscale" : ""}`}>
        {avatar ? <img className="h-full w-full object-cover" src={avatar} alt="" draggable={false} /> : nickname.slice(0, 1)}
      </span>
      {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}
    </span>
  );
}

function CircleMessageText({ message, currentUserId }: { message: CircleMessage; currentUserId: string }) {
  const selfMention = message.mentions.find((mention) => mention.userId === currentUserId);
  if (!selfMention) return <>{message.content}</>;
  const token = `@${selfMention.nickname}`;
  const parts = message.content.split(token);
  return <>
    {parts.map((part, index) => (
      <span key={`${message.id}-${index}`}>
        {index > 0 && <span className="font-bold text-blue-500">{token}</span>}
        {part}
      </span>
    ))}
  </>;
}

function messagePreview(message: CircleMessage | CircleMessageReply) {
  if (message.recalledAt) return "[消息已撤回]";
  if (message.type === "sticker") return `[表情] ${message.stickerName ?? "表情"}`;
  if (message.type === "room_invite") return "[游戏房间邀请]";
  if (message.type === "soup_share") return "[海龟汤分享]";
  if (message.type === "gift") return `[礼物] ${message.gift?.giftName ?? "礼物"} ×${message.gift?.quantity ?? 1}`;
  if (message.type === "red_packet") return "[系统红包]";
  return message.content.trim() || "[空消息]";
}

function ReplyQuote({ reply, mine, onLocate }: {
  reply: CircleMessageReply;
  mine: boolean;
  onLocate: () => void;
}) {
  return (
    <button
      type="button"
      className={`mt-2 block w-full truncate rounded-lg border-l-2 px-2.5 py-1.5 text-left text-xs ${
        mine
          ? "border-white/60 bg-white/15 text-white/85"
          : "border-blue-300 bg-slate-100/90 text-muted hover:bg-blue-50"
      }`}
      onClick={onLocate}
      title="点击定位到原消息"
    >
      <span className={`mr-1 font-bold ${mine ? "text-white" : "text-primary"}`}>
        {reply.sender?.nickname ?? "已注销用户"}:
      </span>
      {messagePreview(reply)}
    </button>
  );
}

export default function CircleChatPage() {
  const { circleId = "" } = useParams();
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<CircleState | null>(null);
  const [messages, setMessages] = useState<CircleMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [stickerSeries, setStickerSeries] = useState<StickerSeries[]>([]);
  const [stickersLoading, setStickersLoading] = useState(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [unreadMentions, setUnreadMentions] = useState<UnreadMention[]>([]);
  const [unclaimedRedPackets, setUnclaimedRedPackets] = useState<UnclaimedRedPacket[]>([]);
  const [mentionRequest, setMentionRequest] = useState<MentionRequest | null>(null);
  const [navigatingMention, setNavigatingMention] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CircleMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const firstScrollRef = useRef(false);
  const followBottomRef = useRef(true);
  useKeepMessageListPinned(messagesRef, followBottomRef);
  const handledMentionNavigationRef = useRef("");
  const highlightTimerRef = useRef<number | null>(null);
  const requestedMentionId = (location.state as { circleMentionMessageId?: string } | null)?.circleMentionMessageId ?? "";

  async function refreshUnclaimedRedPackets() {
    const data = await api<{ packets: UnclaimedRedPacket[] }>(`/api/circles/${circleId}/red-packets/unclaimed`, { bypassCache: true, dedupe: false });
    setUnclaimedRedPackets(data.packets);
  }

  function applyRedPacketDetail(detail: CircleRedPacketDetail) {
    setMessages((current) => current.map((message) => message.redPacket?.id === detail.id
      ? { ...message, redPacket: { ...message.redPacket, claimedCount: detail.claimedCount, myAmount: detail.myAmount } }
      : message));
  }

  async function refreshRedPacketMessageStatus(packetId: string) {
    const data = await api<{ packet: CircleRedPacketDetail }>(`/api/circles/${circleId}/red-packets/${packetId}`, { bypassCache: true, dedupe: false });
    applyRedPacketDetail(data.packet);
  }

  async function loadInitial() {
    const [detail, page, mentionData, packetData] = await Promise.all([
      api<CircleState>(`/api/circles/${circleId}`, { bypassCache: true, dedupe: false }),
      api<MessagePage>(`/api/circles/${circleId}/messages?limit=100`, { bypassCache: true, dedupe: false }),
      api<{ mentions: UnreadMention[] }>(`/api/circles/${circleId}/mentions`, { bypassCache: true, dedupe: false }),
      api<{ packets: UnclaimedRedPacket[] }>(`/api/circles/${circleId}/red-packets/unclaimed`, { bypassCache: true, dedupe: false })
    ]);
    setState(detail);
    setMessages(page.messages);
    setHasMore(page.hasMore);
    setNextCursor(page.nextCursor);
    setUnreadMentions(mentionData.mentions);
    setUnclaimedRedPackets(packetData.packets);
    void markRead();
  }

  function markRead() {
    return api(`/api/circles/${circleId}/read`, { method: "PATCH" }).catch(() => {});
  }

  function markAllMentionsRead() {
    return api(`/api/circles/${circleId}/mentions/read-all`, { method: "PATCH" }).catch(() => {});
  }

  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
      navigate("/circles", { replace: true });
      return;
    }
    firstScrollRef.current = false;
    setLoading(true);
    void loadInitial()
      .catch((error) => {
        showToast((error as Error).message);
        navigate("/circles", { replace: true });
      })
      .finally(() => setLoading(false));
  }, [circleId, user?.id, loadingUser]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current != null) window.clearTimeout(highlightTimerRef.current);
      window.setTimeout(() => {
        if (window.location.pathname !== `/circles/${circleId}`) void markAllMentionsRead();
      }, 0);
    };
  }, [circleId]);

  useEffect(() => {
    const expiries = unclaimedRedPackets.map((packet) => new Date(packet.expiresAt).getTime()).filter((value) => value > Date.now());
    if (!expiries.length) return;
    const timer = window.setTimeout(() => {
      setUnclaimedRedPackets((current) => current.filter((packet) => new Date(packet.expiresAt).getTime() > Date.now()));
    }, Math.min(...expiries) - Date.now() + 100);
    return () => window.clearTimeout(timer);
  }, [unclaimedRedPackets]);

  useEffect(() => {
    void api<{ series: StickerSeries[] }>("/api/stickers", { cacheTtlMs: 30 * 60_000 })
      .then((data) => setStickerSeries(data.series))
      .catch(() => {})
      .finally(() => setStickersLoading(false));
  }, []);

  useEffect(() => {
    if (!user || !state) return;
    return connectCircleSocket(circleId, ({ event, payload }) => {
      if (event === "circle_message_created") {
        const message = payload?.message as CircleMessage | undefined;
        if (!message) return;
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (user && message.mentions.some((mention) => mention.userId === user.id)) {
          setUnreadMentions((current) => current.some((mention) => mention.id === message.id)
            ? current
            : [...current, { id: message.id, sequence: message.sequence }]);
        }
        void markRead();
        if (message.type === "red_packet") void refreshUnclaimedRedPackets().catch(() => {});
      } else if (event === "circle_message_recalled") {
        const messageId = String(payload?.messageId ?? "");
        const recalledAt = String(payload?.recalledAt ?? "");
        if (!messageId || !recalledAt) return;
        setMessages((current) => current.map((message) => message.id === messageId
          ? { ...message, content: "", stickerId: null, roomInvite: null, soupShare: null, mentions: [], recalledAt }
          : message.replyTo?.id === messageId
            ? { ...message, replyTo: { ...message.replyTo, content: "", stickerId: null, recalledAt } }
            : message));
        setUnreadMentions((current) => current.filter((mention) => mention.id !== messageId));
        setReplyingTo((current) => current?.id === messageId ? null : current);
      } else if (event === "circle_member_presence") {
        const userId = String(payload?.userId ?? "");
        const online = Boolean(payload?.online);
        setState((current) => current ? {
          ...current,
          circle: {
            ...current.circle,
            onlineCount: current.members.reduce((count, member) => count + (member.id === userId ? Number(online) : Number(member.isOnline)), 0)
          },
          members: current.members.map((member) => member.id === userId ? { ...member, isOnline: online } : member)
        } : current);
        setMessages((current) => current.map((message) => message.sender?.id === userId
          ? { ...message, sender: { ...message.sender, isOnline: online } }
          : message));
      } else if (event === "circle_member_joined") {
        const member = payload?.member as CircleMember | undefined;
        if (!member) return;
        setState((current) => current && !current.members.some((item) => item.id === member.id)
          ? {
              ...current,
              circle: {
                ...current.circle,
                memberCount: current.circle.memberCount + 1,
                onlineCount: current.circle.onlineCount + Number(member.isOnline)
              },
              members: [...current.members, member]
            }
          : current);
      } else if (event === "circle_updated") {
        const circle = payload?.circle as { name?: string; avatar?: string; updatedAt?: string } | undefined;
        if (circle) setState((current) => current ? { ...current, circle: { ...current.circle, ...circle } } : current);
      } else if (event === "circle_red_packet_changed") {
        const packetId = String(payload?.packetId ?? "");
        void refreshUnclaimedRedPackets().catch(() => {});
        if (packetId) void refreshRedPacketMessageStatus(packetId).catch(() => {});
      } else if (event === "circle_deleted") {
        showToast("该圈子已被删除");
        navigate("/circles", { replace: true });
      }
    }, (connected) => {
      setSocketConnected(connected);
      if (!connected) return;
      void api<MessagePage>(`/api/circles/${circleId}/messages?limit=100`, { bypassCache: true, dedupe: false })
        .then((page) => {
          setMessages((current) => {
            const merged = new Map(current.map((message) => [message.id, message]));
            for (const message of page.messages) merged.set(message.id, message);
            return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
          });
        })
        .catch(() => undefined);
    });
  }, [circleId, user?.id, Boolean(state)]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container || loading) return;
    if (!firstScrollRef.current) {
      container.scrollTop = container.scrollHeight;
      firstScrollRef.current = true;
      return;
    }
    if (followBottomRef.current) container.scrollTop = container.scrollHeight;
  }, [messages.length, loading]);

  useEffect(() => {
    if (loading || !state || !requestedMentionId || handledMentionNavigationRef.current === requestedMentionId) return;
    handledMentionNavigationRef.current = requestedMentionId;
    void openMention({ id: requestedMentionId, sequence: 0 }).finally(() => {
      navigate(location.pathname, { replace: true, state: null });
    });
  }, [loading, state?.circle.id, requestedMentionId]);

  async function loadOlder() {
    if (!hasMore || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    const container = messagesRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    try {
      const page = await api<MessagePage>(`/api/circles/${circleId}/messages?limit=100&before=${encodeURIComponent(nextCursor)}`, { bypassCache: true, dedupe: false });
      setMessages((current) => [...page.messages, ...current]);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - previousHeight;
      });
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function locateMessage(messageId: string, missingMessage = "未找到被回复的原消息") {
    let loadedMessages = messages;
    let cursor = nextCursor;
    let more = hasMore;
    while (!loadedMessages.some((message) => message.id === messageId) && more && cursor) {
      const page = await api<MessagePage>(
        `/api/circles/${circleId}/messages?limit=100&before=${encodeURIComponent(cursor)}`,
        { bypassCache: true, dedupe: false }
      );
      loadedMessages = [...page.messages, ...loadedMessages];
      cursor = page.nextCursor;
      more = page.hasMore;
    }
    if (!loadedMessages.some((message) => message.id === messageId)) {
      showToast(missingMessage);
      return false;
    }
    setMessages(loadedMessages);
    setNextCursor(cursor);
    setHasMore(more);
    followBottomRef.current = false;
    if (highlightTimerRef.current != null) window.clearTimeout(highlightTimerRef.current);
    setHighlightedMessageId(messageId);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById(`circle-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(""), 1800);
    return true;
  }

  async function openMention(target: UnreadMention) {
    if (navigatingMention) return;
    setNavigatingMention(true);
    try {
      await locateMessage(target.id);
      await api(`/api/circles/${circleId}/mentions/${target.id}/read`, { method: "PATCH" });
      setUnreadMentions((current) => current.filter((mention) => mention.id !== target.id));
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setNavigatingMention(false);
    }
  }

  async function openReplyTarget(messageId: string) {
    if (navigatingMention) return;
    setNavigatingMention(true);
    try {
      await locateMessage(messageId);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setNavigatingMention(false);
    }
  }

  async function openNextMention() {
    const target = unreadMentions[unreadMentions.length - 1];
    if (!target) return;
    await openMention(target);
  }

  async function openLatestUnclaimedRedPacket() {
    const target = unclaimedRedPackets[unclaimedRedPackets.length - 1];
    if (!target || navigatingMention) return;
    setNavigatingMention(true);
    try {
      await locateMessage(target.messageId, "未找到未领取红包");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setNavigatingMention(false);
    }
  }

  function mentionMember(member: Pick<CircleMember, "id" | "nickname">) {
    if (member.id === user?.id) return;
    setStickersOpen(false);
    setMentionRequest({ userId: member.id, nickname: member.nickname, key: Date.now() });
    showToast(`已@${member.nickname}`);
  }

  function openMemberProfile(member: Pick<CircleMember, "id">) {
    navigate(member.id === user?.id ? "/mine" : `/users/${member.id}`, {
      state: member.id === user?.id ? undefined : { circleId }
    });
  }

  function beginReply(message: CircleMessage) {
    setStickersOpen(false);
    setReplyingTo(message);
  }

  async function recallMessage(message: CircleMessage) {
    try {
      const result = await api<{ messageId: string; recalledAt: string }>(
        `/api/circles/${circleId}/messages/${message.id}/recall`,
        { method: "PATCH" }
      );
      setMessages((current) => current.map((item) => item.id === result.messageId
        ? { ...item, content: "", stickerId: null, roomInvite: null, soupShare: null, mentions: [], recalledAt: result.recalledAt }
        : item.replyTo?.id === result.messageId
          ? { ...item, replyTo: { ...item.replyTo, content: "", stickerId: null, recalledAt: result.recalledAt } }
          : item));
      setUnreadMentions((current) => current.filter((mention) => mention.id !== result.messageId));
      setReplyingTo((current) => current?.id === result.messageId ? null : current);
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  async function sendText(value: string, mentionedUserIds: string[]) {
    const content = value.trim();
    if (!content || sending) return false;
    setSending(true);
    try {
      followBottomRef.current = true;
      const data = await api<SendResponse>(`/api/circles/${circleId}/messages`, {
        method: "POST",
        body: { content, mentionedUserIds, replyToMessageId: replyingTo?.id }
      });
      setMessages((current) => current.some((item) => item.id === data.message.id) ? current : [...current, data.message]);
      setReplyingTo(null);
      void markRead();
      return true;
    } catch (error) {
      showToast((error as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendSticker(sticker: StickerAsset) {
    if (sending) return;
    setSending(true);
    setStickersOpen(false);
    try {
      followBottomRef.current = true;
      const data = await api<SendResponse>(`/api/circles/${circleId}/messages`, {
        method: "POST",
        body: { stickerId: sticker.id, replyToMessageId: replyingTo?.id }
      });
      setMessages((current) => current.some((item) => item.id === data.message.id) ? current : [...current, data.message]);
      setReplyingTo(null);
      void markRead();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  const stickersById = useMemo(() => new Map(
    stickerSeries.flatMap((series) => series.stickers.map((sticker) => [sticker.id, sticker] as const))
  ), [stickerSeries]);

  if (loadingUser || loading || !state) {
    return <section className="h-[100dvh] overflow-hidden bg-page pt-[72px] lg:p-5 lg:pt-5"><div className="lg:hidden"><PageTopBar title="圈子" backTo="/circles" /></div><div className="mx-auto h-full max-w-3xl px-4 lg:max-w-[1388px] lg:rounded-[28px] lg:bg-white lg:p-6"><ListSkeleton rows={8} /></div></section>;
  }

  return (
    <section className="h-[100dvh] overflow-hidden bg-page pt-[72px] lg:p-5 lg:pt-5">
      <div className="lg:hidden">
        <PageTopBar
          title={state.circle.name}
          titleContent={(
            <span className="flex min-w-0 items-center gap-2.5">
              <img className="h-9 w-9 shrink-0 rounded-xl object-cover" src={state.circle.avatar} alt="" />
              <span className="min-w-0">
                <span className="block max-w-40 truncate text-base font-black text-ink sm:max-w-64">{state.circle.name}</span>
                <span className="flex items-center gap-1 text-[10px] font-bold text-muted">
                  {socketConnected ? <Wifi size={11} className="text-emerald-600" /> : <WifiOff size={11} className="text-red-500" />}
                  {state.circle.onlineCount} 人在线
                </span>
              </span>
            </span>
          )}
          titleTo="/circles"
          backTo="/circles"
          rightAction={(
            <button className="relative grid h-10 w-10 place-items-center rounded-full bg-white text-primary shadow-soft" onClick={() => setMembersOpen(true)} aria-label="成员列表">
              <Users size={19} />
              <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-black text-white">{state.circle.memberCount > 99 ? "99+" : state.circle.memberCount}</span>
            </button>
          )}
        />
      </div>

      <div className="mx-auto flex h-[calc(100dvh-72px)] max-w-3xl flex-col lg:h-full lg:max-w-[1388px] lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-line lg:bg-white lg:shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
        <header className="hidden h-20 shrink-0 items-center justify-between border-b border-line bg-white px-6 lg:flex">
          <div className="flex min-w-0 items-center gap-4">
            <button className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-line bg-slate-50 text-ink transition hover:border-blue-200 hover:bg-blue-50 hover:text-primary" onClick={() => navigate("/circles")} aria-label="返回圈子列表"><ArrowLeft size={21} /></button>
            <img className="h-12 w-12 shrink-0 rounded-2xl object-cover shadow-sm" src={state.circle.avatar} alt={`${state.circle.name}头像`} />
            <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-xl font-black text-ink">{state.circle.name}</h1><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black text-primary">圈子聊天</span></div><p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-muted">{socketConnected ? <Wifi size={13} className="text-emerald-600" /> : <WifiOff size={13} className="text-red-500" />}<span className={socketConnected ? "text-emerald-600" : "text-red-500"}>{socketConnected ? "实时连接" : "正在重连"}</span><span>·</span><span>{state.circle.onlineCount} 人在线</span></p></div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted"><span>消息实时同步</span><span className="h-4 w-px bg-line" /><span className="font-bold text-ink">{state.circle.memberCount} 位成员</span></div>
        </header>

        <div className="min-h-0 min-w-0 flex flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-page">
        <div
          ref={messagesRef}
          className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 lg:px-8 lg:py-6"
          onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            followBottomRef.current = nearBottom;
            setShowScrollBottom(!nearBottom);
          }}
        >
          {hasMore && <button className="mx-auto block rounded-full bg-white px-4 py-2 text-xs font-bold text-primary shadow-sm" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "加载中…" : "加载更早消息"}</button>}
          {giftTimelineEntries(messages).map((entry) => {
            if (entry.kind === "gift_bundle") {
              const mine = entry.gifts[0]?.sender.id === user?.id;
              return <GiftMessageBundle
                key={entry.key}
                gifts={entry.gifts}
                align={mine ? "right" : "left"}
                anchorIds={entry.messages.map((message) => `circle-message-${message.id}`)}
                highlighted={entry.messages.some((message) => message.id === highlightedMessageId)}
              />;
            }
            const message = entry.message;
            const mine = message.sender?.id === user?.id;
            const senderName = message.sender?.nickname ?? "已注销用户";
            const sticker = message.stickerId ? stickersById.get(message.stickerId) : null;
            if (message.recalledAt) {
              return <div id={`circle-message-${message.id}`} key={message.id} className="scroll-mt-24"><RecalledMessageNotice mine={mine} senderName={senderName} /></div>;
            }
            if (message.type === "red_packet" && message.redPacket) {
              return <div id={`circle-message-${message.id}`} key={message.id} className={`scroll-mt-24 rounded-2xl px-1 py-1 outline-offset-4 transition-[outline-color,background-color] ${highlightedMessageId === message.id ? "bg-red-50 outline outline-2 outline-red-300" : "outline-transparent"}`}>
                <div className="mb-1 text-[11px] font-bold text-muted">系统红包</div>
                <CircleRedPacketCard circleId={circleId} packet={message.redPacket} onStatusChange={(detail) => { applyRedPacketDetail(detail); void refreshUnclaimedRedPackets().catch(() => {}); }} />
                <span className="mt-1 block px-1 text-[10px] text-muted">{new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
              </div>;
            }
            const messageActions = [
              { label: "回复", onSelect: () => beginReply(message) },
              ...(message.type !== "gift" && message.type !== "red_packet" && mine && canRecallMessage(message.createdAt, message.recalledAt)
                ? [{ label: "撤回", tone: "danger" as const, availableUntil: new Date(message.createdAt).getTime() + 120_000, onSelect: () => void recallMessage(message) }]
                : [])
            ];
            return (
              <div
                id={`circle-message-${message.id}`}
                key={message.id}
                className={`flex scroll-mt-24 items-start gap-2.5 rounded-2xl outline-offset-4 transition-[outline-color,background-color] ${
                  mine ? "flex-row-reverse" : ""
                } ${highlightedMessageId === message.id ? "bg-blue-100/70 outline outline-2 outline-blue-300" : "outline-transparent"}`}
              >
                <MentionableAvatarButton
                  canMention={Boolean(message.sender && message.sender.id !== user?.id)}
                  onMention={() => {
                    if (!message.sender) return;
                    mentionMember(message.sender);
                  }}
                  onOpen={() => {
                    if (!message.sender) return;
                    openMemberProfile(message.sender);
                  }}
                  ariaLabel={message.sender && message.sender.id !== user?.id ? `查看${senderName}的主页，长按@他` : `查看${senderName}的主页`}
                >
                  <Avatar avatar={message.sender?.avatar ?? null} nickname={senderName} online={Boolean(message.sender?.isOnline)} />
                </MentionableAvatarButton>
                <div className={`flex min-w-0 max-w-[78%] flex-col ${message.type === "soup_share" || message.type === "room_invite" || message.type === "gift" ? "w-[78%]" : ""} ${mine ? "items-end" : "items-start"}`}>
                  <div className={`mb-1 flex max-w-full items-center gap-1.5 px-1 text-[11px] text-muted ${mine ? "flex-row-reverse" : ""}`}>
                    {message.sender ? <VipIdentity nickname={senderName} userLevel={message.sender.level} vipLevel={message.sender.vipLevel} vipActive={message.sender.vipActive} equippedBadge={message.sender.equippedBadge} preserveNickname vipIconBeforeNickname className="max-w-full" /> : <span className="max-w-28 truncate font-bold text-ink">{senderName}</span>}
                  </div>
                  <MessageActionMenu
                    actions={messageActions}
                    className={message.type === "soup_share" || message.type === "room_invite" ? "w-full" : "max-w-full"}
                  >
                    {message.type === "room_invite" && message.roomInvite ? (
                      <div>
                        <OnlineSoupRoomInviteCard invite={message.roomInvite} align={mine ? "right" : "left"} />
                        {message.replyTo && <ReplyQuote reply={message.replyTo} mine={false} onLocate={() => void openReplyTarget(message.replyTo!.id)} />}
                      </div>
                    ) : message.type === "soup_share" && message.soupShare ? (
                      <div>
                        <SoupShareCard soup={message.soupShare} align={mine ? "right" : "left"} />
                        {message.replyTo && <ReplyQuote reply={message.replyTo} mine={false} onLocate={() => void openReplyTarget(message.replyTo!.id)} />}
                      </div>
                    ) : message.type === "gift" && message.gift ? (
                      <GiftMessageCard gift={message.gift} />
                    ) : message.type === "sticker" ? (
                      <div className={mine ? "text-right" : "text-left"}>
                        {sticker
                          ? <img className="inline-block h-36 w-36 object-contain sm:h-40 sm:w-40" src={sticker.animatedUrl} alt={sticker.text} loading="lazy" decoding="async" />
                          : <span className="inline-block rounded-xl bg-slate-100 px-3 py-2 text-sm text-muted">表情已下架</span>}
                        {message.replyTo && <ReplyQuote reply={message.replyTo} mine={false} onLocate={() => void openReplyTarget(message.replyTo!.id)} />}
                      </div>
                    ) : (
                      <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${mine ? "rounded-br-md bg-primary text-white" : "rounded-bl-md bg-white text-ink shadow-sm"}`}>
                        <p className="whitespace-pre-wrap break-words"><CircleMessageText message={message} currentUserId={user?.id ?? ""} /></p>
                        {message.replyTo && <ReplyQuote reply={message.replyTo} mine={mine} onLocate={() => void openReplyTarget(message.replyTo!.id)} />}
                      </div>
                    )}
                  </MessageActionMenu>
                  <span className="mt-1 px-1 text-[10px] text-muted">{new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
              </div>
            );
          })}
          {!messages.length && <p className="py-20 text-center text-sm text-muted">发送第一条消息吧</p>}
        </div>

        {!stickersOpen && (unreadMentions.length > 0 || unclaimedRedPackets.length > 0 || showScrollBottom) && <div className="fixed bottom-20 right-4 z-30 flex flex-col-reverse items-center gap-2 lg:absolute lg:bottom-24 lg:right-6">
          {showScrollBottom && <button className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-primary shadow-[0_8px_24px_rgba(15,23,42,0.2)]" onClick={() => { followBottomRef.current = true; messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); setShowScrollBottom(false); }} aria-label="回到底部"><ChevronDown size={22} /></button>}
          {unreadMentions.length > 0 && <button
            className="relative grid h-11 w-11 place-items-center rounded-full border border-blue-200 bg-primary text-white shadow-[0_8px_24px_rgba(15,23,42,0.2)]"
            disabled={navigatingMention}
            onClick={() => void openNextMention()}
            aria-label={`查看@我的消息，剩余${unreadMentions.length}条`}
          >
            <AtSign size={22} />
            <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
              {unreadMentions.length > 99 ? "99+" : unreadMentions.length}
            </span>
          </button>}
          {unclaimedRedPackets.length > 0 && <button
            className="relative grid h-11 w-11 place-items-center rounded-full border border-red-200 bg-red-500 text-white shadow-[0_8px_24px_rgba(15,23,42,0.2)] transition-colors hover:bg-red-600 disabled:opacity-60"
            disabled={navigatingMention}
            onClick={() => void openLatestUnclaimedRedPacket()}
            aria-label={`定位到未领取红包，共${unclaimedRedPackets.length}个`}
            title="定位到未领取红包"
          >
            <Gift size={21} />
            <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-red-950">
              {unclaimedRedPackets.length > 99 ? "99+" : unclaimedRedPackets.length}
            </span>
          </button>}
        </div>}
        <Composer
          members={state.members}
          currentUserId={user?.id ?? ""}
          mentionRequest={mentionRequest}
          replyTo={replyingTo}
          sending={sending}
          stickersOpen={stickersOpen}
          onToggleStickers={() => setStickersOpen((value) => !value)}
          onCancelReply={() => setReplyingTo(null)}
          onSend={sendText}
        />
        {stickersOpen && <StickerKeyboard series={stickerSeries} loading={stickersLoading} sending={sending} onClose={() => setStickersOpen(false)} onSend={sendSticker} className="shrink-0 border-t border-line px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3" />}
          </div>

          <aside className="hidden min-h-0 flex-col bg-white lg:flex">
            <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="font-black text-ink">圈子成员</h2><p className="mt-0.5 text-xs text-muted">{state.circle.onlineCount} 人当前在线</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-muted">{state.circle.memberCount}</span></div>
            <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-3">
              {[...state.members].sort(circleMemberOrder).map((member) => (
                <div key={member.id} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-slate-50">
                  <MentionableAvatarButton
                    canMention={member.id !== user?.id}
                    onMention={() => mentionMember(member)}
                    onOpen={() => openMemberProfile(member)}
                    ariaLabel={member.id !== user?.id ? `查看${member.nickname}的主页，长按@他` : "查看我的主页"}
                  >
                    <Avatar avatar={member.avatar} nickname={member.nickname} online={member.isOnline} grayscaleWhenOffline size="h-11 w-11" />
                  </MentionableAvatarButton>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openMemberProfile(member)}>
                    <VipIdentity nickname={member.nickname} userLevel={member.level} vipLevel={member.vipLevel} vipActive={member.vipActive} equippedBadge={member.equippedBadge} preserveNickname className="max-w-full" />
                    <span className={`mt-1 block text-xs ${member.isOnline ? "font-bold text-emerald-600" : "text-muted"}`}>{member.isOnline ? "在线" : "离线"}</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-line bg-slate-50/70 px-5 py-3 text-xs leading-5 text-muted">长按头像可快速 @ 对方；长按或右键聊天气泡可回复消息。</div>
          </aside>
        </div>
      </div>

      {membersOpen && <Modal onClose={() => setMembersOpen(false)}>
        <div className="space-y-3">
          <div><h2 className="text-xl font-black text-ink">圈子成员</h2><p className="mt-1 text-sm text-muted">{state.circle.memberCount} 位成员 · {state.circle.onlineCount} 人在线</p></div>
          <div className="max-h-[65vh] divide-y divide-line overflow-y-auto">
            {[...state.members].sort(circleMemberOrder).map((member) => (
              <button
                key={member.id}
                className="flex w-full items-center gap-3 py-3 text-left"
                onClick={() => navigate(member.id === user?.id ? "/mine" : `/users/${member.id}`, {
                  state: member.id === user?.id ? undefined : { circleId }
                })}
              >
                <Avatar avatar={member.avatar} nickname={member.nickname} online={member.isOnline} grayscaleWhenOffline size="h-11 w-11" />
                <span className="min-w-0 flex-1"><VipIdentity nickname={member.nickname} userLevel={member.level} vipLevel={member.vipLevel} vipActive={member.vipActive} equippedBadge={member.equippedBadge} preserveNickname className="max-w-full" /><span className={`mt-0.5 block text-xs ${member.isOnline ? "text-emerald-600" : "text-muted"}`}>{member.isOnline ? "在线" : "离线"}</span></span>
              </button>
            ))}
          </div>
        </div>
      </Modal>}
    </section>
  );
}

function activeMentionAt(content: string, cursor: number) {
  const beforeCursor = content.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;
  const query = beforeCursor.slice(atIndex + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: atIndex, end: cursor, query };
}

function Composer({ members, currentUserId, mentionRequest, replyTo, sending, stickersOpen, onToggleStickers, onCancelReply, onSend }: {
  members: CircleMember[];
  currentUserId: string;
  mentionRequest: MentionRequest | null;
  replyTo: CircleMessage | null;
  sending: boolean;
  stickersOpen: boolean;
  onToggleStickers: () => void;
  onCancelReply: () => void;
  onSend: (value: string, mentionedUserIds: string[]) => Promise<boolean>;
}) {
  const [content, setContent] = useState("");
  const [mentionedUsers, setMentionedUsers] = useState<Array<{ userId: string; nickname: string }>>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeMention = activeMentionAt(content, cursorPosition);
  const mentionCandidates = activeMention
    ? members
      .filter((member) => member.id !== currentUserId)
      .filter((member) => member.nickname.toLocaleLowerCase("zh-CN").includes(activeMention.query.toLocaleLowerCase("zh-CN")))
      .slice(0, 5)
    : [];

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
      const nextCursor = inputRef.current?.value.length ?? 0;
      setCursorPosition(nextCursor);
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [mentionRequest?.key]);

  useEffect(() => {
    if (!replyTo) return;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [replyTo?.id]);

  function chooseMention(member: CircleMember) {
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
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = content.trim();
    if (!value || sending) return;
    const activeMentionIds = mentionedUsers
      .filter((mention) => value.includes(`@${mention.nickname}`))
      .map((mention) => mention.userId);
    setContent("");
    if (await onSend(value, activeMentionIds)) setMentionedUsers([]);
    else setContent((current) => current || value);
  }
  return (
    <form className={`relative z-20 shrink-0 border-t border-line bg-white/95 px-3 pt-3 backdrop-blur ${stickersOpen ? "pb-3" : "pb-[max(12px,env(safe-area-inset-bottom))]"}`} onSubmit={submit}>
      {mentionCandidates.length > 0 && (
        <div className="absolute inset-x-0 bottom-full z-40 border-b border-line bg-white shadow-[0_-10px_30px_rgba(15,23,42,0.12)]">
          <div className="mx-auto max-w-3xl divide-y divide-line px-3">
            {mentionCandidates.map((member) => (
              <button
                key={member.id}
                type="button"
                className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition hover:bg-slate-50 active:bg-slate-100"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => chooseMention(member)}
              >
                <Avatar avatar={member.avatar} nickname={member.nickname} online={member.isOnline} size="h-10 w-10" />
                <span className="min-w-0 flex-1">
                  <VipIdentity nickname={member.nickname} userLevel={member.level} vipLevel={member.vipLevel} vipActive={member.vipActive} equippedBadge={member.equippedBadge} preserveNickname className="max-w-full text-sm font-bold text-ink" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {replyTo && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2">
          <Reply size={16} className="shrink-0 text-primary" />
          <p className="min-w-0 flex-1 truncate text-xs text-muted">
            <span className="font-bold text-primary">回复 {replyTo.sender?.nickname ?? "已注销用户"}：</span>
            {messagePreview(replyTo)}
          </p>
          <button
            type="button"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-white hover:text-ink"
            onClick={onCancelReply}
            aria-label="取消回复"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-1">
        <textarea
          ref={inputRef}
          className="field h-11 max-h-28 min-h-11 flex-1 resize-none py-[10px] leading-[22px]"
          rows={1}
          maxLength={1000}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setCursorPosition(event.target.selectionStart ?? event.target.value.length);
            if (stickersOpen && activeMentionAt(event.target.value, event.target.selectionStart ?? event.target.value.length)) onToggleStickers();
          }}
          onFocus={() => { if (stickersOpen) onToggleStickers(); }}
          onClick={(event) => setCursorPosition(event.currentTarget.selectionStart ?? content.length)}
          onKeyUp={(event) => setCursorPosition(event.currentTarget.selectionStart ?? content.length)}
          placeholder="输入消息"
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
        />
        <ChatComposerIconButton tone={stickersOpen ? "active" : "neutral"} onClick={() => { if (!stickersOpen) inputRef.current?.blur(); onToggleStickers(); }} aria-label="表情包" title="表情包"><Smile size={23} /></ChatComposerIconButton>
        <ChatComposerIconButton type="submit" tone="send" disabled={!content.trim() || sending} aria-label="发送" title="发送"><Send size={22} /></ChatComposerIconButton>
      </div>
    </form>
  );
}
