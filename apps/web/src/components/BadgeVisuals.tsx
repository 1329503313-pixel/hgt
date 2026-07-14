export const BADGE_ASSET_VERSION = "20260714-legend1";

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
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${BADGE_ASSET_VERSION}`;
}

export function LegendaryBadgeIcon({ badge, className = "h-16 w-16" }: { badge: LegendaryBadge; className?: string }) {
  return (
    <div className={`legendary-badge-icon relative shrink-0 overflow-hidden rounded-2xl bg-white shadow-soft ${className}`}>
      <img className="h-full w-full object-cover" src={versionBadgeAssetUrl(badge.iconUrl)} alt={badge.name} draggable={false} />
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
  title = "已装配徽章"
}: {
  badge: EquippedBadgeVisual | null | undefined;
  className?: string;
  title?: string;
}) {
  if (!badge) return null;
  const legendary = badge.key.startsWith("legendary:");
  return (
    <span
      className={`${legendary ? "legendary-badge-icon bg-white shadow-sm" : ""} relative inline-flex shrink-0 overflow-hidden rounded-md align-middle ${className}`}
      title={title}
      aria-label={title}
    >
      <img className="h-full w-full object-cover" src={versionBadgeAssetUrl(badge.iconUrl)} alt="" draggable={false} />
    </span>
  );
}
