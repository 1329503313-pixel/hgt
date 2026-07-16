import { useEffect, useState } from "react";
import { Eye, ChevronRight, ThumbsUp, Star, Sparkles, FileText, Flame } from "lucide-react";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import type { SoupSummary } from "../shared/types";
import { formatViews } from "../context/AppContext";
import { PageTopBar } from "./PageTopBar";
import { useApp } from "../context/AppContext";
import { useNavigate } from "react-router-dom";
import { MineBackButton } from "./MineBackButton";
import { defaultCoverUrl, turtleAvatarUrl } from "../shared/staticAssets";

export function SoupLinkList({
  soups,
  onOpen,
  emptyHint,
  showHeatValue = false
}: {
  soups: SoupSummary[];
  onOpen: (id: string) => void;
  emptyHint: string;
  showHeatValue?: boolean;
}) {
  if (soups.length === 0) {
    return <div className="card p-4 text-center text-sm text-muted">{emptyHint}</div>;
  }
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-muted">{soups.length} 条</span>
      </div>
      <div className="space-y-3">
        {soups.map((soup) => (
          <button
            key={soup.id}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-line bg-white p-3 text-left"
            onClick={() => onOpen(soup.id)}
          >
            {soup.coverImage ? (
              <img className="h-14 w-14 shrink-0 rounded-lg object-cover" src={soup.coverImage} alt="" />
            ) : (
              <img className="h-14 w-14 shrink-0 rounded-lg object-cover" src={defaultCoverUrl} alt="" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate">
                <span className="truncate text-base font-semibold text-ink">{soup.title}</span>
                {soup.averageTotal != null && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-muted">
                    <Sparkles size={13} /> {Number(soup.averageTotal.toFixed(1))}
                  </span>
                )}
                {showHeatValue && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-red-500" title={`热力值 ${soup.heatValue}`}>
                    <Flame size={13} className="fill-red-500" /> {soup.heatValue.toLocaleString()}
                  </span>
                )}
                {soup.reviewStatus === "pending" && (
                  <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">审核中</span>
                )}
                {soup.reviewStatus === "rejected" && (
                  <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-600">审核未通过</span>
                )}
              </span>
              <span className="avatar-name-gap mt-1 flex items-center truncate text-xs text-muted">
                {soup.isOriginal ? (
                  soup.creatorAvatar ? (
                    <img className="h-3.5 w-3.5 rounded-full object-cover" src={soup.creatorAvatar} alt="" />
                  ) : null
                ) : (
                  <img className="h-3.5 w-3.5 rounded-full object-cover" src={turtleAvatarUrl} alt="" />
                )}
                {soup.author || soup.creatorName} · <ThumbsUp size={12} /> {soup.likeCount} · <Star size={12} /> {soup.favoriteCount} · <Eye size={12} /> {formatViews(soup.viewCount)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SubListPage({
  title,
  soups,
  emptyHint,
  showHeatValue = false
}: {
  title: string;
  soups: SoupSummary[];
  emptyHint: string;
  showHeatValue?: boolean;
}) {
  const navigate = useNavigate();
  const { setExportReady } = useApp();
  const [showExportConfirm, setShowExportConfirm] = useState(false);

  // 计算 unread（简化：如果没有 user 则为 0）
  const unread = 0;

  async function handleExportSoups() {
    setShowExportConfirm(false);
    const latest = soups.slice(0, 10);
    if (latest.length === 0) return;

    const sheet = document.createElement("div");
    sheet.className = "export-sheet";
    sheet.style.position = "absolute";
    sheet.style.left = "0"; sheet.style.top = "0";
    sheet.style.zIndex = "-1";
    sheet.style.pointerEvents = "none";

    // Header banner
    const header = document.createElement("div");
    header.className = "export-header";
    const eyebrow = document.createElement("div");
    eyebrow.className = "export-eyebrow"; eyebrow.textContent = "海龟汤";
    const headerTitle = document.createElement("h1"); headerTitle.textContent = title;
    header.append(eyebrow, headerTitle);

    // Body: soup list
    const body = document.createElement("div");
    body.className = "export-body";

    const list = document.createElement("div");
    list.className = "export-soup-list";
    latest.forEach((soup) => {
      const item = document.createElement("div");
      item.className = "export-soup-item";

      const left = document.createElement("div");
      left.className = "export-soup-item-left";

      const itemTitle = document.createElement("div");
      itemTitle.className = "export-soup-item-title";
      itemTitle.textContent = soup.title;

      const itemMeta = document.createElement("div");
      itemMeta.className = "export-soup-item-meta";
      itemMeta.textContent = `${soup.author || soup.creatorName} · ${soup.type}`;

      const itemSummary = document.createElement("div");
      itemSummary.className = "export-soup-item-summary";
      itemSummary.textContent = soup.summary || "暂无摘要";

      left.append(itemTitle, itemMeta, itemSummary);

      const right = document.createElement("div");
      right.className = "export-soup-item-right";
      right.textContent = soup.averageTotal != null ? `${soup.averageTotal}分` : "-";

      item.append(left, right);
      list.appendChild(item);
    });
    body.appendChild(list);
    sheet.append(header, body);

    // Footer: QR code centered
    const footer = document.createElement("div");
    footer.className = "export-footer export-footer-qr-only";

    const footerRight = document.createElement("div");
    footerRight.className = "export-footer-right";
    const homeUrl = window.location.origin;
    const qrDataUrl = await QRCode.toDataURL(homeUrl, {
      width: 180,
      margin: 2,
      color: { dark: "#1e293b", light: "#ffffff" }
    });
    const qrImg = document.createElement("img");
    qrImg.src = qrDataUrl;
    qrImg.alt = "二维码";
    footerRight.appendChild(qrImg);
    const qrLabel = document.createElement("div");
    qrLabel.className = "export-footer-label";
    qrLabel.textContent = "扫码查看更多海龟汤";
    footerRight.appendChild(qrLabel);
    footer.appendChild(footerRight);
    sheet.appendChild(footer);

    document.body.appendChild(sheet);

    try {
      const dataUrl = await toPng(sheet, {
        backgroundColor: "#F5F7FA", pixelRatio: 2, cacheBust: true, skipFonts: true,
        width: sheet.scrollWidth, height: sheet.scrollHeight
      });
      setExportReady({ url: dataUrl, name: `${title}.png` });
    } finally { sheet.remove(); }
  }

  return (
    <section className="space-y-3">
      <PageTopBar title={title} unread={unread} />
      <MineBackButton />
      <SoupLinkList soups={soups} onOpen={(id) => navigate(`/soup/${id}`)} emptyHint={emptyHint} showHeatValue={showHeatValue} />

      {/* 导出汤名悬浮按钮 */}
      <button
        className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition hover:bg-blue-600 active:scale-95"
        aria-label="导出汤名"
        title="导出汤名"
        onClick={() => setShowExportConfirm(true)}
      >
        <FileText size={22} />
      </button>

      {/* 导出确认弹框 */}
      {showExportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-sm rounded-[20px] bg-white p-6 shadow-soft">
            <p className="text-base font-bold text-ink">导出汤名</p>
            <p className="mt-2 text-sm text-muted">是否导出当前页面最新 10 条海龟汤列表？</p>
            <div className="mt-5 flex gap-3">
              <button
                className="btn btn-secondary flex-1"
                onClick={() => setShowExportConfirm(false)}
              >
                否
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={handleExportSoups}
              >
                是
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
