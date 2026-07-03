import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { NotificationItem, ViewRequestItem } from "../shared/types";
import { api, NotificationsResponse, RequestsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { NotificationList, RequestList } from "../components/Lists";

export default function MessagesPage() {
  const { user } = useApp();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);

  useEffect(() => {
    if (!user) return;
    api<NotificationsResponse>("/api/notifications").then((d) => setNotifications(d.notifications)).catch(() => {});
    api<RequestsResponse>("/api/access-requests").then((d) => setRequests(d.requests)).catch(() => {});
  }, [user]);

  async function markRead(id: string) {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
    const d = await api<RequestsResponse>("/api/access-requests");
    setRequests(d.requests);
  }

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <section className="space-y-4">
      <PageTopBar title="消息" unread={unread} />

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-black text-ink">站内消息</h1>
          {notifications.length > 3 && (
            <button className="btn btn-secondary px-3 text-xs" onClick={() => navigate("/messages/notifications")}>
              更多 <ChevronRight size={14} />
            </button>
          )}
        </div>
        <NotificationList notifications={notifications} onRead={markRead} onOpenSoup={(id) => navigate(`/soup/${id}`)} max={3} />
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-black text-ink">查看申请</h1>
          {requests.length > 3 && (
            <button className="btn btn-secondary px-3 text-xs" onClick={() => navigate("/messages/requests")}>
              更多 <ChevronRight size={14} />
            </button>
          )}
        </div>
        <RequestList requests={requests} onDecision={decideRequest} onOpenSoup={(id) => navigate(`/soup/${id}`)} max={3} />
      </div>
    </section>
  );
}
