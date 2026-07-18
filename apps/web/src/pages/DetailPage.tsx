import { useEffect, useState, useMemo, useRef } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Download, Eye, Flame, Lock, Pencil, Shield, Star, ThumbsUp, MessageSquare, Trash2, User, ChevronDown, ChevronUp, DoorOpen, Share2 } from "lucide-react";
import type { SoupDetail } from "../shared/types";
import { api, SoupResponse, SoupsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { ContentCard } from "../components/ContentCard";
import { RadarChart } from "../RadarChart";
import { LogOut } from "lucide-react";
import { GameModal } from "../components/GameModal";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";
import { defaultCoverUrl } from "../shared/staticAssets";
import { DetailSkeleton } from "../components/Skeletons";
import { refreshMineContentCache } from "../shared/mineContentCache";
import { parentRoute } from "../shared/routeHierarchy";
import { useOnlineSoupExitGuard } from "../shared/onlineSoupExitGuard";
import { SoupShareModal } from "../components/SoupShareModal";
import { Modal } from "../components/Modal";

function CollapsibleSection({ children, defaultOpen = false }: { children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-sm font-semibold text-muted shadow-sm active:scale-[0.98] transition-transform"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {open ? "收起" : "展开"} 隐藏内容
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  );
}

export default function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationOrigin = location.state as { onlineSoupRoomId?: string; onlineSoupMember?: boolean; soupShareReturnTo?: string } | null;
  const onlineSoupOrigin = navigationOrigin;
  const onlineSoupRoomId = onlineSoupOrigin?.onlineSoupRoomId ?? "";
  useOnlineSoupExitGuard(onlineSoupRoomId, Boolean(onlineSoupOrigin?.onlineSoupMember), "detail");
  const { user, openAuth, openEvalEditor, openSoupEditor, setUser, showToast, triggerRefresh, exportReady, setExportReady, checkBadgeUnlocks } = useApp();

  const [soup, setSoup] = useState<SoupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGame, setShowGame] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showRoomCreate, setShowRoomCreate] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: "", type: "public" as "public" | "password", password: "" });
  const [hiddenExpanded, setHiddenExpanded] = useState(false);

  const radarRef = useRef<HTMLDivElement | null>(null);
  const backTarget = navigationOrigin?.soupShareReturnTo || (onlineSoupRoomId ? `/online-soup/rooms/${onlineSoupRoomId}` : parentRoute(location.pathname));

  async function createRoomForSoup() {
    if (!soup || creatingRoom) return;
    if (!user) { openAuth(); return; }
    if (!roomForm.name.trim()) return showToast("请填写房间名称");
    if (roomForm.type === "password" && roomForm.password.length !== 4) return showToast("房间密码必须为 4 位");
    setCreatingRoom(true);
    try {
      const created = await api<{ roomId: string }>("/api/online-soup/rooms", { method: "POST", body: roomForm });
      await api(`/api/online-soup/rooms/${created.roomId}/select-soup`, { method: "POST", body: { soupId: soup.id } });
      navigate(`/online-soup/rooms/${created.roomId}`);
    } catch (error) { showToast(error instanceof Error ? error.message : "创建房间失败"); }
    finally { setCreatingRoom(false); }
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<SoupResponse>(`/api/soups/${id}`)
      .then((data) => { setSoup(data.soup); setLoading(false); })
      .catch(() => { setLoading(false); });
    window.scrollTo(0, 0);
  }, [id, user?.id]);

  const ownEvaluation = useMemo(() => {
    if (!soup || !user) return null;
    return soup.evaluations.find((e) => e.reviewerId === user.id) ?? null;
  }, [soup, user]);

  async function handleDelete() {
    if (!soup || !confirm("确定删除这条海龟汤吗？相关评价也会删除。")) return;
    await api(`/api/soups/${soup.id}`, { method: "DELETE" });
    if (user && soup.creatorId === user.id) void refreshMineContentCache(user.id, "published").catch(() => {});
    navigate(parentRoute(location.pathname), { replace: true });
  }

  async function handleFavorite() {
    if (!soup) return;
    if (!user) { openAuth(); return; }
    const data = await api<{ isFavorited: boolean; favoriteCount: number }>(`/api/soups/${soup.id}/favorite`, { method: "POST" });
    setSoup((old) => old ? { ...old, isFavorited: data.isFavorited, favoriteCount: data.favoriteCount } : old);
    void refreshMineContentCache(user.id, "favorites").catch(() => {});
    if (data.isFavorited) await checkBadgeUnlocks();
  }

  async function handleLike() {
    if (!soup) return;
    if (!user) { openAuth(); return; }
    const data = await api<{ isLiked: boolean; likeCount: number }>(`/api/soups/${soup.id}/like`, { method: "POST" });
    setSoup((old) => old ? { ...old, isLiked: data.isLiked, likeCount: data.likeCount } : old);
    void refreshMineContentCache(user.id, "likes").catch(() => {});
    if (data.isLiked) await checkBadgeUnlocks();
  }

  async function handleRequest() {
    if (!soup) return;
    if (!user) { openAuth(); return; }
    await api(`/api/soups/${soup.id}/access-requests`, { method: "POST" });
    showToast("申请已发送，作者和管理员会收到提醒");
    // Refresh
    const data = await api<SoupResponse>(`/api/soups/${id!}`);
    setSoup(data.soup);
  }

  async function handleEvalOpen() {
    if (!soup) return;
    if (!user) { openAuth(); return; }
    if (!soup.canViewFull) {
      showToast("获得汤底查看权限后才能评价");
      return;
    }
    openEvalEditor(soup.id, ownEvaluation);
  }

  async function handleExport(text: string, name: string, sectionTitle?: string) {
    if (!user) { openAuth(); return; }
    if (!soup || !text.trim()) return;
    const [{ toPng }, { default: QRCode }] = await Promise.all([
      import("html-to-image"),
      import("qrcode")
    ]);

    const sheet = document.createElement("div");
    sheet.className = "export-sheet";
    sheet.style.position = "absolute";
    sheet.style.left = "0"; sheet.style.top = "0";
    sheet.style.zIndex = "-1";
    sheet.style.pointerEvents = "none";

    const header = document.createElement("div");
    header.className = "export-header";
    const eyebrow = document.createElement("div");
    eyebrow.className = "export-eyebrow"; eyebrow.textContent = "海龟汤";
    const title = document.createElement("h1"); title.textContent = soup.title;
    const meta = document.createElement("div");
    meta.className = "export-meta";
    meta.textContent = `作者 ${soup.author} · 评分 ${soup.averageTotal ?? "-"} · ${soup.evaluationCount} 条评价`;
    const tags = document.createElement("div"); tags.className = "export-tags";
    [soup.type, soup.isBottomPublic ? "公开汤" : "需授权", soup.isOriginal ? "原创" : "非原创"].forEach((t) => {
      const tag = document.createElement("span"); tag.textContent = t; tags.appendChild(tag);
    });
    header.append(eyebrow, title, meta, tags);

    const body = document.createElement("div"); body.className = "export-body";
    const bodyTitle = document.createElement("h2");
    bodyTitle.textContent = sectionTitle ?? name.split("-").pop() ?? "";
    const content = document.createElement("div"); content.className = "export-content"; content.textContent = text;
    body.append(bodyTitle, content);
    sheet.append(header, body);

    // Footer: radar chart + QR code (always show QR, radar only if data exists)
    const hasRadarData = [
      soup.radar.writing, soup.radar.logic, soup.radar.share,
      soup.radar.mechanism, soup.radar.twist, soup.radar.depth
    ].some((v) => v != null);

    const footer = document.createElement("div");
    footer.className = hasRadarData ? "export-footer" : "export-footer export-footer-qr-only";

    if (hasRadarData) {
      // Left: radar chart
      const left = document.createElement("div");
      left.className = "export-footer-left";
      const radarCanvas = (await new Promise<HTMLCanvasElement | null>((resolve) => {
        const radarEl = radarRef.current;
        if (!radarEl) return resolve(null);
        const sourceCanvas = radarEl.querySelector("canvas");
        if (!sourceCanvas) return resolve(null);
        const clone = document.createElement("canvas");
        clone.width = sourceCanvas.width;
        clone.height = sourceCanvas.height;
        const ctx = clone.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(sourceCanvas, 0, 0);
        resolve(clone);
      }));
      if (radarCanvas) {
        left.appendChild(radarCanvas);
        const radarLabel = document.createElement("div");
        radarLabel.className = "export-footer-label";
        radarLabel.textContent = `本汤综合评分：${soup.averageTotal != null ? soup.averageTotal + "分" : "暂无评分"}`;
        left.appendChild(radarLabel);
      }
      footer.appendChild(left);
    }

    // Right: QR code
    const right = document.createElement("div");
    right.className = "export-footer-right";
    const soupUrl = `${window.location.origin}/soup/${soup.id}`;
    const qrDataUrl = await QRCode.toDataURL(soupUrl, {
      width: 180,
      margin: 2,
      color: { dark: "#1e293b", light: "#ffffff" }
    });
    const qrImg = document.createElement("img");
    qrImg.src = qrDataUrl;
    qrImg.alt = "二维码";
    right.appendChild(qrImg);
    const qrLabel = document.createElement("div");
    qrLabel.className = "export-footer-label";
    qrLabel.textContent = "欢迎您扫码对本汤进行评价";
    right.appendChild(qrLabel);

    footer.appendChild(right);
    sheet.appendChild(footer);

    document.body.appendChild(sheet);

    try {
      const dataUrl = await toPng(sheet, {
        backgroundColor: "#F5F7FA", pixelRatio: 2, cacheBust: true, skipFonts: true,
        width: sheet.scrollWidth, height: sheet.scrollHeight
      });
      setExportReady({ url: dataUrl, name: `${name}.png` });
    } finally { sheet.remove(); }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    triggerRefresh();
    navigate("/");
  }

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-20"><DetailSkeleton /></main>;
  if (!soup) return <div className="card p-8 text-center text-sm text-muted">海龟汤不存在</div>;
  if (showGame) return <GameModal soup={soup} onBack={() => setShowGame(false)} />;

  const hasRadarData = [
    soup.radar.writing, soup.radar.logic, soup.radar.share,
    soup.radar.mechanism, soup.radar.twist, soup.radar.depth
  ].some((v) => v != null);
  const hasEvaluations = soup.evaluations.length > 0;
  const isReviewApproved = soup.reviewStatus === "approved";

  return (
    <section className="pt-16">
      {/* Header */}
      <header className="top-nav-shell">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5">
          <button className="flex min-h-10 items-center gap-2 text-left text-base font-black text-ink" onClick={() => navigate(backTarget, { replace: true })}>
            <ArrowLeft size={18} /> <span>{navigationOrigin?.soupShareReturnTo ? "返回聊天" : onlineSoupRoomId ? "返回房间" : "返回列表"}</span>
          </button>
          <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
            {user ? (
              <>
                <details className="user-menu">
                  <summary className="avatar-name-gap flex min-h-10 min-w-0 cursor-pointer list-none items-center rounded-full bg-white px-2 shadow-soft sm:px-2.5 sm:py-1.5">
                    {user.avatar ? (
                      <img className="h-7 w-7 shrink-0 rounded-full object-cover" src={user.avatar} alt="" />
                    ) : (
                      <div className="hidden h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-black text-primary sm:grid">
                        {(user.nickname || user.username).slice(0, 1)}
                      </div>
                    )}
                    <span className="max-w-[52px] truncate text-[13px] font-semibold text-ink sm:max-w-24 sm:text-sm">
                      {(user.nickname || user.username).slice(0, 8)}
                    </span>
                  </summary>
                  <div className="user-menu-panel left-0 top-[calc(100%+8px)] sm:left-auto sm:right-0">
                    <button className="user-menu-item" onClick={logout}><LogOut size={17} /> 退出登录</button>
                  </div>
                </details>
                <button className="relative grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-soft" onClick={() => navigate("/messages")} aria-label="消息">
                  <Bell size={20} />
                </button>
                {user.role === "admin" && (
                  <button className="hidden h-10 w-10 place-items-center rounded-full bg-white text-primary shadow-soft sm:grid" onClick={() => navigate("/admin")} aria-label="后台">
                    <Shield size={19} />
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-primary rounded-full px-5" onClick={openAuth}>登录</button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 space-y-4">

      {!isReviewApproved && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${soup.reviewStatus === "pending" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {soup.reviewStatus === "pending" ? "审核中：该海龟汤目前仅你和管理员可见，可以继续编辑或删除。" : `审核未通过：${soup.reviewReason || "请修改内容后重新提交审核"}`}
        </div>
      )}

      {/* Meta card */}
      <div className="card p-4">
        <img className="mb-4 max-h-72 w-full rounded-lg object-cover" src={soup.coverImage ?? defaultCoverUrl} alt={`${soup.title} 封面`} />
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-end justify-between gap-3">
              <h1 className="min-w-0 flex-1 break-words text-2xl font-black text-ink">
                {soup.title}
                <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap align-middle text-base font-black text-red-500" title={`热力值 ${soup.heatValue}`}>
                  <Flame size={18} className="fill-red-500" />
                  {soup.heatValue.toLocaleString()}
                </span>
              </h1>
              {isReviewApproved && <div className="flex shrink-0 items-end gap-2" style={{ height: "calc(1.5lh * 0.75)" }}>
                <button
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${soup.isLiked ? "border-red-200 bg-red-50 text-red-500" : "border-line bg-white text-muted hover:border-red-200 hover:text-red-500"}`}
                  style={{ height: "calc(1.5lh * 0.75)" }}
                  onClick={handleLike} aria-pressed={soup.isLiked}
                >
                  <ThumbsUp className={soup.isLiked ? "fill-red-400 text-red-400" : "text-muted"} size={15} /> {soup.likeCount}
                </button>
                <button
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${soup.isFavorited ? "border-amber-200 bg-amber-50 text-amber-500" : "border-line bg-white text-muted hover:border-amber-200 hover:text-amber-500"}`}
                  style={{ height: "calc(1.5lh * 0.75)" }}
                  onClick={handleFavorite} aria-pressed={soup.isFavorited}
                >
                  <Star className={soup.isFavorited ? "fill-amber-400 text-amber-400" : "text-muted"} size={15} /> {soup.favoriteCount}
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-bold text-muted hover:text-primary transition"
                  style={{ height: "calc(1.5lh * 0.75)" }}
                  onClick={() => { document.getElementById("evaluations")?.scrollIntoView({ behavior: "smooth" }); }}
                >
                  <MessageSquare size={15} /> {soup.evaluationCount}
                </button>
              </div>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="pill">{soup.type}</span>
              <span className="pill bg-orange-50 text-orange-600">{soup.difficulty}</span>
              <span className="pill bg-teal-50 text-accent">{soup.isBottomPublic ? "汤底公开" : "汤底需授权"}</span>
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <span>作者 {soup.author} · 发布者</span>
              <button className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 text-primary" onClick={() => navigate(`/users/${soup.creatorId}`)} aria-label={`查看${soup.creatorName}的个人主页`}>
                {soup.creatorAvatar ? <img className="h-full w-full object-cover" src={soup.creatorAvatar} alt={`${soup.creatorName}头像`} /> : <User size={13} />}
              </button>
              <button className="font-bold text-primary hover:underline" onClick={() => navigate(`/users/${soup.creatorId}`)}>{soup.creatorName}</button>
              <EquippedBadgeIcon badge={soup.creatorEquippedBadge} className="h-[13px] w-[13px]" />
              <span>· 评分 {soup.averageTotal ?? "-"}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Surface */}
      <ContentCard title="汤面" text={soup.surface}>
        <button className="btn btn-secondary w-full sm:w-auto" onClick={() => handleExport(soup.surface, `${soup.title}-汤面`, "汤面")}>
          <Download size={18} /> 导出汤面
        </button>
      </ContentCard>
      {soup.supplementalSurfaces.map((text, i) => (
        <CollapsibleSection key={`ss-${i}`}>
          <ContentCard key={`${i}-${text}`} title={`补充汤面${i + 1}`} text={text}>
            <button className="btn btn-secondary w-full sm:w-auto" onClick={() => handleExport(text, `${soup.title}-补充汤面${i + 1}`, `补充汤面${i + 1}`)}>
              <Download size={18} /> 导出补充汤面{i + 1}
            </button>
          </ContentCard>
        </CollapsibleSection>
      ))}

      {/* Bottom */}
      {soup.canViewFull ? (
        <CollapsibleSection>
          <ContentCard title="汤底" text={soup.bottom ?? ""}>
            <button className="btn btn-secondary w-full sm:w-auto" onClick={() => handleExport(soup.bottom ?? "", `${soup.title}-汤底`, "汤底")}>
              <Download size={18} /> 导出汤底
            </button>
          </ContentCard>
          {(soup.supplementalBottoms ?? []).map((text, i) => (
            <ContentCard key={`${i}-${text}`} title={`补充汤底${i + 1}`} text={text}>
              <button className="btn btn-secondary w-full sm:w-auto" onClick={() => handleExport(text, `${soup.title}-补充汤底${i + 1}`, `补充汤底${i + 1}`)}>
                <Download size={18} /> 导出补充汤底{i + 1}
              </button>
            </ContentCard>
          ))}
          {soup.manual && (
            <ContentCard key="manual" title="主持人手册" text={soup.manual}>
              <button className="btn btn-secondary w-full sm:w-auto" onClick={() => handleExport(soup.manual ?? "", `${soup.title}-主持人手册`, "主持人手册")}>
                <Download size={18} /> 导出手册
              </button>
            </ContentCard>
          )}
        </CollapsibleSection>
      ) : (
        <div className="card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-orange-50 p-3 text-warning"><Lock size={22} /></div>
              <div>
                <h2 className="font-black text-ink">汤底和主持人手册需要授权</h2>
                <p className="mt-1 text-sm text-muted">发送申请后，作者和管理员会收到站内提醒。</p>
              </div>
            </div>
            <button className="btn btn-primary" disabled={Boolean(soup.pendingRequestId)} onClick={handleRequest}>
              {soup.pendingRequestId ? "已申请，待处理" : "申请查看全部"}
            </button>
          </div>
        </div>
      )}  {/* soup.canViewFull */}

      {/* Radar + Evaluations */}
      <div className={hasRadarData ? "grid gap-4 lg:grid-cols-[360px_1fr]" : "grid gap-4"}>
        {hasRadarData && (
          <div className="card flex h-[360px] flex-col p-3" ref={radarRef}>
            <h2 className="mb-3 font-black text-ink">六维雷达图</h2>
            <div className="min-h-0 flex-1"><RadarChart radar={soup.radar} /></div>
          </div>
        )}
        <div className="card p-4" id="evaluations">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-black text-ink">评价</h2>
            {hasEvaluations && (
              <button
                className="btn btn-primary"
                disabled={!soup.canViewFull}
                title={!soup.canViewFull ? "获得汤底查看权限后才能评价" : undefined}
                onClick={handleEvalOpen}
              >
                <Star size={18} /> {ownEvaluation ? "编辑我的评价" : "添加评价"}
              </button>
            )}
          </div>
          {!soup.canViewFull && <p className="mb-3 text-xs text-warning">获得汤底查看权限后才能评价。</p>}
          <div className="space-y-3">
            {soup.evaluations.map((item) => (
              <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    {item.reviewerAvatar ? <img className="h-6 w-6 rounded-full object-cover" src={item.reviewerAvatar} alt="" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-100 text-primary"><User size={14} /></span>}
                    <strong>{item.reviewer}</strong>
                    <EquippedBadgeIcon badge={item.reviewerEquippedBadge} className="h-5 w-5" />
                  </span>
                  <span className="rounded-lg bg-blue-50 px-2 py-1 text-sm font-black text-primary">{item.total}</span>
                </div>
                {item.content && <p className="mt-2 text-sm leading-6 text-ink whitespace-pre-wrap">{item.content}</p>}
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
                <button
                  className="btn btn-primary w-full sm:w-auto"
                  disabled={!soup.canViewFull}
                  title={!soup.canViewFull ? "获得汤底查看权限后才能评价" : undefined}
                  onClick={handleEvalOpen}
                >
                  <Star size={18} /> {ownEvaluation ? "编辑我的评价" : "添加评价"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      </div>

      <div className="fixed inset-x-4 bottom-24 z-30 flex items-center justify-end gap-2 overflow-x-auto">
        {user && soup.enableAiGame && isReviewApproved && <button className="flex h-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 px-4 text-sm font-black text-white shadow-lg transition-transform hover:shadow-xl active:scale-95 sm:px-5" onClick={() => setShowGame(true)} aria-label="AI 玩汤">AI玩汤</button>}
        {soup.canViewFull && isReviewApproved && <button className="flex h-14 shrink-0 items-center justify-center gap-1.5 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 px-4 text-sm font-black text-white shadow-lg transition-transform hover:shadow-xl active:scale-95 sm:px-5" onClick={() => { if (!user) { openAuth(); return; } setRoomForm({ name: `${soup.title}玩汤房`.slice(0, 50), type: "public", password: "" }); setShowRoomCreate(true); }} aria-label="开房间"><DoorOpen size={17} />开房间</button>}
        <button className="flex h-14 shrink-0 items-center justify-center gap-1.5 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 px-4 text-sm font-black text-white shadow-lg transition-transform hover:shadow-xl active:scale-95 sm:px-5" onClick={() => setShowShare(true)} aria-label="分享"><Share2 size={17} />分享</button>
      </div>

      {showShare && <SoupShareModal soup={soup} onClose={() => setShowShare(false)} />}
      {showRoomCreate && <Modal onClose={() => !creatingRoom && setShowRoomCreate(false)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">开房间</h2><p className="mt-1 text-sm text-muted">创建后将自动选择《{soup.title}》</p></div><label className="block space-y-2"><span className="text-xs font-bold text-muted">房间名称</span><input className="field" maxLength={50} value={roomForm.name} onChange={(e) => setRoomForm((old) => ({ ...old, name: e.target.value }))} /></label><label className="block space-y-2"><span className="text-xs font-bold text-muted">房间类型</span><select className="field" value={roomForm.type} onChange={(e) => setRoomForm((old) => ({ ...old, type: e.target.value as "public" | "password", password: "" }))}><option value="public">公开房间</option><option value="password">密码房间</option></select></label>{roomForm.type === "password" && <label className="block space-y-2"><span className="text-xs font-bold text-muted">4 位密码</span><input className="field text-center tracking-[.3em]" inputMode="numeric" maxLength={4} value={roomForm.password} onChange={(e) => setRoomForm((old) => ({ ...old, password: e.target.value.replace(/\D/g, "") }))} /></label>}<button className="btn btn-primary w-full" disabled={creatingRoom} onClick={() => void createRoomForSoup()}>{creatingRoom ? "创建中…" : "创建并进入"}</button></div></Modal>}

      {/* Edit/Delete floating bar */}
      {soup.canEdit && (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto grid max-w-md grid-cols-2 gap-3 rounded-2xl border border-line bg-white/95 p-3 shadow-soft backdrop-blur">
          <button className="btn btn-secondary" onClick={() => openSoupEditor(soup)}><Pencil size={18} /> 编辑</button>
          <button className="btn btn-danger" onClick={handleDelete}><Trash2 size={18} /> 删除</button>
        </div>
      )}
      {soup.canEdit && <div className="h-20" />}
    </section>
  );
}
