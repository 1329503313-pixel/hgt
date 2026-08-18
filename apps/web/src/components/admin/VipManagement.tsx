import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Crown, History, MinusCircle, Search, UserRoundPlus, X } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import type { UserRole } from "../../shared/types";
import { Modal } from "../Modal";
import { ListSkeleton } from "../Skeletons";
import { AdminPageSize, AdminPagination } from "./AdminPagination";
import { VipIcon, VipName } from "../VipVisuals";

type VipIdentity = "super_admin" | "backoffice_admin" | "vip" | "expired";
type VipOrderType = "purchase_month" | "purchase_year" | "gift" | "reduce" | "cancel";
type VipUser = {
  id: string;
  nickname: string;
  username: string;
  role: UserRole;
  currentIdentity: VipIdentity;
  vipExpiresAt: string | null;
  legacyActive: boolean;
  remainingMinutes: number | null;
  expiredDays: number;
  vipGrowthValue: number;
  vipLevel: number;
  vipActive: boolean;
};
type VipOrder = {
  id: string;
  orderNumber: string;
  userId: string | null;
  nickname: string;
  username: string;
  orderType: VipOrderType;
  dayChange: number;
  balanceAfterDays: number;
  createdAt: string;
};
type GrantDuration = { unit: "day"; value: 1 | 3 | 7 | 15 } | { unit: "month"; value: number };

const ORDER_TYPE_LABELS: Record<VipOrderType, string> = {
  purchase_month: "购买月VIP",
  purchase_year: "购买年VIP",
  gift: "赠送VIP",
  reduce: "减少时间",
  cancel: "取消身份"
};
const IDENTITY_LABELS: Record<VipIdentity, string> = {
  super_admin: "超级管理员",
  backoffice_admin: "后台管理员",
  vip: "VIP",
  expired: "已过期"
};

function formatRemainingMinutes(minutes: number | null, legacyActive: boolean, vipActive: boolean) {
  if (legacyActive) return "历史VIP（无到期时间）";
  if (vipActive && (!minutes || minutes <= 0)) return "不足1分钟";
  if (!minutes || minutes <= 0) return "已过期";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const restMinutes = minutes % 60;
  return [days ? `${days}天` : "", hours ? `${hours}小时` : "", restMinutes ? `${restMinutes}分钟` : ""].filter(Boolean).join(" ");
}

function VipOrders({ user, onClose }: { user?: VipUser; onClose?: () => void }) {
  const [orders, setOrders] = useState<VipOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [orderType, setOrderType] = useState<VipOrderType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrders = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (user) params.set("userId", user.id);
      if (submittedKeyword) params.set("keyword", submittedKeyword);
      if (orderType !== "all") params.set("orderType", orderType);
      const data = await api<{ orders: VipOrder[]; total: number }>(`/api/admin/vip/orders?${params}`);
      setOrders(data.orders); setTotal(data.total);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "VIP订单加载失败"); }
    finally { setLoading(false); }
  }, [orderType, page, pageSize, submittedKeyword, user?.id]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  return <div className="card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
      <div><h2 className="font-black text-ink">{user ? `${user.nickname}的VIP订单` : "VIP订单"}</h2><p className="mt-1 text-sm text-muted">{user ? `@${user.username} · ` : ""}共 {total} 条，按订单号倒序</p></div>
      {onClose && <button type="button" className="btn btn-secondary shrink-0 px-3" onClick={onClose}><X size={16} />关闭</button>}
    </div>
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1"><input className="field h-10 pl-4 pr-24" placeholder="检索订单号、昵称、账号、订单类型" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setSubmittedKeyword(keyword.trim()); } }} /><button type="button" className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={() => { setPage(1); setSubmittedKeyword(keyword.trim()); }}><Search size={17} />搜索</button></div>
      <select className="field h-10 sm:w-40" aria-label="订单类型" value={orderType} onChange={(event) => { setPage(1); setOrderType(event.target.value as VipOrderType | "all"); }}><option value="all">全部订单类型</option>{Object.entries(ORDER_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">{error}</p>}
    <div className="overflow-x-auto"><div className="min-w-[1010px]">
      <div className="grid grid-cols-[160px_140px_150px_170px_130px_100px_120px] gap-2 px-3 pb-2 text-center text-xs font-bold text-muted"><span>订单号</span><span>用户昵称</span><span>用户账号</span><span>订单时间</span><span>订单类型</span><span>获取天数</span><span>下单后余额</span></div>
      {!loading && <div className="space-y-1">{orders.map((order) => <div key={order.id} className="grid grid-cols-[160px_140px_150px_170px_130px_100px_120px] items-center gap-2 rounded-lg border border-line p-3 text-center text-sm"><code className="text-xs font-bold text-ink">{order.orderNumber}</code><span className="truncate font-semibold text-ink" title={order.nickname}>{order.nickname}</span><span className="truncate text-muted" title={order.username}>@{order.username}</span><span className="text-xs text-muted">{new Date(order.createdAt).toLocaleString()}</span><span className="font-bold text-ink">{ORDER_TYPE_LABELS[order.orderType]}</span><span className={`font-black ${order.dayChange > 0 ? "text-emerald-600" : order.dayChange < 0 ? "text-red-600" : "text-muted"}`}>{order.dayChange > 0 ? "+" : ""}{order.dayChange}</span><span className="font-bold text-ink">{order.balanceAfterDays} 天</span></div>)}</div>}
    </div></div>
    {loading && <ListSkeleton rows={6} />}
    {!loading && orders.length === 0 && <p className="py-8 text-center text-sm text-muted">暂无VIP订单</p>}
    <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} />
  </div>;
}

function GrantVipModal({ user, onClose, onCompleted }: { user: VipUser | null; onClose: () => void; onCompleted: () => Promise<void> }) {
  const { showToast } = useApp();
  const [username, setUsername] = useState(user?.username ?? "");
  const [candidates, setCandidates] = useState<VipUser[]>(user ? [user] : []);
  const [selectedUser, setSelectedUser] = useState<VipUser | null>(user);
  const [duration, setDuration] = useState<GrantDuration>({ unit: "day", value: 1 });
  const [months, setMonths] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function searchUser() {
    const query = username.trim();
    if (!query) { setError("请输入用户账号"); return; }
    setBusy(true); setError(""); setSelectedUser(null);
    try {
      const data = await api<{ users: VipUser[] }>(`/api/admin/vip/users/search?mode=username&query=${encodeURIComponent(query)}`);
      setCandidates(data.users);
      if (data.users.length === 1 && data.users[0].username === query) setSelectedUser(data.users[0]);
      if (!data.users.length) setError("未找到匹配账号");
    } catch (searchError) { setError(searchError instanceof Error ? searchError.message : "用户查询失败"); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!selectedUser) { setError("请先选择用户"); return; }
    let nextDuration = duration;
    if (duration.unit === "month") {
      const value = Number(months);
      if (!Number.isInteger(value) || value <= 0) { setError("月数必须为正整数"); return; }
      nextDuration = { unit: "month", value };
    }
    setBusy(true); setError("");
    try {
      const result = await api<{ orderNumber: string }>("/api/admin/vip/grants", { method: "POST", body: { userId: selectedUser.id, duration: nextDuration } });
      showToast(`VIP赠送成功，订单号 ${result.orderNumber}`);
      await onCompleted(); onClose();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "VIP赠送失败"); }
    finally { setBusy(false); }
  }

  return <Modal onClose={() => { if (!busy) onClose(); }}><div className="space-y-4">
    <div><h2 className="text-lg font-black text-ink">赠送VIP</h2><p className="mt-1 text-sm text-muted">{user ? `${user.nickname}（@${user.username}）` : "输入账号并选择用户后赠送"}</p></div>
    {!user && <div><label className="text-sm font-bold text-ink">用户账号</label><div className="mt-2 flex gap-2"><input className="field min-w-0 flex-1" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchUser(); } }} /><button type="button" className="btn btn-secondary shrink-0" disabled={busy} onClick={() => void searchUser()}><Search size={16} />查询</button></div></div>}
    {!user && candidates.length > 0 && <div className="max-h-48 space-y-2 overflow-y-auto" role="radiogroup" aria-label="匹配账号">{candidates.map((candidate) => <button key={candidate.id} type="button" role="radio" aria-checked={selectedUser?.id === candidate.id} className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${selectedUser?.id === candidate.id ? "border-primary bg-blue-50" : "border-line"}`} onClick={() => setSelectedUser(candidate)}><span><strong className="block text-sm text-ink">{candidate.nickname}</strong><span className="text-xs text-muted">@{candidate.username}</span></span><span className="text-xs font-bold text-muted">{IDENTITY_LABELS[candidate.currentIdentity]}</span></button>)}</div>}
    <div><span className="text-sm font-bold text-ink">赠送时长</span><div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">{([1, 3, 7, 15] as const).map((days) => <button key={days} type="button" className={`btn ${duration.unit === "day" && duration.value === days ? "btn-primary" : "btn-secondary"}`} onClick={() => setDuration({ unit: "day", value: days })}>{days}天</button>)}<button type="button" className={`btn ${duration.unit === "month" ? "btn-primary" : "btn-secondary"}`} onClick={() => setDuration({ unit: "month", value: Number(months) || 1 })}>X月</button></div></div>
    {duration.unit === "month" && <label className="block"><span className="text-sm font-bold text-ink">赠送月数</span><input className="field mt-2" type="number" min="1" step="1" value={months} onChange={(event) => setMonths(event.target.value)} /><span className="mt-1 block text-xs text-muted">1月固定按31天计算</span></label>}
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">{error}</p>}
    <div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="btn btn-primary" disabled={busy || !selectedUser} onClick={() => void submit()}>{busy ? "处理中…" : "确定赠送"}</button></div>
  </div></Modal>;
}

function CancelVipModal({ user, onClose, onCompleted }: { user: VipUser; onClose: () => void; onCompleted: () => Promise<void> }) {
  const { showToast } = useApp();
  const [operation, setOperation] = useState<"reduce" | "cancel">("reduce");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (operation === "reduce") {
      const value = Number(days);
      if (!Number.isInteger(value) || value <= 0) { setError("减少天数必须为正整数"); return; }
    }
    setBusy(true); setError("");
    try {
      const result = operation === "reduce"
        ? await api<{ orderNumber: string }>(`/api/admin/vip/users/${user.id}/reduce`, { method: "POST", body: { days: Number(days) } })
        : await api<{ orderNumber: string }>(`/api/admin/vip/users/${user.id}/cancel`, { method: "POST" });
      showToast(`${operation === "reduce" ? "VIP时间已减少" : "VIP身份已取消"}，订单号 ${result.orderNumber}`);
      await onCompleted(); onClose();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "VIP调整失败"); }
    finally { setBusy(false); }
  }

  return <Modal onClose={() => { if (!busy) onClose(); }}><div className="space-y-4">
    <div><h2 className="text-lg font-black text-ink">取消VIP</h2><p className="mt-1 text-sm text-muted">{user.nickname}（@{user.username}）</p></div>
    <div className="grid grid-cols-2 gap-2"><button type="button" className={`btn ${operation === "reduce" ? "btn-primary" : "btn-secondary"}`} onClick={() => setOperation("reduce")}>减少时间</button><button type="button" className={`btn ${operation === "cancel" ? "btn-danger" : "btn-secondary"}`} onClick={() => setOperation("cancel")}>取消身份</button></div>
    {operation === "reduce" ? <label className="block"><span className="text-sm font-bold text-ink">减少天数</span><input className="field mt-2" type="number" min="1" step="1" autoFocus value={days} onChange={(event) => setDays(event.target.value)} /><span className="mt-1 block text-xs text-muted">可超过当前剩余时间；系统最低减至0，不会产生负数。</span></label> : <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">确认后VIP剩余时间立即清零，管理员身份不会受影响。</p>}
    {user.legacyActive && operation === "reduce" && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">该历史VIP没有到期时间，需先赠送新的VIP时长后才能减少；也可直接取消身份。</p>}
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">{error}</p>}
    <div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className={operation === "cancel" ? "btn btn-danger" : "btn btn-primary"} disabled={busy || (operation === "reduce" && user.legacyActive)} onClick={() => void submit()}>{busy ? "处理中…" : "确定"}</button></div>
  </div></Modal>;
}

export function VipManagement() {
  const [tab, setTab] = useState<"users" | "orders">("users");
  const [users, setUsers] = useState<VipUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [grantUser, setGrantUser] = useState<VipUser | null | undefined>(undefined);
  const [cancelUser, setCancelUser] = useState<VipUser | null>(null);
  const [orderUser, setOrderUser] = useState<VipUser | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (submittedKeyword) params.set("keyword", submittedKeyword);
      const data = await api<{ users: VipUser[]; total: number }>(`/api/admin/vip/users?${params}`);
      setUsers(data.users); setTotal(data.total);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "VIP用户加载失败"); }
    finally { setLoading(false); }
  }, [page, pageSize, submittedKeyword]);

  useEffect(() => { if (tab === "users") void loadUsers(); }, [loadUsers, tab]);

  return <div className="space-y-4">
    <div className="card p-2"><div className="grid grid-cols-2 gap-2" role="tablist" aria-label="VIP管理子模块"><button type="button" role="tab" aria-selected={tab === "users"} className={`btn ${tab === "users" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("users")}><Crown size={17} />用户</button><button type="button" role="tab" aria-selected={tab === "orders"} className={`btn ${tab === "orders" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("orders")}><History size={17} />订单</button></div></div>
    {tab === "orders" ? <VipOrders /> : <div className="card p-4">
      <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-black text-ink">VIP用户</h2><p className="mt-1 text-sm text-muted">有效与曾经拥有过VIP的用户，共 {total} 位</p></div><button type="button" className="btn btn-primary shrink-0" onClick={() => setGrantUser(null)}><UserRoundPlus size={17} />赠送VIP</button></div>
      <div className="relative mb-4"><input className="field h-10 pl-4 pr-24" placeholder="搜索用户昵称、账号" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setSubmittedKeyword(keyword.trim()); } }} /><button type="button" className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={() => { setPage(1); setSubmittedKeyword(keyword.trim()); }}><Search size={17} />搜索</button></div>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">{error}</p>}
      <div className="overflow-x-auto"><div className="min-w-[1170px]"><div className="grid grid-cols-[150px_150px_130px_120px_220px_110px_290px] gap-2 px-3 pb-2 text-center text-xs font-bold text-muted"><span>用户昵称</span><span>用户账号</span><span>当前身份</span><span>VIP成长值</span><span>剩余VIP时间</span><span>已过期时间</span><span>操作</span></div>{!loading && <div className="space-y-1">{users.map((user) => { const vipActive = user.legacyActive || Boolean(user.vipExpiresAt && new Date(user.vipExpiresAt).getTime() > Date.now()); return <div key={user.id} className="grid grid-cols-[150px_150px_130px_120px_220px_110px_290px] items-center gap-2 rounded-lg border border-line p-3 text-center text-sm"><span className="flex min-w-0 items-center justify-center gap-1 truncate font-semibold text-ink" title={user.nickname}><VipName nickname={user.nickname} level={user.vipLevel} active={vipActive} /><VipIcon level={user.vipLevel} active={vipActive} className="h-4 w-4 shrink-0" /></span><span className="truncate text-muted" title={user.username}>@{user.username}</span><span className={`mx-auto rounded-full px-2.5 py-1 text-xs font-black ${user.currentIdentity === "vip" ? "bg-amber-100 text-amber-800" : user.currentIdentity === "expired" ? "bg-slate-100 text-muted" : "bg-blue-50 text-primary"}`}>{IDENTITY_LABELS[user.currentIdentity]}</span><span className="font-black text-amber-700">{user.vipGrowthValue.toLocaleString()} · VIP{user.vipLevel}</span><span className={`text-xs font-bold ${vipActive ? "text-emerald-700" : "text-muted"}`} title={user.vipExpiresAt ? `到期时间：${new Date(user.vipExpiresAt).toLocaleString()}` : undefined}>{formatRemainingMinutes(user.remainingMinutes, user.legacyActive, vipActive)}</span><span className="text-xs text-muted">{!vipActive && user.vipExpiresAt ? `已过期 ${user.expiredDays} 天` : "—"}</span><div className="flex items-center justify-center gap-1"><button type="button" className="btn btn-primary h-9 px-2 text-xs" onClick={() => setGrantUser(user)}><CalendarClock size={14} />赠送VIP</button><button type="button" className="btn btn-secondary h-9 px-2 text-xs text-red-600" onClick={() => setCancelUser(user)}><MinusCircle size={14} />取消VIP</button><button type="button" className="btn btn-secondary h-9 px-2 text-xs" onClick={() => setOrderUser(user)}><History size={14} />订单</button></div></div>; })}</div>}</div></div>
      {loading && <ListSkeleton rows={6} />}{!loading && users.length === 0 && <p className="py-8 text-center text-sm text-muted">暂无符合条件的VIP用户</p>}
      <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} />
    </div>}
    {grantUser !== undefined && <GrantVipModal user={grantUser} onClose={() => setGrantUser(undefined)} onCompleted={loadUsers} />}
    {cancelUser && <CancelVipModal user={cancelUser} onClose={() => setCancelUser(null)} onCompleted={loadUsers} />}
    {orderUser && <Modal full hideClose onClose={() => setOrderUser(null)}><VipOrders user={orderUser} onClose={() => setOrderUser(null)} /></Modal>}
  </div>;
}
