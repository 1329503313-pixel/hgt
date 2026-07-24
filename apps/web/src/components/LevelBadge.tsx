import { normalizeLevel } from "../shared/levelSystem";

export function LevelBadge({ level, className = "" }: { level: number; className?: string }) {
  const normalized = normalizeLevel(level);
  const motion = normalized >= 19 ? " level-badge--animated" : "";
  return <span className={`level-badge level-badge--${normalized}${motion} ${className}`.trim()} aria-label={`等级 ${normalized}`}>Lv{normalized}</span>;
}
