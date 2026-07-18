import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AtSign, ChevronDown, Send, Smile, Users, Wifi, WifiOff } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { CircleMember, CircleMessage, CircleSummary, StickerAsset, StickerSeries } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { Modal } from "../components/Modal";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";
import { connectCircleSocket } from "../shared/circleSocket";
import { OnlineSoupRoomInviteCard } from "../components/OnlineSoupRoomInviteCard";
import { SoupShareCard } from "../components/SoupShareCard";
import { StickerKeyboard } from "../components/StickerKeyboard";

type CircleState = {
  circle: Omit<CircleSummary, "isJoined" | "latestMessage">;
  members: CircleMember[];
};
type MessagePage = { messages: CircleMessage[]; hasMore: boolean; nextCursor: string | null };
type SendResponse = { message: CircleMessage };
type UnreadMention = { id: string; sequence: number };
type MentionRequest = { userId: string; nickname: string; key: number };

function Avatar({ avatar, nickname, online, size = "h-10 w-10" }: { avatar: string | null; nickname: string; online: boolean; size?: string }) {
  return (
    <span className={`relative grid shrink-0 place-items-center ${size}`}>
      <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-blue-100 text-sm font-black text-primary">
        {avatar ? <img className="h-full w-full object-cover" src={avatar} alt="" /> : nickname.slice(0, 1)}
      </span>
      {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}
    </span>
  );
}

function MentionableAvatarButton({ canMention, onMention, onOpen, children }: {
  canMention: boolean;
  onMention: () => void;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const cancelTimer = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  return (
    <button
      type="button"
      onPointerDown={() => {
        longPressedRef.current = false;
        if (!canMention) return;
        cancelTimer();
        timerRef.current = window.setTimeout(() => {
          longPressedRef.current = true;
          onMention();
        }, 550);
      }}
      onPointerUp={cancelTimer}
      onPointerCancel={cancelTimer}
      onPointerLeave={cancelTimer}
      onContextMenu={(event) => {
        if (canMention) event.preventDefault();
      }}
      onClick={(event) => {
        if (longPressedRef.current) {
          event.preventDefault();
          longPressedRef.current = false;
          return;
        }
        onOpen();
      }}
    >
      {children}
    </button>
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
  const [mentionRequest, setMentionRequest] = useState<MentionRequest | null>(null);
  const [navigatingMention, setNavigatingMention] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const firstScrollRef = useRef(false);
  const followBottomRef = useRef(true);
  const handledMentionNavigationRef = useRef("");
  const requestedMentionId = (location.state as { circleMentionMessageId?: string } | null)?.circleMentionMessageId ?? "";

  async function loadInitial() {
    const [detail, page, mentionData] = await Promise.all([
      api<CircleState>(`/api/circles/${circleId}`, { bypassCache: true, dedupe: false }),
      api<MessagePage>(`/api/circles/${circleId}/messages?limit=100`, { bypassCache: true, dedupe: false }),
      api<{ mentions: UnreadMention[] }>(`/api/circles/${circleId}/mentions`, { bypassCache: true, dedupe: false })
    ]);
    setState(detail);
    setMessages(page.messages);
    setHasMore(page.hasMore);
    setNextCursor(page.nextCursor);
    setUnreadMentions(mentionData.mentions);
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
      window.setTimeout(() => {
        if (window.location.pathname !== `/circles/${circleId}`) void markAllMentionsRead();
      }, 0);
    };
  }, [circleId]);

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
        followBottomRef.current = true;
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (user && message.mentions.some((mention) => mention.userId === user.id)) {
          setUnreadMentions((current) => current.some((mention) => mention.id === message.id)
            ? current
            : [...current, { id: message.id, sequence: message.sequence }]);
        }
        void markRead();
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
      } else if (event === "circle_deleted") {
        showToast("该圈子已被删除");
        navigate("/circles", { replace: true });
      }
    }, setSocketConnected);
  }, [circleId, user?.id, Boolean(state)]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container || loading) return;
    if (!firstScrollRef.current) {
      container.scrollTop = container.scrollHeight;
      firstScrollRef.current = true;
      return;
    }
    if (followBottomRef.current) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
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

  async function openMention(target: UnreadMention) {
    if (navigatingMention) return;
    setNavigatingMention(true);
    try {
      let loadedMessages = messages;
      let cursor = nextCursor;
      let more = hasMore;
      while (!loadedMessages.some((message) => message.id === target.id) && more && cursor) {
        const page = await api<MessagePage>(
          `/api/circles/${circleId}/messages?limit=100&before=${encodeURIComponent(cursor)}`,
          { bypassCache: true, dedupe: false }
        );
        loadedMessages = [...page.messages, ...loadedMessages];
        cursor = page.nextCursor;
        more = page.hasMore;
      }
      setMessages(loadedMessages);
      setNextCursor(cursor);
      setHasMore(more);
      followBottomRef.current = false;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.getElementById(`circle-message-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }));
      await api(`/api/circles/${circleId}/mentions/${target.id}/read`, { method: "PATCH" });
      setUnreadMentions((current) => current.filter((mention) => mention.id !== target.id));
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

  async function sendText(value: string, mentionedUserIds: string[]) {
    const content = value.trim();
    if (!content || sending) return false;
    setSending(true);
    try {
      followBottomRef.current = true;
      const data = await api<SendResponse>(`/api/circles/${circleId}/messages`, {
        method: "POST",
        body: { content, mentionedUserIds }
      });
      setMessages((current) => current.some((item) => item.id === data.message.id) ? current : [...current, data.message]);
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
      const data = await api<SendResponse>(`/api/circles/${circleId}/messages`, { method: "POST", body: { stickerId: sticker.id } });
      setMessages((current) => current.some((item) => item.id === data.message.id) ? current : [...current, data.message]);
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
    return <section className="min-h-screen bg-page pt-[72px]"><PageTopBar title="圈子" backTo="/circles" /><div className="mx-auto max-w-3xl px-4"><ListSkeleton rows={8} /></div></section>;
  }

  return (
    <section className="min-h-screen bg-page pt-[72px]">
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

      <div className="mx-auto flex h-[calc(100dvh-72px)] max-w-3xl flex-col">
        <div
          ref={messagesRef}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
          onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            followBottomRef.current = nearBottom;
            setShowScrollBottom(!nearBottom);
          }}
        >
          {hasMore && <button className="mx-auto block rounded-full bg-white px-4 py-2 text-xs font-bold text-primary shadow-sm" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "加载中…" : "加载更早消息"}</button>}
          {messages.map((message) => {
            const mine = message.sender?.id === user?.id;
            const senderName = message.sender?.nickname ?? "已注销用户";
            const sticker = message.stickerId ? stickersById.get(message.stickerId) : null;
            return (
              <div id={`circle-message-${message.id}`} key={message.id} className={`flex scroll-mt-24 items-start gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                <MentionableAvatarButton
                  canMention={Boolean(message.sender && message.sender.id !== user?.id)}
                  onMention={() => {
                    if (!message.sender) return;
                    setMentionRequest({ userId: message.sender.id, nickname: message.sender.nickname, key: Date.now() });
                    showToast(`已@${message.sender.nickname}`);
                  }}
                  onOpen={() => {
                    if (!message.sender) return;
                    navigate(message.sender.id === user?.id ? "/mine" : `/users/${message.sender.id}`, {
                      state: message.sender.id === user?.id ? undefined : { circleId }
                    });
                  }}
                >
                  <Avatar avatar={message.sender?.avatar ?? null} nickname={senderName} online={Boolean(message.sender?.isOnline)} />
                </MentionableAvatarButton>
                <div className={`flex max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  <div className={`mb-1 flex max-w-full items-center gap-1.5 px-1 text-[11px] text-muted ${mine ? "flex-row-reverse" : ""}`}>
                    <span className="max-w-28 truncate font-bold text-ink">{senderName}</span>
                    <EquippedBadgeIcon badge={message.sender?.equippedBadge} className="h-4 w-4" animated={false} />
                  </div>
                  {message.type === "room_invite" && message.roomInvite ? (
                    <OnlineSoupRoomInviteCard invite={message.roomInvite} />
                  ) : message.type === "soup_share" && message.soupShare ? (
                    <SoupShareCard soup={message.soupShare} />
                  ) : message.type === "sticker" ? (
                    sticker
                      ? <img className="h-36 w-36 object-contain sm:h-40 sm:w-40" src={sticker.animatedUrl} alt={sticker.text} loading="lazy" decoding="async" />
                      : <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-muted">表情已下架</span>
                  ) : (
                    <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${mine ? "rounded-br-md bg-primary text-white" : "rounded-bl-md bg-white text-ink shadow-sm"}`}>
                      <p className="whitespace-pre-wrap break-words"><CircleMessageText message={message} currentUserId={user?.id ?? ""} /></p>
                    </div>
                  )}
                  <span className="mt-1 px-1 text-[10px] text-muted">{new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
              </div>
            );
          })}
          {!messages.length && <p className="py-20 text-center text-sm text-muted">发送第一条消息吧</p>}
        </div>

        {unreadMentions.length > 0 && !stickersOpen && (
          <button
            className={`fixed right-4 z-30 grid h-11 w-11 place-items-center rounded-full border border-blue-200 bg-primary text-white shadow-[0_8px_24px_rgba(15,23,42,0.2)] ${showScrollBottom ? "bottom-32" : "bottom-20"}`}
            disabled={navigatingMention}
            onClick={() => void openNextMention()}
            aria-label={`查看@我的消息，剩余${unreadMentions.length}条`}
          >
            <AtSign size={22} />
            <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
              {unreadMentions.length > 99 ? "99+" : unreadMentions.length}
            </span>
          </button>
        )}
        {showScrollBottom && !stickersOpen && <button className="fixed bottom-20 right-4 z-30 grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-primary shadow-[0_8px_24px_rgba(15,23,42,0.2)]" onClick={() => { followBottomRef.current = true; messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); setShowScrollBottom(false); }} aria-label="回到底部"><ChevronDown size={22} /></button>}
        <Composer
          members={state.members}
          currentUserId={user?.id ?? ""}
          mentionRequest={mentionRequest}
          sending={sending}
          stickersOpen={stickersOpen}
          onToggleStickers={() => setStickersOpen((value) => !value)}
          onSend={sendText}
        />
        {stickersOpen && <StickerKeyboard series={stickerSeries} loading={stickersLoading} sending={sending} onClose={() => setStickersOpen(false)} onSend={sendSticker} className="shrink-0 border-t border-line px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3" />}
      </div>

      {membersOpen && <Modal onClose={() => setMembersOpen(false)}>
        <div className="space-y-3">
          <div><h2 className="text-xl font-black text-ink">圈子成员</h2><p className="mt-1 text-sm text-muted">{state.circle.memberCount} 位成员 · {state.circle.onlineCount} 人在线</p></div>
          <div className="max-h-[65vh] divide-y divide-line overflow-y-auto">
            {[...state.members].sort((a, b) => Number(b.isOnline) - Number(a.isOnline)).map((member) => (
              <button
                key={member.id}
                className="flex w-full items-center gap-3 py-3 text-left"
                onClick={() => navigate(member.id === user?.id ? "/mine" : `/users/${member.id}`, {
                  state: member.id === user?.id ? undefined : { circleId }
                })}
              >
                <Avatar avatar={member.avatar} nickname={member.nickname} online={member.isOnline} size="h-11 w-11" />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-sm font-black text-ink">{member.nickname}</span><EquippedBadgeIcon badge={member.equippedBadge} className="h-5 w-5" animated={false} /></span><span className={`mt-0.5 block text-xs ${member.isOnline ? "text-emerald-600" : "text-muted"}`}>{member.isOnline ? "在线" : "离线"}</span></span>
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

function Composer({ members, currentUserId, mentionRequest, sending, stickersOpen, onToggleStickers, onSend }: {
  members: CircleMember[];
  currentUserId: string;
  mentionRequest: MentionRequest | null;
  sending: boolean;
  stickersOpen: boolean;
  onToggleStickers: () => void;
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
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-ink">{member.nickname}</span>
                    <EquippedBadgeIcon badge={member.equippedBadge} className="h-4 w-4" animated={false} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
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
        <button type="button" className={`btn h-11 w-11 shrink-0 p-0 ${stickersOpen ? "btn-primary" : "btn-secondary"}`} onClick={() => { if (!stickersOpen) inputRef.current?.blur(); onToggleStickers(); }} aria-label="表情包"><Smile size={23} /></button>
        <button className="btn btn-primary h-11 w-11 shrink-0 p-0" disabled={!content.trim() || sending} aria-label="发送"><Send size={21} /></button>
      </div>
    </form>
  );
}
