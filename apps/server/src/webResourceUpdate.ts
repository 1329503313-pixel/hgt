export type WebResourceReleaseManifest = {
  enabled: boolean;
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  zipUrl: string;
  zipSize: number;
  zipSha256: string;
  releaseNotes: string[];
  publishedAt: string;
  deltaUrl?: string;
  deltaSize?: number;
  deltaSha256?: string;
  deltaBaseVersionCode?: number;
};

export type WebResourceReleaseRecord = WebResourceReleaseManifest & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type WebResourceUpdateResult = WebResourceReleaseManifest & {
  platform: "android";
  updateAvailable: boolean;
};

const emptyManifest: WebResourceReleaseManifest = {
  enabled: false,
  latestVersionCode: 0,
  latestVersionName: "",
  minSupportedVersionCode: 0,
  zipUrl: "",
  zipSize: 0,
  zipSha256: "",
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

export function mapWebResourceReleaseRow(row: Record<string, unknown>): WebResourceReleaseRecord {
  return {
    id: String(row.id ?? ""),
    enabled: Boolean(row.enabled),
    latestVersionCode: Number(row.version_code ?? 0),
    latestVersionName: String(row.version_name ?? ""),
    minSupportedVersionCode: Number(row.min_supported_version_code ?? 0),
    zipUrl: String(row.zip_url ?? ""),
    zipSize: Number(row.zip_size ?? 0),
    zipSha256: String(row.zip_sha256 ?? ""),
    releaseNotes: stringList(row.release_notes),
    publishedAt: isoDate(row.published_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at)
  };
}

export function resolveWebResourceUpdate(
  currentVersionCode: number,
  manifest: WebResourceReleaseManifest | null
): WebResourceUpdateResult {
  const selected = manifest ?? emptyManifest;
  const releaseReady = selected.enabled
    && selected.zipUrl.startsWith("https://")
    && selected.zipSha256.length === 64
    && selected.zipSize > 0
    && selected.latestVersionCode > 0;
  return {
    ...selected,
    platform: "android",
    updateAvailable: releaseReady && currentVersionCode < selected.latestVersionCode
  };
}
