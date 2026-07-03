import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import type { PublicUser, ViewRequestItem } from "../shared/types";
import { api, UsersResponse, RequestsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { RequestList } from "../components/Lists";

export default function AdminPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);

  useEffect(() => {
    if (loadingUser) return;
    if (!user || user.role !== "admin") { navigate("/"); return; }
    api<UsersResponse>("/api/admin/users").then((d) => setUsers(d.users)).catch(() => {});
    api<RequestsResponse>("/api/access-requests").then((d) => setRequests(d.requests)).catch(() => {});
  }, [user, loadingUser]);

  if (loadingUser) {
    return <div className="flex items-center justify-center py-20 text-sm text-muted">正在喝汤中……</div>;
  }

  async function updateRole(item: PublicUser, role: "admin" | "user") {
    await api(`/api/admin/users/${item.id}`, { method: "PATCH", body: { nickname: item.nickname, role } });
    const d = await api<UsersResponse>("/api/admin/users");
    setUsers(d.users);
  }

  async function deleteUser(item: PublicUser) {
    if (!confirm(`确定删除用户 ${item.nickname} 吗？`)) return;
    await api(`/api/admin/users/${item.id}`, { method: "DELETE" });
    const d = await api<UsersResponse>("/api/admin/users");
    setUsers(d.users);
  }

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
    const d = await api<RequestsResponse>("/api/access-requests");
    setRequests(d.requests);
  }

  return (
    <section className="space-y-4 pt-[72px]">
      <div>
        <h1 className="text-2xl font-black text-ink">管理员后台</h1>
        <p className="mt-1 text-sm text-muted">管理用户，并可代作者处理查看申请。</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="card p-4">
          <h2 className="mb-3 font-black text-ink">用户管理</h2>
          <div className="space-y-3">
            {users.map((u) => (
              <div key={u.id} className="flex flex-col gap-3 rounded-lg border border-line p-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <strong>{u.nickname}</strong>
                  <p className="text-sm text-muted">{u.username} · {u.role}</p>
                </div>
                <select className="field sm:w-32" value={u.role} onChange={(e) => updateRole(u, e.target.value as any)}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
                <button className="btn btn-danger" onClick={() => deleteUser(u)}><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <h2 className="mb-3 font-black text-ink">申请审批</h2>
          <RequestList requests={requests} onDecision={decideRequest} onOpenSoup={(id) => navigate(`/soup/${id}`)} />
        </div>
      </div>
    </section>
  );
}
