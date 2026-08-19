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
  showUserLevel = true,
  className = "",
  inactiveNicknameClassName = "text-ink",
  iconClassName = "h-4 w-4",
  badgeClassName = "h-4 w-4",
  preserveNickname = false,
  animated = false
}: {
  nickname: string;
  userLevel?: number;
  level?: VipLevel | number;
  active?: boolean;
  vipLevel?: VipLevel | number;
  vipActive?: boolean;
  equippedBadge?: EquippedBadge | null;
  showUserLevel?: boolean;
  className?: string;
  inactiveNicknameClassName?: string;
  iconClassName?: string;
  badgeClassName?: string;
  preserveNickname?: boolean;
  animated?: boolean;
}) {
  const resolvedLevel = vipLevel ?? level ?? 0;
  const resolvedActive = vipActive ?? active ?? resolvedLevel > 0;
  const nicknameNode = <VipName nickname={nickname} level={resolvedLevel} active={resolvedActive} inactiveClassName={inactiveNicknameClassName} className={preserveNickname ? "whitespace-nowrap" : "min-w-0 truncate"} />;
  const vipNode = <VipIcon level={resolvedLevel} active={resolvedActive} className={iconClassName} animated={animated} />;
  const levelNode = showUserLevel && userLevel != null ? <LevelBadge level={userLevel} /> : null;
  const badgeNode = equippedBadge ? <EquippedBadgeIcon badge={equippedBadge} className={badgeClassName} animated={animated} /> : null;

  if (preserveNickname) {
    return (
      <span className={`flex min-w-0 items-center ${className}`} title={nickname}>
        <span className="min-w-0 shrink-[1] truncate">{nicknameNode}</span>
        {resolvedActive && <span className="min-w-0 shrink-[10] overflow-hidden pl-1.5">{vipNode}</span>}
        {levelNode && <span className="min-w-0 shrink-[100] overflow-hidden pl-1.5">{levelNode}</span>}
        {badgeNode && <span className="min-w-0 shrink-[1000] overflow-hidden pl-1.5">{badgeNode}</span>}
      </span>
    );
  }

  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      {nicknameNode}
      {vipNode}
      {levelNode}
      {badgeNode}
    </span>
  );
}
