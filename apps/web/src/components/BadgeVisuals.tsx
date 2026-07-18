export type BadgeType = "achievement" | "activity" | "limited";

export type ActivityConditionKind =
  | "login"
  | "user_joined"
  | "publish"
  | "like_given"
  | "comment_given"
  | "favorite_given"
  | "like_received"
  | "comment_received"
  | "favorite_received";

export type ActivityBadgeCondition = {
  kind: ActivityConditionKind;
  startDate: string;
  endDate: string;
  target?: number;
};

export const BADGE_TYPE_LABELS: Record<BadgeType, string> = {
  achievement: "成就徽章",
  activity: "活动徽章",
  limited: "限定徽章"
};

export const ACTIVITY_CONDITION_LABELS: Record<ActivityConditionKind, string> = {
  login: "登录平台",
  user_joined: "用户加入时间",
  publish: "发布海龟汤",
  like_given: "点赞",
  comment_given: "发布评论",
  favorite_given: "收藏",
  like_received: "收获点赞",
  comment_received: "收获评论",
  favorite_received: "收获收藏"
};

export function activityConditionText(condition: ActivityBadgeCondition) {
  const count = ["login", "user_joined"].includes(condition.kind) ? "" : `达到 ${condition.target ?? 1} 次`;
  const range = condition.startDate === "long_term" || condition.endDate === "long_term"
    ? "长期有效"
    : `${condition.startDate} 至 ${condition.endDate}`;
  return `${range} ${ACTIVITY_CONDITION_LABELS[condition.kind]}${count}`;
}

export type LegendaryBadge = {
  id: string;
  key: string;
  name: string;
  description: string;
  requirement: string | null;
  iconUrl: string;
  achievementPoints: number;
  ownershipRate?: number;
  badgeType: BadgeType;
  activityConditions: ActivityBadgeCondition[];
  unlockedAt?: string | null;
  tier: "epic" | "legend";
  ownerCount?: number;
};

export type EquippedBadgeVisual = {
  key: string;
  iconUrl: string;
  name: string;
  tier: "normal" | "rare" | "epic" | "legend";
};

export function versionBadgeAssetUrl(url: string) {
  const [pathname, query] = url.split("?", 2);
  if (!pathname.startsWith("/badges/") || !pathname.toLowerCase().endsWith(".png")) return url;
  return `${pathname.slice(0, -4)}.webp${query ? `?${query}` : ""}`;
}

export function LegendaryBadgeIcon({ badge, className = "h-16 w-16" }: { badge: LegendaryBadge; className?: string }) {
  const legendary = badge.tier === "legend";
  return (
    <div className={`${legendary ? "legendary-badge-icon" : "ring-2 ring-amber-300 bg-amber-50"} relative shrink-0 overflow-hidden rounded-2xl bg-white shadow-soft ${className}`}>
      <img className="h-full w-full object-cover" src={versionBadgeAssetUrl(badge.iconUrl)} alt={badge.name} loading="lazy" decoding="async" draggable={false} />
    </div>
  );
}

export function LegendaryBadgeTile({ badge, onClick }: { badge: LegendaryBadge; onClick?: () => void }) {
  const content = (
    <>
      <LegendaryBadgeIcon badge={badge} />
      <span className="text-xs font-semibold leading-tight text-ink">{badge.name}</span>
      <span className={`${badge.tier === "legend" ? "badge-legend-text" : "text-amber-600"} text-[11px] font-black`}>{badge.tier === "legend" ? "传说" : "史诗"}</span>
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
  animated = false,
  showName = true
}: {
  badge: EquippedBadgeVisual | null | undefined;
  className?: string;
  title?: string;
  animated?: boolean;
  showName?: boolean;
}) {
  if (!badge) return null;
  const legendary = badge.tier === "legend";
  const icon = (
    <span
      className={`${legendary ? `legendary-badge-icon bg-white shadow-sm ${animated ? "" : "equipped-badge-static"}` : ""} relative inline-flex shrink-0 overflow-hidden rounded-md align-middle ${className}`}
      title={title}
      aria-label={title}
    >
      <img className="h-full w-full object-cover" src={versionBadgeAssetUrl(badge.iconUrl)} alt="" loading="lazy" decoding="async" draggable={false} />
    </span>
  );
  if (!showName) return icon;
  const nameColor = badge.tier === "legend"
    ? "badge-legend-text"
    : badge.tier === "epic"
      ? "text-amber-600"
      : badge.tier === "rare"
        ? "text-purple-600"
        : "text-blue-600";
  return (
    <span className="inline-flex shrink-0 items-center gap-1 align-middle" title={`${badge.name} · ${badge.tier === "legend" ? "传说" : badge.tier === "epic" ? "史诗" : badge.tier === "rare" ? "稀有" : "普通"}`}>
      {icon}
      <span className={`${nameColor} whitespace-nowrap py-px text-[11px] font-black leading-[1.4]`}>{badge.name}</span>
    </span>
  );
}
