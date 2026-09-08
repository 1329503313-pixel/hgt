import { cardBattleBuffBonus, cardBattleEffectiveStat, cardBattleStatuses, rollCardBattleDamage, rollCardBattleCritical, type CardBattleBuff } from "./cardBattleMath.js";
import { cardBattleDebuffCodes, cardBattleDebuff, isCardBattleDebuff, type CardBattleStatus } from "./cardBattleStatus.js";
import { applyBattleCollectibleStats, battleCollectibleBonus, calculateCardBattleScore, type BattleCollectible } from "@hgt/shared";
import { CARD_BATTLE_PROC_BUFF_CODES, CARD_BATTLE_PROC_STATS, cardBattleProcStat, type CardBattleProcStats } from "@hgt/shared";
import { cardBattleEffectiveProc, cardBattleLifesteal } from "./cardBattleMath.js";

export const CARD_BATTLE_MAX_ROUNDS = 30;
export const CARD_BATTLE_LINEUP_SIZE = 5;
export const CARD_BATTLE_MAX_TRIGGER_EFFECTS = 100;
export const CARD_BATTLE_MAX_EVENTS = 400;
export const CARD_BATTLE_MAX_PLAYBACK_MS = 7 * 60_000;

export function calculateCardBattlePower(stats: {
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  energyRequired: number;
}) {
  return stats.maxHp + stats.attack * 3 + stats.defense * 4 + stats.speed * 7 - stats.energyRequired * 10;
}

export const cardBattleRoleCodes = ["damage", "tank", "support"] as const;
export type CardBattleRole = typeof cardBattleRoleCodes[number];

export const cardBattleConditionCodes = [
  "energy_full",
  "self_death",
  "self_hp_below_percent",
  "normal_kill",
  "skill_kill",
  "ally_death",
  "self_death_energy_full",
  "self_hp_below_percent_energy_full",
  "normal_kill_energy_full",
  "skill_kill_energy_full",
  "ally_death_energy_full",
] as const;

export const cardBattleEffectCodes = [
  "damage_single",
  ...CARD_BATTLE_PROC_BUFF_CODES,
  ...cardBattleDebuffCodes,
  "damage_rear",
  "damage_random",
  "damage_all_front",
  "damage_all_rear",
  "damage_random_2",
  "damage_random_3",
  "damage_random_4",
  "damage_all",
  "heal_self",
  "heal_lowest_ally",
  "energy_self",
  "energy_lowest_ally",
  "heal_all_allies",
  "energy_all_allies",
  "defense_self",
  "defense_all_allies",
  "speed_self",
  "speed_all_allies",
  "max_hp_self",
  "max_hp_all_allies",
  "attack_self",
  "attack_all_allies",
  "attack_skill_damage_self",
  "attack_skill_damage_all_allies",
  "revive_self",
  "revive_ally_1",
  "revive_ally_2",
  "revive_ally_3",
  "revive_ally_4",
  "revive_all_allies",
] as const;

export type CardBattleConditionCode = typeof cardBattleConditionCodes[number];
export type CardBattleEffectCode = typeof cardBattleEffectCodes[number];

export type CardBattleSkillEffect = {
  id: string;
  order: number;
  condition: CardBattleConditionCode;
  conditionValue: number | null;
  type: CardBattleEffectCode;
  value: number | null;
  duration: number | null;
};

export type CardBattleTier = CardBattleProcStats & {
  starLevel: 0 | 1 | 2 | 3;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  energyRequired: number;
  critRate: number;
  critDamage: number;
  canAttackRear: boolean;
  skillName: string;
  skillDescription: string;
  effects: CardBattleSkillEffect[];
};

export type CardBattleDeckCard = {
  collectible?: BattleCollectible | null;
  instanceId: string;
  cardId: string;
  name: string;
  imageUrl: string;
  rarity: "epic" | "legend";
  battleRole: CardBattleRole;
  starLevel: 0 | 1 | 2 | 3;
  slot: 1 | 2 | 3 | 4 | 5;
  motionMp4Url: string | null;
  motionWebmUrl: string | null;
  motionPosterUrl: string | null;
  tier: CardBattleTier;
};

export type CardBattlePlayerInput = {
  userId: string;
  nickname: string;
  /** Personal seat is independent of the two combat factions. */
  playerSeat?: 1 | 2 | 3;
  seat: 1 | 2;
  cards: CardBattleDeckCard[];
};

export type CardBattlePublicCardState = CardBattleProcStats & {
  instanceId: string;
  userId: string;
  seat: 1 | 2;
  slot: 1 | 2 | 3 | 4 | 5;
  row: "front" | "rear";
  hp: number;
  maxHp: number;
  energy: number;
  energyRequired: number;
  attack: number;
  defense: number;
  speed: number;
  alive: boolean;
  damageDealt?: number;
  damageTaken?: number;
  healingDone?: number;
  statuses?: CardBattleStatus[];
};

export type CardBattleVisualEffect = {
  targetId: string;
  amount?: number;
  blocked?: boolean;
  critical?: boolean;
  stunned?: boolean;
  stunResisted?: boolean;
  label?: string;
};

export type CardBattleEvent = {
  sequence: number;
  round: number;
  kind: "round" | "attack" | "skill" | "end" | "extra_action" | "stun";
  visual: "round" | "damage" | "heal" | "energy" | "buff" | "debuff" | "revive" | "end" | "extra_action" | "stun";
  lifesteal?: number;
  extraAction?: boolean;
  effectType?: CardBattleEffectCode;
  actorId: string | null;
  skillName: string | null;
  effects: CardBattleVisualEffect[];
  states: CardBattlePublicCardState[];
  durationMs: number;
  text: string;
};

export type CardBattleSettlementCard = {
  slot: number;
  cardId: string;
  name: string;
  damageDealt: number;
  damageTaken: number;
  healingDone?: number;
  score?: number;
};

export type CardBattleSettlementPlayer = {
  userId: string;
  nickname: string;
  seat: 1 | 2;
  cards: CardBattleSettlementCard[];
};

export type CardBattleResult = {
  version: 1;
  mode?: "1v1" | "boss";
  winnerSeat: 1 | 2 | null;
  endReason: "elimination" | "round_limit" | "simultaneous_elimination" | "safety_limit" | "surrender";
  rounds: number;
  players: CardBattleSettlementPlayer[];
  initialStates: CardBattlePublicCardState[];
  finalStates: CardBattlePublicCardState[];
  events: CardBattleEvent[];
  playbackDurationMs: number;
};

type RuntimeCard = CardBattleDeckCard & {
  userId: string;
  seat: 1 | 2;
  row: "front" | "rear";
  hp: number;
  maxHp: number;
  energy: number;
  alive: boolean;
  buffs: CardBattleBuff[];
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  lifeTriggeredThresholds: Set<string>;
  revivedRound: number | null;
};

type TriggerKind = "self_death" | "hp_below" | "normal_kill" | "skill_kill" | "ally_death";
type Trigger = {
  kind: TriggerKind;
  cardId: string;
  actorId?: string;
  deadCardId?: string;
  root: number;
  energyFullAtTrigger: boolean;
};

export class CardBattleRuleError extends Error {}

function hashSeed(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seededRandom(seed: string) {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function effectiveStat(card: RuntimeCard, stat: "attack" | "defense" | "speed") {
  return cardBattleEffectiveStat(card.tier[stat], card.buffs, stat);
}

function effectiveSkillDamage(card: RuntimeCard, baseDamage: number) {
  return cardBattleEffectiveStat(baseDamage + battleCollectibleBonus(card.collectible, "skill_damage"), card.buffs, "skillDamage");
}

function collectibleProtection(card: RuntimeCard, type: "debuff_resistance" | "invincible" | "death_protection", round: number) {
  return battleCollectibleBonus(card.collectible, type) >= Math.max(1, round);
}

function protectedDamage(card: RuntimeCard, damage: number, round: number) {
  if (collectibleProtection(card, "invincible", round)) return 0;
  if (collectibleProtection(card, "death_protection", round)) return Math.min(damage, Math.max(0, card.hp - 1));
  return damage;
}

function publicState(card: RuntimeCard, round = 0): CardBattlePublicCardState {
  return {
    instanceId: card.instanceId,
    userId: card.userId,
    seat: card.seat,
    slot: card.slot,
    row: card.row,
    hp: card.hp,
    maxHp: card.maxHp,
    energy: card.energy,
    energyRequired: card.tier.energyRequired,
    attack: effectiveStat(card, "attack"),
    defense: effectiveStat(card, "defense"),
    speed: effectiveStat(card, "speed"),
    alive: card.alive,
    damageDealt: card.damageDealt,
    damageTaken: card.damageTaken,
    healingDone: card.healingDone,
    lifestealRate: cardBattleEffectiveProc(card.tier, card.buffs, "lifestealRate"),
    stunRate: cardBattleEffectiveProc(card.tier, card.buffs, "stunRate"),
    extraActionRate: cardBattleEffectiveProc(card.tier, card.buffs, "extraActionRate"),
    statuses: card.alive ? [...cardBattleStatuses(card.buffs, round), ...(["debuff_resistance", "invincible", "death_protection"] as const)
      .filter((type) => collectibleProtection(card, type, round))
      .map((type) => ({ type, value: battleCollectibleBonus(card.collectible, type), remainingRounds: battleCollectibleBonus(card.collectible, type) - Math.max(1, round) + 1, multiplier: 1 }))] : [],
  };
}

function isEnergyCondition(condition: CardBattleConditionCode) {
  return condition === "energy_full"
    || condition === "self_death_energy_full"
    || condition === "self_hp_below_percent_energy_full"
    || condition === "normal_kill_energy_full"
    || condition === "skill_kill_energy_full"
    || condition === "ally_death_energy_full";
}

function baseTriggerCondition(condition: CardBattleConditionCode): TriggerKind | "turn_energy" {
  if (condition === "energy_full") return "turn_energy";
  if (condition === "self_death" || condition === "self_death_energy_full") return "self_death";
  if (condition === "self_hp_below_percent" || condition === "self_hp_below_percent_energy_full") return "hp_below";
  if (condition === "normal_kill" || condition === "normal_kill_energy_full") return "normal_kill";
  if (condition === "skill_kill" || condition === "skill_kill_energy_full") return "skill_kill";
  return "ally_death";
}

function visualForEffect(type: CardBattleEffectCode): CardBattleEvent["visual"] {
  if (isCardBattleDebuff(type)) return "debuff";
  if (type.startsWith("damage_")) return "damage";
  if (type.startsWith("heal_")) return "heal";
  if (type.startsWith("energy_")) return "energy";
  if (type.startsWith("revive_")) return "revive";
  return "buff";
}

function effectLabel(type: CardBattleEffectCode, value: number) {
  const procStat = cardBattleProcStat(type);
  if (procStat) return `${CARD_BATTLE_PROC_STATS.find((stat) => stat.key === procStat)!.label} +${value}%`;
  if (type.startsWith("attack_skill_damage_")) return `攻击与技能伤害 +${value}`;
  if (type.startsWith("attack_")) return `攻击 +${value}`;
  if (type.startsWith("defense_")) return `防御 +${value}`;
  if (type.startsWith("speed_")) return `速度 +${value}`;
  if (type.startsWith("max_hp_")) return `生命上限 +${value}`;
  if (type.startsWith("energy_")) return `能量 +${value}`;
  if (type.startsWith("revive_")) return "复活";
  return "";
}

export function simulateCardBattle(players: CardBattlePlayerInput[], seed: string, mode: "1v1" | "boss" = "1v1"): CardBattleResult {
  const challengers = players.filter((player) => player.seat === 1);
  const bosses = players.filter((player) => player.seat === 2);
  if (mode === "boss" && (challengers.length < 1 || challengers.length > 3 || bosses.length !== 1
    || challengers.some((player) => player.cards.length !== 3 || new Set(player.cards.map((card) => card.cardId)).size !== 3)
    || bosses[0]!.cards.length !== 5 || new Set(players.map((player) => player.userId)).size !== players.length)) {
    throw new CardBattleRuleError("BOSS 对战需要一至三名玩家各携带三张不同卡牌，对阵五张 BOSS 卡牌");
  }
  if (mode === "1v1" && (players.length !== 2 || players.some((player) => player.cards.length !== CARD_BATTLE_LINEUP_SIZE))) {
    throw new CardBattleRuleError("卡牌对战必须由两名玩家各携带五张卡牌");
  }
  const ids = players.flatMap((player) => player.cards.map((card) => card.instanceId));
  if (new Set(ids).size !== ids.length) throw new CardBattleRuleError("战斗卡牌实例不能重复");
  const random = seededRandom(seed);
  const damageRandom = seededRandom(`${seed}:damage`);
  const criticalRandom = seededRandom(`${seed}:critical`);
  const stunRandom = seededRandom(`${seed}:stun`);
  const extraActionRandom = seededRandom(`${seed}:extra-action`);
  const cards: RuntimeCard[] = players.flatMap((player) => player.cards.map((baseCard) => {
    const card = { ...baseCard, tier: applyBattleCollectibleStats(baseCard.tier, baseCard.collectible) };
    return ({
    ...card,
    userId: player.userId,
    seat: player.seat,
    row: card.slot <= (mode === "boss" && player.seat === 1 ? 1 : 2) ? "front" : "rear",
    hp: card.tier.maxHp,
    maxHp: card.tier.maxHp,
    energy: 0,
    alive: true,
    buffs: [],
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    lifeTriggeredThresholds: new Set<string>(),
    revivedRound: null,
  }); }));
  let currentRound = 0;
  const initialStates = cards.map((card) => publicState(card, currentRound));
  const events: CardBattleEvent[] = [];
  let rootSequence = 0;
  const triggerEffectsByRoot = new Map<number, number>();
  let safetyStopped = false;
  let playbackDurationMs = 0;
  // The complete causal chain of an extra action is ineligible for more extras.
  const extraActionRoots = new Set<number>();
  const isStunned = (card: RuntimeCard) => card.buffs.some((buff) => buff.stat === "stunned" && buff.expiresAfterRound >= currentRound);

  const byId = (id: string) => cards.find((card) => card.instanceId === id)!;
  const allies = (card: RuntimeCard, aliveOnly = true) => cards.filter((candidate) => candidate.seat === card.seat && (!aliveOnly || candidate.alive));
  const enemies = (card: RuntimeCard) => cards.filter((candidate) => candidate.seat !== card.seat && candidate.alive);
  const states = () => cards.map((card) => publicState(card, currentRound));
  const canAddEvent = (durationMs: number, finalEvent = false) => {
    const reservedEndDuration = finalEvent ? 0 : 1200;
    const maxEvents = mode === "boss" ? 800 : CARD_BATTLE_MAX_EVENTS;
    const eventLimitReached = finalEvent ? events.length >= maxEvents : events.length >= maxEvents - 1;
    return !eventLimitReached && playbackDurationMs + durationMs + reservedEndDuration <= (mode === "boss" ? 14 * 60_000 : CARD_BATTLE_MAX_PLAYBACK_MS);
  };
  const addEvent = (event: Omit<CardBattleEvent, "sequence" | "states">, finalEvent = false) => {
    if (!canAddEvent(event.durationMs, finalEvent)) {
      safetyStopped = true;
      return false;
    }
    events.push({ ...event, sequence: events.length + 1, states: states() });
    playbackDurationMs += event.durationMs;
    return true;
  };
  const gainEnergy = (card: RuntimeCard, value: number) => {
    if (!card.alive || value <= 0) return;
    card.energy = Math.min(card.tier.energyRequired, card.energy + value);
  };
  const randomOne = <T,>(list: T[]) => list.length ? list[Math.floor(random() * list.length)] : null;
  const fallbackRow = (list: RuntimeCard[], preferred: "front" | "rear") => {
    const preferredCards = list.filter((card) => card.row === preferred);
    return preferredCards.length ? preferredCards : list.filter((card) => card.row !== preferred);
  };
  const basicTargets = (actor: RuntimeCard) => {
    const candidates = enemies(actor);
    if (!candidates.length) return [];
    if (actor.tier.canAttackRear) return candidates;
    return fallbackRow(candidates, "front");
  };
  const targetsFor = (actor: RuntimeCard, type: CardBattleEffectCode) => {
    const foes = enemies(actor);
    const livingAllies = allies(actor);
    const debuff = cardBattleDebuff(type);
    if (debuff) {
      if (debuff.target === "all") return foes;
      if (debuff.target === "front" || debuff.target === "rear") return fallbackRow(foes, debuff.target);
      const target = randomOne(debuff.target === "single" ? basicTargets(actor) : foes);
      return target ? [target] : [];
    }
    if (cardBattleProcStat(type)) return type.endsWith("_self") ? actor.alive ? [actor] : [] : livingAllies;
    if (type === "damage_single") { const target = randomOne(basicTargets(actor)); return target ? [target] : []; }
    if (type === "damage_rear") { const target = randomOne(fallbackRow(foes, "rear")); return target ? [target] : []; }
    if (type === "damage_random") { const target = randomOne(foes); return target ? [target] : []; }
    if (type === "damage_all_front") return fallbackRow(foes, "front");
    if (type === "damage_all_rear") return fallbackRow(foes, "rear");
    if (type === "damage_all") return foes;
    if (type.startsWith("damage_random_")) {
      const count = Number(type.slice(-1));
      return shuffled(foes, random).slice(0, count);
    }
    if (["heal_self", "energy_self", "defense_self", "speed_self", "max_hp_self", "attack_self", "attack_skill_damage_self"].includes(type)) return actor.alive ? [actor] : [];
    if (type === "heal_lowest_ally") {
      const minimum = Math.min(...livingAllies.map((card) => card.hp));
      const target = randomOne(livingAllies.filter((card) => card.hp === minimum));
      return target ? [target] : [];
    }
    if (type === "energy_lowest_ally") {
      const minimum = Math.min(...livingAllies.map((card) => card.energy));
      const target = randomOne(livingAllies.filter((card) => card.energy === minimum));
      return target ? [target] : [];
    }
    if (["heal_all_allies", "energy_all_allies", "defense_all_allies", "speed_all_allies", "max_hp_all_allies", "attack_all_allies", "attack_skill_damage_all_allies"].includes(type)) return livingAllies;
    if (type === "revive_self") return actor.alive ? [] : [actor];
    const deadOwnCards = allies(actor, false).filter((card) => !card.alive);
    const deadAllies = deadOwnCards.filter((card) => card.instanceId !== actor.instanceId);
    if (type === "revive_all_allies") return deadOwnCards;
    if (type.startsWith("revive_ally_")) return shuffled(deadAllies, random).slice(0, Number(type.slice(-1)));
    return [];
  };

  const triggerQueue: Trigger[] = [];
  const onHit = (actor: RuntimeCard, target: RuntimeCard, damage: number, round: number) => {
    let lifesteal = 0;
    if (actor.alive && damage > 0) {
      const base = cardBattleLifesteal(damage, cardBattleEffectiveProc(actor.tier, actor.buffs, "lifestealRate"));
      const received = cardBattleEffectiveStat(base * (1 + battleCollectibleBonus(actor.collectible, "healing_received") / 100), actor.buffs, "healingReceived");
      lifesteal = Math.min(received, Math.max(0, actor.maxHp - actor.hp));
      actor.hp += lifesteal;
      actor.healingDone += lifesteal;
    }
    const rate = cardBattleEffectiveProc(actor.tier, actor.buffs, "stunRate");
    const rolledStun = rate > 0 && stunRandom() < rate / 100;
    const stunResisted = rolledStun && target.alive && collectibleProtection(target, "debuff_resistance", round);
    const stunned = rolledStun && target.alive && !stunResisted;
    if (stunned) target.buffs.push({ stat: "stunned", value: 1, expiresAfterRound: round, debuff: true });
    return { lifesteal, stunned, stunResisted };
  };
  const queueDeaths = (deadCards: RuntimeCard[], actor: RuntimeCard, killKind: "normal_kill" | "skill_kill", root: number) => {
    if (!deadCards.length) return;
    triggerQueue.push(...deadCards.map((dead) => ({
      kind: "self_death" as const,
      cardId: dead.instanceId,
      actorId: actor.instanceId,
      deadCardId: dead.instanceId,
      root,
      energyFullAtTrigger: dead.energy >= dead.tier.energyRequired,
    })));
    for (const dead of deadCards) {
      for (const ally of cards.filter((candidate) => candidate.seat === dead.seat && candidate.instanceId !== dead.instanceId && candidate.alive)) {
        triggerQueue.push({
          kind: "ally_death",
          cardId: ally.instanceId,
          actorId: actor.instanceId,
          deadCardId: dead.instanceId,
          root,
          energyFullAtTrigger: ally.energy >= ally.tier.energyRequired,
        });
      }
    }
    triggerQueue.push({
      kind: killKind,
      cardId: actor.instanceId,
      actorId: actor.instanceId,
      root,
      energyFullAtTrigger: actor.energy >= actor.tier.energyRequired,
    });
  };

  const applyEffect = (actor: RuntimeCard, effect: CardBattleSkillEffect, round: number, root: number) => {
    if (safetyStopped) return;
    const visual = visualForEffect(effect.type);
    const durationMs = visual === "damage" ? 1300 : 1000;
    // Reserve the visual event before changing runtime state. Reaching a safety
    // limit must never create a state transition that the client cannot animate.
    if (!canAddEvent(durationMs)) {
      safetyStopped = true;
      return;
    }
    const targets = targetsFor(actor, effect.type);
    const amount = Math.max(0, effect.value ?? 0);
    const visuals: CardBattleVisualEffect[] = [];
    const deadCards: RuntimeCard[] = [];
    const crossedThresholds: RuntimeCard[] = [];
    let lifesteal = 0;
    if (visual === "damage") {
      gainEnergy(actor, 10);
      for (const target of targets) {
        const beforeRatio = target.maxHp > 0 ? target.hp / target.maxHp : 0;
        const { critical, multiplier } = rollCardBattleCritical(actor.tier, criticalRandom);
        const hit = rollCardBattleDamage(effectiveSkillDamage(actor, amount) * multiplier, effectiveStat(target, "defense"), target.hp, damageRandom);
        const { incomingDamage } = hit;
        const damage = protectedDamage(target, hit.damage, round);
        // 承伤统计包含防御抵消和溢出的伤害；命中即回能，完全抵挡也不例外。
        target.damageTaken += incomingDamage;
        gainEnergy(target, 10);
        if (damage > 0) {
          target.hp -= damage;
          actor.damageDealt += damage;
        }
        visuals.push({ targetId: target.instanceId, amount: -damage, blocked: damage === 0, critical,
          ...(hit.damage > damage ? { label: collectibleProtection(target, "invincible", round) ? "无敌" : "免死" } : {}) });
        if (target.hp <= 0 && target.alive) {
          target.hp = 0;
          target.alive = false;
          deadCards.push(target);
        } else if (target.alive && target.hp / target.maxHp < beforeRatio) crossedThresholds.push(target);
        const proc = onHit(actor, target, damage, round);
        lifesteal += proc.lifesteal;
        Object.assign(visuals[visuals.length - 1]!, { stunned: proc.stunned, stunResisted: proc.stunResisted });
      }
    } else if (visual === "heal") {
      for (const target of targets) {
        const { critical, multiplier } = rollCardBattleCritical(actor.tier, criticalRandom);
        const outgoing = Math.round(amount * multiplier * (1 + battleCollectibleBonus(actor.collectible, "healing") / 100));
        const received = cardBattleEffectiveStat(outgoing * (1 + battleCollectibleBonus(target.collectible, "healing_received") / 100), target.buffs, "healingReceived");
        const healed = Math.min(received, Math.max(0, target.maxHp - target.hp));
        target.hp += healed;
        actor.healingDone += healed;
        if (healed > 0) visuals.push({ targetId: target.instanceId, amount: healed, critical });
      }
    } else if (visual === "energy") {
      for (const target of targets) {
        const before = target.energy;
        gainEnergy(target, amount);
        const gained = target.energy - before;
        if (gained > 0) visuals.push({ targetId: target.instanceId, amount: gained, label: effectLabel(effect.type, gained) });
      }
    } else if (visual === "debuff") {
      const debuff = cardBattleDebuff(effect.type)!;
      const expiresAfterRound = round + Math.max(1, effect.duration ?? 1) - 1;
      for (const target of targets) {
        if (collectibleProtection(target, "debuff_resistance", round)) {
          visuals.push({ targetId: target.instanceId, label: "抵抗负面状态" });
          continue;
        }
        const stat = cardBattleProcStat(effect.type) ?? (debuff.status === "speed_down" ? "speed" : debuff.status === "defense_down" ? "defense" : debuff.status === "max_hp_down" ? "maxHp" : debuff.status === "healing_received_down" ? "healingReceived" : "attack");
        const before = Math.min(100, cardBattleBuffBonus(target.buffs, stat, true));
        target.buffs.push({ stat, value: Math.min(100, amount), expiresAfterRound, debuff: true });
        if (stat === "attack") target.buffs.push({ stat: "skillDamage", value: Math.min(100, amount), expiresAfterRound, debuff: true });
        if (stat === "maxHp") {
          target.maxHp = cardBattleEffectiveStat(target.tier.maxHp, target.buffs, "maxHp", 1);
          target.hp = Math.min(target.hp, target.maxHp);
        }
        const applied = Math.min(100, cardBattleBuffBonus(target.buffs, stat, true)) - before;
        visuals.push({ targetId: target.instanceId, amount: applied, label: `${debuff.label} -${applied}%` });
      }
    } else if (visual === "buff") {
      for (const target of targets) {
        const procStat = cardBattleProcStat(effect.type);
        if (procStat) {
          const before = cardBattleEffectiveProc(target.tier, target.buffs, procStat);
          target.buffs.push({ stat: procStat, value: amount, expiresAfterRound: round + Math.max(1, effect.duration ?? 1) - 1 });
          const gained = cardBattleEffectiveProc(target.tier, target.buffs, procStat) - before;
          visuals.push({ targetId: target.instanceId, amount: gained, label: effectLabel(effect.type, gained) });
          continue;
        }
        const before = { attack: effectiveStat(target, "attack"), skillDamage: effectiveSkillDamage(target, 0), defense: effectiveStat(target, "defense"), speed: effectiveStat(target, "speed"), maxHp: target.maxHp };
        let gained = 0;
        let label = "";
        if (effect.type.startsWith("max_hp_")) {
          // Max-HP increases keep their existing lifetime: until this life ends.
          target.buffs.push({ stat: "maxHp", value: amount, expiresAfterRound: Infinity });
          target.maxHp = cardBattleEffectiveStat(target.tier.maxHp, target.buffs, "maxHp", 1);
          gained = target.maxHp - before.maxHp;
          target.hp += gained;
        } else if (effect.type.startsWith("attack_skill_damage_")) {
          const expiresAfterRound = round + Math.max(1, effect.duration ?? 1) - 1;
          target.buffs.push({ stat: "attack", value: amount, expiresAfterRound });
          target.buffs.push({ stat: "skillDamage", value: amount, expiresAfterRound });
          gained = effectiveStat(target, "attack") - before.attack;
          const skillGained = effectiveSkillDamage(target, 0) - before.skillDamage;
          label = gained === skillGained ? effectLabel(effect.type, gained) : `攻击 +${gained} / 技能伤害 +${skillGained}`;
        } else {
          const stat = effect.type.startsWith("attack_") ? "attack" : effect.type.startsWith("defense_") ? "defense" : "speed";
          target.buffs.push({ stat, value: amount, expiresAfterRound: round + Math.max(1, effect.duration ?? 1) - 1 });
          gained = effectiveStat(target, stat) - before[stat];
        }
        if (gained > 0) visuals.push({ targetId: target.instanceId, amount: gained, label: label || effectLabel(effect.type, gained) });
      }
    } else if (visual === "revive") {
      for (const target of targets) {
        target.alive = true;
        target.maxHp = target.tier.maxHp;
        target.hp = target.maxHp;
        target.energy = 0;
        target.buffs = [];
        target.lifeTriggeredThresholds.clear();
        target.revivedRound = round;
        visuals.push({ targetId: target.instanceId, label: "复活" });
      }
    }
    addEvent({
      round,
      kind: "skill",
      effectType: effect.type,
      visual,
      actorId: actor.instanceId,
      skillName: actor.tier.skillName || "卡牌技能",
      effects: visuals,
      lifesteal,
      extraAction: extraActionRoots.has(root),
      durationMs,
      text: `${actor.name} 使用${actor.tier.skillName ? `「${actor.tier.skillName}」` : "技能"}`,
    });
    queueDeaths(deadCards, actor, "skill_kill", root);
    for (const target of crossedThresholds) triggerQueue.push({
      kind: "hp_below",
      cardId: target.instanceId,
      actorId: actor.instanceId,
      root,
      energyFullAtTrigger: target.energy >= target.tier.energyRequired,
    });
  };

  const firedForRoot = new Set<string>();
  const processTriggers = (round: number) => {
    while (triggerQueue.length && !safetyStopped) {
      const trigger = triggerQueue.shift()!;
      const card = byId(trigger.cardId);
      if (card.alive && isStunned(card)) continue;
      const candidates = card.tier.effects
        .filter((effect) => baseTriggerCondition(effect.condition) === trigger.kind)
        .sort((left, right) => left.order - right.order);
      const hadFullEnergy = trigger.energyFullAtTrigger;
      const matching = candidates.filter((effect) => {
        const key = `${trigger.root}:${trigger.kind}:${trigger.deadCardId ?? ""}:${card.instanceId}:${effect.id}`;
        if (firedForRoot.has(key)) return false;
        if (isEnergyCondition(effect.condition) && !hadFullEnergy) return false;
        if (trigger.kind === "hp_below") {
          const threshold = Math.max(1, Math.min(100, effect.conditionValue ?? 0));
          const thresholdKey = `${effect.id}:${threshold}`;
          if (card.lifeTriggeredThresholds.has(thresholdKey) || card.hp / card.maxHp > threshold / 100) return false;
          card.lifeTriggeredThresholds.add(thresholdKey);
        }
        firedForRoot.add(key);
        return true;
      });
      if (!matching.length) continue;
      if (matching.some((effect) => isEnergyCondition(effect.condition))) card.energy = 0;
      for (const effect of matching) {
        const rootEffects = (triggerEffectsByRoot.get(trigger.root) ?? 0) + 1;
        triggerEffectsByRoot.set(trigger.root, rootEffects);
        if (rootEffects > CARD_BATTLE_MAX_TRIGGER_EFFECTS) {
          safetyStopped = true;
          break;
        }
        applyEffect(card, effect, round, trigger.root);
      }
      tryExtraAction(card, round, trigger.root);
    }
  };

  const performAction = (actor: RuntimeCard, round: number, root: number) => {
      const energyEffects = actor.tier.effects
        .filter((effect) => effect.condition === "energy_full")
        .sort((left, right) => left.order - right.order);
      if (actor.energy >= actor.tier.energyRequired && energyEffects.length) {
        actor.energy = 0;
        for (const effect of energyEffects) applyEffect(actor, effect, round, root);
        processTriggers(round);
      } else {
        const target = randomOne(basicTargets(actor));
        if (!target) return;
        if (!canAddEvent(1100)) {
          safetyStopped = true;
          return;
        }
        const beforeRatio = target.hp / target.maxHp;
        const { critical, multiplier } = rollCardBattleCritical(actor.tier, criticalRandom);
        const hit = rollCardBattleDamage(effectiveStat(actor, "attack") * multiplier, effectiveStat(target, "defense"), target.hp, damageRandom);
        const { incomingDamage } = hit;
        const damage = protectedDamage(target, hit.damage, round);
        target.damageTaken += incomingDamage;
        gainEnergy(actor, 10);
        gainEnergy(target, 10);
        if (damage > 0) {
          target.hp -= damage;
          actor.damageDealt += damage;
        }
        const died = target.hp <= 0 && target.alive;
        if (died) { target.hp = 0; target.alive = false; }
        const proc = onHit(actor, target, damage, round);
        addEvent({
          lifesteal: proc.lifesteal, extraAction: extraActionRoots.has(root),
          round, kind: "attack", visual: "damage", actorId: actor.instanceId, skillName: null,
          effects: [{ targetId: target.instanceId, amount: -damage, blocked: damage === 0, critical, stunned: proc.stunned, stunResisted: proc.stunResisted,
            ...(hit.damage > damage ? { label: collectibleProtection(target, "invincible", round) ? "无敌" : "免死" } : {}) }], durationMs: 1100,
          text: `${actor.name} 攻击 ${target.name}`,
        });
        if (died) queueDeaths([target], actor, "normal_kill", root);
        else if (target.hp / target.maxHp < beforeRatio) triggerQueue.push({
          kind: "hp_below",
          cardId: target.instanceId,
          actorId: actor.instanceId,
          root: root,
          energyFullAtTrigger: target.energy >= target.tier.energyRequired,
        });
        processTriggers(round);
      }
    tryExtraAction(actor, round, root);
  };

  const tryExtraAction = (actor: RuntimeCard, round: number, root: number) => {
    if (safetyStopped || extraActionRoots.has(root) || !actor.alive || isStunned(actor) || !enemies(actor).length) return;
    const rate = cardBattleEffectiveProc(actor.tier, actor.buffs, "extraActionRate");
    if (rate <= 0 || extraActionRandom() >= rate / 100) return;
    if (!canAddEvent(650)) { safetyStopped = true; return; }
    const extraRoot = ++rootSequence;
    extraActionRoots.add(extraRoot);
    addEvent({ round, kind: "extra_action", visual: "extra_action", actorId: actor.instanceId, skillName: null,
      effects: [{ targetId: actor.instanceId, label: "再动" }], extraAction: true, durationMs: 650, text: `${actor.name} 立即再次行动` });
    performAction(actor, round, extraRoot);
  };

  const sideAlive = (seat: 1 | 2) => cards.some((card) => card.seat === seat && card.alive);
  const winnerAfterChains = () => sideAlive(1) === sideAlive(2) ? null : sideAlive(1) ? 1 as const : 2 as const;
  let completedRounds = 0;
  let winnerSeat: 1 | 2 | null = null;
  let endReason: CardBattleResult["endReason"] = "round_limit";

  for (let round = 1; round <= CARD_BATTLE_MAX_ROUNDS && !safetyStopped; round += 1) {
    currentRound = round;
    completedRounds = round;
    if (!addEvent({ round, kind: "round", visual: "round", actorId: null, skillName: null, effects: [], durationMs: 500, text: `第 ${round} 回合` })) break;
    const initiative = shuffled(cards.filter((card) => card.alive), random)
      .sort((left, right) => effectiveStat(right, "speed") - effectiveStat(left, "speed"));
    for (const actor of initiative) {
      if (safetyStopped) break;
      if (!actor.alive || actor.revivedRound === round || !sideAlive(actor.seat === 1 ? 2 : 1)) continue;
      if (isStunned(actor)) {
        addEvent({ round, kind: "stun", visual: "stun", actorId: actor.instanceId, skillName: null,
          effects: [{ targetId: actor.instanceId, label: "眩晕·跳过行动" }], durationMs: 650, text: `${actor.name} 因眩晕无法行动` });
        continue;
      }
      performAction(actor, round, ++rootSequence);
      if (!sideAlive(1) || !sideAlive(2)) {
        winnerSeat = winnerAfterChains();
        endReason = winnerSeat ? "elimination" : "simultaneous_elimination";
        break;
      }
    }
    if (!safetyStopped) {
      for (const card of cards) {
        card.buffs = card.buffs.filter((buff) => buff.expiresAfterRound > round);
        card.maxHp = cardBattleEffectiveStat(card.tier.maxHp, card.buffs, "maxHp", 1);
        card.hp = Math.min(card.hp, card.maxHp);
      }
    }
    if (!sideAlive(1) || !sideAlive(2)) break;
  }

  if (safetyStopped) {
    winnerSeat = null;
    endReason = "safety_limit";
  } else if (sideAlive(1) && sideAlive(2) && completedRounds >= CARD_BATTLE_MAX_ROUNDS) {
    const metrics = ([1, 2] as const).map((seat) => {
      const side = cards.filter((card) => card.seat === seat);
      return {
        seat,
        alive: side.filter((card) => card.alive).length,
        hpRatio: side.reduce((sum, card) => sum + card.hp / Math.max(1, card.maxHp), 0),
        damage: side.reduce((sum, card) => sum + card.damageDealt, 0),
      };
    });
    const [one, two] = metrics;
    winnerSeat = mode === "boss" ? 2 : one.alive !== two.alive ? (one.alive > two.alive ? 1 : 2)
      : one.hpRatio !== two.hpRatio ? (one.hpRatio > two.hpRatio ? 1 : 2)
      : one.damage !== two.damage ? (one.damage > two.damage ? 1 : 2)
      : null;
    endReason = "round_limit";
  } else if (!sideAlive(1) && !sideAlive(2)) {
    winnerSeat = null;
    endReason = "simultaneous_elimination";
  }

  addEvent({
    round: completedRounds, kind: "end", visual: "end", actorId: null, skillName: null, effects: [], durationMs: 1200,
    text: mode === "boss" ? (winnerSeat === 1 ? "挑战成功" : "挑战失败") : winnerSeat ? `${players.find((player) => player.seat === winnerSeat)?.nickname ?? "玩家"} 获胜` : "本局平局",
  }, true);
  const settlementPlayers = players.map((player) => ({
    userId: player.userId,
    nickname: player.nickname,
    seat: player.seat,
    cards: cards.filter((card) => card.userId === player.userId).sort((left, right) => left.slot - right.slot).map((card) => ({
      slot: card.slot,
      cardId: card.cardId,
      name: card.name,
      damageDealt: card.damageDealt,
      damageTaken: card.damageTaken,
      healingDone: card.healingDone,
      score: calculateCardBattleScore(card.damageDealt, card.damageTaken, card.healingDone),
    })),
  }));
  return {
    version: 1,
    mode,
    winnerSeat,
    endReason,
    rounds: completedRounds,
    players: settlementPlayers,
    initialStates,
    finalStates: states(),
    events,
    playbackDurationMs,
  };
}
