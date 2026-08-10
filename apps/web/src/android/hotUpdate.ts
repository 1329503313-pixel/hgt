import { IS_ANDROID_APP } from "../runtime";

export type HotUpdateManifest = {
  platform: "android";
  updateAvailable: boolean;
  latestVersionCode: number;
  latestVersionName: string;
  zipUrl: string;
  zipSize: number;
  zipSha256: string;
  releaseNotes: string[];
  publishedAt: string;
};

export async function checkForHotUpdate(currentVersionCode: number): Promise<HotUpdateManifest | null> {
  if (!IS_ANDROID_APP) return null;
  try {
    const response = await fetch(
      `${window.location.origin}/api/app/web-resource-update?versionCode=${currentVersionCode}`,
      { credentials: "include", cache: "no-store", headers: { Accept: "application/json" } }
    );
    if (!response.ok) return null;
    const data = await response.json() as HotUpdateManifest;
    return data.updateAvailable ? data : null;
  } catch {
    return null;
  }
}

export async function downloadHotUpdate(
  url: string,
  expectedSha256: string,
  onProgress?: (received: number, total: number) => void
): Promise<string> {
  if (!IS_ANDROID_APP) throw new Error("仅 Android APP 支持热更新");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  let received = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取下载数据");

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.length;
      chunks.push(value);
      onProgress?.(received, contentLength > 0 ? contentLength : received);
    }
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hashHex !== expectedSha256) throw new Error("下载文件校验失败，请重试");

  // Convert to base64 for Capacitor Filesystem
  const base64 = btoa(String.fromCharCode(...combined));
  const path = `update-${Date.now()}.zip`;

  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Data,
    recursive: true
  });

  return path;
}

export async function extractAndVerifyHotUpdate(
  downloadedPath: string,
  versionCode: number
): Promise<string> {
  if (!IS_ANDROID_APP) throw new Error("仅 Android APP 支持热更新");

  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const record = {
    versionCode,
    directory: `hot-update/${versionCode}`,
    appliedAt: new Date().toISOString()
  };

  await Filesystem.writeFile({
    path: "hgt_hot_update_record.json",
    data: JSON.stringify(record),
    directory: Directory.Data,
    recursive: true
  });

  return record.directory;
}

export async function getActiveHotUpdateBundle(): Promise<{ versionCode: number; directory: string; appliedAt: string } | null> {
  if (!IS_ANDROID_APP) return null;
  try {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    const result = await Filesystem.readFile({
      path: "hgt_hot_update_record.json",
      directory: Directory.Data
    });
    return JSON.parse(String(result.data)) as { versionCode: number; directory: string; appliedAt: string };
  } catch {
    return null;
  }
}

export async function clearHotUpdateRecord(): Promise<void> {
  if (!IS_ANDROID_APP) return;
  try {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({
      path: "hgt_hot_update_record.json",
      directory: Directory.Data
    });
  } catch {
    // Already cleaned
  }
}
