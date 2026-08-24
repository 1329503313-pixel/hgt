import { useEffect, useMemo, useState } from "react";
import { Download, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Modal } from "./Modal";

const DISMISSED_AT_KEY = "hgt:pwa-install-dismissed-at";
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIosSafari() {
  const userAgent = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/i.test(userAgent)
    || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|MicroMessenger/i.test(userAgent);
  return ios && safari;
}

function recentlyDismissed() {
  try {
    const dismissedAt = Number.parseInt(window.localStorage.getItem(DISMISSED_AT_KEY) ?? "", 10);
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in private browsing; dismissal still works for this render.
  }
}

export function PwaInstallPrompt() {
  const location = useLocation();
  const iosSafari = useMemo(isIosSafari, []);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);

  useEffect(() => {
    if (location.pathname !== "/" || isStandalone() || recentlyDismissed()) {
      setVisible(false);
      return;
    }

    const phoneViewport = window.matchMedia("(max-width: 767px)").matches;
    if (!phoneViewport || (!iosSafari && !installEvent)) return;

    const timer = window.setTimeout(() => setVisible(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [installEvent, iosSafari, location.pathname]);

  function dismiss() {
    rememberDismissal();
    setVisible(false);
    setGuideOpen(false);
  }

  async function install() {
    if (!installEvent) {
      setGuideOpen(true);
      return;
    }

    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "accepted") setVisible(false);
  }

  if (!visible && !guideOpen) return null;

  return (
    <>
      {visible && (
        <aside className="pwa-install-card" aria-label="安装汤物语">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-primary" aria-hidden="true">
            <Smartphone size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-black text-ink">添加到主屏幕</strong>
            <span className="mt-0.5 block text-xs leading-5 text-muted">像 APP 一样独立打开，业务数据始终保持在线同步。</span>
          </span>
          <button type="button" className="btn btn-primary min-h-11 shrink-0 px-3 text-sm" onClick={() => void install()}>
            {installEvent ? <Download size={17} /> : <Share size={17} />}
            {installEvent ? "安装" : "方法"}
          </button>
          <button type="button" className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-slate-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={dismiss} aria-label="30 天内不再提示" title="关闭安装提示">
            <X size={18} />
          </button>
        </aside>
      )}

      {guideOpen && (
        <Modal onClose={() => setGuideOpen(false)} contentClassName="max-w-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="pwa-install-title" className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-primary" aria-hidden="true">
                <Smartphone size={24} />
              </span>
              <div>
                <h2 id="pwa-install-title" className="text-xl font-black text-ink">添加到 iPhone 主屏幕</h2>
                <p className="mt-1 text-sm leading-6 text-muted">无需下载文件，在 Safari 中完成以下操作即可。</p>
              </div>
            </div>
            <ol className="space-y-3" aria-label="安装步骤">
              <li className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm" aria-hidden="true"><Share size={20} /></span>
                <span className="text-sm leading-6 text-ink"><strong>1.</strong> 点击 Safari 工具栏中的“分享”按钮</span>
              </li>
              <li className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm" aria-hidden="true"><SquarePlus size={20} /></span>
                <span className="text-sm leading-6 text-ink"><strong>2.</strong> 向下找到并选择“添加到主屏幕”</span>
              </li>
              <li className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm" aria-hidden="true"><Smartphone size={20} /></span>
                <span className="text-sm leading-6 text-ink"><strong>3.</strong> 开启“打开为 Web App”</span>
              </li>
              <li className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm" aria-hidden="true"><Download size={20} /></span>
                <span className="text-sm leading-6 text-ink"><strong>4.</strong> 点击右上角“添加”完成安装</span>
              </li>
            </ol>
            <button type="button" className="btn btn-primary min-h-12 w-full" onClick={dismiss}>知道了</button>
          </section>
        </Modal>
      )}
    </>
  );
}
