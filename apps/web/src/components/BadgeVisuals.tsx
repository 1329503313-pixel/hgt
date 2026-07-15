const BADGE_ASSET_URLS: Record<string, string> = {
  "/badges/ai-clear-epic.png": "/badges/ai-clear-epic.d17e481128.webp",
  "/badges/ai-clear-normal.png": "/badges/ai-clear-normal.c8235d1a20.webp",
  "/badges/ai-clear-rare.png": "/badges/ai-clear-rare.4a53501976.webp",
  "/badges/commenter-epic.png": "/badges/commenter-epic.9784f504e4.webp",
  "/badges/commenter-normal.png": "/badges/commenter-normal.694fa39006.webp",
  "/badges/commenter-rare.png": "/badges/commenter-rare.beb3e686d2.webp",
  "/badges/creator-favorite-epic.png": "/badges/creator-favorite-epic.10131f5f1a.webp",
  "/badges/creator-favorite-normal.png": "/badges/creator-favorite-normal.b81e5c423d.webp",
  "/badges/creator-favorite-rare.png": "/badges/creator-favorite-rare.2a237cfd08.webp",
  "/badges/creator-like-epic.png": "/badges/creator-like-epic.c379d483e3.webp",
  "/badges/creator-like-normal.png": "/badges/creator-like-normal.e8868ef42e.webp",
  "/badges/creator-like-rare.png": "/badges/creator-like-rare.2a418d621d.webp",
  "/badges/favorite-epic.png": "/badges/favorite-epic.ff673d8c49.webp",
  "/badges/favorite-normal.png": "/badges/favorite-normal.5187dbccf6.webp",
  "/badges/favorite-rare.png": "/badges/favorite-rare.67d5394500.webp",
  "/badges/founder-turtle-legend.png": "/badges/founder-turtle-legend.b557ad37cf.webp",
  "/badges/insight-epic.png": "/badges/insight-epic.380ce14f05.webp",
  "/badges/insight-normal.png": "/badges/insight-normal.de9ad0c3aa.webp",
  "/badges/insight-rare.png": "/badges/insight-rare.277c428d82.webp",
  "/badges/like-epic.png": "/badges/like-epic.e2eaa6f9cf.webp",
  "/badges/like-normal.png": "/badges/like-normal.1ea3d8c772.webp",
  "/badges/like-rare.png": "/badges/like-rare.f32a126d99.webp",
  "/badges/login-epic.png": "/badges/login-epic.d76c028abe.webp",
  "/badges/login-normal.png": "/badges/login-normal.b2a0b3eba0.webp",
  "/badges/login-rare.png": "/badges/login-rare.a4656e00f3.webp",
  "/badges/publish-epic.png": "/badges/publish-epic.3aef6c6c7e.webp",
  "/badges/publish-normal.png": "/badges/publish-normal.461916aaa1.webp",
  "/badges/publish-rare.png": "/badges/publish-rare.a3fa51c97f.webp",
  "/badges/received-comment-epic.png": "/badges/received-comment-epic.26358f013a.webp",
  "/badges/received-comment-normal.png": "/badges/received-comment-normal.31f3f0b897.webp",
  "/badges/received-comment-rare.png": "/badges/received-comment-rare.db9b793453.webp"
};

export type LegendaryBadge = {
  id: string;
  key: string;
  name: string;
  description: string;
  requirement: string | null;
  iconUrl: string;
  achievementPoints: number;
  tier: "legend";
  ownerCount?: number;
};

export type EquippedBadgeVisual = {
  key: string;
  iconUrl: string;
};

export function versionBadgeAssetUrl(url: string) {
  const [pathname] = url.split("?", 1);
  return BADGE_ASSET_URLS[pathname] ?? url;
}

export function LegendaryBadgeIcon({ badge, className = "h-16 w-16" }: { badge: LegendaryBadge; className?: string }) {
  return (
    <div className={`legendary-badge-icon relative shrink-0 overflow-hidden rounded-2xl bg-white shadow-soft ${className}`}>
      <img className="h-full w-full object-cover" src={versionBadgeAssetUrl(badge.iconUrl)} alt={badge.name} loading="lazy" decoding="async" draggable={false} />
    </div>
  );
}

export function LegendaryBadgeTile({ badge, onClick }: { badge: LegendaryBadge; onClick?: () => void }) {
  const content = (
    <>
      <LegendaryBadgeIcon badge={badge} />
      <span className="text-xs font-semibold leading-tight text-ink">{badge.name}</span>
      <span className="badge-legend-text text-[11px] font-black">传说</span>
    </>
  );
  return onClick ? (
    <button type="button" className="flex flex-col items-center gap-1.5 rounded-xl text-center transition active:scale-95" onClick={onClick} aria-label={`检视徽章：${badge.name}`}>
      {content}
    </button>
  ) : (
    <div className="flex flex-col items-center gap-1.5 text-center">{content}</div>
  );
}

export function EquippedBadgeIcon({
  badge,
  className = "h-4 w-4",
  title = "已装配徽章",
  animated = false
}: {
  badge: EquippedBadgeVisual | null | undefined;
  className?: string;
  title?: string;
  animated?: boolean;
}) {
  if (!badge) return null;
  const legendary = badge.key.startsWith("legendary:");
  return (
    <span
      className={`${legendary ? `legendary-badge-icon bg-white shadow-sm ${animated ? "" : "equipped-badge-static"}` : ""} relative inline-flex shrink-0 overflow-hidden rounded-md align-middle ${className}`}
      title={title}
      aria-label={title}
    >
      <img className="h-full w-full object-cover" src={versionBadgeAssetUrl(badge.iconUrl)} alt="" loading="lazy" decoding="async" draggable={false} />
    </span>
  );
}
