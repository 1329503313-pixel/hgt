import { cardBattleStatusCategory } from "@hgt/shared";
import { useId, type CSSProperties } from "react";
import { CARD_BATTLE_MOTIONS, CARD_BATTLE_PROC_MOTIONS, CARD_BATTLE_STATUS_GLYPHS, type BattleGlyphName, type BattleMotion } from "../shared/cardBattleMotion";
import { CARD_BATTLE_STATUS_ORDER, cardBattleStatusText, type CardBattleStatus } from "../shared/cardBattleEffects";
import type { OnlineCardBattleEvent } from "../shared/types";

export function BattleGlyph({ name }: { name: BattleGlyphName }) {
  const clipId = useId().replace(/:/g, "");
  const shield = <path d="M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6Z" />;
  const heart = <path d="M12 21 3.4 12.5C-2 7 5 0 10 5l2 2 2-2c5-5 12 2 6.6 7.5Z" />;
  const sword = <><path d="m7 14 11-12 4 1-1 4L10 18M4 12l8 8M2 22l6-6" /><path d="m11 13 7-7" /></>;
  const wings = <><path className="battle-glyph-left" d="M11 18C9 8 4 7 1 3v9l3-1-2 5 4-1 1 5Z" /><path className="battle-glyph-right" d="M13 18c2-10 7-11 10-15v9l-3-1 2 5-4-1-1 5Z" /><path d="M12 11v11" /></>;
  const fracture = <path className="battle-glyph-fracture" d="m13 1-4 7 6 3-6 4 4 8" />;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="battle-glyph">
    {(name === "blood" || name === "blood-block") && <><path d="M12 2C10 7 5 10 5 15a7 7 0 0 0 14 0c0-5-5-8-7-13Z" fill="currentColor" fillOpacity=".2" /><path d="M9 15a3 3 0 0 0 3 3" />{name === "blood-block" && <path d="m2 3 20 18" strokeWidth="3" />}</>}
    {(name === "dizzy" || name === "dizzy-block") && <><ellipse cx="12" cy="13" rx="10" ry="5" strokeDasharray="3 3" /><path d="m6 1 1.3 3.5H11L8 7l1 4-3-2.5L3 11l1-4-3-2.5h3.7Zm12 10 1 3h3l-2.5 2 1 3L18 17l-2.5 2 1-3-2.5-2h3Z" fill="currentColor" fillOpacity=".25" />{name === "dizzy-block" && <path d="m2 2 20 20" strokeWidth="3" />}</>}
    {(name === "repeat" || name === "repeat-block") && <><path d="M20 8a9 9 0 0 0-15-3L2 8m0-6v6h6M4 16a9 9 0 0 0 15 3l3-3m0 6v-6h-6M10 8l6 4-6 4Z" />{name === "repeat-block" && <path d="m2 2 20 20" strokeWidth="3" />}</>}
    {name === "fire" && <><path d="M13 1c4 6-2 8 2 11 2-2 3-4 3-6 7 8 4 17-6 17C2 23 0 14 7 7c-1 5 2 6 3 3s2-6 3-9Z" fill="currentColor" fillOpacity=".2" /><path d="M12 13c5 5 4 9 0 9s-5-4 0-9Z" /></>}
    {name === "ice" && <><path d="M12 1v22M2.5 6.5l19 11M2.5 17.5l19-11M8 3l4 4 4-4M8 21l4-4 4 4M2 11l5-2-1-5M22 13l-5 2 1 5" /></>}
    {name === "bolt" && <path d="m14 1-11 13h8l-1 9L22 9h-9Z" fill="currentColor" fillOpacity=".25" />}
    {(name === "heal" || name === "heal-block") && <><path d="M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z" fill="currentColor" fillOpacity=".15" />{name === "heal-block" && <path d="M2 2 22 22" strokeWidth="3" />}</>}
    {name === "energy" && <><circle cx="12" cy="12" r="8" /><path d="m13 5-6 9h5l-1 5 6-9h-5ZM3 2l2 2m14 16 2 2" /></>}
    {name === "shield" && <>{shield}<path d="m7 12 3 3 7-7" /></>}
    {name === "broken-shield" && <><defs><clipPath id={`${clipId}-left`}><path d="M0 0h13L9 8l6 3-6 4 4 9H0Z" /></clipPath><clipPath id={`${clipId}-right`}><path d="M13 0h11v24H13l-4-9 6-4-6-3Z" /></clipPath></defs><g className="battle-glyph-shard-left"><g clipPath={`url(#${clipId}-left)`}>{shield}</g></g><g className="battle-glyph-shard-right"><g clipPath={`url(#${clipId}-right)`}>{shield}</g></g>{fracture}</>}
    {(name === "sword" || name === "broken-sword") && <g className={name === "broken-sword" ? "battle-glyph-breaking" : undefined}>{sword}{name === "broken-sword" && <path d="m8 7 8 3-3 5 8 3" strokeWidth="2.5" />}</g>}
    {name === "arcane" && <>{sword}<path d="m5 1 1 3 3 1-3 1-1 3-1-3-3-1 3-1ZM18 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" /></>}
    {(name === "wings" || name === "frozen-wings") && <>{wings}{name === "frozen-wings" && <path d="M5 3 19 21M19 3 5 21M2 12h20" />}</>}
    {(name === "heart" || name === "broken-heart") && <g className={name === "broken-heart" ? "battle-glyph-breaking" : undefined}>{heart}{name === "broken-heart" ? fracture : <path d="M8 12h8m-4-4v8" />}</g>}
    {name === "phoenix" && <>{wings}<path d="m9 8 3-6 3 6-3 3ZM9 18l-3 5m9-5 3 5" /><circle cx="12" cy="7" r="6" strokeDasharray="2 3" /></>}
  </svg>;
}

export function CardBattleStatusIcons({ statuses }: { statuses: CardBattleStatus[] }) {
  if (!statuses.length) return null;
  const sorted = [...statuses].sort((a, b) => CARD_BATTLE_STATUS_ORDER.indexOf(a.type) - CARD_BATTLE_STATUS_ORDER.indexOf(b.type));
  return <div className="card-battle-status-rail" role="list" aria-label={`卡牌状态，共${sorted.length}层，可横向滚动`} tabIndex={0}>
    {sorted.map((status, index) => <span key={`${status.type}:${index}`} role="listitem" className={`card-battle-status-icon ${(status.category ?? cardBattleStatusCategory(status.type)) === "debuff" ? "is-debuff" : "is-buff"}`} title={cardBattleStatusText(status)} aria-label={cardBattleStatusText(status)} data-status-type={status.type} data-status-category={status.category ?? cardBattleStatusCategory(status.type)}>
      <BattleGlyph name={CARD_BATTLE_STATUS_GLYPHS[status.type]} />
      <small>{status.remainingRounds ?? "∞"}</small>
    </span>)}
  </div>;
}

export function CardBattleSkillFx({ event, instanceId }: { event: OnlineCardBattleEvent | null; instanceId: string }) {
  if (!event || event.kind !== "skill") return null;
  // Older persisted games still get semantic effects without inventing a gameplay type.
  const fallback = event.visual === "revive" ? "revive_ally_1" : event.visual === "heal" ? "heal_self" : event.visual === "energy" ? "energy_self" : event.visual === "buff" ? "attack_self" : "damage_single";
  const spec = CARD_BATTLE_MOTIONS[event.effectType ?? fallback];
  const targetIndex = event.effects.findIndex((effect) => effect.targetId === instanceId);
  const caster = event.actorId === instanceId;
  if (!spec || targetIndex < 0 && !caster) return null;
  const sourceOnly = targetIndex < 0;
  return <BattleFx spec={spec} durationMs={event.durationMs} effectType={event.effectType ?? fallback} sourceOnly={sourceOnly} targetIndex={targetIndex} />;
}

export function CardBattleProcFx({ event, instanceId }: { event: OnlineCardBattleEvent | null; instanceId: string }) {
  if (!event) return null;
  const actor = event.actorId === instanceId;
  const stunned = event.effects.some((effect) => effect.targetId === instanceId && effect.stunned);
  return <>
    {actor && Boolean(event.lifesteal) && <BattleFx spec={CARD_BATTLE_PROC_MOTIONS.lifesteal} durationMs={event.durationMs} effectType="lifesteal" />}
    {(stunned || actor && event.kind === "stun") && <BattleFx spec={CARD_BATTLE_PROC_MOTIONS.stun} durationMs={event.durationMs} effectType="stun" />}
    {actor && event.kind === "extra_action" && <BattleFx spec={CARD_BATTLE_PROC_MOTIONS.extra_action} durationMs={event.durationMs} effectType="extra_action" />}
  </>;
}

function BattleFx({ spec, durationMs, effectType, sourceOnly = false, targetIndex = 0 }: { spec: BattleMotion; durationMs: number; effectType: string; sourceOnly?: boolean; targetIndex?: number }) {
  return <div aria-hidden="true" data-skill-effect={effectType} data-motion={spec.motion} data-pattern={spec.pattern} className={`card-battle-skill-fx motion-${spec.motion} pattern-${spec.pattern} ${sourceOnly ? "is-source" : "is-target"}`} style={{ "--skill-color": spec.color, "--skill-duration": `${durationMs}ms`, "--skill-target-index": Math.max(0, targetIndex) } as CSSProperties}>
    <i className="card-battle-skill-ring" />
    <i className="card-battle-skill-wave" />
    <span className="card-battle-skill-symbol"><BattleGlyph name={spec.glyph} /></span>
    {Array.from({ length: Math.max(3, spec.count + 2) }, (_, index) => <span key={index} className="card-battle-skill-particle" style={{ "--particle-angle": `${index * 360 / Math.max(3, spec.count + 2)}deg`, "--particle-index": index } as CSSProperties}><BattleGlyph name={spec.glyph} /></span>)}
  </div>;
}
