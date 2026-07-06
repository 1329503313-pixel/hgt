import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCheck, ChevronRight } from "lucide-react";
import type { NotificationItem, ViewRequestItem } from "../shared/types";
import { api, NotificationsResponse, RequestsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { NotificationList, RequestList } from "../components/Lists";

export default function MessagesPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);

  useEffect(() => {
    if (loadingUser || !user) return;
    api<NotificationsResponse>("/api/notifications").then((d) => setNotifications(d.notifications)).catch(() => {});
    api<RequestsResponse>("/api/access-requests").then((d) => setRequests(d.requests)).catch(() => {});
  }, [user, loadingUser]);

  async function markRead(id: string) {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
    const d = await api<RequestsResponse>("/api/access-requests");
    setRequests(d.requests);
  }

  async function markAllRead() {
    await api("/api/notifications/read-all", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <section className="space-y-4 pt-[72px]">
      <PageTopBar title="消息" backTo="/" />

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-black text-ink">站内消息</h1>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button className="btn btn-secondary px-3 text-xs" onClick={markAllRead}>
                <CheckCheck size={14} /> 一键已读
              </button>
            )}
            {notifications.length > 3 && (
              <button className="btn btn-secondary px-3 text-xs" onClick={() => navigate("/messages/notifications")}>
                更多 <ChevronRight size={14} />
              </button>
            )}
          </div>
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
