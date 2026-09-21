import type { CardBattleBondActionType } from "@hgt/shared";
import { CARD_BATTLE_MOTIONS, type BattleMotion } from "./cardBattleMotion";
import type { OnlineCardBattleEvent } from "./types";

export type FxQuality = "standard" | "economy";
export type FxFamily = "slash" | "fire" | "ice" | "lightning" | "arcane" | "pierce" | "heal" | "energy" | "armor" | "shield" | "attack" | "skill" | "skill_attack" | "focus" | "speed" | "life" | "critical" | "precision" | "dodge" | "blood" | "stun" | "time" | "counter" | "debuff" | "immunity" | "cleanse" | "seal" | "revive" | "neutral";
export const BOND_FX_FAMILIES: Record<CardBattleBondActionType, FxFamily> = {
  attack: "slash", skill: "arcane", act_again: "time", attack_up: "attack", skill_damage_up: "skill",
  attack_skill_damage_up: "skill_attack", defense_up: "armor", speed_up: "speed", max_hp_up: "life",
  heal: "heal", energy: "energy", extra_action_up: "time", lifesteal_up: "blood", stun_up: "stun",
  speed_down: "debuff", shield: "shield", dodge_up: "dodge", hit_up: "precision", crit_rate_up: "focus", crit_damage_up: "critical",
};
export const FX_MATERIALS = {
  slash: "/card-battle-fx/slash-v1.webp", fire: "/card-battle-fx/fire-v1.webp", revive: "/card-battle-fx/revive-v1.webp",
} as const;
export const FX_BUDGET = { standard: { particles: 24, perTarget: 6 }, economy: { particles: 8, perTarget: 2 } } as const;
export const cardBattleImpactMs = (duration: number) => Math.max(120, Math.round(duration * .55));

export function effectFamily(type: string, spec?: BattleMotion): FxFamily {
  if (type.startsWith("damage_true_")) return "pierce";
  if (type.startsWith("damage_")) return spec?.glyph === "ice" ? "ice" : spec?.glyph === "bolt" ? "lightning" : spec?.glyph === "arcane" ? "arcane" : "fire";
  if (type.includes("_down_")) return "debuff";
  if (type.startsWith("revival_block")) return "seal";
  if (type.startsWith("revive_")) return "revive";
  if (type.startsWith("immunity_")) return "immunity";
  if (type.startsWith("cleanse_")) return "cleanse";
  if (type.startsWith("shield_")) return "shield";
  if (type.startsWith("defense_")) return "armor";
  if (type.startsWith("attack_skill")) return "skill_attack";
  if (type.startsWith("attack_")) return "attack";
  if (type.startsWith("max_hp_")) return "life";
  if (type.startsWith("heal_")) return "heal";
  if (type.startsWith("energy_")) return "energy";
  if (type.startsWith("speed_")) return "speed";
  if (type.startsWith("lifesteal_")) return "blood";
  if (type.startsWith("stun_")) return "stun";
  if (type.startsWith("counter_")) return "counter";
  if (type === "act_again" || type.startsWith("extra_action_")) return "time";
  if (type.startsWith("dodge_")) return "dodge";
  if (type.startsWith("hit_")) return "precision";
  return "neutral";
}

// Legacy buff records deliberately remain neutral, rather than pretending that
// every missing type granted attack. Text and actual states remain authoritative.
const fallback: Record<OnlineCardBattleEvent["visual"], FxFamily> = {
  damage: "slash", heal: "heal", energy: "energy", buff: "neutral", debuff: "debuff", revive: "revive",
  extra_action: "time", stun: "stun", round: "neutral", end: "neutral",
};
export function eventFx(event: OnlineCardBattleEvent) {
  // An attack keeps its identity even when triggered by a bond or replayed
  // with legacy skill metadata. Outcome feedback is a separate layer.
  if (event.kind === "attack") return { family: "slash" as FxFamily, spec: undefined, color: "#ffe1a4", pattern: "single" };
  const spec = event.effectType ? CARD_BATTLE_MOTIONS[event.effectType] : undefined;
  const action = event.bond?.actionType;
  const family = spec ? effectFamily(event.effectType!, spec)
    : action && BOND_FX_FAMILIES[action] ? BOND_FX_FAMILIES[action] : fallback[event.visual];
  const colors: Partial<Record<FxFamily, string>> = { slash: "#ffe1a4", critical: "#ffe1a4", heal: "#80ebba", energy: "#71d9ff", blood: "#ff7696", revive: "#ffe6b0", stun: "#f5d894", debuff: "#d492b5", seal: "#e78fad", pierce: "#e4cfff", cleanse: "#a4eedf", immunity: "#bdcaff" };
  return { family, spec, color: colors[family] ?? spec?.color ?? "#b9d3ee", pattern: event.bond ? "actual" : spec?.pattern ?? "single" };
}

export function fxParticles(event: OnlineCardBattleEvent, instanceId: string, quality: FxQuality) {
  // Distribute a fixed budget among the actual targets and caster, including
  // nine-card BOSS teams. Procs never allocate another particle set.
  const ids = [...new Set([...event.effects.filter(e => !e.dodged).map(e => e.targetId), ...(event.actorId ? [event.actorId] : [])])];
  const index = ids.indexOf(instanceId);
  if (index < 0) return [];
  const { perTarget } = FX_BUDGET[quality];
  const particles = Math.max(0, FX_BUDGET[quality].particles - (event.lifesteal ? 4 : 0) - (event.bond ? 2 : 0));
  const count = Math.min(perTarget, Math.floor(particles / Math.max(1, ids.length)) + (index < particles % ids.length ? 1 : 0));
  if (event.kind === "attack") {
    // Fixed impact sparks across rounds/cards; economy keeps the same first
    // two sparks instead of redistributing every angle when quality changes.
    return [
      { x: -28, y: 22, angle: -38, size: 3 }, { x: 30, y: -26, angle: -38, size: 3 },
      { x: -38, y: 8, angle: -18, size: 2 }, { x: 39, y: -9, angle: -18, size: 2 },
      { x: -12, y: 34, angle: -65, size: 2 }, { x: 14, y: -36, angle: -65, size: 2 },
    ].slice(0, count);
  }
  let seed = 2166136261;
  for (const char of `${event.sequence}:${instanceId}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const angle = (i * 360 / count + seed % 40) * Math.PI / 180;
    const radius = 24 + seed % 36;
    return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius), angle: seed % 180, size: 2 + seed % 3 };
  });
}

export function targetFeedback(event: OnlineCardBattleEvent, id: string) {
  const effect = event.effects.find(e => e.targetId === id);
  if (!effect) return null;
  if (effect.dodged) return "dodge";
  if (effect.protection) return effect.protection;
  if (effect.stunResisted && event.visual !== "damage") return "resisted";
  if (event.visual === "damage") {
    if (effect.shieldDamage) return event.states.find(s => s.instanceId === id)?.shield === 0 ? "shield-break" : "shield-hit";
    if (effect.blocked) return "blocked";
  }
  return null;
}
