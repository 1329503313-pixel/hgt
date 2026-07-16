type CacheEnvelope<T> = { savedAt: number; value: T };

export function readSessionCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CacheEnvelope<T>;
    if (!cached.savedAt || Date.now() - cached.savedAt > maxAgeMs) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cached.value;
  } catch {
    return null;
  }
}

export function writeSessionCache<T>(key: string, value: T) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value } satisfies CacheEnvelope<T>));
  } catch {
    // Storage may be unavailable or full; the page still works without caching.
  }
}

export function removeSessionCache(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* ignore unavailable storage */ }
}

export function removeSessionCachePrefix(prefix: string) {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore unavailable storage.
  }
}
