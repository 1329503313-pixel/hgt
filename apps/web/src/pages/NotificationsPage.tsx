import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { NotificationItem } from "../shared/types";
import { api, NotificationsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { NotificationList } from "../components/Lists";

export default function NotificationsPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser || !user) return;
    setLoading(true);
    api<NotificationsResponse>("/api/notifications")
      .then((d) => setNotifications(d.notifications))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, loadingUser]);

  async function markRead(id: string) {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 pt-[72px]">
        <button className="btn btn-secondary px-3" onClick={() => navigate("/messages")}><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-black text-ink">全部站内消息</h1>
      </div>
      <div className="card p-4">
        <NotificationList notifications={notifications} onRead={markRead} onOpen={navigate} />
      </div>
    </section>
  );
}
