import type { CSSProperties, ReactNode } from "react";
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

function vipPalette(level: number) {
  if (level >= 7) return "from-fuchsia-500 via-amber-300 to-cyan-400";
  if (level >= 5) return "from-fuchsia-500 via-amber-300 to-cyan-400";
  return "from-amber-300 via-yellow-500 to-amber-700";
}

function shapeForLevel(level: number): ReactNode {
  const pointsByLevel = [
    "50,4 61,27 87,27 67,43 75,70 50,55 25,70 33,43 13,27 39,27",
    "50,2 60,24 84,16 68,37 91,50 64,52 62,77 50,59 38,77 36,52 9,50 32,37 16,16 40,24",
    "50,3 56,20 76,8 68,29 93,32 72,43 86,65 62,55 50,80 38,55 14,65 28,43 7,32 32,29 24,8 44,20",
    "50,2 58,20 79,11 70,31 94,39 70,45 81,70 58,57 50,82 42,57 19,70 30,45 6,39 30,31 21,11 42,20",
    "50,2 61,18 82,13 70,32 91,50 69,55 70,78 50,63 30,78 31,55 9,50 30,32 18,13 39,18",
    "50,2 57,20 76,5 72,27 96,30 76,43 91,64 67,55 61,81 50,61 39,81 33,55 9,64 24,43 4,30 28,27 24,5 43,20",
    "50,2 58,22 80,10 69,31 92,36 68,42 78,64 57,53 50,76 43,53 22,64 32,42 8,36 31,31 20,10 42,22",
    "50,1 56,18 73,4 72,24 94,18 78,35 98,45 76,49 88,72 66,57 50,84 42,58 22,76 29,51 3,57 25,41 5,19 29,29 27,5 44,20",
    "50,1 57,19 72,3 73,23 94,8 81,32 99,30 84,45 99,62 78,56 88,83 64,65 50,98 43,67 23,87 32,61 5,72 22,48 1,35 27,36 18,9 42,24"
  ];
  const points = pointsByLevel[Math.min(9, Math.max(1, Math.floor(level))) - 1];
  return <polygon points={points} />;
}

export function VipIcon({ level, active = true, className = "h-4 w-4", animated = true }: { level: number; active?: boolean; className?: string; animated?: boolean }) {
  const normalized = Math.min(9, Math.max(0, Math.floor(Number(level) || 0)));
  if (!active || normalized < 1) return null;
  return (
    <span
      className={`vip-icon inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${vipPalette(normalized)} ${animated && normalized >= 7 ? "vip-icon-animated" : ""} ${className}`}
      title={`VIP${normalized}`}
      aria-label={`VIP${normalized}`}
      style={{ "--vip-level": normalized } as CSSProperties}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true" className="h-[78%] w-[78%] fill-white drop-shadow-[0_1px_1px_rgba(120,53,15,0.45)]">
        {shapeForLevel(normalized)}
      </svg>
    </span>
  );
}

export function vipNicknameClass(level: number, active = true) {
  if (!active || level < 1) return "text-ink";
  if (level >= 7) return "vip-name-rainbow";
  if (level >= 5) return "vip-name-spectrum";
  return "vip-name-gold";
}

export function VipName({ nickname, level, active = true, className = "", children }: { nickname?: string; level: number; active?: boolean; className?: string; children?: ReactNode }) {
  return <span className={`${vipNicknameClass(level, active)} ${className}`}>{children ?? nickname}</span>;
}
