import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, KeyRound, Search, Shell, Trash2, X } from "lucide-react";
import type { PublicUser } from "../../shared/types";
import type { ShellTransaction } from "../../shared/types";
import { api } from "../../api";
import { Modal } from "../Modal";
import { AdminColumn, ColumnSelector, gridTemplate } from "./ColumnSelector";
import { AdminPageSize, AdminPagination } from "./AdminPagination";
import { ListSkeleton } from "../Skeletons";
import { subscribeServerEvent } from "../../shared/serverEvents";
import { useApp } from "../../context/AppContext";
import type { ActivityBadgeCondition } from "../BadgeVisuals";
import { ActivityConditionsEditor, newActivityCondition } from "./ActivityConditionsEditor";

type AdminUser = PublicUser & {
  username: string;
  lastLoginAt: string | null;
  isOnline: boolean;
  loggedInToday: boolean;
  shellBalance: number;
  achievementPoints: number;
  stats: { soupCount: number; evaluationCount: number; likeCount: number; favoriteCount: number };
};

type UsersResponseExt = { users: AdminUser[]; total: number };
type TodayFilter = "all" | "yes" | "no";
type UserSortBy = "createdAt" | "lastLoginAt" | "soupCount" | "evaluationCount" | "likeCount" | "favoriteCount" | "shellBalance" | "achievementPoints";
type SortOrder = "asc" | "desc";
type UserColumn = "user" | "role" | "createdAt" | "lastLoginAt" | "loggedToday" | "shells" | "achievementPoints" | "soups" | "evaluations" | "likes" | "favorites" | "password" | "actions";
type BulkShellPreview = { matchedCount: number; eligibleCount: number; skippedCount: number };

const userColumns: readonly AdminColumn<UserColumn>[] = [
  { key: "user", label: "用户", width: "minmax(190px, 1fr)" },
  { key: "role", label: "角色", width: "110px" },
  { key: "createdAt", label: "加入时间", width: "110px" },
  { key: "lastLoginAt", label: "最后登录时间", width: "160px" },
  { key: "loggedToday", label: "今日登录", width: "90px" },
  { key: "shells", label: "贝壳", width: "90px" },
  { key: "achievementPoints", label: "成就点", width: "90px" },
  { key: "soups", label: "汤品", width: "70px" },
  { key: "evaluations", label: "评价", width: "70px" },
  { key: "likes", label: "点赞", width: "70px" },
  { key: "favorites", label: "收藏", width: "70px" },
  { key: "password", label: "密码", width: "100px" },
  { key: "actions", label: "操作", width: "80px" }
];

export function UserManagement() {
  const { showToast } = useApp();
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
  const [shellUser, setShellUser] = useState<AdminUser | null>(null);
  const [shellTransactions, setShellTransactions] = useState<ShellTransaction[]>([]);
  const [shellLoading, setShellLoading] = useState(false);
  const [shellOperation, setShellOperation] = useState<"add" | "deduct" | null>(null);
  const [shellAmount, setShellAmount] = useState("");
  const [shellError, setShellError] = useState("");
  const [shellAdjusting, setShellAdjusting] = useState(false);
  const [bulkShellOpen, setBulkShellOpen] = useState(false);
  const [bulkShellOperation, setBulkShellOperation] = useState<"add" | "deduct">("add");
  const [bulkShellAmount, setBulkShellAmount] = useState("");
  const [bulkShellConditions, setBulkShellConditions] = useState<ActivityBadgeCondition[]>(() => [newActivityCondition()]);
  const [bulkShellPreview, setBulkShellPreview] = useState<BulkShellPreview | null>(null);
  const [bulkShellBusy, setBulkShellBusy] = useState(false);
  const [bulkShellError, setBulkShellError] = useState("");
  const presenceRefreshTimer = useRef<number | null>(null);

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

  useEffect(() => {
    const unsubscribe = subscribeServerEvent("presence_changed", (event) => {
      try {
        const payload = JSON.parse(event.data) as { userId?: string; online?: boolean };
        if (!payload.userId) return;
        setUsers((current) => current.map((item) => item.id === payload.userId ? { ...item, isOnline: Boolean(payload.online) } : item));
        if (sortBy === "lastLoginAt" && sortOrder === "desc") {
          if (presenceRefreshTimer.current != null) window.clearTimeout(presenceRefreshTimer.current);
          presenceRefreshTimer.current = window.setTimeout(() => void loadUsers().catch(() => {}), 250);
        }
      } catch {
        // 忽略格式异常的在线状态事件。
      }
    });
    return () => {
      unsubscribe();
      if (presenceRefreshTimer.current != null) window.clearTimeout(presenceRefreshTimer.current);
    };
  }, [loadUsers, sortBy, sortOrder]);

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

  async function loadShellDetail(item: AdminUser) {
    setShellUser(item);
    setShellLoading(true);
    setShellError("");
    try {
      const data = await api<{ balance: number; transactions: ShellTransaction[] }>(`/api/admin/users/${item.id}/shell-transactions?limit=50`);
      setShellUser((current) => current ? { ...current, shellBalance: data.balance } : current);
      setShellTransactions(data.transactions);
    } catch (error) {
      setShellError(error instanceof Error ? error.message : "贝壳明细加载失败");
    } finally {
      setShellLoading(false);
    }
  }

  async function adjustShells() {
    if (!shellUser || !shellOperation) return;
    const amount = Number(shellAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setShellError("请输入正整数");
      return;
    }
    setShellAdjusting(true);
    setShellError("");
    try {
      await api(`/api/admin/users/${shellUser.id}/shell-adjustments`, { method: "POST", body: { operation: shellOperation, amount } });
      setShellAmount("");
      setShellOperation(null);
      await Promise.all([loadShellDetail(shellUser), loadUsers()]);
    } catch (error) {
      setShellError(error instanceof Error ? error.message : "贝壳调整失败");
    } finally {
      setShellAdjusting(false);
    }
  }

  function bulkShellBody() {
    return { operation: bulkShellOperation, amount: Number(bulkShellAmount), conditions: bulkShellConditions };
  }

  function closeBulkShell() {
    if (bulkShellBusy) return;
    setBulkShellOpen(false);
    setBulkShellPreview(null);
    setBulkShellError("");
  }

  async function previewBulkShells() {
    const amount = Number(bulkShellAmount);
    if (!Number.isInteger(amount) || amount <= 0) { setBulkShellError("请输入正整数贝壳数量"); return; }
    if (bulkShellConditions.length === 0) { setBulkShellError("请至少设置一个用户条件"); return; }
    setBulkShellBusy(true); setBulkShellError("");
    try {
      setBulkShellPreview(await api<BulkShellPreview>("/api/admin/users/bulk-shell-adjustments/preview", { method: "POST", body: bulkShellBody() }));
    } catch (error) { setBulkShellError(error instanceof Error ? error.message : "符合用户计算失败"); }
    finally { setBulkShellBusy(false); }
  }

  async function executeBulkShells() {
    if (!bulkShellPreview || bulkShellPreview.eligibleCount === 0) return;
    if (!confirm(`确定向 ${bulkShellPreview.eligibleCount} 位用户${bulkShellOperation === "add" ? "发放" : "扣除"} ${bulkShellAmount} 贝壳吗？`)) return;
    setBulkShellBusy(true); setBulkShellError("");
    try {
      const result = await api<{ matchedCount: number; adjustedCount: number; skippedCount: number }>("/api/admin/users/bulk-shell-adjustments", { method: "POST", body: bulkShellBody() });
      showToast(`已为 ${result.adjustedCount} 位用户${bulkShellOperation === "add" ? "发放" : "扣除"}贝壳${result.skippedCount ? `，跳过 ${result.skippedCount} 位余额不足用户` : ""}`);
      setBulkShellOpen(false); setBulkShellPreview(null); setBulkShellAmount("");
      await loadUsers();
    } catch (error) { setBulkShellError(error instanceof Error ? error.message : "批量贝壳操作失败"); }
    finally { setBulkShellBusy(false); }
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
        <div className="flex items-center gap-2"><button type="button" className="btn btn-primary h-10 px-3 text-xs whitespace-nowrap" onClick={() => { setBulkShellOpen(true); setBulkShellPreview(null); setBulkShellError(""); }}><Shell size={16} />发放/扣除贝壳</button><ColumnSelector columns={userColumns} visible={visibleColumns} onChange={setVisibleColumns} /></div>
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
          <option value="shellBalance">按贝壳</option>
          <option value="achievementPoints">按成就点</option>
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
        <div className="min-w-[1370px]">
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
                {visibleColumns.has("lastLoginAt") && <span className={`text-xs font-bold ${user.isOnline ? "text-emerald-600" : "text-muted"}`}>{user.isOnline ? "在线" : user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "从未登录"}</span>}
                {visibleColumns.has("loggedToday") && <span className={`rounded-full px-2 py-1 text-xs font-bold ${user.loggedInToday ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"}`}>{user.loggedInToday ? "已登录" : "未登录"}</span>}
                {visibleColumns.has("shells") && <button className="inline-flex items-center gap-1 font-black text-primary hover:underline" onClick={() => void loadShellDetail(user)}><Shell size={14} />{user.shellBalance}</button>}
                {visibleColumns.has("achievementPoints") && <span className="font-black text-amber-600">{user.achievementPoints.toLocaleString()}</span>}
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

      {bulkShellOpen && <Modal full onClose={closeBulkShell}>
        <div className="flex items-start justify-between gap-3 border-b border-line pb-3"><div><h2 className="text-lg font-black text-ink">批量发放/扣除贝壳</h2><p className="mt-1 text-sm text-muted">多个条件需同时满足，仅面向普通用户</p></div><button className="btn btn-secondary shrink-0 px-3" disabled={bulkShellBusy} onClick={closeBulkShell}><X size={17} />关闭</button></div>
        <div className="space-y-5 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><span className="text-sm font-bold text-ink">操作类型</span><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className={`btn ${bulkShellOperation === "add" ? "btn-primary" : "btn-secondary"}`} disabled={bulkShellBusy} onClick={() => { setBulkShellOperation("add"); setBulkShellPreview(null); }}>发放贝壳</button><button type="button" className={`btn ${bulkShellOperation === "deduct" ? "btn-danger" : "btn-secondary"}`} disabled={bulkShellBusy} onClick={() => { setBulkShellOperation("deduct"); setBulkShellPreview(null); }}>扣除贝壳</button></div></div>
            <label><span className="text-sm font-bold text-ink">每位用户调整数量</span><input className="field mt-2" type="number" min="1" step="1" value={bulkShellAmount} disabled={bulkShellBusy} onChange={(event) => { setBulkShellAmount(event.target.value); setBulkShellPreview(null); }} placeholder="请输入正整数" /></label>
          </div>
          <div><div className="mb-3"><h3 className="text-sm font-black text-ink">用户条件</h3><p className="mt-1 text-xs text-muted">规则与活动徽章发放条件一致</p></div><ActivityConditionsEditor value={bulkShellConditions} disabled={bulkShellBusy} onChange={(conditions) => { setBulkShellConditions(conditions); setBulkShellPreview(null); }} emptyText="请至少添加一个用户条件" /></div>
          {bulkShellOperation === "deduct" && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">余额不足本次扣减数量的用户将被跳过，不会扣成负数。</p>}
          {bulkShellError && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{bulkShellError}</p>}
          {bulkShellPreview && <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-4 text-center"><div><p className="text-xl font-black text-ink">{bulkShellPreview.matchedCount}</p><p className="mt-1 text-xs text-muted">符合条件</p></div><div><p className="text-xl font-black text-emerald-600">{bulkShellPreview.eligibleCount}</p><p className="mt-1 text-xs text-muted">实际操作</p></div><div><p className="text-xl font-black text-amber-600">{bulkShellPreview.skippedCount}</p><p className="mt-1 text-xs text-muted">余额不足跳过</p></div></div>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-white pt-3"><button className="btn btn-secondary" disabled={bulkShellBusy} onClick={() => void previewBulkShells()}>{bulkShellBusy ? "计算中…" : "计算符合用户"}</button><button className={bulkShellOperation === "add" ? "btn btn-primary" : "btn btn-danger"} disabled={bulkShellBusy || !bulkShellPreview || bulkShellPreview.eligibleCount === 0} onClick={() => void executeBulkShells()}>{bulkShellBusy ? "处理中…" : `确认${bulkShellOperation === "add" ? "发放" : "扣除"}`}</button></div>
      </Modal>}

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

      {shellUser && (
        <Modal onClose={() => { if (!shellAdjusting) { setShellUser(null); setShellOperation(null); setShellAmount(""); setShellError(""); } }}>
          <div className="space-y-4">
            <div><h2 className="text-lg font-black text-ink">{shellUser.nickname}的贝壳明细</h2><p className="mt-1 flex items-center gap-1 text-sm font-bold text-primary"><Shell size={16} />当前余额：{shellUser.shellBalance.toLocaleString()}</p></div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary" onClick={() => { setShellOperation("add"); setShellError(""); }}>增加</button>
              <button className="btn btn-secondary text-red-600" onClick={() => { setShellOperation("deduct"); setShellError(""); }}>扣减</button>
            </div>
            {shellOperation && <form className="rounded-xl border border-line bg-slate-50 p-3" onSubmit={(event) => { event.preventDefault(); void adjustShells(); }}>
              <label className="text-sm font-bold text-ink">{shellOperation === "add" ? "增加数量" : "扣减数量"}</label>
              <div className="mt-2 flex gap-2"><input className="field min-w-0 flex-1" type="number" min="1" step="1" autoFocus value={shellAmount} onChange={(event) => setShellAmount(event.target.value)} /><button className="btn btn-primary shrink-0" disabled={shellAdjusting}>{shellAdjusting ? "处理中…" : "确认"}</button></div>
            </form>}
            {shellError && <p className="text-sm font-bold text-red-600">{shellError}</p>}
            <div className="max-h-[45dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {shellLoading ? <ListSkeleton rows={5} /> : shellTransactions.length ? shellTransactions.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0"><p className="truncate font-bold text-ink">{item.remark || item.typeLabel}</p><p className="mt-1 text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</p></div>
                  <div className="shrink-0 text-right"><p className={`font-black ${item.amount > 0 ? "text-emerald-600" : "text-red-500"}`}>{item.amount > 0 ? "+" : ""}{item.amount}</p><p className="text-[11px] text-muted">余额 {item.balanceAfter}</p></div>
                </div>
              )) : <p className="p-8 text-center text-sm text-muted">暂无贝壳明细</p>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
