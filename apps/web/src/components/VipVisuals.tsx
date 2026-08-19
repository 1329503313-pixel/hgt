import type { ReactNode } from "react";
import type { VipLevel } from "../shared/types";

export const VIP_THRESHOLDS = [0, 5, 300, 800, 1500, 2800, 4500, 7000, 10000, 15000] as const;

export function vipLevelForGrowth(value: number): VipLevel {
  const growth = Math.max(0, Math.floor(Number(value) || 0));
  let level = 0;
  for (let index = 1; index < VIP_THRESHOLDS.length; index += 1) {
    if (growth >= VIP_THRESHOLDS[index]) level = index;
    else break;
  }
  return level as VipLevel;
}

export function vipIconSource(level: number) {
  const normalized = Math.min(9, Math.max(0, Math.floor(Number(level) || 0)));
  return normalized < 1 ? null : `/vip/vip-${normalized}.webp`;
}

export function VipIcon({ level, active = true, className = "h-4 w-4", animated = true }: { level: number; active?: boolean; className?: string; animated?: boolean }) {
  const normalized = Math.min(9, Math.max(0, Math.floor(Number(level) || 0)));
  if (!active || normalized < 1) return null;
  const source = vipIconSource(normalized);
  return (
    <span
      className={`vip-icon inline-flex shrink-0 items-center justify-center ${animated && normalized >= 7 ? "vip-icon-animated" : ""} ${className}`}
      title={`VIP${normalized}`}
      aria-label={`VIP${normalized}`}
    >
      <img src={source ?? undefined} alt="" aria-hidden="true" draggable={false} className="h-full w-full select-none object-contain" />
    </span>
  );
}

export function vipNicknameClass(level: number, active = true) {
  if (!active || level < 1) return "text-ink";
  if (level >= 7) return "vip-name-rainbow";
  if (level >= 5) return "vip-name-spectrum";
  return "vip-name-gold";
}

export function VipName({ nickname, level, active = true, inactiveClassName = "text-ink", className = "", children }: { nickname?: string; level: number; active?: boolean; inactiveClassName?: string; className?: string; children?: ReactNode }) {
  const nicknameClassName = active && level >= 1 ? vipNicknameClass(level, active) : inactiveClassName;
  return <span className={`${nicknameClassName} ${className}`}>{children ?? nickname}</span>;
}
