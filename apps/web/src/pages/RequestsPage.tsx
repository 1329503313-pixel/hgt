import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ViewRequestItem } from "../shared/types";
import { api, RequestsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { RequestList } from "../components/Lists";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";

export default function RequestsPage() {
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadRequests() {
    const data = await api<RequestsResponse>("/api/access-requests");
    setRequests(data.requests);
  }

  useEffect(() => {
    if (loadingUser || !user) return;
    setLoading(true);
    void loadRequests().catch((error) => showToast((error as Error).message)).finally(() => setLoading(false));
  }, [user, loadingUser]);

  useEffect(() => {
    if (!user) return;
    const events = new EventSource("/api/events", { withCredentials: true });
    const onUnreadChanged = () => { void loadRequests().catch(() => {}); };
    events.addEventListener("unread_changed", onUnreadChanged);
    return () => { events.removeEventListener("unread_changed", onUnreadChanged); events.close(); };
  }, [user?.id]);

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    try {
      await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
      await loadRequests();
      showToast(decision === "approved" ? "已同意查看申请" : "已拒绝查看申请");
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title="申请" backTo="/messages" />
      <div className="mx-auto max-w-3xl px-4 pb-10">
        <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
          {loading ? <ListSkeleton rows={6} /> : (
            <RequestList requests={requests} onDecision={(id, decision) => void decideRequest(id, decision)} onOpenSoup={(id) => navigate(`/soup/${id}`)} />
          )}
        </div>
      </div>
    </section>
  );
}
