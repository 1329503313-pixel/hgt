import { CARD_BATTLE_DEFENSE_EFFECT_CODES, cardBattleAccuracyStat, cardBattleDodgeChance, isCardBattleTrueDamage, isCardBattleShield } from "@hgt/shared";
import { cardBattleEffectiveAccuracy, cardBattleEffectiveCritical } from "./cardBattleMath.js";
import { cardBattleShieldValue, consumeCardBattleShields, type CardBattleShield } from "./cardBattleShields.js";
import { cardBattleBuffBonus, cardBattleEffectiveStat, cardBattleStatuses, rollCardBattleDamage, rollCardBattleCritical, type CardBattleBuff } from "./cardBattleMath.js";
import { cardBattleDebuffCodes, cardBattleDebuff, isCardBattleDebuff, type CardBattleStatus } from "./cardBattleStatus.js";
import { applyBattleCollectibleStats, battleCollectibleBonus, calculateCardBattleScore, type BattleCollectible } from "@hgt/shared";
import { CARD_BATTLE_PROC_BUFF_CODES, CARD_BATTLE_PROC_STATS, cardBattleProcStat, isCardBattleDamageEffect, type CardBattleDamageOptions, type CardBattleProcStats } from "@hgt/shared";
import { cardBattleEffectiveProc, cardBattleLifesteal } from "./cardBattleMath.js";
import { cardBattleSupportShares, type CardBattleSupportShare } from "./cardBattleSupport.js";
import type { CardBattleSupportBreakdown, CardBattleSupportKind } from "@hgt/shared";
import { CARD_BATTLE_CONTROL_CODES, isCardBattleStun, isCardBattleRevivalBlock, isCardBattleImmunity, isCardBattleCleanse } from "@hgt/shared";
import { CARD_BATTLE_BOND_ACTIONS, type CardBattleBond, type CardBattleBondTarget } from "@hgt/shared";
import { createCardBattleBondQueue } from "./cardBattleBondQueue.js";

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
  ...CARD_BATTLE_DEFENSE_EFFECT_CODES,
  ...CARD_BATTLE_CONTROL_CODES,
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

export type CardBattleSkillEffect = CardBattleDamageOptions & {
  id: string;
  order: number;
  condition: CardBattleConditionCode;
  conditionValue: number | null;
  type: CardBattleEffectCode;
  value: number | null;
  duration: number | null;
  probability?: number;
  additionalEffects?: CardBattleSkillAction[];
};

export type CardBattleSkillAction = Omit<CardBattleSkillEffect, "id" | "order" | "condition" | "conditionValue" | "additionalEffects"> & { id?: string };

export type CardBattleTier = CardBattleProcStats & import("@hgt/shared").CardBattleAccuracyStats & {
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
  bonds?: CardBattleBond[];
};

export type CardBattleDeckCard = {
  /** Internal unboosted configuration, retained for ranking rematches. */
  collectionBaseTier?: CardBattleTier;
  collectible?: BattleCollectible | null;
  instanceId: string;
  cardId: string;
  cardNo?: string;
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

export type CardBattlePublicCardState = CardBattleProcStats & import("@hgt/shared").CardBattleAccuracyStats & {
  critRate?: number;
  critDamage?: number;
  shield?: number;
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
  supportDone?: number;
  supportBreakdown?: CardBattleSupportBreakdown;
  statuses?: CardBattleStatus[];
};

export type CardBattleVisualEffect = {
  dodged?: boolean;
  shieldDamage?: number;
  hpDamage?: number;
  shieldGained?: number;
  targetId: string;
  amount?: number;
  blocked?: boolean;
  critical?: boolean;
  stunned?: boolean;
  stunResisted?: boolean;
  label?: string;
};

export type CardBattleEvent = {
  bond?: { ownerId: string; triggerId: string };
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
  supportDone?: number;
  supportBreakdown?: CardBattleSupportBreakdown;
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
  mode?: "1v1" | "boss" | "tower";
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
  shields: CardBattleShield[];
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  supportDone: number;
  supportBreakdown: CardBattleSupportBreakdown;
  revivalSourceId: string | null;
  preventedStuns: CardBattleSupportShare[];
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

function debuffImmune(card: RuntimeCard, round: number) {
  return collectibleProtection(card, "debuff_resistance", round)
    || card.buffs.some((buff) => buff.stat === "immunity" && buff.expiresAfterRound >= round);
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
    ...cardBattleEffectiveCritical(card.tier, card.buffs),
    shield: cardBattleShieldValue(card.shields),
    dodgeRate: cardBattleEffectiveAccuracy(card.tier, card.buffs, "dodgeRate"),
    hitRate: cardBattleEffectiveAccuracy(card.tier, card.buffs, "hitRate"),
    energy: card.energy,
    energyRequired: card.tier.energyRequired,
    attack: effectiveStat(card, "attack"),
    defense: effectiveStat(card, "defense"),
    speed: effectiveStat(card, "speed"),
    alive: card.alive,
    damageDealt: card.damageDealt,
    damageTaken: card.damageTaken,
    healingDone: card.healingDone,
    supportDone: card.supportDone,
    supportBreakdown: { ...card.supportBreakdown },
    lifestealRate: cardBattleEffectiveProc(card.tier, card.buffs, "lifestealRate"),
    stunRate: cardBattleEffectiveProc(card.tier, card.buffs, "stunRate"),
    extraActionRate: cardBattleEffectiveProc(card.tier, card.buffs, "extraActionRate"),
    statuses: [...cardBattleStatuses(card.alive ? card.buffs : card.buffs.filter((buff) => buff.stat === "revivalBlock"), round),
      ...card.shields.filter(shield => shield.remaining > 0).map(shield => ({ type: "shield" as const, value: shield.remaining, remainingRounds: Math.max(1, shield.expiresAfterRound - round + 1), multiplier: 1, category: "buff" as const })),
      ...(["debuff_resistance", "invincible", "death_protection"] as const)
      .filter((type) => card.alive && collectibleProtection(card, type, round))
      .map((type) => ({ type, value: battleCollectibleBonus(card.collectible, type), remainingRounds: battleCollectibleBonus(card.collectible, type) - Math.max(1, round) + 1, multiplier: 1, category: "buff" as const }))],
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
  if (isCardBattleDebuff(type) || isCardBattleStun(type) || isCardBattleRevivalBlock(type)) return "debuff";
  if (isCardBattleDamageEffect(type)) return "damage";
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

export function simulateCardBattle(players: CardBattlePlayerInput[], seed: string, mode: "1v1" | "boss" | "tower" = "1v1"): CardBattleResult {
  const challengers = players.filter((player) => player.seat === 1);
  const bosses = players.filter((player) => player.seat === 2);
  const maxRounds = mode === "tower" ? 50 : CARD_BATTLE_MAX_ROUNDS;
  if (mode === "tower" && (challengers.length < 1 || challengers.length > 3 || bosses.length !== 1
    || players.some((player) => player.cards.length !== 5)
    || new Set(challengers.flatMap((player) => player.cards.map((card) => card.cardId))).size !== challengers.length * 5)) {
    throw new CardBattleRuleError("闯关需要一至三个五张不同卡牌的阵容，阵容间不得重复卡牌");
  }
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
  const dodgeRandom = seededRandom(`${seed}:dodge`);
  const damageRandom = seededRandom(`${seed}:damage`);
  const criticalRandom = seededRandom(`${seed}:critical`);
  const stunRandom = seededRandom(`${seed}:stun`);
  const extraActionRandom = seededRandom(`${seed}:extra-action`);
  // Zero-rate procs used to skip their draw. Keep combat streams unchanged even
  // when evaluating a fully suppressed proc for support attribution.
  const supportRandom = seededRandom(`${seed}:support`);
  const allCards: RuntimeCard[] = players.flatMap((player) => player.cards.map((baseCard) => {
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
    shields: [],
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    supportDone: 0,
    supportBreakdown: {},
    revivalSourceId: null,
    preventedStuns: [],
    lifeTriggeredThresholds: new Set<string>(),
    revivedRound: null,
  }); }));
  let squadIndex = 0;
  const squadIds = challengers.map((player) => new Set(player.cards.map((card) => card.instanceId)));
  let cards = mode === "tower" ? allCards.filter((card) => card.seat === 2 || squadIds[0]!.has(card.instanceId)) : allCards;
  let currentRound = 0;
  const initialStates = cards.map((card) => publicState(card, currentRound));
  const events: CardBattleEvent[] = [];
  let rootSequence = 0;
  const triggerEffectsByRoot = new Map<number, number>();
  let safetyStopped = false;
  let playbackDurationMs = 0;
  // The complete causal chain of an extra action is ineligible for more extras.
  const extraActionRoots = new Set<number>();
  const guaranteedExtras = new Set<string>();
  const completedExtras = new Set<string>();
  const extraActionSupport = new Map<number, { actorId: string; sourceId: string }>();
  let buffSequence = 0;
  const isStunned = (card: RuntimeCard) => card.buffs.some((buff) => buff.stat === "stunned" && buff.expiresAfterRound >= currentRound);
  const bonds = createCardBattleBondQueue(() => cards, card => card.alive && !isStunned(card));
  let activeBond: CardBattleEvent["bond"];
  const bondObserved = new Map(allCards.map(card => [card.instanceId, { energy: card.energy, hpRatio: card.hp / card.maxHp, alive: card.alive }]));
  const clearEnergy = (card: RuntimeCard, root: number) => {
    if (card.energy > 0) bonds.emit("energy_empty", card, root);
    card.energy = 0;
    bondObserved.get(card.instanceId)!.energy = 0;
  };

  const byId = (id: string) => allCards.find((card) => card.instanceId === id)!;
  const creditSupport = (sourceId: string | null | undefined, kind: CardBattleSupportKind, amount: number) => {
    if (!sourceId || !Number.isFinite(amount) || amount <= 0) return;
    const source = byId(sourceId);
    const credited = Math.round(amount);
    source.supportDone += credited;
    source.supportBreakdown[kind] = (source.supportBreakdown[kind] ?? 0) + credited;
  };
  const creditShares = (shares: CardBattleSupportShare[], kind: CardBattleSupportKind, multiplier = 1) => {
    for (const share of shares) creditSupport(share.sourceId, kind, share.amount * multiplier);
    return shares.reduce((sum, share) => sum + share.amount, 0);
  };
  const grantBuff = (actor: RuntimeCard, target: RuntimeCard, buff: CardBattleBuff) => {
    target.buffs.push({ ...buff, sourceId: actor.instanceId, sourceOrder: ++buffSequence });
  };
  const creditExtraAction = (actor: RuntimeCard, root: number, amount: number) => {
    const support = extraActionSupport.get(root);
    if (support?.actorId === actor.instanceId) creditSupport(support.sourceId, "extraAction", amount);
  };
  const damageHit = (actor: RuntimeCard, target: RuntimeCard, base: number, stat: "attack" | "skillDamage", multiplier: number, round: number, root: number, ignoreDefensePercent = 0, trueDamage = false) => {
    const availableShield = trueDamage ? 0 : cardBattleShieldValue(target.shields);
    const roll = damageRandom();
    const measure = ([outgoing, defending]: CardBattleBuff[][]) => {
      const hit = rollCardBattleDamage(cardBattleEffectiveStat(base, outgoing!, stat) * multiplier,
        cardBattleEffectiveStat(target.tier.defense, defending!, "defense"), target.hp + availableShield, () => roll, trueDamage ? 0 : ignoreDefensePercent);
      const shieldDamage = collectibleProtection(target, "invincible", round) ? 0 : Math.min(availableShield, hit.damage);
      const hpDamage = protectedDamage(target, hit.damage - shieldDamage, round);
      return { ...hit, unprotectedDamage: hit.damage, damage: shieldDamage + hpDamage, shieldDamage, hpDamage };
    };
    const hit = measure([actor.buffs, target.buffs]);
    creditShares(cardBattleSupportShares([
      { buffs: actor.buffs, accepts: (buff) => buff.stat === stat && !buff.debuff },
      { buffs: target.buffs, accepts: (buff) => buff.stat === "defense" && Boolean(buff.debuff) },
    ], (buffs) => measure(buffs).damage), "damageBoost");
    creditShares(cardBattleSupportShares([
      { buffs: actor.buffs, accepts: (buff) => buff.stat === stat && Boolean(buff.debuff) },
      { buffs: target.buffs, accepts: (buff) => buff.stat === "defense" && !buff.debuff },
    ], (buffs) => measure(buffs).damage, -1), "damageReduction");
    creditSupport(actor.revivalSourceId, "revival", hit.damage);
    creditSupport(target.revivalSourceId, "revival", hit.incomingDamage);
    creditExtraAction(actor, root, hit.damage);
    if (hit.shieldDamage > 0) consumeCardBattleShields(target.shields, hit.shieldDamage, (sourceId, absorbed) => creditSupport(sourceId, "shield", absorbed));
    target.shields = target.shields.filter(shield => shield.remaining > 0);
    return hit;
  };
  const dodges = (actor: RuntimeCard, target: RuntimeCard) => {
    const chance = cardBattleDodgeChance(cardBattleEffectiveAccuracy(target.tier, target.buffs, "dodgeRate"), cardBattleEffectiveAccuracy(actor.tier, actor.buffs, "hitRate"));
    return chance > 0 && dodgeRandom() < chance / 100;
  };
  const allies = (card: RuntimeCard, aliveOnly = true) => cards.filter((candidate) => candidate.seat === card.seat && (!aliveOnly || candidate.alive));
  const enemies = (card: RuntimeCard) => cards.filter((candidate) => candidate.seat !== card.seat && candidate.alive);
  const states = () => cards.map((card) => publicState(card, currentRound));
  const canAddEvent = (durationMs: number, finalEvent = false) => {
    const reservedEndDuration = finalEvent ? 0 : 1200;
    const maxEvents = mode === "tower" ? 1600 : mode === "boss" ? 800 : CARD_BATTLE_MAX_EVENTS;
    const eventLimitReached = finalEvent ? events.length >= maxEvents : events.length >= maxEvents - 1;
    return !eventLimitReached && playbackDurationMs + durationMs + reservedEndDuration <= (mode === "tower" ? 28 * 60_000 : mode === "boss" ? 14 * 60_000 : CARD_BATTLE_MAX_PLAYBACK_MS);
  };
  const addEvent = (event: Omit<CardBattleEvent, "sequence" | "states">, finalEvent = false, root = 0) => {
    if (!canAddEvent(event.durationMs, finalEvent)) {
      safetyStopped = true;
      return false;
    }
    events.push({ ...event, ...(activeBond ? { bond: activeBond, skillName: "羁绊技能", text: `【羁绊】${event.text}` } : {}), sequence: events.length + 1, states: states() });
    if (root) {
      for (const card of cards) {
        const before = bondObserved.get(card.instanceId)!;
        if (before.alive && !card.alive) bonds.emit("death", card, root);
        if (before.hpRatio > .5 && card.hp / card.maxHp <= .5) bonds.emit("hp_half", card, root);
        if (before.energy < card.tier.energyRequired && card.energy >= card.tier.energyRequired) bonds.emit("energy_full", card, root);
        if (before.energy > 0 && card.energy === 0) bonds.emit("energy_empty", card, root);
      }
      for (const effect of event.effects) {
        const target = byId(effect.targetId);
        if (event.visual === "damage" && (effect.amount ?? 0) < 0) bonds.emit("damaged", target, root);
        if ((effect.shieldGained ?? 0) > 0) bonds.emit("shielded", target, root);
        if (event.visual === "heal" && (effect.amount ?? 0) > 0) bonds.emit("healed", target, root);
        if (effect.stunned) {
          bonds.emit("stunned", target, root);
          if (event.actorId) bonds.emit("stun", byId(event.actorId), root);
        }
      }
      if (event.lifesteal && event.actorId) bonds.emit("healed", byId(event.actorId), root);
    }
    for (const card of cards) bondObserved.set(card.instanceId, { energy: card.energy, hpRatio: card.hp / card.maxHp, alive: card.alive });
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
  const targetsFor = (actor: RuntimeCard, type: CardBattleEffectCode): RuntimeCard[] => {
    const foes = enemies(actor);
    const livingAllies = allies(actor);
    if (isCardBattleRevivalBlock(type)) {
      const allFoes = cards.filter((candidate) => candidate.seat !== actor.seat);
      if (type.endsWith("_all")) return allFoes;
      if (type.endsWith("_front")) return fallbackRow(allFoes, "front");
      if (type.endsWith("_rear")) return fallbackRow(allFoes, "rear");
      return []; // The damaged variant receives this skill group's actual victims.
    }
    if (isCardBattleStun(type)) {
      if (type.endsWith("_all")) return foes;
      if (type.endsWith("_front")) return fallbackRow(foes, "front");
      if (type.endsWith("_rear")) return fallbackRow(foes, "rear");
      const target = randomOne(type.endsWith("_single") ? fallbackRow(foes, "front") : foes);
      return target ? [target] : [];
    }
    if (isCardBattleImmunity(type) || isCardBattleCleanse(type)) {
      if (type.endsWith("_self")) return actor.alive ? [actor] : [];
      if (type.endsWith("_front")) return fallbackRow(livingAllies, "front");
      if (type.endsWith("_rear")) return fallbackRow(livingAllies, "rear");
      if (type.endsWith("_random")) {
        const target = randomOne(livingAllies);
        return target ? [target] : [];
      }
      return livingAllies;
    }
    const debuff = cardBattleDebuff(type);
    if (debuff) {
      if (debuff.target === "all") return foes;
      if (debuff.target === "front" || debuff.target === "rear") return fallbackRow(foes, debuff.target);
      const target = randomOne(debuff.target === "single" ? basicTargets(actor) : foes);
      return target ? [target] : [];
    }
    if (cardBattleProcStat(type)) return type.endsWith("_self") ? actor.alive ? [actor] : [] : livingAllies;
    if (isCardBattleTrueDamage(type)) return targetsFor(actor, type.replace("damage_true_", "damage_") as CardBattleEffectCode);
    if (isCardBattleShield(type) || cardBattleAccuracyStat(type)) {
      if (type.endsWith("_self")) return actor.alive ? [actor] : [];
      if (type.endsWith("_front")) return livingAllies.filter(card => card.row === "front");
      if (type.endsWith("_rear")) return livingAllies.filter(card => card.row === "rear");
      return livingAllies;
    }
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
  const onHit = (actor: RuntimeCard, target: RuntimeCard, damage: number, round: number, root: number) => {
    let lifesteal = 0;
    if (actor.alive && damage > 0) {
      if (cardBattleLifesteal(damage, cardBattleEffectiveProc(actor.tier, actor.buffs, "lifestealRate")) > 0) bonds.emit("lifesteal", actor, root);
      const measure = ([buffs]: CardBattleBuff[][]) => {
        const base = cardBattleLifesteal(damage, cardBattleEffectiveProc(actor.tier, buffs!, "lifestealRate"));
        const received = cardBattleEffectiveStat(base * (1 + battleCollectibleBonus(actor.collectible, "healing_received") / 100), buffs!, "healingReceived");
        return Math.min(received, Math.max(0, actor.maxHp - actor.hp));
      };
      lifesteal = measure([actor.buffs]);
      const gained = creditShares(cardBattleSupportShares([{ buffs: actor.buffs,
        accepts: (buff) => ["lifestealRate", "healingReceived"].includes(buff.stat) && !buff.debuff }], measure), "healingBoost");
      creditSupport(actor.instanceId, "healing", lifesteal - gained);
      creditShares(cardBattleSupportShares([{ buffs: actor.buffs,
        accepts: (buff) => ["lifestealRate", "healingReceived"].includes(buff.stat) && Boolean(buff.debuff) }], measure, -1), "healingReduction");
      creditExtraAction(actor, root, lifesteal);
      actor.hp += lifesteal;
      actor.healingDone += lifesteal;
    }
    const rate = cardBattleEffectiveProc(actor.tier, actor.buffs, "stunRate");
    const roll = rate > 0 ? stunRandom() : supportRandom();
    const rolledStun = rate > 0 && roll < rate / 100;
    const stunResisted = rolledStun && target.alive && debuffImmune(target, round);
    const stunned = rolledStun && target.alive && !stunResisted;
    const measureProc = ([buffs]: CardBattleBuff[][]) => roll < cardBattleEffectiveProc(actor.tier, buffs!, "stunRate") / 100 ? 1 : 0;
    if (stunned) {
      const source = cardBattleSupportShares([{ buffs: actor.buffs, accepts: (buff) => buff.stat === "stunRate" && !buff.debuff }], measureProc)[0];
      target.buffs.push({ stat: "stunned", value: 1, expiresAfterRound: round, debuff: true, stunSupportSourceId: source?.sourceId });
    } else if (target.alive && !debuffImmune(target, round)) {
      target.preventedStuns.push(...cardBattleSupportShares([{ buffs: actor.buffs,
        accepts: (buff) => buff.stat === "stunRate" && Boolean(buff.debuff) }], measureProc, -1));
    }
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

  const applyEffect = (actor: RuntimeCard, effect: CardBattleSkillAction, round: number, root: number, damaged?: Set<RuntimeCard>, bondTargets?: RuntimeCard[]) => {
    if (safetyStopped) return;
    const visual = visualForEffect(effect.type);
    const durationMs = visual === "damage" ? 1300 : 1000;
    // Reserve the visual event before changing runtime state. Reaching a safety
    // limit must never create a state transition that the client cannot animate.
    if (!canAddEvent(durationMs)) {
      safetyStopped = true;
      return;
    }
    const targets = bondTargets ?? (effect.type === "revival_block_damaged" ? [...damaged ?? []] : targetsFor(actor, effect.type));
    const amount = Math.max(0, effect.value ?? 0);
    const visuals: CardBattleVisualEffect[] = [];
    const deadCards: RuntimeCard[] = [];
    const crossedThresholds: RuntimeCard[] = [];
    let lifesteal = 0;
    const expiresAfterRound = round + Math.max(1, effect.duration ?? 1) - 1;
    if (isCardBattleStun(effect.type) || isCardBattleRevivalBlock(effect.type) || isCardBattleImmunity(effect.type)) {
      const immunity = isCardBattleImmunity(effect.type);
      const stun = isCardBattleStun(effect.type);
      for (const target of targets) {
        if (stun && stunRandom() >= (effect.probability ?? 100) / 100) {
          visuals.push({ targetId: target.instanceId, label: "眩晕未生效" });
          continue;
        }
        if (!immunity && debuffImmune(target, round)) {
          visuals.push({ targetId: target.instanceId, label: "抵抗负面状态", stunResisted: stun });
          continue;
        }
        grantBuff(actor, target, { stat: immunity ? "immunity" : stun ? "stunned" : "revivalBlock", value: 1,
          debuff: !immunity, expiresAfterRound, ...(stun ? { stunSupportSourceId: actor.instanceId } : {}) });
        visuals.push({ targetId: target.instanceId, label: immunity ? "免疫" : stun ? "眩晕" : "禁止复活", stunned: stun });
      }
    } else if (isCardBattleCleanse(effect.type)) {
      for (const target of targets) {
        // One application can contain multiple stat components (attack + skill damage).
        const layers = [...new Set(target.buffs.filter((buff) => buff.debuff && buff.expiresAfterRound >= round)
          .map((buff) => buff.applicationId ?? buff))].slice(0, amount);
        const removed = new Set(layers);
        target.buffs = target.buffs.filter((buff) => !buff.debuff || !removed.has(buff.applicationId ?? buff));
        target.maxHp = cardBattleEffectiveStat(target.tier.maxHp, target.buffs, "maxHp", 1);
        target.hp = Math.min(target.hp, target.maxHp);
        visuals.push({ targetId: target.instanceId, amount: layers.length, label: `净化 ${layers.length} 个减益` });
      }
    } else if (visual === "damage") {
      gainEnergy(actor, 10);
      for (const target of targets) {
        if (dodges(actor, target)) { visuals.push({ targetId: target.instanceId, dodged: true, label: "闪避", amount: 0 }); continue; }
        const beforeRatio = target.maxHp > 0 ? target.hp / target.maxHp : 0;
        const { critical, multiplier } = rollCardBattleCritical(cardBattleEffectiveCritical(actor.tier, actor.buffs), criticalRandom);
        const hit = damageHit(actor, target, amount + battleCollectibleBonus(actor.collectible, "skill_damage"), "skillDamage", multiplier, round, root, effect.ignoreDefensePercent ?? 0, isCardBattleTrueDamage(effect.type));
        const { incomingDamage, damage } = hit;
        // 承伤统计包含防御抵消和溢出的伤害；命中即回能，完全抵挡也不例外。
        target.damageTaken += incomingDamage;
        gainEnergy(target, 10);
        if (damage > 0) {
          target.hp -= hit.hpDamage;
          actor.damageDealt += damage;
          damaged?.add(target);
        }
        visuals.push({ targetId: target.instanceId, amount: -damage, hpDamage: hit.hpDamage, shieldDamage: hit.shieldDamage, blocked: damage === 0, critical,
          ...(hit.unprotectedDamage > damage ? { label: collectibleProtection(target, "invincible", round) ? "无敌" : "免死" } : {}) });
        if (target.hp <= 0 && target.alive) {
          target.hp = 0;
          target.alive = false;
          target.shields = [];
          target.revivalSourceId = null;
          target.preventedStuns = [];
          deadCards.push(target);
        } else if (target.alive && target.hp / target.maxHp < beforeRatio) crossedThresholds.push(target);
        const proc = onHit(actor, target, damage, round, root);
        lifesteal += proc.lifesteal;
        Object.assign(visuals[visuals.length - 1]!, { stunned: proc.stunned, stunResisted: proc.stunResisted });
      }
    } else if (visual === "heal") {
      for (const target of targets) {
        const { critical, multiplier } = rollCardBattleCritical(cardBattleEffectiveCritical(actor.tier, actor.buffs), criticalRandom);
        const outgoing = Math.round(amount * multiplier * (1 + battleCollectibleBonus(actor.collectible, "healing") / 100));
        const measure = ([buffs]: CardBattleBuff[][]) => Math.min(
          cardBattleEffectiveStat(outgoing * (1 + battleCollectibleBonus(target.collectible, "healing_received") / 100), buffs!, "healingReceived"),
          Math.max(0, target.maxHp - target.hp));
        const healed = measure([target.buffs]);
        const gained = creditShares(cardBattleSupportShares([{ buffs: target.buffs,
          accepts: (buff) => buff.stat === "healingReceived" && !buff.debuff }], measure), "healingBoost");
        creditSupport(actor.instanceId, "healing", healed - gained);
        creditShares(cardBattleSupportShares([{ buffs: target.buffs,
          accepts: (buff) => buff.stat === "healingReceived" && Boolean(buff.debuff) }], measure, -1), "healingReduction");
        creditExtraAction(actor, root, healed);
        target.hp += healed;
        actor.healingDone += healed;
        if (healed > 0) visuals.push({ targetId: target.instanceId, amount: healed, critical });
      }
    } else if (visual === "energy") {
      for (const target of targets) {
        const before = target.energy;
        gainEnergy(target, amount);
        const gained = target.energy - before;
        creditSupport(actor.instanceId, "energy", gained * 100);
        if (gained > 0) visuals.push({ targetId: target.instanceId, amount: gained, label: effectLabel(effect.type, gained) });
      }
    } else if (visual === "debuff") {
      const debuff = cardBattleDebuff(effect.type)!;
      const expiresAfterRound = round + Math.max(1, effect.duration ?? 1) - 1;
      for (const target of targets) {
        if (debuffImmune(target, round)) {
          visuals.push({ targetId: target.instanceId, label: "抵抗负面状态" });
          continue;
        }
        const stat = cardBattleProcStat(effect.type) ?? (debuff.status === "speed_down" ? "speed" : debuff.status === "defense_down" ? "defense" : debuff.status === "max_hp_down" ? "maxHp" : debuff.status === "healing_received_down" ? "healingReceived" : "attack");
        const before = Math.min(100, cardBattleBuffBonus(target.buffs, stat, true));
        const previousSpeed = effectiveStat(target, "speed");
        const previousHp = target.hp;
        const applicationId = ++buffSequence;
        grantBuff(actor, target, { stat, value: bondTargets ? amount : Math.min(100, amount), expiresAfterRound, debuff: true, applicationId,
          ...(bondTargets ? { independent: true, flat: true } : {}) });
        if (stat === "attack") grantBuff(actor, target, { stat: "skillDamage", value: Math.min(100, amount), expiresAfterRound, debuff: true, applicationId });
        if (stat === "maxHp") {
          target.maxHp = cardBattleEffectiveStat(target.tier.maxHp, target.buffs, "maxHp", 1);
          target.hp = Math.min(target.hp, target.maxHp);
          creditSupport(actor.instanceId, "maxHp", previousHp - target.hp);
        }
        if (stat === "speed") creditSupport(actor.instanceId, "speed", (previousSpeed - effectiveStat(target, "speed")) * 100);
        const applied = Math.min(100, cardBattleBuffBonus(target.buffs, stat, true)) - before;
        visuals.push({ targetId: target.instanceId, amount: bondTargets ? amount : applied, label: `${debuff.label} -${bondTargets ? amount : applied}${bondTargets ? "" : "%"}` });
      }
    } else if (visual === "buff") {
      for (const target of targets) {
        if (isCardBattleShield(effect.type)) {
          target.shields.push({ remaining: amount, expiresAfterRound, sourceId: actor.instanceId, order: ++buffSequence });
          visuals.push({ targetId: target.instanceId, shieldGained: amount, amount, label: `护盾 +${amount}` });
          continue;
        }
        const accuracyStat = cardBattleAccuracyStat(effect.type);
        if (accuracyStat) {
          grantBuff(actor, target, { stat: accuracyStat, value: amount, expiresAfterRound, independent: true });
          visuals.push({ targetId: target.instanceId, amount, label: `${accuracyStat === "dodgeRate" ? "闪避率" : "命中率"} +${amount}%` });
          continue;
        }
        const procStat = cardBattleProcStat(effect.type);
        if (procStat) {
          const before = cardBattleEffectiveProc(target.tier, target.buffs, procStat);
          grantBuff(actor, target, { stat: procStat, value: amount, expiresAfterRound: round + Math.max(1, effect.duration ?? 1) - 1, ...(bondTargets ? { independent: true } : {}) });
          const gained = cardBattleEffectiveProc(target.tier, target.buffs, procStat) - before;
          visuals.push({ targetId: target.instanceId, amount: gained, label: effectLabel(effect.type, gained) });
          continue;
        }
        const before = { attack: effectiveStat(target, "attack"), skillDamage: effectiveSkillDamage(target, 0), defense: effectiveStat(target, "defense"), speed: effectiveStat(target, "speed"), maxHp: target.maxHp };
        let gained = 0;
        let label = "";
        if (effect.type.startsWith("max_hp_")) {
          // Max-HP increases keep their existing lifetime: until this life ends.
          grantBuff(actor, target, { stat: "maxHp", value: amount, expiresAfterRound: bondTargets ? expiresAfterRound : Infinity, ...(bondTargets ? { independent: true } : {}) });
          target.maxHp = cardBattleEffectiveStat(target.tier.maxHp, target.buffs, "maxHp", 1);
          gained = target.maxHp - before.maxHp;
          target.hp += gained;
          creditSupport(actor.instanceId, "maxHp", gained);
        } else if (effect.type.startsWith("attack_skill_damage_")) {
          const expiresAfterRound = round + Math.max(1, effect.duration ?? 1) - 1;
          grantBuff(actor, target, { stat: "attack", value: amount, expiresAfterRound });
          grantBuff(actor, target, { stat: "skillDamage", value: amount, expiresAfterRound });
          gained = effectiveStat(target, "attack") - before.attack;
          const skillGained = effectiveSkillDamage(target, 0) - before.skillDamage;
          label = gained === skillGained ? effectLabel(effect.type, gained) : `攻击 +${gained} / 技能伤害 +${skillGained}`;
        } else {
          const stat = effect.type.startsWith("attack_") ? "attack" : effect.type.startsWith("defense_") ? "defense" : "speed";
          grantBuff(actor, target, { stat, value: amount, expiresAfterRound: round + Math.max(1, effect.duration ?? 1) - 1, ...(bondTargets ? { independent: true } : {}) });
          gained = effectiveStat(target, stat) - before[stat];
          if (stat === "speed") creditSupport(actor.instanceId, "speed", gained * 100);
        }
        if (gained > 0) visuals.push({ targetId: target.instanceId, amount: gained, label: label || effectLabel(effect.type, gained) });
      }
    } else if (visual === "revive") {
      for (const target of targets) {
        if (target.buffs.some((buff) => buff.stat === "revivalBlock" && buff.expiresAfterRound >= round)) {
          visuals.push({ targetId: target.instanceId, blocked: true, label: "禁止复活" });
          continue;
        }
        target.alive = true;
        target.maxHp = target.tier.maxHp;
        target.hp = target.maxHp;
        target.energy = 0;
        target.buffs = [];
        target.shields = [];
        target.lifeTriggeredThresholds.clear();
        target.revivedRound = round;
        target.revivalSourceId = actor.instanceId;
        target.preventedStuns = [];
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
    }, false, root);
    queueDeaths(deadCards, actor, "skill_kill", root);
    for (const target of crossedThresholds) triggerQueue.push({
      kind: "hp_below",
      cardId: target.instanceId,
      actorId: actor.instanceId,
      root,
      energyFullAtTrigger: target.energy >= target.tier.energyRequired,
    });
  };

  const applySkill = (actor: RuntimeCard, skill: CardBattleSkillEffect, round: number, root: number) => {
    const damaged = new Set<RuntimeCard>();
    const actions = [skill, ...skill.additionalEffects ?? []];
    const countedApply = (action: CardBattleSkillAction) => {
      const count = (triggerEffectsByRoot.get(root) ?? 0) + 1;
      triggerEffectsByRoot.set(root, count);
      if (count > CARD_BATTLE_MAX_TRIGGER_EFFECTS) { safetyStopped = true; return; }
      applyEffect(actor, action, round, root, damaged);
    };
    for (const action of actions) {
      if (safetyStopped) break;
      if (action.type !== "act_again" && action.type !== "revival_block_damaged") countedApply(action);
    }
    // Collect every damage action's actual victims before any queued death triggers run.
    for (const action of actions.filter((item) => item.type === "revival_block_damaged")) {
      if (safetyStopped) break;
      countedApply(action);
    }
    if (!safetyStopped && actions.some((action) => action.type === "act_again")) {
      guaranteedExtras.add(`${root}:${actor.instanceId}`);
    }
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
      if (matching.some((effect) => isEnergyCondition(effect.condition))) clearEnergy(card, trigger.root);
      for (const effect of matching) {
        applySkill(card, effect, round, trigger.root);
        if (safetyStopped) break;
      }
      bonds.emit("skill", card, trigger.root);
      drainBonds(round);
      tryExtraAction(card, round, trigger.root);
    }
  };

  const performAction = (actor: RuntimeCard, round: number, root: number, forced?: "attack" | "skill") => {
      if (!actor.alive || isStunned(actor) || safetyStopped) return;
      const energyEffects = actor.tier.effects
        .filter((effect) => effect.condition === "energy_full")
        .sort((left, right) => left.order - right.order);
      if (forced === "skill" || (forced !== "attack" && actor.energy >= actor.tier.energyRequired && energyEffects.length)) {
        clearEnergy(actor, root);
        for (const effect of energyEffects) applySkill(actor, effect, round, root);
        if (forced === "skill") clearEnergy(actor, root);
        // Include final energy clearing even when no damage/effect event follows it.
        if (forced === "skill") addEvent({round,kind:"skill",visual:"energy",actorId:actor.instanceId,skillName:null,effects:[],durationMs:300,text:`${actor.name} 清空能量`}, false, root);
        bonds.emit("skill", actor, root);
        processTriggers(round);
      } else {
        const target = randomOne(basicTargets(actor));
        if (!target) return;
        if (!canAddEvent(1100)) {
          safetyStopped = true;
          return;
        }
        if (dodges(actor, target)) {
          gainEnergy(actor, 10);
          addEvent({ round, kind: "attack", visual: "damage", actorId: actor.instanceId, skillName: null, effects: [{ targetId: target.instanceId, dodged: true, label: "闪避", amount: 0 }], durationMs: 1100, text: `${actor.name} 攻击 ${target.name}，被闪避` }, false, root);
          bonds.emit("attack", actor, root);
        } else {
          const beforeRatio = target.hp / target.maxHp;
          const { critical, multiplier } = rollCardBattleCritical(cardBattleEffectiveCritical(actor.tier, actor.buffs), criticalRandom);
          const hit = damageHit(actor, target, actor.tier.attack, "attack", multiplier, round, root);
          const { incomingDamage, damage } = hit;
          target.damageTaken += incomingDamage;
          gainEnergy(actor, 10);
          gainEnergy(target, 10);
          if (damage > 0) {
            target.hp -= hit.hpDamage;
            actor.damageDealt += damage;
          }
          const died = target.hp <= 0 && target.alive;
          if (died) { target.hp = 0; target.alive = false; target.shields = []; target.revivalSourceId = null; target.preventedStuns = []; }
          const proc = onHit(actor, target, damage, round, root);
          addEvent({
            lifesteal: proc.lifesteal, extraAction: extraActionRoots.has(root),
            round, kind: "attack", visual: "damage", actorId: actor.instanceId, skillName: null,
            effects: [{ targetId: target.instanceId, amount: -damage, hpDamage: hit.hpDamage, shieldDamage: hit.shieldDamage, blocked: damage === 0, critical, stunned: proc.stunned, stunResisted: proc.stunResisted,
              ...(hit.unprotectedDamage > damage ? { label: collectibleProtection(target, "invincible", round) ? "无敌" : "免死" } : {}) }], durationMs: 1100,
            text: `${actor.name} 攻击 ${target.name}`,
          }, false, root);
          bonds.emit("attack", actor, root);
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
      }
    drainBonds(round);
    tryExtraAction(actor, round, root);
  };

  const tryExtraAction = (actor: RuntimeCard, round: number, root: number) => {
    if (safetyStopped || extraActionRoots.has(root) || !actor.alive || isStunned(actor) || !enemies(actor).length) return;
    const key = `${root}:${actor.instanceId}`;
    if (completedExtras.has(key)) return;
    const guaranteed = guaranteedExtras.has(key);
    const rate = cardBattleEffectiveProc(actor.tier, actor.buffs, "extraActionRate");
    const roll = rate > 0 ? extraActionRandom() : supportRandom();
    const measure = ([buffs]: CardBattleBuff[][]) => roll < cardBattleEffectiveProc(actor.tier, buffs!, "extraActionRate") / 100 ? 1 : 0;
    if (!guaranteed && (rate <= 0 || roll >= rate / 100)) {
      // No new combat event: attach this completed-action contribution to its
      // last visible snapshot, so surrender never reads a future settlement.
      const prevented = cardBattleSupportShares([{ buffs: actor.buffs,
        accepts: (buff) => buff.stat === "extraActionRate" && Boolean(buff.debuff) }], measure, -1);
      creditShares(prevented, "extraActionPrevention", 1000);
      if (prevented.length && events.length) events[events.length - 1]!.states = states();
      return;
    }
    if (!canAddEvent(650)) { safetyStopped = true; return; }
    completedExtras.add(key);
    const extraRoot = ++rootSequence;
    bonds.inherit(root, extraRoot);
    extraActionRoots.add(extraRoot);
    const source = cardBattleSupportShares([{ buffs: actor.buffs,
      accepts: (buff) => buff.stat === "extraActionRate" && !buff.debuff }], measure)[0];
    if (guaranteed || source) extraActionSupport.set(extraRoot, { actorId: actor.instanceId, sourceId: guaranteed ? actor.instanceId : source!.sourceId });
    addEvent({ round, kind: "extra_action", visual: "extra_action", actorId: actor.instanceId, skillName: null,
      effects: [{ targetId: actor.instanceId, label: "再动" }], extraAction: true, durationMs: 650, text: `${actor.name} 立即再次行动` }, false, extraRoot);
    bonds.emit("extra_action", actor, extraRoot);
    performAction(actor, round, extraRoot);
  };

  const sideAlive = (seat: 1 | 2) => cards.some((card) => card.seat === seat && card.alive);
  const bondRandom = seededRandom(`${seed}:bond-targets`);
  const bondTargetsFor = (owner: RuntimeCard, trigger: RuntimeCard, target: CardBattleBondTarget) => {
    if (target === "self") return owner.alive ? [owner] : [];
    if (target === "trigger") return trigger.alive ? [trigger] : [];
    if (target.startsWith("random_")) return shuffled(allies(owner), bondRandom).slice(0, Number(target.slice(-1)));
    const side = target.startsWith("enemies") ? enemies(owner) : allies(owner);
    // Explicit front/rear targets never fall back to a different row.
    return target.endsWith("_front") ? side.filter(card => card.row === "front")
      : target.endsWith("_rear") ? side.filter(card => card.row === "rear") : side;
  };
  const bondEffectTypes = {
    shield: "shield_self", dodge_up: "dodge_self", hit_up: "hit_self",
    attack_up: "attack_self", defense_up: "defense_self", speed_up: "speed_self", max_hp_up: "max_hp_self",
    heal: "heal_self", energy: "energy_self", extra_action_up: "extra_action_self",
    lifesteal_up: "lifesteal_self", stun_up: "stun_self", speed_down: "speed_down_all",
  } as const;
  const drainBonds = (round: number) => bonds.drain(({owner,trigger,bond,root}) => {
    const previousBond = activeBond;
    activeBond = {ownerId:owner.instanceId, triggerId:trigger.instanceId};
    try {
      for (const action of bond.actions) {
        if (safetyStopped || !owner.alive || isStunned(owner)) break;
        const count = (triggerEffectsByRoot.get(root) ?? 0) + 1;
        triggerEffectsByRoot.set(root, count);
        if (count > CARD_BATTLE_MAX_TRIGGER_EFFECTS) { safetyStopped = true; break; }
        const targets = bondTargetsFor(owner, trigger, action.target);
        if (!targets.length) continue;
        if (action.type === "crit_rate_up" || action.type === "crit_damage_up") {
          if (!canAddEvent(1000)) { safetyStopped = true; break; }
          const stat = action.type === "crit_rate_up" ? "critRate" : "critDamage";
          for (const target of targets) grantBuff(owner, target, { stat, value: action.value!, expiresAfterRound: round + action.duration! - 1, independent: true });
          addEvent({ round, kind: "skill", visual: "buff", actorId: owner.instanceId, skillName: "羁绊技能",
            effects: targets.map(target => ({ targetId: target.instanceId, amount: action.value!, label: `${stat === "critRate" ? "暴击率" : "暴击伤害"} +${action.value}%` })),
            durationMs: 1000, text: `${owner.name} ${CARD_BATTLE_BOND_ACTIONS[action.type]}` }, false, root);
        } else if (action.type === "attack" || action.type === "skill" || action.type === "act_again") {
          for (const target of targets) {
            if (safetyStopped || !owner.alive || isStunned(owner)) break;
            if (!target.alive || isStunned(target) || !enemies(target).length) continue;
            const child = ++rootSequence;
            bonds.inherit(root, child);
            extraActionRoots.add(child);
            extraActionSupport.set(child, {actorId:target.instanceId, sourceId:owner.instanceId});
            if (!addEvent({round,kind:"extra_action",visual:"extra_action",actorId:target.instanceId,skillName:"羁绊技能",
              effects:[{targetId:target.instanceId,label:CARD_BATTLE_BOND_ACTIONS[action.type]}],extraAction:true,durationMs:650,
              text:`${owner.name} 令 ${target.name} ${CARD_BATTLE_BOND_ACTIONS[action.type]}`}, false, child)) break;
            if (action.type === "act_again") bonds.emit("extra_action", target, child);
            performAction(target, round, child, action.type === "act_again" ? undefined : action.type);
          }
        } else {
          applyEffect(owner, {type:bondEffectTypes[action.type],value:action.value,duration:action.duration}, round, root, undefined, targets);
          processTriggers(round);
        }
      }
    } finally { activeBond = previousBond; }
  }, () => safetyStopped);
  const openBonds = (incoming: RuntimeCard[], round: number) => {
    const root = ++rootSequence;
    for (const card of incoming) {
      if (card.energy === 0) bonds.emit("energy_empty", card, root);
      if (card.energy >= card.tier.energyRequired) bonds.emit("energy_full", card, root);
    }
    drainBonds(round);
  };
  const winnerAfterChains = () => sideAlive(1) === sideAlive(2) ? null : sideAlive(1) ? 1 as const : 2 as const;
  const advanceSquads = (round: number) => {
    const joined: RuntimeCard[] = [];
    while (mode === "tower" && !safetyStopped && !sideAlive(1) && sideAlive(2) && squadIndex + 1 < squadIds.length) {
      const nextIds = squadIds[++squadIndex]!;
      const incoming = allCards.filter(card => nextIds.has(card.instanceId));
      cards = [...cards.filter(card => card.seat === 2), ...incoming];
      addEvent({round,kind:"round",visual:"round",actorId:null,skillName:null,effects:[],durationMs:900,text:`${challengers[squadIndex]!.nickname} 接替上场`});
      joined.push(...incoming);
      openBonds(incoming, round);
    }
    return joined;
  };
  let completedRounds = 0;
  let winnerSeat: 1 | 2 | null = null;
  let endReason: CardBattleResult["endReason"] = "round_limit";

  for (let round = 1; round <= maxRounds && !safetyStopped; round += 1) {
    currentRound = round;
    completedRounds = round;
    if (!addEvent({ round, kind: "round", visual: "round", actorId: null, skillName: null, effects: [], durationMs: 500, text: `第 ${round} 回合` })) break;
    if (round === 1) { openBonds(cards, round); advanceSquads(round); }
    const initiative = shuffled(cards.filter((card) => card.alive), random)
      .sort((left, right) => effectiveStat(right, "speed") - effectiveStat(left, "speed"));
    for (const actor of initiative) {
      if (safetyStopped) break;
      if (!actor.alive || actor.revivedRound === round || !sideAlive(actor.seat === 1 ? 2 : 1)) continue;
      if (isStunned(actor)) {
        const stuns = actor.buffs.filter((buff) => buff.stat === "stunned" && buff.expiresAfterRound >= round);
        // An ordinary/base stun already prevents this action; multiple stuns
        // cannot claim the same skipped round, even from different casters.
        if (canAddEvent(650) && stuns.every((buff) => buff.stunSupportSourceId)) creditSupport(stuns[0]?.stunSupportSourceId, "stun", 1000);
        actor.preventedStuns = [];
        addEvent({ round, kind: "stun", visual: "stun", actorId: actor.instanceId, skillName: null,
          effects: [{ targetId: actor.instanceId, label: "眩晕·跳过行动" }], durationMs: 650, text: `${actor.name} 因眩晕无法行动` });
        continue;
      }
      const nextDuration = actor.energy >= actor.tier.energyRequired && actor.tier.effects.some((effect) => effect.condition === "energy_full")
        ? (visualForEffect([...actor.tier.effects].filter((effect) => effect.condition === "energy_full").sort((a, b) => a.order - b.order)[0]!.type) === "damage" ? 1300 : 1000) : 1100;
      if (canAddEvent(nextDuration)) creditSupport(actor.preventedStuns[0]?.sourceId, "stun", 1000);
      actor.preventedStuns = [];
      performAction(actor, round, ++rootSequence);
      // Finish death/revival chains before retiring this squad. Retired cards are
      // absent from targeting, but remain in allCards for historical contribution.
      const incoming = advanceSquads(round);
      // New squad acts in this same round; surviving BOSS actions are not replayed.
      initiative.push(...shuffled(incoming, random).sort((a, b) => effectiveStat(b, "speed") - effectiveStat(a, "speed")));
      if (!sideAlive(1) || !sideAlive(2)) {
        winnerSeat = winnerAfterChains();
        endReason = winnerSeat ? "elimination" : "simultaneous_elimination";
        break;
      }
    }
    if (!safetyStopped) {
      for (const card of cards) {
        card.preventedStuns = [];
        card.shields = card.shields.filter(shield => shield.remaining > 0 && shield.expiresAfterRound > round);
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
  } else if (mode === "tower" && !sideAlive(2) && allCards.some((card) => card.seat === 1 && card.alive)) {
    // A final death chain can eliminate the deployed squad and BOSS together;
    // living reserves still belong to the challenger even before deployment.
    winnerSeat = 1;
    endReason = "elimination";
  } else if (sideAlive(1) && sideAlive(2) && completedRounds >= maxRounds) {
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
    winnerSeat = mode !== "1v1" ? 2 : one.alive !== two.alive ? (one.alive > two.alive ? 1 : 2)
      : one.hpRatio !== two.hpRatio ? (one.hpRatio > two.hpRatio ? 1 : 2)
      : one.damage !== two.damage ? (one.damage > two.damage ? 1 : 2)
      : null;
    endReason = "round_limit";
  } else if (!sideAlive(1) && !sideAlive(2)) {
    winnerSeat = null;
    endReason = "simultaneous_elimination";
  } else if (sideAlive(1) !== sideAlive(2)) {
    winnerSeat = winnerAfterChains();
    endReason = "elimination";
  }

  addEvent({
    round: completedRounds, kind: "end", visual: "end", actorId: null, skillName: null, effects: [], durationMs: 1200,
    text: mode !== "1v1" ? (winnerSeat === 1 ? "挑战成功" : "挑战失败") : winnerSeat ? `${players.find((player) => player.seat === winnerSeat)?.nickname ?? "玩家"} 获胜` : "本局平局",
  }, true);
  const settlementPlayers = players.map((player) => ({
    userId: player.userId,
    nickname: player.nickname,
    seat: player.seat,
    cards: allCards.filter((card) => player.cards.some((input) => input.instanceId === card.instanceId)).sort((left, right) => left.slot - right.slot).map((card) => ({
      slot: card.slot,
      cardId: card.cardId,
      name: card.name,
      damageDealt: card.damageDealt,
      damageTaken: card.damageTaken,
      healingDone: card.healingDone,
      supportDone: card.supportDone,
      supportBreakdown: { ...card.supportBreakdown },
      score: calculateCardBattleScore(card.damageDealt, card.damageTaken, card.supportDone),
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
