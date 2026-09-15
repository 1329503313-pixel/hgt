import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";
import {
  downloadAndInstallAndroidUpdate, getAndroidUpdate, getAndroidDownloadStatus,
  installDownloadedAndroidUpdate, openAndroidUpdateDownload, IS_NATIVE_ANDROID,
  type AndroidDownloadStatus, type AndroidUpdateManifest
} from "../android/platform";

type UpdateView = {
  manifest: AndroidUpdateManifest;
  download: AndroidDownloadStatus;
  legacy: boolean;
  message?: string;
  statusMessage?: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message
    : (error as { message?: string })?.message || "更新暂时不可用，请重试";
}

async function withTimeout<T>(action: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("系统响应超时，请重试或通过浏览器下载安装")), 15000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function AndroidUpdateGate() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<UpdateView | null>(null);
  const actionPending = useRef(false);
  const checking = useRef(false);
  const generation = useRef(0);
  const statusRequest = useRef(0);
  const mounted = useRef(false);
  const lastProgress = useRef({ received: 0, time: Date.now() });

  const updateView = useCallback((value: UpdateView | null) => {
    current.current = value;
    if (mounted.current) setView(value);
  }, []);

  const refreshDownload = useCallback(async () => {
    const existing = current.current;
    if (!existing || existing.legacy || actionPending.current) return;
    const version = generation.current;
    const request = ++statusRequest.current;
    try {
      const download = await withTimeout(getAndroidDownloadStatus(existing.manifest.apkUrl));
      if (!mounted.current || version !== generation.current || request !== statusRequest.current || actionPending.current) return;
      const latest = current.current;
      if (!latest || latest.manifest.apkUrl !== existing.manifest.apkUrl) return;
      const received = download?.received ?? 0;
      if (received !== lastProgress.current.received) lastProgress.current = { received, time: Date.now() };
      const stalled = download && ["pending", "downloading", "paused"].includes(download.status)
        && Date.now() - lastProgress.current.time > 30000;
      updateView({
        ...latest, download: download ?? latest.download, legacy: download === null,
        statusMessage: stalled ? "下载暂时没有进展，请检查网络；也可通过浏览器下载安装" : undefined
      });
    } catch (error) {
      if (mounted.current && version === generation.current && request === statusRequest.current && current.current) {
        updateView({ ...current.current, statusMessage: errorMessage(error) });
      }
    }
  }, [updateView]);

  const checkForUpdates = useCallback(async () => {
    if (!IS_NATIVE_ANDROID || checking.current || current.current || actionPending.current) return;
    checking.current = true;
    try {
      // The hot-update path does not yet extract or activate a bundle. Use the complete
      // APK flow until that capability is implemented and verified end to end.
      const manifest = await withTimeout(getAndroidUpdate());
      if (!mounted.current || !manifest?.updateAvailable) return;
      updateView({ manifest, download: { status: "none" }, legacy: false });
      lastProgress.current = { received: 0, time: Date.now() };
      await refreshDownload();
    } catch {
      // Startup checks are silent; explicit download / install failures stay in the dialog.
    } finally {
      checking.current = false;
    }
  }, [refreshDownload, updateView]);

  useEffect(() => {
    mounted.current = true;
    if (IS_NATIVE_ANDROID) void checkForUpdates();
    const onActive = (event: Event) => {
      if (!(event as CustomEvent<{ isActive: boolean }>).detail?.isActive) return;
      if (current.current) void refreshDownload();
      else void checkForUpdates();
    };
    window.addEventListener("hgt:app-state", onActive);
    return () => {
      mounted.current = false;
      generation.current++;
      window.removeEventListener("hgt:app-state", onActive);
    };
  }, [checkForUpdates, refreshDownload]);

  const apkUrl = view?.manifest.apkUrl;
  useEffect(() => {
    if (!apkUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "hidden") await refreshDownload();
      if (!cancelled) timer = setTimeout(() => { void poll(); }, 1500);
    };
    timer = setTimeout(() => { void poll(); }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [apkUrl, refreshDownload]);

  async function runAction(action: "download" | "install" | "browser") {
    const existing = current.current;
    if (!existing || actionPending.current) return;
    actionPending.current = true;
    generation.current++;
    setBusy(true);
    updateView({ ...existing, message: undefined, statusMessage: undefined });
    try {
      if (action === "browser") {
        await withTimeout(openAndroidUpdateDownload(existing.manifest.apkUrl));
        updateView({ ...existing, message: "请在浏览器中完成下载并打开 APK 安装；返回 APP 后仍可继续安装更新。" });
      } else if (action === "install") {
        await withTimeout(installDownloadedAndroidUpdate(existing.manifest.apkUrl));
        updateView({ ...existing, message: "已请求打开系统安装页。如未显示或取消了安装，请再次点击安装更新。" });
      } else {
        const download = await withTimeout(downloadAndInstallAndroidUpdate(existing.manifest.apkUrl));
        lastProgress.current = { received: 0, time: Date.now() };
        updateView({
          ...existing,
          download: download.status ? download : { status: "pending", downloadId: download.downloadId },
          message: existing.legacy ? "下载已交给系统处理。若安装页未弹出，可通过浏览器下载安装。" : undefined
        });
      }
    } catch (error) {
      updateView({ ...existing, message: errorMessage(error) });
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!view) return null;
  const { manifest, download, legacy } = view;
  const message = view.message || view.statusMessage;
  const downloading = ["pending", "downloading", "paused"].includes(download.status);
  const ready = download.status === "ready";
  const total = download.total ?? 0;
  const received = download.received ?? 0;
  const percent = total > 0 ? Math.min(99, Math.max(0, Math.round(received / total * 100))) : undefined;
  const dismiss = () => {
    if (manifest.forceUpdate || actionPending.current) return;
    generation.current++;
    updateView(null);
  };

  return (
    <Modal onClose={dismiss} hideCloseButton={manifest.forceUpdate || busy}>
      <div className="space-y-4" role="alertdialog" aria-modal="true" aria-labelledby="apk-title">
        <div className="flex items-start gap-3 pr-1">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            <ShieldCheck size={24} />
          </span>
          <div>
            <h2 id="apk-title" className="text-xl font-black text-ink">
              {ready ? "下载完成，等待安装" : downloading ? "正在下载更新" : "发现新版 " + manifest.latestVersionName}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {ready ? "点击安装更新，由系统确认安装。"
                : manifest.forceUpdate ? "当前版本已停止支持，请完成更新后继续使用。"
                : "下载完整安装包，安装后保留原有数据。"}
            </p>
          </div>
        </div>
        {!downloading && !ready && manifest.releaseNotes.length > 0 && (
          <ul className="list-disc space-y-1 rounded-2xl bg-slate-50 px-8 py-4 text-sm leading-6 text-ink">
            {manifest.releaseNotes.map((note, i) => <li key={i}>{note}</li>)}
          </ul>
        )}
        {downloading && !legacy && (
          <div className="space-y-2">
            <div role="progressbar" aria-label="安装包下载进度" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={percent} className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-emerald-600" style={{ width: percent === undefined ? "0%" : percent + "%" }} />
            </div>
            <p className="text-sm text-muted">
              {(received / 1048576).toFixed(1)} MB{total > 0 ? " / " + (total / 1048576).toFixed(1) + " MB" : " · 正在获取文件大小"}
            </p>
            <p className="text-sm text-muted">{download.message || "下载完成后，点击安装更新。"}</p>
          </div>
        )}
        {(message || download.status === "failed") && (
          <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            {message || download.message || "下载失败，请重试"}
          </p>
        )}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <RefreshCw size={18} className="animate-spin motion-reduce:animate-none" />正在处理，请稍候…
        </p>}
        <div className="grid gap-2">
          {(!downloading || ready) && (
            <button type="button" disabled={busy} className="btn btn-primary min-h-12 disabled:opacity-50"
              onClick={() => { void runAction(ready ? "install" : "download"); }}>
              <Download size={18} />{ready ? "安装更新" : download.status === "failed" ? "重新下载" : "立即更新"}
            </button>
          )}
          <button type="button" disabled={busy} className="btn btn-secondary min-h-12 disabled:opacity-50"
            onClick={() => { void runAction("browser"); }}>通过浏览器下载安装</button>
          {!manifest.forceUpdate && (
            <button type="button" disabled={busy} className="btn btn-secondary min-h-12 disabled:opacity-50" onClick={dismiss}>
              {downloading ? "稍后查看" : "稍后"}
            </button>
          )}
        </div>
        <p className="text-xs leading-5 text-muted">
          安装包来自官方。若系统提示安装权限，请允许“汤物语”安装未知应用，返回后再次点击安装更新。
        </p>
      </div>
    </Modal>
  );
}
