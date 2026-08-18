import type { EquippedBadge, VipLevel } from "../shared/types";
import { EquippedBadgeIcon } from "./BadgeVisuals";
import { LevelBadge } from "./LevelBadge";
import { VipIcon, VipName } from "./VipVisuals";

export function VipIdentity({
  nickname,
  userLevel,
  level,
  active,
  vipLevel,
  vipActive,
  equippedBadge,
  className = "",
  iconClassName = "h-4 w-4",
  badgeClassName = "h-4 w-4",
  animated = false
}: {
  nickname: string;
  userLevel?: number;
  level?: VipLevel | number;
  active?: boolean;
  vipLevel?: VipLevel | number;
  vipActive?: boolean;
  equippedBadge?: EquippedBadge | null;
  className?: string;
  iconClassName?: string;
  badgeClassName?: string;
  animated?: boolean;
}) {
  const resolvedLevel = vipLevel ?? level ?? 0;
  const resolvedActive = vipActive ?? active ?? resolvedLevel > 0;
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <VipName nickname={nickname} level={resolvedLevel} active={resolvedActive} className="min-w-0 truncate" />
      <VipIcon level={resolvedLevel} active={resolvedActive} className={iconClassName} animated={animated} />
      <LevelBadge level={userLevel ?? 0} />
      {equippedBadge && <EquippedBadgeIcon badge={equippedBadge} className={badgeClassName} animated={animated} />}
    </span>
  );
}
