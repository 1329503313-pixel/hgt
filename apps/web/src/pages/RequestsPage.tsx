import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { ViewRequestItem } from "../shared/types";
import { api, RequestsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { RequestList } from "../components/Lists";

export default function RequestsPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);

  useEffect(() => {
    if (loadingUser || !user) return;
    api<RequestsResponse>("/api/access-requests").then((d) => setRequests(d.requests)).catch(() => {});
  }, [user, loadingUser]);

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
    const d = await api<RequestsResponse>("/api/access-requests");
    setRequests(d.requests);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 pt-[72px]">
        <button className="btn btn-secondary px-3" onClick={() => navigate("/messages")}><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-black text-ink">全部查看申请</h1>
      </div>
      <div className="card p-4">
        <RequestList requests={requests} onDecision={decideRequest} onOpenSoup={(id) => navigate(`/soup/${id}`)} />
      </div>
    </section>
  );
}
