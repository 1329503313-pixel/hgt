import type { CSSProperties } from "react";
import { getLevelTitle, normalizeLevel } from "../shared/levelSystem";

function getStarCount(level: number) {
  if (level >= 11 && level <= 15) return level - 10;
  if (level === 39) return 4;
  if (level === 40) return 5;
  return 0;
}

const RAIN_PARTICLES = [
  ["5%", "-.08s", ".68s", ".46rem"], ["13%", "-.51s", ".82s", ".36rem"],
  ["21%", "-.24s", ".74s", ".42rem"], ["29%", "-.69s", ".88s", ".32rem"],
  ["37%", "-.36s", ".71s", ".48rem"], ["45%", "-.12s", ".84s", ".34rem"],
  ["53%", "-.58s", ".76s", ".4rem"], ["61%", "-.31s", ".9s", ".3rem"],
  ["69%", "-.73s", ".7s", ".46rem"], ["77%", "-.43s", ".8s", ".34rem"],
  ["85%", "-.18s", ".86s", ".4rem"], ["93%", "-.62s", ".72s", ".32rem"],
  ["17%", "-.77s", ".92s", ".3rem"], ["41%", "-.47s", ".78s", ".38rem"],
  ["65%", "-.04s", ".89s", ".3rem"], ["89%", "-.39s", ".75s", ".38rem"],
] as const;

function getRainCount(level: number) {
  return level >= 26 && level <= 30 ? 8 + (level - 26) * 2 : 0;
}

export function LevelBadge({ level, className = "" }: { level: number; className?: string }) {
  const normalized = normalizeLevel(level);
  const animated = normalized >= 11 ? " level-badge--animated" : "";
  const stars = getStarCount(normalized);
  const rainCount = getRainCount(normalized);
  return (
    <span className={`level-badge level-badge--${normalized}${animated} ${className}`.trim()} aria-label={`等级 ${normalized} ${getLevelTitle(normalized)}`}>
      {stars > 0 && <span className="level-badge__stars" aria-hidden="true">{Array.from({ length: stars }, (_, index) => <i key={index} />)}</span>}
      {(normalized >= 16 && normalized <= 20) || normalized === 40 ? <span className="level-badge__shine" aria-hidden="true" /> : null}
      {normalized >= 21 && normalized <= 25 ? <span className="level-badge__blotches" aria-hidden="true"><i /><i /><i /><i /></span> : null}
      {rainCount > 0 ? (
        <span className="level-badge__rain" aria-hidden="true">
          {RAIN_PARTICLES.slice(0, rainCount).map(([x, delay, duration, size], index) => (
            <i key={index} style={{ "--rain-x": x, "--rain-delay": delay, "--rain-duration": duration, "--rain-size": size } as CSSProperties}>✦</i>
          ))}
        </span>
      ) : null}
      {normalized >= 31 && normalized <= 35 ? <span className="level-badge__rings" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</span> : null}
      <span className="level-badge__label">Lv{normalized}</span>
    </span>
  );
}
