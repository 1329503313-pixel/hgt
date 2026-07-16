import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronRight, FileClock, Heart, MessageCircle, ShieldCheck } from "lucide-react";
import type { NotificationItem, ViewRequestItem } from "../shared/types";
import { api, NotificationsResponse, RequestsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";

type NoticeSummary = { id: string; isRead: boolean };

const interactionTypes = new Set(["soup_like", "soup_favorite", "soup_evaluation", "user_follow"]);

export default function MessagesPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);
  const [notices, setNotices] = useState<NoticeSummary[]>([]);

  useEffect(() => {
    if (loadingUser || !user) return;
    void Promise.all([
      api<NotificationsResponse>("/api/notifications").then((data) => setNotifications(data.notifications)),
      api<RequestsResponse>("/api/access-requests").then((data) => setRequests(data.requests)),
      api<{ notices: NoticeSummary[] }>("/api/notices").then((data) => setNotices(data.notices))
    ]).catch(() => {});
  }, [user, loadingUser]);

  const counts = useMemo(() => ({
    system: notifications.filter((item) => item.type !== "view_request" && !interactionTypes.has(item.type) && !item.isRead).length,
    interactions: notifications.filter((item) => interactionTypes.has(item.type) && !item.isRead).length,
    requests: requests.filter((item) => item.status === "pending").length,
    notices: notices.filter((item) => !item.isRead).length
  }), [notifications, requests, notices]);

  const entries = [
    { label: "系统", path: "/messages/system", count: counts.system, icon: ShieldCheck, iconClass: "bg-blue-100 text-blue-600" },
    { label: "互动", path: "/messages/interactions", count: counts.interactions, icon: Heart, iconClass: "bg-rose-100 text-rose-500" },
    { label: "申请", path: "/messages/requests", count: counts.requests, icon: FileClock, iconClass: "bg-amber-100 text-amber-600" },
    { label: "通知", path: "/messages/notices", count: counts.notices, icon: Bell, iconClass: "bg-violet-100 text-violet-600" }
  ];

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title="消息" backTo="/" />

      <div className="mx-auto max-w-3xl px-4 pb-10">
        <div className="grid grid-cols-4 gap-2 rounded-2xl bg-white px-2 py-5 shadow-soft sm:gap-6 sm:px-8">
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

        <div className="mt-5 overflow-hidden rounded-2xl bg-white shadow-soft">
          <div className="flex items-center justify-between border-b border-line px-4 py-4">
            <h2 className="text-lg font-black text-ink">消息</h2>
            <span className="inline-flex items-center gap-1 text-xs text-muted">私聊消息 <ChevronRight size={14} /></span>
          </div>
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-slate-400">
              <MessageCircle size={30} />
            </span>
            <p className="mt-4 font-bold text-ink">暂无消息</p>
            <p className="mt-1 text-sm text-muted">私聊功能即将开放</p>
          </div>
        </div>
      </div>
    </section>
  );
}
