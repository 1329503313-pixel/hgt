import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";
import { checkForHotUpdate, downloadHotUpdate, extractAndVerifyHotUpdate, type HotUpdateManifest } from "../android/hotUpdate";
import { downloadAndInstallAndroidUpdate, getAndroidUpdate, type AndroidUpdateManifest, IS_NATIVE_ANDROID } from "../android/platform";
import { useApp } from "../context/AppContext";

type UpdateState =
  | { phase: "checking" }
  | { phase: "hot-update-available"; manifest: HotUpdateManifest }
  | { phase: "hot-update-downloading"; manifest: HotUpdateManifest; progress: number; total: number }
  | { phase: "hot-update-extracting"; manifest: HotUpdateManifest }
  | { phase: "hot-update-done"; manifest: HotUpdateManifest }
  | { phase: "apk-update-available"; manifest: AndroidUpdateManifest }
  | { phase: "apk-installing" }
  | { phase: "apk-download-started" }
  | { phase: "error"; message: string };

export function AndroidUpdateGate() {
  const { showToast, user } = useApp();
  const [state, setState] = useState<UpdateState | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!IS_NATIVE_ANDROID) return;
    setState({ phase: "checking" });

    try {
      const appInfoModule = await import("@capacitor/app");
      const info = await appInfoModule.App.getInfo();
      const currentVersionCode = Number.parseInt(info.build, 10);
      if (!Number.isSafeInteger(currentVersionCode) || currentVersionCode < 1) {
        throw new Error("无法读取 APP 版本号");
      }

      const hotManifest = await checkForHotUpdate(currentVersionCode);
      if (hotManifest) {
        setState({ phase: "hot-update-available", manifest: hotManifest });
        return;
      }

      const apkManifest = await getAndroidUpdate();
      if (apkManifest?.updateAvailable) {
        setState({ phase: "apk-update-available", manifest: apkManifest });
        return;
      }

      setState(null);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    if (!IS_NATIVE_ANDROID) return;
    void checkForUpdates();
    const onActive = (event: Event) => {
      if ((event as CustomEvent<{ isActive: boolean }>).detail?.isActive && user) {
        void checkForUpdates();
      }
    };
    window.addEventListener("hgt:app-state", onActive);
    return () => window.removeEventListener("hgt:app-state", onActive);
  }, [checkForUpdates, user]);

  if (!state || state.phase === "checking") return null;

  // --- Hot Update flow ---
  async function startHotUpdateDownload(manifest: HotUpdateManifest) {
    setState({ phase: "hot-update-downloading", manifest, progress: 0, total: manifest.zipSize });
    try {
      const downloadedPath = await downloadHotUpdate(
        manifest.zipUrl,
        manifest.zipSha256,
        (received, total) => setState({ phase: "hot-update-downloading", manifest, progress: received, total })
      );

      setState({ phase: "hot-update-extracting", manifest });
      await extractAndVerifyHotUpdate(downloadedPath, manifest.latestVersionCode);
      setState({ phase: "hot-update-done", manifest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ phase: "error", message });
    }
  }

  function restartApp() {
    void import("@capacitor/app").then(async (m) => {
      try {
        await m.App.exitApp();
      } catch {
        window.location.reload();
      }
    });
  }

  // --- APK fallback flow ---
  async function installApk(manifest: AndroidUpdateManifest) {
    setState({ phase: "apk-installing" });
    try {
      await downloadAndInstallAndroidUpdate(manifest.apkUrl);
      setState({ phase: "apk-download-started" });
      showToast("新版 APK 正在下载，完成后将打开系统安装页");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("INSTALL_PERMISSION_REQUIRED")) {
        showToast(`请允许"安装未知应用"，返回后再次点击立即更新`);
      } else {
        showToast(message || "更新下载失败，请稍后重试");
      }
      setState({ phase: "apk-update-available", manifest });
    }
  }

  // --- Render ---
  function dismissIfAllowed() {
    if (state === null) return;
    switch (state.phase) {
      case "hot-update-downloading":
      case "hot-update-extracting":
      case "hot-update-done":
      case "apk-installing":
        return;
      default:
        setState(null);
    }
  }

  function renderContent() {
    if (!state) return null;

    switch (state.phase) {
      case "hot-update-available": {
        const m = state.manifest;
        const sizeInMB = (m.zipSize / (1024 * 1024)).toFixed(1);
        return (
          <div className="space-y-4" role="alertdialog" aria-modal="true" aria-labelledby="hu-title">
            <div className="flex items-start gap-3 pr-1">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                <RefreshCw size={24} />
              </span>
              <div>
                <h2 id="hu-title" className="text-xl font-black text-ink">发现新版 {m.latestVersionName}</h2>
                <p className="mt-1 text-sm text-muted">应用内更新无需重新安装，下载仅约 {sizeInMB}MB。</p>
              </div>
            </div>
            {m.releaseNotes.length > 0 && (
              <ul className="list-disc space-y-1 rounded-2xl bg-slate-50 px-8 py-4 text-sm leading-6 text-ink">
                {m.releaseNotes.map((note: string, i: number) => <li key={`${i}-${note}`}>{note}</li>)}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary min-h-11" onClick={() => setState(null)}>稍后</button>
              <button type="button" className="btn btn-primary min-h-11" onClick={() => { void startHotUpdateDownload(m); }}>
                <Download size={18} />立即更新
              </button>
            </div>
          </div>
        );
      }

      case "hot-update-downloading": {
        const dm = state;
        const pct = dm.total > 0 ? Math.min(99, Math.round((dm.progress / dm.total) * 100)) : 0;
        const downloaded = (dm.progress / (1024 * 1024)).toFixed(1);
        const totalMB = (dm.total / (1024 * 1024)).toFixed(1);
        return (
          <div className="space-y-4" role="alertdialog" aria-modal="true" aria-labelledby="hu-dl-title">
            <h2 id="hu-dl-title" className="text-lg font-black text-ink">正在下载 {dm.manifest.latestVersionName}</h2>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-600 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-center text-sm text-muted">{downloaded}MB / {totalMB}MB ({pct}%)</p>
          </div>
        );
      }

      case "hot-update-extracting":
        return (
          <div className="space-y-4 text-center" role="alertdialog" aria-modal="true">
            <RefreshCw size={36} className="mx-auto animate-spin text-blue-700" />
            <h2 className="text-lg font-black text-ink">正在解压资源…</h2>
            <p className="text-sm text-muted">请勿关闭 APP</p>
          </div>
        );

      case "hot-update-done":
        return (
          <div className="space-y-4" role="alertdialog" aria-modal="true" aria-labelledby="hu-done-title">
            <div className="flex items-start gap-3 pr-1">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShieldCheck size={24} />
              </span>
              <div>
                <h2 id="hu-done-title" className="text-xl font-black text-ink">更新完成</h2>
                <p className="mt-1 text-sm text-muted">关闭 APP 后重新打开即生效。</p>
              </div>
            </div>
            <button type="button" className="btn btn-primary w-full min-h-11" onClick={restartApp}>
              <RefreshCw size={18} />立即重启
            </button>
          </div>
        );

      case "apk-update-available": {
        const am = state.manifest;
        return (
          <div className="space-y-4" role="alertdialog" aria-modal="true" aria-labelledby="apk-title">
            <div className="flex items-start gap-3 pr-1">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShieldCheck size={24} />
              </span>
              <div>
                <h2 id="apk-title" className="text-xl font-black text-ink">系统更新 {am.latestVersionName}</h2>
                <p className="mt-1 text-sm text-muted">
                  {am.forceUpdate ? "当前版本已停止支持。" : "需要下载完整安装包，约 27MB。"}
                </p>
              </div>
            </div>
            {am.releaseNotes.length > 0 && (
              <ul className="list-disc space-y-1 rounded-2xl bg-slate-50 px-8 py-4 text-sm leading-6 text-ink">
                {am.releaseNotes.map((note: string, i: number) => <li key={`${i}-${note}`}>{note}</li>)}
              </ul>
            )}
            <div className={`grid gap-2 ${am.forceUpdate ? "grid-cols-1" : "grid-cols-2"}`}>
              {!am.forceUpdate && (
                <button type="button" className="btn btn-secondary min-h-11" onClick={() => setState(null)}>稍后</button>
              )}
              <button type="button" className="btn btn-primary min-h-11" onClick={() => { void installApk(am); }}>
                <Download size={18} />立即更新
              </button>
            </div>
            <p className="text-center text-xs text-muted">APK 仅从官方 OSS 下载，安装由系统确认。</p>
          </div>
        );
      }

      case "apk-installing":
        return (
          <div className="space-y-4 text-center" role="alertdialog" aria-modal="true">
            <RefreshCw size={36} className="mx-auto animate-spin text-emerald-700" />
            <h2 className="text-lg font-black text-ink">正在启动下载…</h2>
          </div>
        );

      case "apk-download-started":
        return (
          <div className="space-y-4 text-center" role="alertdialog" aria-modal="true">
            <ShieldCheck size={36} className="mx-auto text-emerald-700" />
            <h2 className="text-lg font-black text-ink">下载已启动</h2>
            <p className="text-sm text-muted">完成后在通知栏中点击安装。</p>
            <button type="button" className="btn btn-secondary min-h-11" onClick={() => setState(null)}>关闭</button>
          </div>
        );

      case "error":
        return (
          <div className="space-y-4 text-center" role="alertdialog" aria-modal="true">
            <h2 className="text-lg font-black text-ink">更新失败</h2>
            <p className="text-sm text-muted">{state.message}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary min-h-11" onClick={() => setState(null)}>取消</button>
              <button type="button" className="btn btn-primary min-h-11" onClick={() => { void checkForUpdates(); }}>
                <RefreshCw size={18} />重试
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <Modal onClose={dismissIfAllowed} hideClose={state?.phase === "hot-update-downloading" || state?.phase === "hot-update-extracting" || state?.phase === "hot-update-done"}>
      {renderContent()}
    </Modal>
  );
}
