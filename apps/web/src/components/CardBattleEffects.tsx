import { cardBattleStatusCategory } from "@hgt/shared";
import { useId, type CSSProperties } from "react";
import { useCardBattleFx } from "./CardBattleFxContext";
import { eventFx, fxParticles, targetFeedback, FX_MATERIALS, type FxFamily } from "../shared/cardBattleFx";
import { CARD_BATTLE_PROC_MOTIONS, CARD_BATTLE_STATUS_GLYPHS, type BattleGlyphName, type BattleMotion } from "../shared/cardBattleMotion";
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


// Compound paths keep every family recognizable without multiplying SVG nodes.
const motifs: Record<FxFamily, string> = {
  slash: 'M8 80Q36 12 94 16Q43 25 8 80ZM21 84 84 29',
  fire: 'M50 6C70 35 45 35 67 51L76 30C104 77 69 96 48 93C10 89 15 55 32 33L30 62Q52 55 50 6ZM49 60Q70 82 49 91Q30 82 49 60',
  ice: 'M50 5 61 43 91 25 67 54 95 73 60 64 50 97 40 64 6 74 33 54 9 25 40 43ZM50 5V97M9 25 95 73M91 25 6 74',
  lightning: 'M62 0 19 54H47L37 100 84 41H56ZM12 22 24 34 9 52M83 59 94 73 83 91',
  arcane: 'M50 6 90 28V73L50 96 10 73V28ZM50 17 77 64H23ZM50 83 23 36H77Z',
  pierce: 'M50 0 55 40 93 50 55 54 50 100 45 55 7 50 45 45ZM30 26 50 18 70 26M30 74 50 82 70 74',
  heal: 'M44 26H56V44H74V56H56V74H44V56H26V44H44ZM12 85Q70 68 19 44M88 83Q30 64 81 25',
  energy: 'M59 13 29 54H49L40 88 73 43H53ZM19 34A35 35 0 0 1 82 35M81 66A35 35 0 0 1 18 65',
  armor: 'M50 10 83 27 78 65 50 91 22 65 17 27ZM50 10V91M17 27 50 44 83 27M22 65 50 44 78 65',
  shield: 'M50 7 87 22 80 66 50 94 20 66 13 22ZM50 18 75 29 70 61 50 80 30 61 25 29Z',
  attack: 'M20 79 71 14 86 11 85 27 30 84ZM18 60 42 83M15 90 27 77',
  skill: 'M50 5 58 36 89 44 58 52 50 84 42 52 11 44 42 36ZM76 64 80 75 92 79 80 83 76 95 72 83 60 79 72 75Z',
  skill_attack: 'M15 85 69 10 84 8 83 26 26 88M14 62 43 85M69 49 74 63 89 68 74 73 69 89 64 73 49 68 64 63Z',
  focus: 'M50 10 59 38 88 50 59 62 50 91 41 62 12 50 41 38ZM27 13 17 27M73 13 83 27M73 87 83 73M27 87 17 73',
  speed: 'M45 50Q21 15 5 12L12 52 37 73M55 50Q79 15 95 12L88 52 63 73M15 31 37 54M85 31 63 54M50 40V89',
  life: 'M50 83 20 55C-6 19 32 6 50 31C68 6 106 19 80 55ZM30 51H42L49 39 57 64 64 51H77',
  critical: 'M50 5 57 32 82 18 68 42 97 50 68 58 82 82 57 68 50 97 43 68 18 82 32 58 3 50 32 42 18 18 43 32Z',
  precision: 'M50 17A33 33 0 1 1 49.9 17M50 3V29M50 71V97M3 50H29M71 50H97M40 50 48 58 64 38',
  dodge: 'M9 40Q46 14 86 34M16 58Q52 34 95 53M10 76Q41 54 77 72',
  blood: 'M50 7C38 34 23 49 23 67A27 27 0 0 0 77 67C77 49 62 34 50 7ZM36 64Q33 78 47 82',
  stun: 'M17 58C-9 36 106 29 88 60C77 84 11 78 17 58ZM31 11 35 23 48 23 38 31 42 43 31 36 20 43 24 31 14 23 27 23ZM78 59 82 69 94 71 84 78 86 90 77 83 67 89 70 77 62 69 74 68Z',
  time: 'M79 30A35 35 0 1 0 84 66M79 10V30H59M50 27V51L67 62',
  counter: 'M82 75Q97 24 41 32V13L7 43 41 71V51Q78 43 82 75Z',
  debuff: 'M18 15H82V85H18ZM57 13 42 37 62 48 37 64 50 88M7 37 19 43M81 57 94 64',
  immunity: 'M50 6 88 25 81 69 50 95 19 69 12 25ZM32 51 45 64 70 36M4 9 14 18M86 81 96 90',
  cleanse: 'M50 7 57 40 90 47 57 54 50 87 43 54 10 47 43 40ZM14 84 31 72M74 21 90 9',
  seal: 'M50 8A42 42 0 1 1 49.9 8M21 21 79 79M79 21 21 79M35 35H65V65H35Z',
  revive: 'M50 3V95M15 67Q28 32 44 51L50 74 56 51Q72 32 85 67M20 90Q50 72 80 90M37 21 50 9 63 21',
  neutral: 'M50 15 85 50 50 85 15 50ZM50 29 71 50 50 71 29 50Z',
};
export function FxMotif({ family }: { family: FxFamily }) {
  return <svg className="card-battle-fx-motif" viewBox="0 0 100 100" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><path d={motifs[family]} /></svg>;
}
export function CardBattleSkillFx({ event, instanceId }: { event: OnlineCardBattleEvent | null; instanceId: string }) {
  const context = useCardBattleFx();
  if (!event || !context.visible || !['skill','attack'].includes(event.kind)) return null;
  const target = event.effects.find(e => e.targetId === instanceId);
  const caster = event.actorId === instanceId;
  if (!target && !caster) return null;
  const recipe = eventFx(event);
  const feedback = targetFeedback(event, instanceId);
  const family: FxFamily = feedback === 'dodge' ? 'dodge' : feedback === 'resisted' || feedback === 'invincible' ? 'immunity' : feedback === 'death_protection' ? 'life' : feedback === 'blocked' ? 'armor' : feedback?.startsWith('shield') ? 'shield' : event.counterattack && caster ? 'counter' : recipe.family;
  return <BattleFx key={context.eventKey+':'+event.sequence+':'+instanceId} event={event} instanceId={instanceId} family={family} color={recipe.color} spec={recipe.spec} effectType={event.effectType ?? (event.bond?.actionType ? 'bond:'+event.bond.actionType : event.kind)} sourceOnly={!target} feedback={feedback} />;
}
export function CardBattleProcFx({ event, instanceId }: { event: OnlineCardBattleEvent | null; instanceId: string }) {
  const context = useCardBattleFx();
  if (!event || !context.visible) return null;
  const actor = event.actorId === instanceId;
  const stunned = event.effects.some(e => e.targetId === instanceId && e.stunned);
  return <>
    {actor && Boolean(event.lifesteal) && <BattleFx key={context.eventKey+':'+event.sequence+':blood'} event={event} instanceId={instanceId} family="blood" color="#ff7696" spec={CARD_BATTLE_PROC_MOTIONS.lifesteal} effectType="lifesteal" compact />}
    {(stunned || actor && event.kind === 'stun') && <BattleFx key={context.eventKey+':'+event.sequence+':stun'} event={event} instanceId={instanceId} family="stun" color="#f5d894" spec={CARD_BATTLE_PROC_MOTIONS.stun} effectType="stun" compact />}
    {actor && event.kind === 'extra_action' && <BattleFx key={context.eventKey+':'+event.sequence+':time'} event={event} instanceId={instanceId} family="time" color="#9cdced" spec={CARD_BATTLE_PROC_MOTIONS.extra_action} effectType="extra_action" compact />}
  </>;
}
function BattleFx({ event, instanceId, family, color, spec, effectType, sourceOnly = false, feedback, compact = false }: { event: OnlineCardBattleEvent; instanceId: string; family: FxFamily; color: string; spec?: BattleMotion; effectType: string; sourceOnly?: boolean; feedback?: string | null; compact?: boolean }) {
  const { quality, reduced } = useCardBattleFx();
  const dense = event.effects.length > 9 || event.effects.length > 6 && event.effects.some(e=>e.stunned);
  const detailed = quality === 'standard' && !dense;
  if (compact && (quality === 'economy' || dense)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${motifs[family]}" fill="none" stroke="${color}" stroke-width="3"/></svg>`;
    return <i aria-hidden="true" data-skill-effect={effectType} data-fx-family={family} className={`card-battle-skill-fx card-battle-fx-compact-mark family-${family}`} style={{ backgroundImage:`url("data:image/svg+xml,${encodeURIComponent(svg)}")` }} />;
  }
  const texture = !compact && !sourceOnly && !feedback && !reduced && detailed && family in FX_MATERIALS ? FX_MATERIALS[family as keyof typeof FX_MATERIALS] : null;
  const particles = compact || sourceOnly || feedback || reduced || dense && quality === 'economy' ? [] : fxParticles(event,instanceId,quality);
  const critical = !compact && !feedback && event.effects.some(e=>e.targetId===instanceId && e.critical);
  const broken: Partial<Record<BattleGlyphName,FxFamily>> = { 'broken-shield':'armor', 'broken-heart':'life', 'broken-sword':'attack', 'frozen-wings':'speed', 'heal-block':'heal', 'blood-block':'blood', 'dizzy-block':'stun', 'repeat-block':'time' };
  const motif = family === 'debuff' && spec ? broken[spec.glyph] ?? family : family;
  return <div aria-hidden="true" data-skill-effect={effectType} data-fx-family={family} data-feedback={feedback ?? undefined} data-critical={critical || undefined} data-motion={spec?.motion ?? 'impact'} data-pattern={event.bond ? 'actual' : spec?.pattern ?? 'single'} data-quality={quality} className={'card-battle-skill-fx family-'+family+(sourceOnly?' is-source':' is-target')+(compact?' is-compact':'')+(reduced?' is-reduced':'')} style={{'--skill-color':color,'--skill-duration':event.durationMs+'ms'} as CSSProperties}>
    {!compact && detailed && <i className="card-battle-fx-aura" />}
    <FxMotif family={motif} />
    {texture && <i className="card-battle-fx-texture" style={{backgroundImage:'url("'+texture+'")'}} />}
    {detailed && (feedback === 'shield-break' || family === 'debuff') && <svg className="card-battle-fx-fracture" viewBox="0 0 100 100"><path d="m55 8-17 28 22 12-29 18 20 28" fill="none" stroke="currentColor" strokeWidth="3" /></svg>}
    {critical && detailed && <i className="card-battle-fx-critical" />}
    {particles.map((p,i)=><i key={i} className="card-battle-fx-particle" style={{'--fx-x':p.x+'px','--fx-y':p.y+'px','--fx-angle':p.angle+'deg',width:p.size,height:p.size} as CSSProperties} />)}
  </div>;
}
