import { FormEvent, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { PrivateMessageItem, PublicUser } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";

type ChatResponse = {
  conversation: { id: string; otherUser: Pick<PublicUser, "id" | "username" | "nickname" | "avatar"> };
  messages: PrivateMessageItem[];
};

export default function ChatPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user, loadingUser, showToast } = useApp();
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadMessages() {
    const data = await api<ChatResponse>(`/api/conversations/${id}/messages`);
    setChat(data);
  }

  useEffect(() => { if (!loadingUser && user && id) void loadMessages().catch((error) => showToast((error as Error).message)); }, [id, user?.id, loadingUser]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat?.messages.length]);
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
      setContent(""); await loadMessages();
    } catch (error) { showToast((error as Error).message); } finally { setSending(false); }
  }

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
      <div className="mx-auto flex min-h-[calc(100vh-72px)] max-w-3xl flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-28">
          {chat.messages.map((message) => {
            const sender = message.isMine ? user : chat.conversation.otherUser;
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
                  : (sender?.nickname || sender?.username || "用").slice(0, 1)}
              </button>
              <div className={`flex max-w-[78%] flex-col ${message.isMine ? "items-end" : "items-start"}`}>
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${message.isMine ? "rounded-br-md bg-primary text-white" : "rounded-bl-md bg-white text-ink shadow-sm"}`}>
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                </div>
                <p className="mt-1 px-1 text-[10px] text-muted">{new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
              </div>
            </div>
          );})}
          {chat.messages.length === 0 && <p className="py-20 text-center text-sm text-muted">发送第一条消息吧</p>}
          <div ref={bottomRef} />
        </div>
        <form className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 p-3 backdrop-blur" onSubmit={send}>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea className="field max-h-28 min-h-11 flex-1 resize-none" rows={1} maxLength={1000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="输入消息" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <button className="btn btn-primary h-11 w-11 shrink-0 p-0" disabled={!content.trim() || sending} aria-label="发送"><Send size={18} /></button>
          </div>
        </form>
      </div>
    </section>
  );
}
