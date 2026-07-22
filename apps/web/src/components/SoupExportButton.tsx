import { useState } from "react";
import { FileText } from "lucide-react";
import type { SoupSummary } from "../shared/types";
import { useApp } from "../context/AppContext";

export function SoupExportButton({
  soups,
  title,
  fileName,
  confirmText,
  disabled = false
}: {
  soups: SoupSummary[];
  title: string;
  fileName: string;
  confirmText: string;
  disabled?: boolean;
}) {
  const { setExportReady } = useApp();
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleExport() {
    setShowConfirm(false);
    if (soups.length === 0) return;
    const [{ toPng }, { default: QRCode }] = await Promise.all([
      import("html-to-image"),
      import("qrcode")
    ]);

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
    const headerTitle = document.createElement("h1");
    headerTitle.textContent = title;
    header.append(eyebrow, headerTitle);

    const body = document.createElement("div");
    body.className = "export-body";
    const list = document.createElement("div");
    list.className = "export-soup-list";

    soups.forEach((soup) => {
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

    const footer = document.createElement("div");
    footer.className = "export-footer export-footer-qr-only";
    const footerRight = document.createElement("div");
    footerRight.className = "export-footer-right";
    const qrDataUrl = await QRCode.toDataURL(window.location.origin, {
      width: 180,
      margin: 2,
      color: { dark: "#1e293b", light: "#ffffff" }
    });
    const qrImg = document.createElement("img");
    qrImg.src = qrDataUrl;
    qrImg.alt = "二维码";
    const qrLabel = document.createElement("div");
    qrLabel.className = "export-footer-label";
    qrLabel.textContent = "扫码查看更多海龟汤";
    footerRight.append(qrImg, qrLabel);
    footer.appendChild(footerRight);
    sheet.appendChild(footer);
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
      setExportReady({ url: dataUrl, name: fileName });
    } finally {
      sheet.remove();
    }
  }

  return (
    <>
      <button
        className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition hover:bg-blue-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 lg:hidden"
        aria-label="导出当前页海龟汤列表"
        title="导出当前页海龟汤列表"
        disabled={disabled || soups.length === 0}
        onClick={() => setShowConfirm(true)}
      >
        <FileText size={22} />
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-sm rounded-[20px] bg-white p-6 shadow-soft">
            <p className="text-base font-bold text-ink">导出汤名</p>
            <p className="mt-2 text-sm text-muted">{confirmText}</p>
            <div className="mt-5 flex gap-3">
              <button className="btn btn-secondary flex-1" onClick={() => setShowConfirm(false)}>否</button>
              <button className="btn btn-primary flex-1" onClick={() => void handleExport()}>是</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
