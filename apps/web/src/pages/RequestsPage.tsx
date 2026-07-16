import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ViewRequestItem } from "../shared/types";
import { api, RequestsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { RequestList } from "../components/Lists";
import { PageTopBar } from "../components/PageTopBar";

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
          {loading ? <p className="py-16 text-center text-sm text-muted">正在加载……</p> : (
            <RequestList requests={requests} onDecision={(id, decision) => void decideRequest(id, decision)} onOpenSoup={(id) => navigate(`/soup/${id}`)} />
          )}
        </div>
      </div>
    </section>
  );
}
