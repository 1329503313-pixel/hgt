import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Send, Smile, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { PrivateMessageItem, PublicUser, StickerAsset, StickerSeries } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";

type ChatResponse = {
  conversation: { id: string; otherUser: Pick<PublicUser, "id" | "nickname" | "avatar"> };
  messages: PrivateMessageItem[];
};

export default function ChatPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user, loadingUser, showToast } = useApp();
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [stickerSeries, setStickerSeries] = useState<StickerSeries[]>([]);
  const [showStickers, setShowStickers] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);
  const shouldFollowBottomRef = useRef(true);

  async function loadMessages() {
    const data = await api<ChatResponse>(`/api/conversations/${id}/messages`);
    setChat(data);
  }

  useEffect(() => {
    void api<{ series: StickerSeries[] }>("/api/stickers")
      .then((data) => setStickerSeries(data.series))
      .catch((error) => showToast((error as Error).message));
  }, []);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    shouldFollowBottomRef.current = true;
    setShowScrollBottom(false);
    if (!loadingUser && user && id) void loadMessages().catch((error) => showToast((error as Error).message));
  }, [id, user?.id, loadingUser]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container || !chat) return;
    if (!initialScrollDoneRef.current) {
      container.scrollTop = container.scrollHeight;
      initialScrollDoneRef.current = true;
      shouldFollowBottomRef.current = true;
      setShowScrollBottom(false);
      return;
    }
    if (shouldFollowBottomRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      setShowScrollBottom(false);
    }
  }, [chat?.messages.length, chat?.conversation.id]);
  useEffect(() => {
    if (!user || !id) return;
    const events = new EventSource("/api/events", { withCredentials: true });
    const onMessage = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { conversationId?: string };
      if (payload.conversationId === id) void loadMessages();
    };
    events.addEventListener("private_message", onMessage);
    return () => { events.removeEventListener("private_message", onMessage); events.close(); };
  }, [id, user?.id]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = content.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await api(`/api/conversations/${id}/messages`, { method: "POST", body: { content: value } });
      shouldFollowBottomRef.current = true;
      setContent(""); await loadMessages();
    } catch (error) { showToast((error as Error).message); } finally { setSending(false); }
  }

  async function sendSticker(sticker: StickerAsset) {
    if (sending) return;
    setSending(true);
    try {
      await api(`/api/conversations/${id}/messages`, { method: "POST", body: { stickerId: sticker.id } });
      shouldFollowBottomRef.current = true;
      setShowStickers(false);
      await loadMessages();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  const stickersById = new Map(
    stickerSeries.flatMap((series) => series.stickers.map((sticker) => [sticker.id, sticker] as const))
  );

  if (loadingUser || !chat) return <section className="min-h-screen bg-page pt-[72px]"><PageTopBar title="私信" backTo="/messages" /><div className="mx-auto max-w-3xl px-4"><ListSkeleton rows={7} /></div></section>;

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar
        title={chat.conversation.otherUser.nickname}
        titleContent={(
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 text-sm font-black text-primary">
              {chat.conversation.otherUser.avatar
                ? <img className="h-full w-full object-cover" src={chat.conversation.otherUser.avatar} alt={`${chat.conversation.otherUser.nickname}头像`} />
                : chat.conversation.otherUser.nickname.slice(0, 1)}
            </span>
            <span className="max-w-36 truncate text-base font-black text-ink sm:max-w-56 sm:text-lg">{chat.conversation.otherUser.nickname}</span>
          </span>
        )}
        titleTo={`/users/${chat.conversation.otherUser.id}`}
        backTo="/messages"
      />
      <div className="mx-auto flex h-[calc(100dvh-72px)] max-w-3xl flex-col">
        <div
          ref={messagesRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 pb-28"
          onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            shouldFollowBottomRef.current = nearBottom;
            setShowScrollBottom(!nearBottom);
          }}
        >
          {chat.messages.map((message) => {
            const sender = message.isMine ? user : chat.conversation.otherUser;
            const sticker = message.stickerId ? stickersById.get(message.stickerId) : null;
            return (
            <div key={message.id} className={`flex items-start gap-2.5 ${message.isMine ? "flex-row-reverse" : "flex-row"}`}>
              <button
                type="button"
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 text-sm font-black text-primary"
                onClick={() => navigate(message.isMine ? "/mine" : `/users/${chat.conversation.otherUser.id}`)}
                aria-label={`查看${sender?.nickname ?? "用户"}的个人主页`}
              >
                {sender?.avatar
                  ? <img className="h-full w-full object-cover" src={sender.avatar} alt={`${sender.nickname}头像`} />
                  : (sender?.nickname || "用").slice(0, 1)}
              </button>
              <div className={`flex max-w-[78%] flex-col ${message.isMine ? "items-end" : "items-start"}`}>
                {message.type === "sticker" ? (
                  sticker
                    ? <img className="h-36 w-36 object-contain sm:h-40 sm:w-40" src={sticker.animatedUrl} alt={sticker.text} loading="lazy" decoding="async" />
                    : <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-muted">表情已下架</span>
                ) : (
                  <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${message.isMine ? "rounded-br-md bg-primary text-white" : "rounded-bl-md bg-white text-ink shadow-sm"}`}>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                )}
                <p className="mt-1 px-1 text-[10px] text-muted">{new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
              </div>
            </div>
          );})}
          {chat.messages.length === 0 && <p className="py-20 text-center text-sm text-muted">发送第一条消息吧</p>}
        </div>
        {showScrollBottom && (
          <button
            type="button"
            className="fixed bottom-20 right-4 z-30 grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-primary shadow-[0_8px_24px_rgba(15,23,42,0.2)] transition active:scale-95 sm:right-6"
            aria-label="滑到底部"
            title="滑到底部"
            onClick={() => {
              shouldFollowBottomRef.current = true;
              const container = messagesRef.current;
              container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
              setShowScrollBottom(false);
            }}
          >
            <ChevronDown size={22} strokeWidth={2.4} />
          </button>
        )}
        {showStickers && (
          <div className="fixed inset-x-0 bottom-[69px] z-30 border-t border-line bg-white shadow-[0_-10px_30px_rgba(15,23,42,0.08)]">
            <div className="mx-auto max-w-3xl p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-black text-ink">表情包</p>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-slate-100" onClick={() => setShowStickers(false)} aria-label="关闭表情面板"><X size={19} /></button>
              </div>
              <div className="max-h-[42vh] space-y-4 overflow-y-auto">
                {stickerSeries.map((series) => (
                  <section key={series.id}>
                    <p className="mb-2 text-xs font-bold text-muted">{series.name} · {series.characterName}</p>
                    <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                      {series.stickers.map((sticker) => (
                        <button key={sticker.id} type="button" className="rounded-2xl border border-transparent p-1.5 text-center transition hover:border-blue-100 hover:bg-blue-50 active:scale-95" disabled={sending} onClick={() => void sendSticker(sticker)}>
                          <img className="aspect-square w-full object-contain" src={sticker.staticUrl} alt="" loading="lazy" decoding="async" />
                          <span className="mt-1 block truncate text-[11px] font-bold text-ink">{sticker.name}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}
        <form className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 p-3 backdrop-blur" onSubmit={send}>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea className="field h-11 max-h-28 min-h-11 flex-1 resize-none py-[10px] leading-[22px]" rows={1} maxLength={1000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="输入消息" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <button type="button" className={`btn h-11 w-11 shrink-0 p-0 ${showStickers ? "btn-primary" : "btn-secondary"}`} onClick={() => setShowStickers((current) => !current)} aria-label="打开表情包"><Smile size={24} /></button>
            <button className="btn btn-primary h-11 w-11 shrink-0 p-0" disabled={!content.trim() || sending} aria-label="发送"><Send size={22} /></button>
          </div>
        </form>
      </div>
    </section>
  );
}
