import { useEffect, useMemo, useState } from "react";
import { CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { NotificationItem } from "../shared/types";
import { api, NotificationsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { NotificationList } from "../components/Lists";
import { PageTopBar } from "../components/PageTopBar";

type NotificationCategory = "system" | "interactions";
const interactionTypes = new Set(["soup_like", "soup_favorite", "soup_evaluation", "user_follow"]);

export default function NotificationsPage({ category }: { category: NotificationCategory }) {
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser || !user) return;
    setLoading(true);
    api<NotificationsResponse>("/api/notifications")
      .then((data) => setNotifications(data.notifications))
      .catch((error) => showToast((error as Error).message))
      .finally(() => setLoading(false));
  }, [user, loadingUser, showToast]);

  const visible = useMemo(() => notifications.filter((item) => {
    if (item.type === "view_request") return false;
    return category === "interactions" ? interactionTypes.has(item.type) : !interactionTypes.has(item.type);
  }), [category, notifications]);

  async function markRead(id: string) {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, isRead: true } : item));
  }

  async function markCategoryRead() {
    const unreadIds = visible.filter((item) => !item.isRead).map((item) => item.id);
    if (!unreadIds.length) return;
    await Promise.all(unreadIds.map((id) => api(`/api/notifications/${id}/read`, { method: "PATCH" })));
    setNotifications((current) => current.map((item) => unreadIds.includes(item.id) ? { ...item, isRead: true } : item));
  }

  const title = category === "system" ? "系统消息" : "互动消息";
  const unread = visible.some((item) => !item.isRead);

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title={title} backTo="/messages" />
      <div className="mx-auto max-w-3xl px-4 pb-10">
        <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
          {unread && (
            <div className="flex justify-end border-b border-line px-4 py-3">
              <button className="inline-flex items-center gap-1.5 text-sm font-bold text-primary" onClick={() => void markCategoryRead()}>
                <CheckCheck size={17} /> 全部已读
              </button>
            </div>
          )}
          {loading ? <p className="py-16 text-center text-sm text-muted">正在加载……</p> : (
            <NotificationList notifications={visible} onRead={(id) => void markRead(id)} onOpen={navigate} />
          )}
        </div>
      </div>
    </section>
  );
}
