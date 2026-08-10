const SERVER_MEDIA_PREFIXES = ["/api/media/", "/api/banners/"] as const;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function isServerMediaPath(value: string) {
  return SERVER_MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function resolveServerMediaUrl(value: string, apiOrigin: string) {
  if (!value || !isServerMediaPath(value)) return value;
  const origin = trimTrailingSlash(apiOrigin.trim());
  return origin ? `${origin}${value}` : value;
}

export function normalizeServerMediaUrls<T>(value: T, apiOrigin: string): T {
  if (!apiOrigin) return value;
  if (typeof value === "string") return resolveServerMediaUrl(value, apiOrigin) as T;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeServerMediaUrls(item, apiOrigin)) as T;
  }
  if (value && typeof value === "object") {
    const normalized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeServerMediaUrls(item, apiOrigin)])
    );
    return normalized as T;
  }
  return value;
}
