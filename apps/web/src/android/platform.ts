import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { apiEndpoint, IS_ANDROID_APP, PUBLIC_SITE_ORIGIN } from "../runtime";
import { closeTopAndroidLayer } from "./backStack";

export type AndroidUpdateManifest = {
  platform: "android";
  enabled: boolean;
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  apkUrl: string;
  releaseNotes: string[];
  publishedAt: string;
  updateAvailable: boolean;
  forceUpdate: boolean;
};

type AndroidUpdatePlugin = {
  downloadAndInstall(options: { url: string }): Promise<{ downloadId: string }>;
};

const AndroidUpdate = registerPlugin<AndroidUpdatePlugin>("AndroidUpdate");

export const IS_NATIVE_ANDROID = IS_ANDROID_APP && Capacitor.getPlatform() === "android";

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const base64 = value.split(",", 2)[1];
      if (!base64) reject(new Error("图片编码失败"));
      else resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(-96);
  return cleaned || "hgt-share.png";
}

function webDownload(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareImage(options: { file: File; title: string; text: string }) {
  if (IS_NATIVE_ANDROID) {
    const path = `share/${Date.now()}-${safeFileName(options.file.name)}`;
    await Filesystem.writeFile({
      path,
      data: await fileToBase64(options.file),
      directory: Directory.Cache,
      recursive: true
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: options.title, text: options.text, files: [uri], dialogTitle: "分享到" });
    return "shared" as const;
  }

  if (navigator.share && navigator.canShare?.({ files: [options.file] })) {
    await navigator.share({ title: options.title, text: options.text, files: [options.file] });
    return "shared" as const;
  }
  webDownload(options.file);
  return "downloaded" as const;
}

export function isShareCancelled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function getAndroidUpdate(): Promise<AndroidUpdateManifest | null> {
  if (!IS_NATIVE_ANDROID) return null;
  const info = await App.getInfo();
  const versionCode = Number.parseInt(info.build, 10);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error("无法读取 APP 版本号");
  const response = await fetch(apiEndpoint(`/api/app/android-update?versionCode=${versionCode}`), {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("版本检查暂时不可用");
  return response.json() as Promise<AndroidUpdateManifest>;
}

export async function downloadAndInstallAndroidUpdate(apkUrl: string) {
  if (!IS_NATIVE_ANDROID) throw new Error("仅 Android APP 支持安装更新");
  return AndroidUpdate.downloadAndInstall({ url: apkUrl });
}

export function initializeAndroidPlatform() {
  if (!IS_NATIVE_ANDROID) return () => undefined;
  const removers: Array<() => Promise<void>> = [];
  let disposed = false;
  const keepListener = (handle: { remove: () => Promise<void> }) => {
    if (disposed) void handle.remove();
    else removers.push(() => handle.remove());
  };
  const openAppUrl = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl);
      const publicOrigin = new URL(PUBLIC_SITE_ORIGIN);
      if (url.protocol !== "https:" || url.host !== publicOrigin.host || url.pathname.startsWith("/admin")) return;
      const target = `${url.pathname}${url.search}${url.hash}`;
      window.history.pushState({}, "", target);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      // Ignore malformed or non-product deep links.
    }
  };

  void App.addListener("backButton", ({ canGoBack }) => {
    if (closeTopAndroidLayer()) return;
    if (canGoBack && window.location.pathname !== "/") window.history.back();
    else void App.exitApp();
  }).then(keepListener);

  void App.addListener("appStateChange", ({ isActive }) => {
    window.dispatchEvent(new CustomEvent("hgt:app-state", { detail: { isActive } }));
    if (isActive) {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  }).then(keepListener);

  void App.addListener("appUrlOpen", ({ url }) => openAppUrl(url)).then(keepListener);
  void App.getLaunchUrl().then((launch) => { if (!disposed && launch?.url) openAppUrl(launch.url); });

  const onClick = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest("a[target='_blank']") as HTMLAnchorElement | null;
    if (!anchor || !/^https:\/\//i.test(anchor.href)) return;
    event.preventDefault();
    void Browser.open({ url: anchor.href });
  };
  document.addEventListener("click", onClick, true);

  return () => {
    disposed = true;
    document.removeEventListener("click", onClick, true);
    for (const remove of removers) void remove();
  };
}
