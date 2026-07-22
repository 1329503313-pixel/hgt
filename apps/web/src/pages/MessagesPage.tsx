import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronRight, FileClock, Heart, MessageCircle, ShieldCheck } from "lucide-react";
import type { ConversationItem } from "../shared/types";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { CardSkeleton, ListSkeleton } from "../components/Skeletons";
import { subscribeServerEvent } from "../shared/serverEvents";
import { privateMessagePreview } from "../shared/messagePreview";
import { useMessageUnreadCounts } from "../shared/useMessageUnread";
import { LevelBadge } from "../components/LevelBadge";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";

export default function MessagesPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const counts = useMessageUnreadCounts(user?.id, Boolean(user));

  const loadConversations = useCallback(async () => {
    const data = await api<{ conversations: ConversationItem[] }>("/api/conversations");
    setConversations(data.conversations);
  }, []);

  const loadMessageData = useCallback(async () => {
    await loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (loadingUser || !user) return;
    setLoading(true);
    void loadMessageData().catch(() => {}).finally(() => setLoading(false));
  }, [user, loadingUser, loadMessageData]);

  useEffect(() => {
    if (!user) return;
    const onUnreadChanged = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { source?: string };
        if (payload.source?.startsWith("private_message")) void loadConversations();
      } catch {
        void loadConversations();
      }
    };
    return subscribeServerEvent("unread_changed", onUnreadChanged);
  }, [user?.id, loadConversations]);

  useEffect(() => {
    if (!user) return;
    return subscribeServerEvent("presence_changed", (event) => {
      try {
        const payload = JSON.parse(event.data) as { userId?: string; online?: boolean };
        if (!payload.userId) return;
        setConversations((current) => current.map((conversation) => conversation.otherUser.id === payload.userId
          ? { ...conversation, otherUser: { ...conversation.otherUser, isOnline: Boolean(payload.online) } }
          : conversation));
      } catch {
        // Ignore malformed presence events.
      }
    });
  }, [user?.id]);

  const entries = [
    { label: "系统", path: "/messages/system", count: counts.system, icon: ShieldCheck, iconClass: "bg-blue-100 text-blue-600" },
    { label: "互动", path: "/messages/interactions", count: counts.interactions, icon: Heart, iconClass: "bg-rose-100 text-rose-500" },
    { label: "申请", path: "/messages/requests", count: counts.requests, icon: FileClock, iconClass: "bg-amber-100 text-amber-600" },
    { label: "通知", path: "/messages/notices", count: counts.notices, icon: Bell, iconClass: "bg-violet-100 text-violet-600" }
  ];

  if (loadingUser || loading) return <section className="min-h-screen bg-page pt-[72px]"><PageTopBar title="消息" backTo="/" /><div className="mx-auto max-w-6xl space-y-4 px-4 pb-10"><CardSkeleton rows={2} /><ListSkeleton rows={6} /></div></section>;

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title="消息" backTo="/" />

      <div className="message-center-layout mx-auto max-w-6xl px-4 pb-10">
        <div className="message-center-categories grid grid-cols-4 gap-2 rounded-2xl bg-white px-2 py-5 shadow-soft sm:gap-6 sm:px-8">
          {entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <button key={entry.path} className="group flex min-w-0 flex-col items-center gap-2" onClick={() => navigate(entry.path)}>
                <span className={`relative grid h-14 w-14 place-items-center rounded-[18px] transition group-active:scale-95 sm:h-16 sm:w-16 ${entry.iconClass}`}>
                  <Icon size={27} strokeWidth={2.2} />
                  {entry.count > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-black text-white">
                      {entry.count > 99 ? "99+" : entry.count}
                    </span>
                  )}
                </span>
                <span className="text-sm font-bold text-ink">{entry.label}</span>
              </button>
            );
          })}
        </div>

        <div className="message-center-conversations mt-5 overflow-hidden rounded-2xl bg-white shadow-soft">
          <div className="flex items-center justify-between border-b border-line px-4 py-4">
            <h2 className="text-lg font-black text-ink">消息</h2>
            <span className="inline-flex items-center gap-1 text-xs text-muted">{counts.privateMessages} 条未读 <ChevronRight size={14} /></span>
          </div>
          {conversations.length ? <div className="divide-y divide-line">
            {conversations.map((conversation) => (
              <button key={conversation.id} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50" onClick={() => navigate(`/messages/chat/${conversation.id}`)}>
                <span className="relative h-12 w-12 shrink-0">
                  <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-primary">
                    {conversation.otherUser.avatar ? <img className="h-full w-full object-cover" src={conversation.otherUser.avatar} alt="" /> : conversation.otherUser.nickname.slice(0, 1)}
                  </span>
                  {conversation.unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] leading-none text-white">{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span>}
                  {conversation.otherUser.isOnline && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-black text-ink">{conversation.otherUser.nickname}</span>
                    <LevelBadge level={conversation.otherUser.level} />
                    <EquippedBadgeIcon badge={conversation.otherUser.equippedBadge} className="h-4 w-4" animated={false} />
                  </span>
                  <span className="mt-1 block truncate text-sm text-muted">{conversation.lastMessage ? `${conversation.lastMessage.isMine ? "我：" : ""}${privateMessagePreview(conversation.lastMessage)}` : "开始聊天吧"}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{new Date(conversation.lastMessage?.createdAt ?? conversation.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>
              </button>
            ))}
          </div> : <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-slate-400">
              <MessageCircle size={30} />
            </span>
            <p className="mt-4 font-bold text-ink">暂无消息</p>
            <p className="mt-1 text-sm text-muted">关注用户后可以发起私信</p>
          </div>}
        </div>
      </div>
    </section>
  );
}
