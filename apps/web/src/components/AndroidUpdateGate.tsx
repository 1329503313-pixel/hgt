import { useCallback, useEffect, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";
import { downloadAndInstallAndroidUpdate, getAndroidUpdate, type AndroidUpdateManifest, IS_NATIVE_ANDROID } from "../android/platform";
import { useApp } from "../context/AppContext";

export function AndroidUpdateGate() {
  const { showToast } = useApp();
  const [release, setRelease] = useState<AndroidUpdateManifest | null>(null);
  const [installing, setInstalling] = useState(false);
  const [downloadStarted, setDownloadStarted] = useState(false);

  const check = useCallback(async () => {
    try {
      const next = await getAndroidUpdate();
      if (next?.updateAvailable) setRelease(next);
    } catch {
      // 版本检查失败不阻断现有版本使用；强制更新由服务端在成功响应时决定。
    }
  }, []);

  useEffect(() => {
    if (!IS_NATIVE_ANDROID) return;
    void check();
    const onActive = (event: Event) => {
      if ((event as CustomEvent<{ isActive: boolean }>).detail?.isActive) void check();
    };
    window.addEventListener("hgt:app-state", onActive);
    return () => window.removeEventListener("hgt:app-state", onActive);
  }, [check]);

  if (!release) return null;

  async function install() {
    if (installing || !release) return;
    setInstalling(true);
    try {
      await downloadAndInstallAndroidUpdate(release.apkUrl);
      setDownloadStarted(true);
      showToast("新版 APK 正在下载，完成后将打开系统安装页");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("INSTALL_PERMISSION_REQUIRED")) {
        showToast("请允许“安装未知应用”，返回后再次点击立即更新");
      } else {
        showToast(message || "更新下载失败，请稍后重试");
      }
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Modal onClose={() => { if (!release.forceUpdate) setRelease(null); }} hideClose={release.forceUpdate}>
      <div className="space-y-4" role="alertdialog" aria-modal="true" aria-labelledby="android-update-title">
        <div className="flex items-start gap-3 pr-1">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><ShieldCheck size={24} /></span>
          <div>
            <h2 id="android-update-title" className="text-xl font-black text-ink">发现新版本 {release.latestVersionName}</h2>
            <p className="mt-1 text-sm text-muted">{release.forceUpdate ? "当前版本已停止支持，更新后才能继续使用。" : "建议更新以获得完整功能与体验。"}</p>
          </div>
        </div>
        {release.releaseNotes.length > 0 && (
          <ul className="list-disc space-y-1 rounded-2xl bg-slate-50 px-8 py-4 text-sm leading-6 text-ink">
            {release.releaseNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
          </ul>
        )}
        <div className={`grid gap-2 ${release.forceUpdate ? "grid-cols-1" : "grid-cols-2"}`}>
          {!release.forceUpdate && <button type="button" className="btn btn-secondary min-h-11" onClick={() => setRelease(null)} disabled={installing}>稍后</button>}
          <button type="button" className="btn btn-primary min-h-11" onClick={() => void install()} disabled={installing || downloadStarted}>
            <Download size={18} />{downloadStarted ? "下载中，请查看通知" : installing ? "正在启动下载…" : "立即更新"}
          </button>
        </div>
        <p className="text-center text-xs text-muted">APK 仅从官方 OSS 下载，安装由 Android 系统确认。</p>
      </div>
    </Modal>
  );
}
