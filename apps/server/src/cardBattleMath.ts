import { cardBattleStatusOrder, type CardBattleStatus, type CardBattleStatusType } from "./cardBattleStatus.js";
import type { CardBattleProcStat, CardBattleProcStats } from "@hgt/shared";

export type CardBattleBuffStat = "attack" | "skillDamage" | "defense" | "speed" | "maxHp" | "healingReceived" | CardBattleProcStat | "stunned";
export type CardBattleBuff = { stat: CardBattleBuffStat; value: number; expiresAfterRound: number; debuff?: boolean };

/** In insertion order, separately by polarity: the oldest surviving layer is full strength. */
export function cardBattleBuffBonus(buffs: readonly CardBattleBuff[], stat: CardBattleBuffStat, debuff = false) {
  let first = true;
  let total = 0;
  for (const buff of buffs) {
    if (buff.stat !== stat || buff.value <= 0 || Boolean(buff.debuff) !== debuff) continue;
    total += buff.value * (first ? 1 : .5);
    first = false;
  }
  return debuff || ["lifestealRate", "stunRate", "extraActionRate"].includes(stat) ? total : Math.round(total);
}

/** Rate modifiers are percentage points, not a percentage of the base rate. */
export function cardBattleEffectiveProc(stats: CardBattleProcStats, buffs: readonly CardBattleBuff[], stat: CardBattleProcStat) {
  return Math.min(100, Math.max(0, (stats[stat] ?? 0) + cardBattleBuffBonus(buffs, stat) - cardBattleBuffBonus(buffs, stat, true)));
}

export function cardBattleLifesteal(damage: number, rate: number) {
  return Math.round(Math.max(0, damage) * Math.min(100, Math.max(0, rate)) / 100);
}

export function cardBattleEffectiveStat(base: number, buffs: readonly CardBattleBuff[], stat: CardBattleBuffStat, minimum = 0) {
  const positive = base + cardBattleBuffBonus(buffs, stat);
  const reduction = Math.min(100, cardBattleBuffBonus(buffs, stat, true));
  return Math.max(minimum, Math.round(positive * (1 - reduction / 100)));
}

export function cardBattleStatuses(buffs: readonly CardBattleBuff[], round: number): CardBattleStatus[] {
  const statuses: CardBattleStatus[] = [];
  const counts = new Map<CardBattleStatusType, number>();
  for (const buff of buffs) {
    if (buff.value <= 0 || buff.expiresAfterRound < round) continue;
    if (buff.stat === "stunned") {
      statuses.push({ type: "stunned", value: 1, multiplier: 1, remainingRounds: 1 });
      continue;
    }
    // The two components of an attack+skill-damage debuff share one status icon.
    if (buff.debuff && buff.stat === "skillDamage") continue;
    const type: CardBattleStatusType | undefined = buff.debuff
      ? ({ attack: "attack_skill_damage_down", defense: "defense_down", speed: "speed_down", maxHp: "max_hp_down", healingReceived: "healing_received_down", lifestealRate: "lifesteal_down", stunRate: "stun_down", extraActionRate: "extra_action_down" } as const)[buff.stat as Exclude<CardBattleBuffStat, "skillDamage" | "stunned">]
      : ({ attack: "attack_up", skillDamage: "skill_damage_up", defense: "defense_up", speed: "speed_up", maxHp: "max_hp_up", lifestealRate: "lifesteal_up", stunRate: "stun_up", extraActionRate: "extra_action_up" } as const)[buff.stat as Exclude<CardBattleBuffStat, "healingReceived" | "stunned">];
    if (!type) continue;
    const remainingRounds = Number.isFinite(buff.expiresAfterRound) ? Math.max(1, buff.expiresAfterRound - round + 1) : null;
    const multiplier = counts.has(type) ? .5 : 1;
    statuses.push({ type, value: buff.value, multiplier, remainingRounds });
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return statuses.sort((left, right) => cardBattleStatusOrder.indexOf(left.type) - cardBattleStatusOrder.indexOf(right.type));
}

/** Uses the caster's percentages; old frozen lineups receive the same preset. */
export function rollCardBattleCritical(stats: { critRate?: number; critDamage?: number }, random: () => number) {
  const critical = random() < (stats.critRate ?? 25) / 100;
  return { critical, multiplier: critical ? (stats.critDamage ?? 150) / 100 : 1 };
}

/** One deterministic draw per target hit, applied before defense. */
export function rollCardBattleDamage(baseDamage: number, defense: number, hp: number, random: () => number) {
  const incomingDamage = Math.round(Math.max(0, baseDamage) * (.98 + random() * .04));
  const damage = Math.min(hp, Math.max(0, Math.round(incomingDamage - defense)));
  return { incomingDamage, damage };
}
