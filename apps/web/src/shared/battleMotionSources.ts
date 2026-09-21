export type BattleMotionSource = { url: string; type: string };
type Rendition = BattleMotionSource & { width: number; height: number; bitrate: number; framerate: number };
const cache = new Map<string, Promise<BattleMotionSource[]>>();

/** A missing/older server or unavailable rendition always falls back to original media. */
export function battleMotionSources(mp4: string, webm: string | null | undefined, pixels: number): Promise<BattleMotionSource[]> {
  const original: BattleMotionSource[] = [{ url: mp4, type: "video/mp4" }, ...(webm ? [{ url: webm, type: "video/webm" }] : [])];
  const width = [256, 512, 768].find(size => size >= pixels);
  let url: URL;
  try { url = new URL(mp4, document.baseURI); } catch { return Promise.resolve(original); }
  if (!width || !/\/api\/media\/assets\/cards\/[^/]+\/motion\/mp4$/.test(url.pathname)) return Promise.resolve(original);
  url.pathname = url.pathname.replace(/mp4$/, "renditions"); url.searchParams.set("width", String(width));
  const key = url.href;
  const existing = cache.get(key); if (existing) return existing;
  let expire: number;
  const deadline = new Promise<BattleMotionSource[]>(resolve => { expire = window.setTimeout(() => resolve(original), 1000); });
  const load = (async () => {
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 800);
    try {
      const response = await fetch(key, { credentials: "include", signal: controller.signal });
      if (!response.ok) return original;
      const data: { sources?: Rendition[] } = await response.json();
      const options = await Promise.all((data.sources ?? []).map(async source => {
        if (!source.width || !source.height || !source.bitrate || !source.framerate) return null;
        let score = 0;
        try {
          const info = await navigator.mediaCapabilities?.decodingInfo({ type: "file", video: { contentType: source.type, width: source.width, height: source.height, bitrate: source.bitrate, framerate: source.framerate } });
          if (info && !info.supported) return null;
          score = info ? Number(info.smooth) + Number(info.powerEfficient) * 2 : 0;
        } catch { /* browser native source fallback */ }
        return { url: new URL(source.url, url).href, type: source.type, score };
      }));
      const available = options.filter((source): source is NonNullable<typeof source> => Boolean(source)).sort((a, b) => b.score - a.score);
      return available.length ? [...available, ...original] : original;
    } catch { return original; }
    finally { window.clearTimeout(timer); }
  })();
  const bounded = Promise.race([load, deadline]).finally(() => window.clearTimeout(expire));
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, bounded);
  // Retry cold/missing variants on a later mount, never replace a playing source.
  void bounded.then(result => { if (result === original) cache.delete(key); });
  return bounded;
}
