import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Download, Eye, Flame, Lock, Pencil, Shield, Star, ThumbsUp, MessageSquare, Trash2, User, Gamepad2, ChevronDown, ChevronUp } from "lucide-react";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import type { SoupDetail } from "../shared/types";
import { api, SoupResponse, SoupsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { ContentCard } from "../components/ContentCard";
import { RadarChart } from "../RadarChart";
import { LogOut } from "lucide-react";
import { GameModal } from "../components/GameModal";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";

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
  const { user, openAuth, openEvalEditor, openSoupEditor, setUser, showToast, triggerRefresh, exportReady, setExportReady, checkBadgeUnlocks } = useApp();

  const [soup, setSoup] = useState<SoupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGame, setShowGame] = useState(false);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);

  const radarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<SoupResponse>(`/api/soups/${id}`)
      .then((data) => { setSoup(data.soup); setLoading(false); })
      .catch(() => { setLoading(false); });
    window.scrollTo(0, 0);
  }, [id]);

  const ownEvaluation = useMemo(() => {
    if (!soup || !user) return null;
    return soup.evaluations.find((e) => e.reviewerId === user.id) ?? null;
  }, [soup, user]);

  async function handleDelete() {
    if (!soup || !confirm("确定删除这条海龟汤吗？相关评价也会删除。")) return;
    await api(`/api/soups/${soup.id}`, { method: "DELETE" });
    navigate("/");
  }

  async function handleFavorite() {
    if (!soup) return;
    if (!user) { openAuth(); return; }
    const data = await api<{ isFavorited: boolean; favoriteCount: number }>(`/api/soups/${soup.id}/favorite`, { method: "POST" });
    setSoup((old) => old ? { ...old, isFavorited: data.isFavorited, favoriteCount: data.favoriteCount } : old);
    if (data.isFavorited) await checkBadgeUnlocks();
  }

  async function handleLike() {
    if (!soup) return;
    if (!user) { openAuth(); return; }
    const data = await api<{ isLiked: boolean; likeCount: number }>(`/api/soups/${soup.id}/like`, { method: "POST" });
    setSoup((old) => old ? { ...old, isLiked: data.isLiked, likeCount: data.likeCount } : old);
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
    openEvalEditor(soup.id, ownEvaluation);
  }

  async function handleExport(text: string, name: string, sectionTitle?: string) {
    if (!user) { openAuth(); return; }
    if (!soup || !text.trim()) return;

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

  if (loading) return <div className="flex items-center justify-center py-20 text-sm text-muted">正在喝汤中……</div>;
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
          <button className="flex min-h-10 items-center gap-2 text-left text-base font-black text-ink" onClick={() => navigate("/")}>
            <ArrowLeft size={18} /> <span>返回列表</span>
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
        <img className="mb-4 max-h-72 w-full rounded-lg object-cover" src={soup.coverImage ?? "/default-cover.png"} alt={`${soup.title} 封面`} />
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
              <span className="pill bg-teal-50 text-accent">{soup.isBottomPublic ? "汤底公开" : "汤底需授权"}</span>
            </div>
            <p className="avatar-name-gap mt-3 flex items-center text-sm text-muted">
              {soup.creatorAvatar ? <img className="h-4 w-4 rounded-full object-cover" src={soup.creatorAvatar} alt="" /> : <User size={14} />}
              <span>作者 {soup.author} · 发布者 {soup.creatorName}</span>
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
              <button className="btn btn-primary" onClick={handleEvalOpen}>
                <Star size={18} /> {ownEvaluation ? "编辑我的评价" : "添加评价"}
              </button>
            )}
          </div>
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
                <button className="btn btn-primary w-full sm:w-auto" onClick={handleEvalOpen}>
                  <Star size={18} /> {ownEvaluation ? "编辑我的评价" : "添加评价"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      </div>

      {/* AI 玩汤 悬浮按钮 */}
      {user && soup.enableAiGame && isReviewApproved && (
        <button
          className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-lg active:scale-95 transition-transform hover:shadow-xl"
          onClick={() => setShowGame(true)}
          aria-label="AI 玩汤"
        >
          <Gamepad2 size={24} />
        </button>
      )}

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
