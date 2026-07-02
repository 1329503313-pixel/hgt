import { toPng } from "html-to-image";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Download,
  Eye,
  ImagePlus,
  Home,
  Lock,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Star,
  Trash2,
  User,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  Evaluation,
  NotificationItem,
  PublicUser,
  SoupDetail,
  SoupSummary,
  ViewRequestItem
} from "./shared/types";
import { api, MeResponse, NotificationsResponse, PasswordResponse, RequestsResponse, SoupResponse, SoupsResponse, UsersResponse } from "./api";
import { RadarChart } from "./RadarChart";

type View = "home" | "detail" | "messages" | "allNotifications" | "allRequests" | "admin" | "mine";
type AuthMode = "login" | "register" | null;
type SoupForm = {
  title: string;
  author: string;
  type: string;
  summary: string;
  coverImage: string;
  isOriginal: boolean;
  surface: string;
  supplementalSurfaces: string[];
  bottom: string;
  supplementalBottoms: string[];
  manual: string;
  isSurfacePublic: boolean;
  isBottomPublic: boolean;
};
type EvalForm = {
  total: string;
  writing: string;
  logic: string;
  share: string;
  mechanism: string;
  twist: string;
  depth: string;
};

const emptySoup: SoupForm = {
  title: "",
  author: "",
  type: "本格清汤",
  summary: "",
  coverImage: "",
  isOriginal: true,
  surface: "",
  supplementalSurfaces: [],
  bottom: "",
  supplementalBottoms: [],
  manual: "",
  isSurfacePublic: true,
  isBottomPublic: false
};

const emptyEval: EvalForm = {
  total: "4",
  writing: "",
  logic: "",
  share: "",
  mechanism: "",
  twist: "",
  depth: ""
};

const soupTypes = ["本格清汤", "本格红汤", "本格黑汤", "变格清汤", "变格红汤", "变格黑汤", "纯机制汤", "其他"];
function formatViews(value: number) {
  if (value >= 10000) return `${Number((value / 10000).toFixed(value >= 100000 ? 0 : 1))}w`;
  return value.toLocaleString();
}

export default function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [soupsHasMore, setSoupsHasMore] = useState(true);
  const [soupsLoading, setSoupsLoading] = useState(false);
  const soupsLoadingRef = useRef(false);
  const soupsOffsetRef = useRef(0);
  const [selected, setSelected] = useState<SoupDetail | null>(null);
  const [view, setView] = useState<View>("home");
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [authError, setAuthError] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [mySoups, setMySoups] = useState<SoupSummary[]>([]);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [showSoupForm, setShowSoupForm] = useState(false);
  const [editingSoupId, setEditingSoupId] = useState<string | null>(null);
  const [soupForm, setSoupForm] = useState<SoupForm>(emptySoup);
  const [showEvalForm, setShowEvalForm] = useState(false);
  const [evalForm, setEvalForm] = useState<EvalForm>(emptyEval);
  const [filters, setFilters] = useState({
    keyword: "",
    type: "",
    minRating: "all",
    bottomPublic: "all"
  });
  const [toast, setToast] = useState("");
  const [exportReady, setExportReady] = useState<{ url: string; name: string } | null>(null);

  const unread = notifications.filter((item) => !item.isRead).length;

  async function loadMe() {
    const data = await api<MeResponse>("/api/auth/me");
    setUser(data.user);
  }

  async function loadSoups(append = false) {
    // 用 ref 做并发保护，避免 state 闭包延迟导致重复请求
    if (soupsLoadingRef.current) return;
    if (append && !soupsHasMore) return;
    soupsLoadingRef.current = true;
    setSoupsLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== "all") params.set(key, value);
      });
      params.set("limit", "10");
      params.set("offset", String(append ? soupsOffsetRef.current : 0));
      const data = await api<SoupsResponse>(`/api/soups?${params.toString()}`);
      if (append) {
        setSoups((old) => {
          const seen = new Set(old.map((item) => item.id));
          const next = data.soups.filter((item) => !seen.has(item.id));
          soupsOffsetRef.current += next.length;
          return [...old, ...next];
        });
      } else {
        setSoups(data.soups);
        soupsOffsetRef.current = data.soups.length;
      }
      setSoupsHasMore(data.hasMore);
    } finally {
      soupsLoadingRef.current = false;
      setSoupsLoading(false);
    }
  }

  async function loadMoreSoups() {
    await loadSoups(true);
  }

  async function loadNotifications() {
    if (!user) return;
    const data = await api<NotificationsResponse>("/api/notifications");
    setNotifications(data.notifications);
  }

  async function loadRequests() {
    if (!user) return;
    const data = await api<RequestsResponse>("/api/access-requests");
    setRequests(data.requests);
  }

  async function loadUsers() {
    if (user?.role !== "admin") return;
    const data = await api<UsersResponse>("/api/admin/users");
    setUsers(data.users);
  }

  async function loadMySoups() {
    if (!user) return;
    const data = await api<SoupsResponse>("/api/me/soups");
    setMySoups(data.soups);
  }

  async function loadDetail(id: string) {
    const data = await api<SoupResponse>(`/api/soups/${id}`);
    setSelected(data.soup);
    setView("detail");
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }

  useEffect(() => {
    loadMe().catch(() => undefined);
  }, []);

  useEffect(() => {
    loadSoups(false).catch((error) => setToast(error.message));
  }, [filters]);

  useEffect(() => {
    loadNotifications().catch(() => undefined);
    loadRequests().catch(() => undefined);
    loadUsers().catch(() => undefined);
    loadMySoups().catch(() => undefined);
  }, [user]);

  async function refreshAll() {
    await Promise.all([loadSoups(false), loadNotifications(), loadRequests(), loadUsers(), loadMySoups()]);
    if (selected) await loadDetail(selected.id);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api<MeResponse>(path, { method: "POST", body: payload });
      setUser(data.user);
      setAuthError("");
      setAuthMode(null);
      await refreshAll();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败，请检查账号和密码");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setSelected(null);
    setNotifications([]);
    setRequests([]);
    setUsers([]);
    setView("home");
  }

  function openCreate() {
    if (!user) {
      setAuthError("");
      setAuthMode("login");
      return;
    }
    setEditingSoupId(null);
    setSoupForm({ ...emptySoup, author: user.nickname || user.username });
    setShowSoupForm(true);
  }

  function openEdit(soup: SoupDetail) {
    setEditingSoupId(soup.id);
    setSoupForm({
      title: soup.title,
      author: soup.author,
      type: soup.type,
      summary: soup.summary,
      coverImage: soup.coverImage ?? "",
      isOriginal: soup.isOriginal,
      surface: soup.surface,
      supplementalSurfaces: soup.supplementalSurfaces,
      bottom: soup.bottom ?? "",
      supplementalBottoms: soup.supplementalBottoms ?? [],
      manual: soup.manual ?? "",
      isSurfacePublic: soup.isSurfacePublic,
      isBottomPublic: soup.isBottomPublic
    });
    setShowSoupForm(true);
  }

  async function submitSoup(event: FormEvent) {
    event.preventDefault();
    const method = editingSoupId ? "PUT" : "POST";
    const path = editingSoupId ? `/api/soups/${editingSoupId}` : "/api/soups";
    const payload = {
      ...soupForm,
      supplementalSurfaces: soupForm.supplementalSurfaces.map((item) => item.trim()).filter(Boolean),
      supplementalBottoms: soupForm.supplementalBottoms.map((item) => item.trim()).filter(Boolean),
      author: soupForm.isOriginal ? soupForm.author : "佚名"
    };
    const result = await api<{ id?: string }>(path, { method, body: payload });
    setShowSoupForm(false);
    await loadSoups(false);
    await loadDetail(editingSoupId ?? result.id!);
  }

  async function deleteSoup(id: string) {
    if (!confirm("确定删除这条海龟汤吗？相关评价也会删除。")) return;
    await api(`/api/soups/${id}`, { method: "DELETE" });
    setSelected(null);
    setView("home");
    await loadSoups(false);
  }

  async function submitEvaluation(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await api(`/api/soups/${selected.id}/evaluations`, {
      method: "POST",
      body: evalForm
    });
    setShowEvalForm(false);
    setToast("评价已保存");
    await loadDetail(selected.id);
    await loadSoups(false);
  }

  async function requestAccess() {
    if (!selected) return;
    if (!user) {
      setAuthError("");
      setAuthMode("login");
      return;
    }
    await api(`/api/soups/${selected.id}/access-requests`, { method: "POST" });
    setToast("申请已发送，作者和管理员会收到提醒");
    await loadDetail(selected.id);
  }

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
    await Promise.all([loadRequests(), loadNotifications()]);
    if (selected) await loadDetail(selected.id);
  }

  async function markRead(id: string) {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    await loadNotifications();
  }

  async function exportText(textValue: string, name: string, sectionTitle?: string) {
    if (!user) {
      setAuthError("");
      setAuthMode("login");
      return;
    }
    if (!selected || !textValue.trim()) return;

    const sheet = document.createElement("div");
    sheet.className = "export-sheet";
    sheet.style.position = "absolute";
    sheet.style.left = "0";
    sheet.style.top = "0";
    sheet.style.zIndex = "-1";
    sheet.style.pointerEvents = "none";

    const header = document.createElement("div");
    header.className = "export-header";

    const eyebrow = document.createElement("div");
    eyebrow.className = "export-eyebrow";
    eyebrow.textContent = "海龟汤";

    const title = document.createElement("h1");
    title.textContent = selected.title;

    const meta = document.createElement("div");
    meta.className = "export-meta";
    meta.textContent = `作者 ${selected.author} · 评分 ${selected.averageTotal ?? "-"} · ${selected.evaluationCount} 条评价`;

    const tags = document.createElement("div");
    tags.className = "export-tags";
    [selected.type, selected.isBottomPublic ? "公开汤" : "需授权", selected.isOriginal ? "原创" : "非原创"].forEach((item) => {
      const tag = document.createElement("span");
      tag.textContent = item;
      tags.appendChild(tag);
    });

    header.append(eyebrow, title, meta, tags);

    const body = document.createElement("div");
    body.className = "export-body";
    const bodyTitle = document.createElement("h2");
    bodyTitle.textContent = sectionTitle ?? name.split("-").pop() ?? "";
    const content = document.createElement("div");
    content.className = "export-content";
    content.textContent = textValue;
    body.append(bodyTitle, content);

    sheet.append(header, body);
    document.body.appendChild(sheet);

    try {
      const dataUrl = await toPng(sheet, {
        backgroundColor: "#F5F7FA",
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: true,
        width: sheet.scrollWidth,
        height: sheet.scrollHeight
      });
      setExportReady({ url: dataUrl, name: `${name}.png` });
    } finally {
      sheet.remove();
    }
  }

  async function updateUser(item: PublicUser, role: "admin" | "user") {
    await api(`/api/admin/users/${item.id}`, {
      method: "PATCH",
      body: { nickname: item.nickname, role }
    });
    await loadUsers();
  }

  async function deleteUser(item: PublicUser) {
    if (!confirm(`确定删除用户 ${item.nickname} 吗？`)) return;
    await api(`/api/admin/users/${item.id}`, { method: "DELETE" });
    await loadUsers();
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setToast("两次输入的新密码不一致");
      return;
    }
    try {
      await api<PasswordResponse>("/api/auth/password", { method: "POST", body: { newPassword: passwordForm.newPassword } });
      setPasswordForm({ newPassword: "", confirmPassword: "" });
      setToast("密码已更新");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "修改密码失败");
    }
  }

  const ownEvaluation = useMemo(() => {
    if (!selected || !user) return null;
    return selected.evaluations.find((item) => item.reviewerId === user.id) ?? null;
  }, [selected, user]);

  function openEval() {
    if (!user) {
      setAuthError("");
      setAuthMode("login");
      return;
    }
    if (ownEvaluation) {
      setEvalForm({
        total: String(ownEvaluation.total),
        writing: ownEvaluation.writing?.toString() ?? "",
        logic: ownEvaluation.logic?.toString() ?? "",
        share: ownEvaluation.share?.toString() ?? "",
        mechanism: ownEvaluation.mechanism?.toString() ?? "",
        twist: ownEvaluation.twist?.toString() ?? "",
        depth: ownEvaluation.depth?.toString() ?? ""
      });
    } else {
      setEvalForm(emptyEval);
    }
    setShowEvalForm(true);
  }

  return (
    <div className="app-shell min-h-screen bg-page">
      {view !== "home" && view !== "messages" && view !== "mine" && <header className="fixed inset-x-0 top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <button className="flex min-h-11 items-center gap-2 text-left text-base font-black text-ink" onClick={() => setView("home")}>
            {view === "detail" ? (
              <>
                <ArrowLeft size={18} />
                <span>返回列表</span>
              </>
            ) : (
              <span>海龟汤</span>
            )}
          </button>
          <div className="flex items-center gap-2">
            {user && (
              <button className="btn btn-secondary relative px-3" onClick={() => setView("messages")}>                <Bell size={18} />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-warning px-1.5 text-xs text-white">
                  {unread}
                  </span>
                )}
              </button>
            )}
            {user?.role === "admin" && (
              <button
                className="btn btn-secondary hidden px-3 sm:inline-flex"
                onClick={() => setView(view === "admin" ? "home" : "admin")}
              >
                <Shield size={18} />
                {view === "admin" ? "前台" : "后台"}
              </button>
            )}
            {user ? (
              <details className="user-menu">
                <summary className="inline-flex min-h-11 max-w-24 cursor-pointer list-none items-center truncate rounded-lg bg-white px-3 text-sm font-bold text-ink sm:max-w-32">
                  {(user.nickname || user.username).slice(0, 8)}
                </summary>
                <div className="user-menu-panel right-0 top-[calc(100%+8px)]">
                  <button className="user-menu-item" onClick={logout}>
                    <LogOut size={17} />
                    退出登录
                  </button>
                </div>
              </details>
            ) : (
              <button className="btn btn-primary" onClick={() => { setAuthError(""); setAuthMode("login"); }}>
                登录
              </button>
            )}
          </div>
        </div>
      </header>}

      <main className={`mx-auto max-w-6xl px-4 ${view === "detail" ? "pb-24" : "pb-28"} ${view === "home" || view === "messages" || view === "mine" ? "pt-24" : "pb-4 pt-24"}`}>
        {toast && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-primary">
            {toast}
            <button onClick={() => setToast("")}>
              <X size={16} />
            </button>
          </div>
        )}

        {view === "home" && (
          <HomeView
            soups={soups}
            filters={filters}
            setFilters={setFilters}
            onOpen={loadDetail}
            user={user}
            unread={unread}
            onMessages={() => setView("messages")}
            onAdmin={() => setView("admin")}
            onLogin={() => { setAuthError(""); setAuthMode("login"); }}
            onLogout={logout}
            hasMore={soupsHasMore}
            loading={soupsLoading}
            onLoadMore={loadMoreSoups}
          />
        )}
        {view === "detail" && selected && (
          <DetailView
            soup={selected}
            user={user}
            ownEvaluation={ownEvaluation}
            onEdit={() => openEdit(selected)}
            onDelete={() => deleteSoup(selected.id)}
            onEvaluate={openEval}
            onRequest={requestAccess}
            onExport={exportText}
          />
        )}
        {view === "messages" && (
          <MessagesView
            notifications={notifications}
            requests={requests}
            user={user}
            unread={unread}
            onRead={markRead}
            onDecision={decideRequest}
            onOpenSoup={loadDetail}
            onMessages={() => setView(view === "messages" ? "home" : "messages")}
            onAdmin={() => setView("admin")}
            onLogin={() => { setAuthError(""); setAuthMode("login"); }}
            onLogout={logout}
            onAllNotifications={() => setView("allNotifications")}
            onAllRequests={() => setView("allRequests")}
          />
        )}
        {view === "allNotifications" && (
          <AllNotificationsView
            notifications={notifications}
            onRead={markRead}
            onOpenSoup={loadDetail}
            onBack={() => setView("messages")}
          />
        )}
        {view === "allRequests" && (
          <AllRequestsView
            requests={requests}
            onDecision={decideRequest}
            onOpenSoup={loadDetail}
            onBack={() => setView("messages")}
          />
        )}
        {view === "mine" && (
          <MineView
            user={user}
            mySoups={mySoups}
            unread={unread}
            passwordForm={passwordForm}
            setPasswordForm={setPasswordForm}
            onPasswordSubmit={changePassword}
            onLogin={() => {
              setAuthError("");
              setAuthMode("login");
            }}
            onOpenSoup={loadDetail}
            onMessages={() => setView("messages")}
            onAdmin={() => setView("admin")}
            onLogout={logout}
          />
        )}
        {view === "admin" && user?.role === "admin" && (
          <AdminView
            users={users}
            requests={requests}
            onRole={updateUser}
            onDelete={deleteUser}
            onDecision={decideRequest}
          />
        )}
      </main>

      {authMode && <AuthModal mode={authMode} setMode={setAuthMode} error={authError} setError={setAuthError} onSubmit={submitAuth} />}
      {showSoupForm && (
        <SoupEditor
          value={soupForm}
          setValue={setSoupForm}
          user={user}
          editing={Boolean(editingSoupId)}
          onClose={() => setShowSoupForm(false)}
          onSubmit={submitSoup}
        />
      )}
      {showEvalForm && (
        <EvalEditor
          value={evalForm}
          setValue={setEvalForm}
          editing={Boolean(ownEvaluation)}
          onClose={() => setShowEvalForm(false)}
          onSubmit={submitEvaluation}
        />
      )}
      {exportReady && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/45 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="max-h-[88vh] w-full max-w-lg overflow-auto rounded-t-lg bg-white p-4 shadow-soft sm:rounded-[20px]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base font-black text-ink">图片已生成</div>
                <div className="mt-1 truncate text-xs text-muted">{exportReady.name} · 长按或右键保存图片</div>
              </div>
              <button
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-50 text-muted"
                onClick={() => setExportReady(null)}
                aria-label="关闭导出预览"
              >
                <X size={18} />
              </button>
            </div>
            <img className="w-full rounded-xl border border-line bg-page" src={exportReady.url} alt="导出预览" />
          </div>
        </div>
      )}
      {view !== "detail" && (
        <BottomNav
          view={view}
          onHome={() => setView("home")}
          onCreate={openCreate}
          onMine={() => {
            if (!user) {
              setAuthError("");
              setAuthMode("login");
              return;
            }
            setView("mine");
          }}
        />
      )}
    </div>
  );
}

function PageTopBar({
  title,
  user,
  unread,
  onMessages,
  onAdmin,
  onLogin,
  onLogout
}: {
  title: string;
  user: PublicUser | null;
  unread: number;
  onMessages: () => void;
  onAdmin: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="top-nav-shell">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-2 px-4 py-4">
        <button className="min-h-11 min-w-0 shrink-0 text-left" type="button">
          <h1 className="truncate text-[24px] font-black leading-none text-ink sm:text-[28px]">{title}</h1>
        </button>
        <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          {user ? (
            <>
              <details className="user-menu">
                <summary className="flex min-h-11 min-w-0 cursor-pointer list-none items-center rounded-full bg-white px-2 shadow-soft sm:gap-2 sm:px-2.5 sm:py-1.5">
                  <div className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-black text-primary sm:grid">
                    {(user.nickname || user.username).slice(0, 1)}
                  </div>
                  <span className="max-w-[52px] truncate text-[13px] font-semibold text-ink sm:max-w-24 sm:text-sm">
                    {(user.nickname || user.username).slice(0, 8)}
                  </span>
                </summary>
                <div className="user-menu-panel left-0 top-[calc(100%+8px)] sm:left-auto sm:right-0">
                  <button className="user-menu-item" onClick={onLogout}>
                    <LogOut size={17} />
                    退出登录
                  </button>
                </div>
              </details>
              <button className="relative grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-soft" onClick={onMessages} aria-label="消息">
                <Bell size={21} />
                {unread > 0 && (
                  <span className="absolute right-1.5 top-0 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
              {user.role === "admin" && (
                <button className="hidden h-11 w-11 place-items-center rounded-full bg-white text-primary shadow-soft sm:grid" onClick={onAdmin} aria-label="后台">
                  <Shield size={20} />
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-primary rounded-full px-5" onClick={onLogin}>
              登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HomeView({
  soups,
  filters,
  setFilters,
  onOpen,
  user,
  unread,
  onMessages,
  onAdmin,
  onLogin,
  onLogout,
  hasMore,
  loading,
  onLoadMore
}: {
  soups: SoupSummary[];
  filters: Record<string, string>;
  setFilters: (next: any) => void;
  onOpen: (id: string) => void;
  user: PublicUser | null;
  unread: number;
  onMessages: () => void;
  onAdmin: () => void;
  onLogin: () => void;
  onLogout: () => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState(filters.keyword ?? "");
  const activeFilterCount = [filters.type, filters.minRating !== "all", filters.bottomPublic !== "all"].filter(Boolean).length;
  const isResultMode = Boolean(filters.keyword) || activeFilterCount > 0;
  const submitSearch = () => setFilters((old: any) => ({ ...old, keyword: searchKeyword.trim() }));

  return (
    <section className="space-y-4">
      <PageTopBar
        title="海龟汤"
        user={user}
        unread={unread}
        onMessages={onMessages}
        onAdmin={onAdmin}
        onLogin={onLogin}
        onLogout={onLogout}
      />

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-12 rounded-full bg-white pl-4 pr-11 text-[15px] shadow-soft"
            placeholder="搜索海龟汤标题、作者或摘要..."
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitSearch();
            }}
          />
          <button
            className="absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-primary transition hover:bg-blue-50"
            type="button"
            aria-label="搜索"
            onClick={submitSearch}
          >
            <Search size={20} />
          </button>
        </div>
        <button
          className="relative inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-bold text-primary shadow-soft"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal size={19} />
          <span className="hidden sm:inline">筛选</span>
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {filtersOpen && (
        <div className="grid gap-2 rounded-2xl border border-line bg-white p-3 shadow-soft sm:grid-cols-3">
          <label className="filter-field">
            <span>类型</span>
            <select
              className="field"
              value={filters.type}
              onChange={(event) => setFilters((old: any) => ({ ...old, type: event.target.value }))}
            >
              <option value="">全部类型</option>
              {soupTypes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>评分</span>
            <select
              className="field"
              value={filters.minRating}
              onChange={(event) => setFilters((old: any) => ({ ...old, minRating: event.target.value }))}
            >
              <option value="all">全部评分</option>
              <option value="2">2分以上</option>
              <option value="3">3分以上</option>
              <option value="4">4分以上</option>
            </select>
          </label>
          <label className="filter-field">
            <span>公开情况</span>
            <select
              className="field"
              value={filters.bottomPublic}
              onChange={(event) => setFilters((old: any) => ({ ...old, bottomPublic: event.target.value }))}
            >
              <option value="all">全部</option>
              <option value="surface">汤面公开</option>
              <option value="bottom">汤底公开</option>
            </select>
          </label>
        </div>
      )}

      {!isResultMode && (
        <div className="home-hero-banner">
          <img src="/home-banner.png" alt="故事背后藏着的真的是真相吗？" />
        </div>
      )}

      <MasonryList soups={soups} onOpen={onOpen} hasMore={hasMore} loading={loading} onLoadMore={onLoadMore} />

      {soups.length === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-muted">{user ? "暂无符合条件的海龟汤" : "暂无公开海龟汤"}</div>
      )}
      {loading && (
        <div className="flex items-center justify-center py-8 text-sm text-muted">加载中...</div>
      )}
    </section>
  );
}

function getMasonryColumnCount() {
  if (typeof window === "undefined") return 2;
  if (window.innerWidth >= 1120) return 4;
  if (window.innerWidth >= 760) return 3;
  return 2;
}

function estimateSoupHeight(soup: SoupSummary) {
  const coverHeight = soup.coverImage ? 128 : 92;
  const titleRows = soup.title.length > 12 ? 2 : 1;
  const summaryRows = Math.min(3, Math.max(1, Math.ceil((soup.summary || "").length / 18)));
  return coverHeight + 108 + titleRows * 20 + summaryRows * 20;
}

function MasonryList({
  soups,
  onOpen,
  hasMore,
  loading,
  onLoadMore
}: {
  soups: SoupSummary[];
  onOpen: (id: string) => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const [columnCount, setColumnCount] = useState(getMasonryColumnCount);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const update = () => setColumnCount(getMasonryColumnCount());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loading) onLoadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  const columns = useMemo(() => {
    const count = Math.max(1, Math.min(columnCount, Math.max(soups.length, 1)));
    const nextColumns: SoupSummary[][] = Array.from({ length: count }, () => []);
    const columnHeights = Array.from({ length: count }, () => 0);

    soups.forEach((soup) => {
      let target = 0;
      for (let index = 1; index < count; index += 1) {
        if (columnHeights[index] < columnHeights[target]) target = index;
      }
      nextColumns[target].push(soup);
      columnHeights[target] += heights[soup.id] ?? estimateSoupHeight(soup);
    });

    return nextColumns;
  }, [columnCount, heights, soups]);

  return (
    <>
      <div className="home-masonry">
        {columns.map((column, index) => (
          <div className="home-masonry-column" key={index}>
            {column.map((soup) => (
              <MeasuredSoupCard
                key={soup.id}
                soup={soup}
                onOpen={onOpen}
                onHeight={(height) => {
                  setHeights((old) => (Math.abs((old[soup.id] ?? 0) - height) < 1 ? old : { ...old, [soup.id]: height }));
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinelRef} className="h-1 w-full" />
    </>
  );
}

function MeasuredSoupCard({
  soup,
  onOpen,
  onHeight
}: {
  soup: SoupSummary;
  onOpen: (id: string) => void;
  onHeight: (height: number) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const measure = () => onHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeight]);

  return <SoupCard refTarget={cardRef} soup={soup} onOpen={onOpen} />;
}

function SoupCard({
  soup,
  onOpen,
  refTarget
}: {
  soup: SoupSummary;
  onOpen: (id: string) => void;
  refTarget?: React.RefObject<HTMLElement | null>;
}) {
  const tags = [
    { label: soup.type, className: "bg-blue-50 text-primary ring-blue-100" },
    soup.isOriginal ? { label: "原创汤", className: "bg-emerald-50 text-emerald-600 ring-emerald-100" } : null,
    soup.isBottomPublic
      ? { label: "汤底公开", className: "bg-teal-50 text-accent ring-teal-100" }
      : { label: "汤面公开", className: "bg-violet-50 text-violet-600 ring-violet-100" }
  ].filter(Boolean).slice(0, 3) as { label: string; className: string }[];

  return (
    <article ref={refTarget} className="soup-card" onClick={() => onOpen(soup.id)}>
      {soup.coverImage ? (
        <CoverImage src={soup.coverImage} alt={`${soup.title} 封面`} />
      ) : (
        <div className="soup-card-cover bg-[url('/home-hero.png')] bg-cover bg-center" style={{ aspectRatio: "2 / 1" }} />
      )}
      <div className="p-3">
        <h2 className="line-clamp-2 text-[16px] font-black leading-snug text-ink">{soup.title}</h2>
        <p className="mt-1 flex items-center gap-1.5 truncate text-[13px] text-muted">
          <User size={14} />
          {soup.author || soup.creatorName}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag.label} className={`inline-flex h-[24px] items-center rounded-md px-2 text-[12px] font-semibold ring-1 ${tag.className}`}>
              {tag.label}
            </span>
          ))}
        </div>
        <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-muted">{soup.summary || "暂无摘要，点开看看汤面留下的第一道线索。"}</p>
        <div className="mt-1 flex items-center justify-between text-[13px] text-muted">
          <span className="inline-flex items-center gap-1 font-semibold">
            <Star className="fill-amber-400 text-amber-400" size={16} />
            {soup.averageTotal ? `${soup.averageTotal}分` : "未评分"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye size={16} />
            {formatViews(soup.viewCount)}
          </span>
        </div>
      </div>
    </article>
  );
}

function CoverImage({ src, alt }: { src: string; alt: string }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const isTooWide = ratio != null && ratio > 2;
  const isTooTall = ratio != null && ratio < 0.5;

  if (isTooWide || isTooTall) {
    return (
      <div className="soup-card-cover-frame" style={{ aspectRatio: isTooWide ? "2 / 1" : "1 / 2" }}>
        <img
          className="soup-card-cover h-full object-cover"
          src={src}
          alt={alt}
          onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
        />
      </div>
    );
  }

  return (
    <img
      className="soup-card-cover"
      src={src}
      alt={alt}
      onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
    />
  );
}

function BottomNav({
  view,
  onHome,
  onCreate,
  onMine
}: {
  view: View;
  onHome: () => void;
  onCreate: () => void;
  onMine: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_rgba(17,24,39,0.07)] backdrop-blur">
      <div className="relative mx-auto grid max-w-md grid-cols-3 items-end gap-2">
        <BottomNavItem active={view === "home" || view === "detail"} icon={<Home size={20} />} label="首页" onClick={onHome} />
        <button className="flex min-h-[64px] flex-col items-center justify-end gap-1 text-xs font-semibold text-ink" onClick={onCreate}>
          <span className="-mt-7 grid h-16 w-16 place-items-center rounded-full border-[6px] border-page bg-primary text-white shadow-[0_10px_24px_rgba(37,99,235,0.32)]">
            <Plus size={34} strokeWidth={2.2} />
          </span>
          <span>创作</span>
        </button>
        <BottomNavItem active={view === "mine"} icon={<User size={20} />} label="我的" onClick={onMine} />
      </div>
    </nav>
  );
}

function BottomNavItem({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition ${
        active ? "text-primary" : "text-ink hover:bg-blue-50 hover:text-primary"
      }`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DetailView({
  soup,
  user,
  ownEvaluation,
  onEdit,
  onDelete,
  onEvaluate,
  onRequest,
  onExport
}: {
  soup: SoupDetail;
  user: PublicUser | null;
  ownEvaluation: unknown;
  onEdit: () => void;
  onDelete: () => void;
  onEvaluate: () => void;
  onRequest: () => void;
  onExport: (text: string, name: string, sectionTitle?: string) => void;
}) {
  const hasRadarData = [
    soup.radar.writing,
    soup.radar.logic,
    soup.radar.share,
    soup.radar.mechanism,
    soup.radar.twist,
    soup.radar.depth
  ].some((value) => value != null);
  const hasEvaluations = soup.evaluations.length > 0;

  return (
    <section className="space-y-4">
      <div className="card p-4">
        {soup.coverImage && (
          <img className="mb-4 max-h-72 w-full rounded-lg object-cover" src={soup.coverImage} alt={`${soup.title} 封面`} />
        )}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-black text-ink">{soup.title}</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="pill">{soup.type}</span>
              <span className="pill bg-teal-50 text-accent">{soup.isBottomPublic ? "汤底公开" : "汤底需授权"}</span>
              <span className="pill bg-slate-100 text-muted">{soup.evaluationCount} 条评价</span>
            </div>
            <p className="mt-3 text-sm text-muted">
              作者 {soup.author} · 发布者 {soup.creatorName} · 评分 {soup.averageTotal ?? "-"}
            </p>
          </div>
        </div>
      </div>

      <ContentCard title="汤面" text={soup.surface}>
        <button className="btn btn-secondary w-full sm:w-auto" onClick={() => onExport(soup.surface, `${soup.title}-汤面`, "汤面")}>
          <Download size={18} />
          导出汤面
        </button>
      </ContentCard>
      {soup.supplementalSurfaces.map((text, index) => (
        <ContentCard key={`${index}-${text}`} title={`补充汤面${index + 1}`} text={text}>
          <button
            className="btn btn-secondary w-full sm:w-auto"
            onClick={() => onExport(text, `${soup.title}-补充汤面${index + 1}`, `补充汤面${index + 1}`)}
          >
            <Download size={18} />
            导出补充汤面{index + 1}
          </button>
        </ContentCard>
      ))}

      {soup.canViewFull ? (
        <>
          <ContentCard title="汤底" text={soup.bottom ?? ""}>
            <button className="btn btn-secondary w-full sm:w-auto" onClick={() => onExport(soup.bottom ?? "", `${soup.title}-汤底`, "汤底")}>
              <Download size={18} />
              导出汤底
            </button>
          </ContentCard>
          {(soup.supplementalBottoms ?? []).map((text, index) => (
            <ContentCard key={`${index}-${text}`} title={`补充汤底${index + 1}`} text={text}>
              <button
                className="btn btn-secondary w-full sm:w-auto"
                onClick={() => onExport(text, `${soup.title}-补充汤底${index + 1}`, `补充汤底${index + 1}`)}
              >
                <Download size={18} />
                导出补充汤底{index + 1}
              </button>
            </ContentCard>
          ))}
          {soup.manual && (
            <ContentCard title="主持人手册" text={soup.manual}>
              <button
                className="btn btn-secondary w-full sm:w-auto"
                onClick={() => onExport(soup.manual ?? "", `${soup.title}-主持人手册`, "主持人手册")}
              >
                <Download size={18} />
                导出手册
              </button>
            </ContentCard>
          )}
        </>
      ) : (
        <div className="card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-orange-50 p-3 text-warning">
                <Lock size={22} />
              </div>
              <div>
                <h2 className="font-black text-ink">汤底和主持人手册需要授权</h2>
                <p className="mt-1 text-sm text-muted">发送申请后，作者和管理员会收到站内提醒。</p>
              </div>
            </div>
            <button className="btn btn-primary" disabled={Boolean(soup.pendingRequestId)} onClick={onRequest}>
              {soup.pendingRequestId ? "已申请，待处理" : "申请查看全部"}
            </button>
          </div>
        </div>
      )}

      <div className={hasRadarData ? "grid gap-4 lg:grid-cols-[360px_1fr]" : "grid gap-4"}>
        {hasRadarData && (
          <div className="card flex h-[360px] flex-col p-3">
            <h2 className="mb-3 font-black text-ink">六维雷达图</h2>
            <div className="min-h-0 flex-1">
              <RadarChart radar={soup.radar} />
            </div>
          </div>
        )}
        <div className="card p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-black text-ink">评价</h2>
            {hasEvaluations && (
              <button className="btn btn-primary" onClick={onEvaluate}>
                <Star size={18} />
                {ownEvaluation ? "编辑我的评价" : "添加评价"}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {soup.evaluations.map((item) => (
              <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <strong>{item.reviewer}</strong>
                  <span className="rounded-lg bg-blue-50 px-2 py-1 text-sm font-black text-primary">{item.total}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted sm:grid-cols-3">
                  <span>文笔 {item.writing ?? "-"}</span>
                  <span>逻辑 {item.logic ?? "-"}</span>
                  <span>分享 {item.share ?? "-"}</span>
                  <span>机制 {item.mechanism ?? "-"}</span>
                  <span>反转 {item.twist ?? "-"}</span>
                  <span>深度 {item.depth ?? "-"}</span>
                </div>
              </div>
            ))}
            {!hasEvaluations && (
              <div className="space-y-3">
                <p className="text-sm text-muted">还没有评价。</p>
                <button className="btn btn-primary w-full sm:w-auto" onClick={onEvaluate}>
                  <Star size={18} />
                  {ownEvaluation ? "编辑我的评价" : "添加评价"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {soup.canEdit && (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto grid max-w-md grid-cols-2 gap-3 rounded-2xl border border-line bg-white/95 p-3 shadow-soft backdrop-blur">
          <button className="btn btn-secondary" onClick={onEdit}>
            <Pencil size={18} />
            编辑
          </button>
          <button className="btn btn-danger" onClick={onDelete}>
            <Trash2 size={18} />
            删除
          </button>
        </div>
      )}
    </section>
  );
}

function ContentCard({
  title,
  text,
  children
}: {
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3">
        <h2 className="font-black text-ink">{title}</h2>
      </div>
      <div className="rounded-lg bg-white p-4">
        <div className="content-block text-[15px] leading-7 text-ink">{text}</div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">{children}</div>
    </div>
  );
}

function MessagesView({
  notifications,
  requests,
  user,
  unread,
  onRead,
  onDecision,
  onOpenSoup,
  onMessages,
  onAdmin,
  onLogin,
  onLogout,
  onAllNotifications,
  onAllRequests
}: {
  notifications: NotificationItem[];
  requests: ViewRequestItem[];
  user: PublicUser | null;
  unread: number;
  onRead: (id: string) => void;
  onDecision: (id: string, decision: "approved" | "rejected") => void;
  onOpenSoup: (id: string) => void;
  onMessages: () => void;
  onAdmin: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onAllNotifications: () => void;
  onAllRequests: () => void;
}) {

  return (
    <section className="space-y-4">
      <PageTopBar title="消息" user={user} unread={unread} onMessages={onMessages} onAdmin={onAdmin} onLogin={onLogin} onLogout={onLogout} />

      {/* 站内消息区域 */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-black text-ink">站内消息</h1>
          {notifications.length > 3 && (
            <button className="btn btn-secondary px-3 text-xs" onClick={onAllNotifications}>
              更多 <ChevronRight size={14} />
            </button>
          )}
        </div>
        <NotificationList notifications={notifications} onRead={onRead} onOpenSoup={onOpenSoup} max={3} />
      </div>

      {/* 查看申请区域 */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-black text-ink">查看申请</h1>
          {requests.length > 3 && (
            <button className="btn btn-secondary px-3 text-xs" onClick={onAllRequests}>
              更多 <ChevronRight size={14} />
            </button>
          )}
        </div>
        <RequestList requests={requests} onDecision={onDecision} onOpenSoup={onOpenSoup} max={3} />
      </div>
    </section>
  );
}

function NotificationList({
  notifications,
  onRead,
  onOpenSoup,
  max
}: {
  notifications: NotificationItem[];
  onRead: (id: string) => void;
  onOpenSoup: (id: string) => void;
  max?: number;
}) {
  const visible = max ? notifications.slice(0, max) : notifications;

  if (notifications.length === 0) {
    return <p className="text-sm text-muted">暂无消息。</p>;
  }

  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg border border-line bg-white p-3 ${item.relatedId ? "cursor-pointer hover:border-primary/40 hover:shadow-sm" : ""}`}
          onClick={() => {
            if (item.relatedId) {
              if (!item.isRead) onRead(item.id);
              onOpenSoup(item.relatedId);
            }
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-bold text-ink truncate">{item.title}</h2>
              <p className="mt-1 text-sm text-muted line-clamp-2">{item.content}</p>
              <p className="mt-1 text-xs text-muted/60">{new Date(item.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!item.isRead && (
                <span className="h-2 w-2 rounded-full bg-primary" />
              )}
              {item.relatedId && <ChevronRight size={16} className="text-muted/40" />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MineView({
  user,
  mySoups,
  unread,
  passwordForm,
  setPasswordForm,
  onPasswordSubmit,
  onLogin,
  onOpenSoup,
  onMessages,
  onAdmin,
  onLogout
}: {
  user: PublicUser | null;
  mySoups: SoupSummary[];
  unread: number;
  passwordForm: { newPassword: string; confirmPassword: string };
  setPasswordForm: (next: { newPassword: string; confirmPassword: string }) => void;
  onPasswordSubmit: (event: FormEvent) => void;
  onLogin: () => void;
  onOpenSoup: (id: string) => void;
  onMessages: () => void;
  onAdmin: () => void;
  onLogout: () => void;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!user) {
    return (
      <section className="space-y-4">
        <PageTopBar title="我的" user={user} unread={unread} onMessages={onMessages} onAdmin={onAdmin} onLogin={onLogin} onLogout={onLogout} />
        <div className="card p-4 text-center">
          <p className="mt-2 text-sm text-muted">登录后可查看个人信息和发布记录。</p>
          <button className="btn btn-primary mt-4 w-full" onClick={onLogin}>
            登录
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <PageTopBar title="我的" user={user} unread={unread} onMessages={onMessages} onAdmin={onAdmin} onLogin={onLogin} onLogout={onLogout} />
      <div className="card p-4">
        <div className="grid gap-3">
          <InfoRow label="昵称" value={user.nickname} />
          <InfoRow label="账号" value={user.username} />
          <InfoRow label="角色" value={user.role === "admin" ? "管理员" : "普通用户"} />
          <InfoRow label="加入时间" value={new Date(user.createdAt).toLocaleDateString()} />
        </div>
      </div>

      <div className="card p-4">
        {!passwordOpen ? (
          <button className="flex min-h-11 w-full items-center justify-between text-left" onClick={() => setPasswordOpen(true)}>
            <span>
              <span className="block text-base font-semibold text-ink">修改密码</span>
              <span className="mt-1 block text-xs text-muted">进入后设置新密码</span>
            </span>
            <Pencil size={18} className="text-primary" />
          </button>
        ) : (
          <form className="space-y-3" onSubmit={onPasswordSubmit}>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">修改密码</h2>
              <button
                className="text-sm font-semibold text-muted"
                type="button"
                onClick={() => {
                  setPasswordForm({ newPassword: "", confirmPassword: "" });
                  setPasswordOpen(false);
                }}
              >
                返回
              </button>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted">新密码</span>
              <input
                className="field"
                type="password"
                minLength={6}
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted">再次输入新密码</span>
              <input
                className="field"
                type="password"
                minLength={6}
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
                required
              />
            </label>
            <button className="btn btn-primary w-full">保存新密码</button>
          </form>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">我发布的海龟汤</h2>
          <span className="text-sm text-muted">{mySoups.length} 条</span>
        </div>
        <div className="space-y-3">
          {mySoups.map((soup) => (
            <button
              key={soup.id}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-line bg-white p-3 text-left"
              onClick={() => onOpenSoup(soup.id)}
            >
              {soup.coverImage && <img className="h-14 w-14 shrink-0 rounded-lg object-cover" src={soup.coverImage} alt="" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-ink">{soup.title}</span>
                <span className="mt-1 block truncate text-xs text-muted">
                  {formatViews(soup.viewCount)} 浏览 · {soup.evaluationCount} 评 · {soup.isBottomPublic ? "汤底公开" : soup.isSurfacePublic ? "汤面公开" : "不公开"}
                </span>
              </span>
            </button>
          ))}
          {mySoups.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-muted">还没有发布海龟汤。</p>}
        </div>
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="truncate text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

function AdminView({
  users,
  requests,
  onRole,
  onDelete,
  onDecision
}: {
  users: PublicUser[];
  requests: ViewRequestItem[];
  onRole: (user: PublicUser, role: "admin" | "user") => void;
  onDelete: (user: PublicUser) => void;
  onDecision: (id: string, decision: "approved" | "rejected") => void;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-ink">管理员后台</h1>
        <p className="mt-1 text-sm text-muted">管理用户，并可代作者处理查看申请。</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="card p-4">
          <h2 className="mb-3 font-black text-ink">用户管理</h2>
          <div className="space-y-3">
            {users.map((item) => (
              <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-line p-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <strong>{item.nickname}</strong>
                  <p className="text-sm text-muted">
                    {item.username} · {item.role}
                  </p>
                </div>
                <select className="field sm:w-32" value={item.role} onChange={(event) => onRole(item, event.target.value as any)}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
                <button className="btn btn-danger" onClick={() => onDelete(item)}>
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <h2 className="mb-3 font-black text-ink">申请审批</h2>
          <RequestList requests={requests} onDecision={onDecision} />
        </div>
      </div>
    </section>
  );
}

function RequestList({
  requests,
  onDecision,
  onOpenSoup,
  max
}: {
  requests: ViewRequestItem[];
  onDecision: (id: string, decision: "approved" | "rejected") => void;
  onOpenSoup?: (id: string) => void;
  max?: number;
}) {
  const visible = max ? requests.slice(0, max) : requests;

  if (requests.length === 0) {
    return <p className="text-sm text-muted">暂无申请。</p>;
  }

  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <div key={item.id} className="rounded-lg border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-ink">{item.soupTitle}</h3>
              <p className="mt-1 text-sm text-muted">
                {item.requesterName} · {statusText(item.status)}
              </p>
            </div>
            {onOpenSoup && (
              <button className="btn btn-secondary px-3" onClick={() => onOpenSoup(item.soupId)}>
                <Eye size={16} />
              </button>
            )}
          </div>
          {item.status === "pending" && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-primary" onClick={() => onDecision(item.id, "approved")}>
                同意
              </button>
              <button className="btn btn-secondary" onClick={() => onDecision(item.id, "rejected")}>
                拒绝
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AllNotificationsView({
  notifications,
  onRead,
  onOpenSoup,
  onBack
}: {
  notifications: NotificationItem[];
  onRead: (id: string) => void;
  onOpenSoup: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn btn-secondary px-3" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-black text-ink">全部站内消息</h1>
      </div>
      <div className="card p-4">
        <NotificationList notifications={notifications} onRead={onRead} onOpenSoup={onOpenSoup} />
      </div>
    </section>
  );
}

function AllRequestsView({
  requests,
  onDecision,
  onOpenSoup,
  onBack
}: {
  requests: ViewRequestItem[];
  onDecision: (id: string, decision: "approved" | "rejected") => void;
  onOpenSoup: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn btn-secondary px-3" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-black text-ink">全部查看申请</h1>
      </div>
      <div className="card p-4">
        <RequestList requests={requests} onDecision={onDecision} onOpenSoup={onOpenSoup} />
      </div>
    </section>
  );
}

function AuthModal({
  mode,
  setMode,
  error,
  setError,
  onSubmit
}: {
  mode: "login" | "register";
  setMode: (mode: AuthMode) => void;
  error: string;
  setError: (error: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Modal onClose={() => { setError(""); setMode(null); }}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <h2 className="text-xl font-black text-ink">{mode === "login" ? "登录" : "注册"}</h2>
          <p className="mt-1 text-sm text-muted">登录状态将持久化 30 天。</p>
        </div>
        {mode === "register" && <input className="field" name="nickname" placeholder="昵称（最多8字）" maxLength={8} required />}
        <input className="field" name="username" placeholder="账号" required />
        <input className="field" name="password" type="password" placeholder="密码" required />
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div>}
        <button className="btn btn-primary w-full">{mode === "login" ? "登录" : "注册并登录"}</button>
        <button
          className="btn btn-secondary w-full"
          type="button"
          onClick={() => {
            setError("");
            setMode(mode === "login" ? "register" : "login");
          }}
        >
          {mode === "login" ? "没有账号，去注册" : "已有账号，去登录"}
        </button>
      </form>
    </Modal>
  );
}

function SoupEditor({
  value,
  setValue,
  user,
  editing,
  onClose,
  onSubmit
}: {
  value: SoupForm;
  setValue: (next: SoupForm) => void;
  user: PublicUser | null;
  editing: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const patch = (next: Partial<SoupForm>) => setValue({ ...value, ...next });
  const authorName = user?.nickname || user?.username || "";
  const [termsAccepted, setTermsAccepted] = useState(editing);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [coverError, setCoverError] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!termsAccepted) {
      setTermsError("请先勾选同意用户使用条款");
      return;
    }
    setTermsError("");
    onSubmit(event);
  }

  function handleCoverUpload(file: File | undefined) {
    setCoverError("");
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setCoverError("封面仅支持 JPG 或 PNG 图片");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setCoverError("封面图片请控制在 3MB 以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patch({ coverImage: String(reader.result) });
    reader.readAsDataURL(file);
  }

  function updateSupplement(kind: "surface" | "bottom", index: number, text: string) {
    const key = kind === "surface" ? "supplementalSurfaces" : "supplementalBottoms";
    const next = [...value[key]];
    next[index] = text;
    patch({ [key]: next } as Partial<SoupForm>);
  }

  function addSupplement(kind: "surface" | "bottom") {
    const key = kind === "surface" ? "supplementalSurfaces" : "supplementalBottoms";
    patch({ [key]: [...value[key], ""] } as Partial<SoupForm>);
  }

  function removeSupplement(kind: "surface" | "bottom", index: number) {
    const key = kind === "surface" ? "supplementalSurfaces" : "supplementalBottoms";
    patch({ [key]: value[key].filter((_, itemIndex) => itemIndex !== index) } as Partial<SoupForm>);
  }

  return (
    <Modal full onClose={onClose}>
      <form className="space-y-4 pb-24" onSubmit={handleSubmit}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <button type="button" className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-muted" onClick={onClose}>
              <ArrowLeft size={17} />
              返回
            </button>
            <h2 className="text-xl font-black text-ink">{editing ? "编辑海龟汤" : "新建海龟汤"}</h2>
            <p className="mt-1 text-sm text-muted">支持文本内容与 JPG/PNG 封面。</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 标题</span>
            <input className="field" placeholder="请输入标题" value={value.title} onChange={(event) => patch({ title: event.target.value })} required />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 是否原创</span>
            <select
              className="field"
              value={value.isOriginal ? "yes" : "no"}
              onChange={(event) => {
                const isOriginal = event.target.value === "yes";
                patch({ isOriginal, author: isOriginal ? authorName : "佚名" });
              }}
            >
              <option value="yes">是，原创</option>
              <option value="no">否，非原创</option>
            </select>
          </label>
          {value.isOriginal && (
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 作者</span>
              <input
                className="field"
                value={value.author || authorName}
                readOnly
                required
              />
            </label>
          )}
          <label className="space-y-2 md:col-span-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 类型</span>
            <select className="field" value={value.type} onChange={(event) => patch({ type: event.target.value })}>
              {soupTypes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="space-y-2 pb-2">
          <span className="text-xs font-bold text-muted">封面</span>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
            {value.coverImage ? (
              <div className="space-y-3">
                <img className="max-h-56 w-full rounded-lg object-cover" src={value.coverImage} alt="封面预览" />
                <div className="grid grid-cols-2 gap-2">
                  <label className="btn btn-secondary cursor-pointer">
                    更换封面
                    <input
                      className="hidden"
                      type="file"
                      accept="image/jpeg,image/png"
                      onChange={(event) => handleCoverUpload(event.target.files?.[0])}
                    />
                  </label>
                  <button className="btn btn-secondary" type="button" onClick={() => patch({ coverImage: "" })}>
                    移除封面
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg bg-white px-4 py-5 text-center text-sm text-muted">
                <ImagePlus className="mb-2 text-primary" size={24} />
                上传 JPG 或 PNG 封面
                <span className="mt-1 text-xs text-muted">建议小于 3MB</span>
                <input
                  className="hidden"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => handleCoverUpload(event.target.files?.[0])}
                />
              </label>
            )}
            {coverError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{coverError}</div>}
          </div>
        </label>

        <label className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted">摘要</span>
          </div>
          <div className="relative">
            <textarea
              className="field min-h-24 pb-8"
              style={{ minHeight: 96 }}
              placeholder="最多 40 个字"
              maxLength={40}
              value={value.summary}
              onChange={(event) => patch({ summary: event.target.value })}
            />
            <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted">{value.summary.length}/40</span>
          </div>
        </label>
        <div className="space-y-2">
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 汤面</span>
            <textarea
              className="field min-h-56"
              style={{ minHeight: 224 }}
              placeholder="请输入汤面"
              value={value.surface}
              onChange={(event) => patch({ surface: event.target.value })}
              required
            />
          </label>
          <SupplementEditor
            title="补充汤面"
            items={value.supplementalSurfaces}
            onAdd={() => addSupplement("surface")}
            onChange={(index, text) => updateSupplement("surface", index, text)}
            onRemove={(index) => removeSupplement("surface", index)}
          />
        </div>
        <div className="space-y-2">
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 汤底</span>
            <textarea
              className="field min-h-56"
              style={{ minHeight: 224 }}
              placeholder="请输入汤底"
              value={value.bottom}
              onChange={(event) => patch({ bottom: event.target.value })}
              required
            />
          </label>
          <SupplementEditor
            title="补充汤底"
            items={value.supplementalBottoms}
            onAdd={() => addSupplement("bottom")}
            onChange={(index, text) => updateSupplement("bottom", index, text)}
            onRemove={(index) => removeSupplement("bottom", index)}
          />
        </div>
        <label className="space-y-2">
          <span className="text-xs font-bold text-muted">主持人手册</span>
          <textarea
            className="field min-h-44"
            style={{ minHeight: 176 }}
            placeholder="选填"
            value={value.manual}
            onChange={(event) => patch({ manual: event.target.value })}
          />
        </label>

        <div className="space-y-2 border-t border-line pt-3">
            <CheckRow
              label="公开汤面"
              desc="勾选后，其他用户可以在列表和详情中看到这条海龟汤。"
              checked={value.isSurfacePublic}
              onChange={(checked) => patch({ isSurfacePublic: checked })}
            />
            <CheckRow
              label="公开汤底和主持人手册"
              desc="勾选后，其他用户无需申请即可查看完整内容。"
              checked={value.isBottomPublic}
              onChange={(checked) => patch({ isBottomPublic: checked })}
            />
            <label className="flex items-center gap-2 text-xs leading-5 text-muted">
              <input
                className="h-4 w-4 shrink-0"
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => {
                  setTermsAccepted(event.target.checked);
                  if (event.target.checked) setTermsError("");
                }}
              />
              <span className="flex min-h-11 flex-wrap items-center">
                勾选代表同意
                <button
                  className="mx-1 inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
                  type="button"
                  onClick={() => setTermsOpen(true)}
                >
                  用户使用条款
                </button>
              </span>
            </label>
          {termsError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{termsError}</div>}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(17,24,39,0.07)] backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <button className="btn btn-primary w-full">{editing ? "保存修改" : "发布"}</button>
          </div>
        </div>
      </form>
      {termsOpen && (
        <TermsModal
          onClose={() => setTermsOpen(false)}
          onAccept={() => {
            setTermsAccepted(true);
            setTermsError("");
            setTermsOpen(false);
          }}
        />
      )}
    </Modal>
  );
}

function SupplementEditor({
  title,
  items,
  onAdd,
  onChange,
  onRemove
}: {
  title: string;
  items: string[];
  onAdd: () => void;
  onChange: (index: number, text: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-slate-50 p-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-xs font-bold text-muted">{title}</span>
        <button className="btn btn-secondary px-3" type="button" onClick={onAdd}>
          <Plus size={16} />
          追加
        </button>
      </div>
      {items.map((item, index) => (
        <label className="block space-y-1" key={index}>
          <span className="text-xs font-bold text-muted">
            {title}{index + 1}
          </span>
          <div className="space-y-2">
            <textarea
              className="field min-h-32"
              style={{ minHeight: 128 }}
              placeholder={`请输入${title}${index + 1}`}
              value={item}
              onChange={(event) => onChange(index, event.target.value)}
            />
            <button className="btn btn-secondary w-full" type="button" onClick={() => onRemove(index)}>
              <Trash2 size={16} />
              删除{title}{index + 1}
            </button>
          </div>
        </label>
      ))}
      {items.length === 0 && <p className="text-xs leading-5 text-muted">可按需要追加，空白补充项不会保存。</p>}
    </div>
  );
}

function EvalEditor({
  value,
  setValue,
  editing,
  onClose,
  onSubmit
}: {
  value: EvalForm;
  setValue: (next: EvalForm) => void;
  editing: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const patch = (next: Partial<EvalForm>) => setValue({ ...value, ...next });
  const totalScoreGuide = [
    "1分（较差）：有点王八，逻辑不顺，文意不清，汤面汤底不合理",
    "2分（能玩）：不是王八汤，逻辑相对通顺，一般般",
    "3分（推荐）：逻辑通顺合理，有点意思，愿意拿去给别人玩",
    "4分（精品）：逻辑严谨、故事优秀、机制新奇，在玩过的海龟汤中能排进前20%",
    "5分（神作）：逻辑缜密、故事反转或机制很吸引人，汤底反推汤面基本是最优解，有一定深度，在玩过的海龟汤中能排进前5%"
  ];

  return (
    <Modal onClose={onClose}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <h2 className="text-xl font-black text-ink">{editing ? "编辑评价" : "添加评价"}</h2>
          <p className="mt-1 text-sm text-muted">总评分必填，六维评分可选。</p>
        </div>
        <ScoreInput
          label="总评分"
          value={value.total}
          onChange={(total) => patch({ total })}
          guide={totalScoreGuide}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <ScoreInput label="文笔" desc="本汤汤面、汤底文笔如何" value={value.writing} onChange={(writing) => patch({ writing })} />
          <ScoreInput label="逻辑" desc="本汤汤面、汤底逻辑闭环如何" value={value.logic} onChange={(logic) => patch({ logic })} />
          <ScoreInput label="分享性" desc="你把本汤分享给其他人玩的意愿如何" value={value.share} onChange={(share) => patch({ share })} />
          <ScoreInput label="机制" desc="本汤机制的可玩性、好玩性如何（非机制汤为0）" value={value.mechanism} onChange={(mechanism) => patch({ mechanism })} />
          <ScoreInput label="反转" desc="本汤汤底对于汤面的反转与震撼程度如何" value={value.twist} onChange={(twist) => patch({ twist })} />
          <ScoreInput label="深度" desc="本汤故事立意深度如何" value={value.depth} onChange={(depth) => patch({ depth })} />
        </div>
        <button className="btn btn-primary w-full">保存评价</button>
      </form>
    </Modal>
  );
}

function ScoreInput({
  label,
  desc,
  guide,
  value,
  onChange,
  required
}: {
  label: string;
  desc?: string;
  guide?: string[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="label flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {required && <span className="text-danger">*</span>}
        <span>{label}</span>
        {desc && <span className="text-xs font-normal leading-5 text-slate-600">{desc}</span>}
      </span>
      <input
        className="field"
        type="number"
        min={required ? 1 : 0}
        max={5}
        step={0.5}
        placeholder={required ? "1-5" : "可选"}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
      {guide && (
        <span className="block space-y-1 pt-1 text-xs leading-5 text-slate-600">
          {guide.map((item) => (
            <span className="block" key={item}>
              {item}
            </span>
          ))}
        </span>
      )}
    </label>
  );
}

function CheckRow({
  label,
  desc,
  checked,
  onChange
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex gap-2 text-xs leading-5 text-muted">
      <input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="font-semibold text-ink">{label}</span>
        <span className="ml-1">{desc}</span>
      </span>
    </label>
  );
}

function TermsModal({ onClose, onAccept }: { onClose: () => void; onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/35 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-t-lg bg-white p-5 shadow-soft sm:rounded-[20px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-ink">用户使用条款</h3>
            <p className="mt-1 text-sm text-muted">发布海龟汤前，请确认你理解并接受以下承诺。</p>
          </div>
          <button className="btn btn-secondary px-3" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm leading-7 text-ink">
          <p>
            1. 用户承诺其上传、发布或编辑的海龟汤内容为本人原创，或已取得合法、充分的授权，不存在侵犯他人著作权、改编权、信息网络传播权、署名权等合法权益的情形。
          </p>
          <p>
            2. 用户承诺上传内容不存在版权归属争议、抄袭、未经授权转载、未经授权改编等问题。若因内容权利瑕疵产生投诉、纠纷、索赔或法律责任，均由发布用户自行承担。
          </p>
          <p>
            3. 用户承诺不会利用本平台发布的海龟汤内容进行未经授权的商业盈利活动，包括但不限于售卖、付费转载、商业演出、课程售卖或其他以该内容直接获利的行为。
          </p>
          <p>
            4. 平台仅提供内容记录、展示、评价与授权查看工具，不对用户上传内容的真实性、原创性、合法性作实质审查或担保。
          </p>
          <p>
            5. 若平台收到权利人投诉、监管要求或发现明显违规内容，平台有权对相关内容采取隐藏、删除、限制访问或冻结账号等处理措施。
          </p>
        </div>
        <button className="btn btn-primary mt-5 w-full" onClick={onAccept}>
          我已了解
        </button>
      </div>
    </div>
  );
}

function Modal({ children, onClose, full = false }: { children: React.ReactNode; onClose: () => void; full?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-900/30 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className={`w-full overflow-auto bg-white p-4 shadow-soft sm:rounded-[20px] ${full ? "h-full max-w-3xl sm:h-[88vh]" : "max-h-[80vh] max-w-md rounded-t-lg"}`}>
        {!full && <div className="mb-3 flex justify-end sm:hidden">
          <button className="btn btn-secondary px-3" onClick={onClose}>
            <X size={18} />
          </button>
        </div>}
        {children}
      </div>
    </div>
  );
}

function statusText(status: string) {
  if (status === "approved") return "已同意";
  if (status === "rejected") return "已拒绝";
  return "待处理";
}
