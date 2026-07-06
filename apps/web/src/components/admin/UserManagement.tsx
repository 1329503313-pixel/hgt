import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, User } from "lucide-react";
import type { PublicUser, ViewRequestItem } from "../../shared/types";
import { api, RequestsResponse } from "../../api";
import { RequestList } from "../Lists";

type AdminUser = PublicUser & {
  stats: { soupCount: number; evaluationCount: number; likeCount: number; favoriteCount: number };
};

type UsersResponseExt = { users: AdminUser[] };

export function UserManagement() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    api<UsersResponseExt>("/api/admin/users").then((d) => setUsers(d.users)).catch(() => {});
    api<RequestsResponse>("/api/access-requests").then((d) => setRequests(d.requests)).catch(() => {});
  }, []);

  async function updateRole(item: AdminUser, role: "admin" | "user") {
    await api(`/api/admin/users/${item.id}`, { method: "PATCH", body: { nickname: item.nickname, role } });
    const d = await api<UsersResponseExt>("/api/admin/users");
    setUsers(d.users);
  }

  async function deleteUser(item: AdminUser) {
    if (!confirm(`确定删除用户 ${item.nickname} 吗？`)) return;
    await api(`/api/admin/users/${item.id}`, { method: "DELETE" });
    const d = await api<UsersResponseExt>("/api/admin/users");
    setUsers(d.users);
  }

  async function resetPassword(id: string) {
    if (!newPassword || newPassword.length < 6) return;
    if (!confirm(`确定重置该用户的密码吗？新密码：${newPassword}`)) return;
    await api(`/api/admin/users/${id}/reset-password`, { method: "POST", body: { newPassword } });
    setResetId(null);
    setNewPassword("");
    alert("密码已重置");
  }

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
    const d = await api<RequestsResponse>("/api/access-requests");
    setRequests(d.requests);
  }

  return (
    <div className="grid gap-4">
      <div className="card p-4">
        <h2 className="mb-3 font-black text-ink">用户管理</h2>
        <div className="text-sm text-muted mb-3">{users.length} 位用户</div>
        <div className="overflow-x-auto">
          <div className="min-w-[960px]">
            <div className="mb-2 grid grid-cols-[48px_1.2fr_1fr_1fr_80px_70px_70px_70px_80px_100px] gap-2 px-3 text-xs font-bold text-muted">
              <span></span>
              <span>昵称 / 账号</span>
              <span>角色</span>
              <span>加入时间</span>
              <span>汤品</span>
              <span>评价</span>
              <span>点赞</span>
              <span>收藏</span>
              <span>密码</span>
              <span></span>
            </div>
            <div className="space-y-1">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="grid grid-cols-[48px_1.2fr_1fr_1fr_80px_70px_70px_70px_80px_100px] items-center gap-2 rounded-lg border border-line p-3 text-sm"
                >
                  {u.avatar ? (
                    <img className="h-8 w-8 rounded-full object-cover" src={u.avatar} alt="" />
                  ) : (
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-xs font-black text-primary">
                      {(u.nickname || u.username).slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{u.nickname}</div>
                    <div className="text-xs text-muted">@{u.username}</div>
                  </div>
                  <select className="field h-9 text-xs" value={u.role} onChange={(e) => updateRole(u, e.target.value as any)}>
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                  <span className="text-xs text-muted">{new Date(u.createdAt).toLocaleDateString()}</span>
                  <span className="text-center font-semibold text-ink">{u.stats.soupCount}</span>
                  <span className="text-center">{u.stats.evaluationCount}</span>
                  <span className="text-center">{u.stats.likeCount}</span>
                  <span className="text-center">{u.stats.favoriteCount}</span>
                  <div>
                    {resetId === u.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          className="field h-8 w-20 text-xs px-1"
                          type="text"
                          placeholder="新密码"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") resetPassword(u.id); }}
                          autoFocus
                        />
                        <button className="btn btn-primary h-8 px-2 text-xs" onClick={() => resetPassword(u.id)}>确定</button>
                        <button className="btn btn-secondary h-8 px-1 text-xs" onClick={() => { setResetId(null); setNewPassword(""); }}>×</button>
                      </div>
                    ) : (
                      <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => { setResetId(u.id); setNewPassword(""); }}>
                        重置密码
                      </button>
                    )}
                  </div>
                  <button className="btn btn-danger h-8 w-8 p-0 grid place-items-center shrink-0" onClick={() => deleteUser(u)} title="删除">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-black text-ink">申请审批</h2>
        <RequestList requests={requests} onDecision={decideRequest} onOpenSoup={(id) => navigate(`/soup/${id}`)} />
      </div>
    </div>
  );
}
