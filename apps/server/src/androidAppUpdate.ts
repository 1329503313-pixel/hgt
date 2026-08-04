export type AndroidReleaseManifest = {
  enabled: boolean;
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  apkUrl: string;
  releaseNotes: string[];
  publishedAt: string;
};

export type AndroidReleaseRecord = AndroidReleaseManifest & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type AndroidUpdateResult = AndroidReleaseManifest & {
  platform: "android";
  updateAvailable: boolean;
  forceUpdate: boolean;
};

export const emptyAndroidReleaseManifest: AndroidReleaseManifest = {
  enabled: false,
  latestVersionCode: 0,
  latestVersionName: "",
  minSupportedVersionCode: 0,
  apkUrl: "",
  releaseNotes: [],
  publishedAt: ""
};

function stringList(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isoDate(value: unknown): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function mapAndroidReleaseRow(row: Record<string, unknown>): AndroidReleaseRecord {
  return {
    id: String(row.id ?? ""),
    enabled: Boolean(row.enabled),
    latestVersionCode: Number(row.version_code ?? 0),
    latestVersionName: String(row.version_name ?? ""),
    minSupportedVersionCode: Number(row.min_supported_version_code ?? 0),
    apkUrl: String(row.apk_url ?? ""),
    releaseNotes: stringList(row.release_notes),
    publishedAt: isoDate(row.published_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at)
  };
}

export function resolveAndroidUpdate(
  currentVersionCode: number,
  manifest: AndroidReleaseManifest | null
): AndroidUpdateResult {
  const selected = manifest ?? emptyAndroidReleaseManifest;
  const releaseReady = selected.enabled
    && selected.apkUrl.startsWith("https://")
    && selected.latestVersionCode > 0;
  const updateAvailable = releaseReady && currentVersionCode < selected.latestVersionCode;
  return {
    ...selected,
    platform: "android",
    updateAvailable,
    forceUpdate: updateAvailable && currentVersionCode < selected.minSupportedVersionCode
  };
}
