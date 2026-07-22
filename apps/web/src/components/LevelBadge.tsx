import { normalizeLevel } from "../shared/levelSystem";

export function LevelBadge({ level, animated = false, className = "" }: { level: number; animated?: boolean; className?: string }) {
  const normalized = normalizeLevel(level);
  const motion = animated && normalized >= 19 ? " level-badge--animated" : "";
  return <span className={`level-badge level-badge--${normalized}${motion} ${className}`.trim()} aria-label={`等级 ${normalized}`}>Lv{normalized}</span>;
}
