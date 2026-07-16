import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, KeyRound, Search, Trash2 } from "lucide-react";
import type { PublicUser } from "../../shared/types";
import { api } from "../../api";
import { Modal } from "../Modal";
import { AdminColumn, ColumnSelector, gridTemplate } from "./ColumnSelector";
import { AdminPageSize, AdminPagination } from "./AdminPagination";
import { ListSkeleton } from "../Skeletons";

type AdminUser = PublicUser & {
  username: string;
  lastLoginAt: string | null;
  loggedInToday: boolean;
  stats: { soupCount: number; evaluationCount: number; likeCount: number; favoriteCount: number };
};

type UsersResponseExt = { users: AdminUser[]; total: number };
type TodayFilter = "all" | "yes" | "no";
type UserSortBy = "createdAt" | "lastLoginAt" | "soupCount" | "evaluationCount" | "likeCount" | "favoriteCount";
type SortOrder = "asc" | "desc";
type UserColumn = "user" | "role" | "createdAt" | "lastLoginAt" | "loggedToday" | "soups" | "evaluations" | "likes" | "favorites" | "password" | "actions";

const userColumns: readonly AdminColumn<UserColumn>[] = [
  { key: "user", label: "用户", width: "minmax(190px, 1fr)" },
  { key: "role", label: "角色", width: "110px" },
  { key: "createdAt", label: "加入时间", width: "110px" },
  { key: "lastLoginAt", label: "最后登录时间", width: "160px" },
  { key: "loggedToday", label: "今日登录", width: "90px" },
  { key: "soups", label: "汤品", width: "70px" },
  { key: "evaluations", label: "评价", width: "70px" },
  { key: "likes", label: "点赞", width: "70px" },
  { key: "favorites", label: "收藏", width: "70px" },
  { key: "password", label: "密码", width: "100px" },
  { key: "actions", label: "操作", width: "80px" }
];

export function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [todayFilter, setTodayFilter] = useState<TodayFilter>("all");
  const [sortBy, setSortBy] = useState<UserSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<UserColumn>>(() => new Set(userColumns.map((column) => column.key)));
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (submittedKeyword) params.set("keyword", submittedKeyword);
      if (todayFilter !== "all") params.set("loggedToday", todayFilter);
      params.set("limit", String(pageSize));
      params.set("offset", String((page - 1) * pageSize));
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      const data = await api<UsersResponseExt>(`/api/admin/users?${params.toString()}`);
      setUsers(data.users);
      setTotal(data.total);
    } finally { setLoading(false); }
  }, [submittedKeyword, todayFilter, page, pageSize, sortBy, sortOrder]);

  useEffect(() => { loadUsers().catch(() => {}); }, [loadUsers]);

  const template = useMemo(() => gridTemplate(userColumns, visibleColumns), [visibleColumns]);

  async function updateRole(item: AdminUser, role: "admin" | "user") {
    await api(`/api/admin/users/${item.id}`, { method: "PATCH", body: { nickname: item.nickname, role } });
    await loadUsers();
  }

  async function deleteUser(item: AdminUser) {
    if (!confirm(`确定删除用户 ${item.nickname} 吗？`)) return;
    await api(`/api/admin/users/${item.id}`, { method: "DELETE" });
    await loadUsers();
  }

  function openResetPassword(user: AdminUser) {
    setResetUser(user);
    setNewPassword("");
    setResetError("");
  }

  function closeResetPassword() {
    if (resetting) return;
    setResetUser(null);
    setNewPassword("");
    setResetError("");
  }

  async function resetPassword() {
    if (!resetUser) return;
    if (newPassword.length < 6) {
      setResetError("新密码至少需要 6 位");
      return;
    }
    setResetting(true);
    setResetError("");
    try {
      await api(`/api/admin/users/${resetUser.id}/reset-password`, { method: "POST", body: { newPassword } });
      setResetting(false);
      closeResetPassword();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "密码重置失败");
    } finally { setResetting(false); }
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-black text-ink">用户管理</h2>
          <div className="mt-1 text-sm text-muted">{total} 位用户</div>
        </div>
        <ColumnSelector columns={userColumns} visible={visibleColumns} onChange={setVisibleColumns} />
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-10 pl-4 pr-24"
            placeholder="搜索昵称、账号..."
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setSubmittedKeyword(keyword.trim()); } }}
          />
          <button className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={() => { setPage(1); setSubmittedKeyword(keyword.trim()); }}>
            <Search size={18} />
            <span>搜索</span>
          </button>
        </div>
        <select className="field h-10 sm:w-40" value={todayFilter} onChange={(event) => { setPage(1); setTodayFilter(event.target.value as TodayFilter); }}>
          <option value="all">全部登录状态</option>
          <option value="yes">今天已登录</option>
          <option value="no">今天未登录</option>
        </select>
        <select className="field h-10 sm:w-40" aria-label="用户排序字段" value={sortBy} onChange={(event) => { setPage(1); setSortBy(event.target.value as UserSortBy); }}>
          <option value="createdAt">按加入时间</option>
          <option value="lastLoginAt">按最后登录时间</option>
          <option value="soupCount">按发布汤品</option>
          <option value="evaluationCount">按发布评价</option>
          <option value="likeCount">按点赞</option>
          <option value="favoriteCount">按收藏</option>
        </select>
        <button
          className="btn btn-secondary h-10 px-3 text-xs whitespace-nowrap"
          title={sortOrder === "asc" ? "当前为正序" : "当前为倒序"}
          onClick={() => { setPage(1); setSortOrder((order) => order === "asc" ? "desc" : "asc"); }}
        >
          <ArrowUpDown size={15} />
          {sortOrder === "asc" ? "正序" : "倒序"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1180px]">
          <div className="mb-2 grid items-center justify-items-center gap-2 px-3 text-center text-xs font-bold text-muted" style={{ gridTemplateColumns: template }}>
            {userColumns.filter((column) => visibleColumns.has(column.key)).map((column) => <span key={column.key}>{column.label}</span>)}
          </div>
          <div className="space-y-1">
            {users.map((user) => (
              <div key={user.id} className="grid items-center justify-items-center gap-2 rounded-lg border border-line p-3 text-center text-sm" style={{ gridTemplateColumns: template }}>
                {visibleColumns.has("user") && (
                  <div className="avatar-name-gap flex min-w-0 items-center justify-center">
                    {user.avatar ? <img className="h-8 w-8 shrink-0 rounded-full object-cover" src={user.avatar} alt="" /> : (
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-black text-primary">{(user.nickname || user.username).slice(0, 1)}</div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{user.nickname}</div>
                      <div className="truncate text-xs text-muted">@{user.username}</div>
                    </div>
                  </div>
                )}
                {visibleColumns.has("role") && (
                  <select className="field h-9 w-24 px-2 text-xs" value={user.role} onChange={(event) => updateRole(user, event.target.value as "admin" | "user")}>
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                )}
                {visibleColumns.has("createdAt") && <span className="text-xs text-muted">{new Date(user.createdAt).toLocaleDateString()}</span>}
                {visibleColumns.has("lastLoginAt") && <span className="text-xs text-muted">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "从未登录"}</span>}
                {visibleColumns.has("loggedToday") && <span className={`rounded-full px-2 py-1 text-xs font-bold ${user.loggedInToday ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"}`}>{user.loggedInToday ? "已登录" : "未登录"}</span>}
                {visibleColumns.has("soups") && <span className="font-semibold text-ink">{user.stats.soupCount}</span>}
                {visibleColumns.has("evaluations") && <span>{user.stats.evaluationCount}</span>}
                {visibleColumns.has("likes") && <span>{user.stats.likeCount}</span>}
                {visibleColumns.has("favorites") && <span>{user.stats.favoriteCount}</span>}
                {visibleColumns.has("password") && <button className="btn btn-secondary h-8 px-2 text-xs whitespace-nowrap" onClick={() => openResetPassword(user)}><KeyRound size={14} />重置</button>}
                {visibleColumns.has("actions") && <button className="btn btn-danger h-8 px-2 text-xs whitespace-nowrap" onClick={() => deleteUser(user)}><Trash2 size={14} />删除</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {loading && <ListSkeleton rows={6} />}
      {!loading && users.length === 0 && <p className="py-8 text-center text-sm text-muted">没有符合条件的用户</p>}
      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPage(1); setPageSize(size); }}
      />

      {resetUser && (
        <Modal onClose={closeResetPassword}>
          <form onSubmit={(event) => { event.preventDefault(); resetPassword(); }}>
            <h2 className="text-lg font-black text-ink">重置用户密码</h2>
            <p className="mt-1 text-sm text-muted">为 {resetUser.nickname}（@{resetUser.username}）设置新密码。</p>
            <label className="mt-4 block text-sm font-bold text-ink" htmlFor="admin-reset-password">新密码</label>
            <input
              id="admin-reset-password"
              className="field mt-2 w-full"
              type="password"
              autoFocus
              placeholder="至少 6 位"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            {resetError && <p className="mt-2 text-sm text-red-600">{resetError}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="btn btn-secondary" type="button" onClick={closeResetPassword}>取消</button>
              <button className="btn btn-primary" type="submit" disabled={resetting}>{resetting ? "重置中……" : "确认重置"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
