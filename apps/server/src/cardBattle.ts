export const CARD_BATTLE_MAX_ROUNDS = 30;
export const CARD_BATTLE_LINEUP_SIZE = 5;
export const CARD_BATTLE_MAX_TRIGGER_EFFECTS = 100;
export const CARD_BATTLE_MAX_EVENTS = 400;
export const CARD_BATTLE_MAX_PLAYBACK_MS = 7 * 60_000;

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

export type CardBattleTier = {
  starLevel: 0 | 1 | 2 | 3;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  energyRequired: number;
  canAttackRear: boolean;
  skillName: string;
  skillDescription: string;
  effects: CardBattleSkillEffect[];
};

export type CardBattleDeckCard = {
  instanceId: string;
  cardId: string;
  name: string;
  imageUrl: string;
  rarity: "epic" | "legend";
  starLevel: 0 | 1 | 2 | 3;
  slot: 1 | 2 | 3 | 4 | 5;
  tier: CardBattleTier;
};

export type CardBattlePlayerInput = {
  userId: string;
  nickname: string;
  seat: 1 | 2;
  cards: CardBattleDeckCard[];
};

export type CardBattlePublicCardState = {
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
};

export type CardBattleVisualEffect = {
  targetId: string;
  amount?: number;
  blocked?: boolean;
  label?: string;
};

export type CardBattleEvent = {
  sequence: number;
  round: number;
  kind: "round" | "attack" | "skill" | "end";
  visual: "round" | "damage" | "heal" | "energy" | "buff" | "revive" | "end";
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
};

export type CardBattleSettlementPlayer = {
  userId: string;
  nickname: string;
  seat: 1 | 2;
  cards: CardBattleSettlementCard[];
};

export type CardBattleResult = {
  version: 1;
  winnerSeat: 1 | 2 | null;
  endReason: "elimination" | "round_limit" | "simultaneous_elimination" | "safety_limit";
  rounds: number;
  players: CardBattleSettlementPlayer[];
  initialStates: CardBattlePublicCardState[];
  finalStates: CardBattlePublicCardState[];
  events: CardBattleEvent[];
  playbackDurationMs: number;
};

type Buff = { stat: "attack" | "defense" | "speed"; value: number; expiresAfterRound: number };
type RuntimeCard = CardBattleDeckCard & {
  userId: string;
  seat: 1 | 2;
  row: "front" | "rear";
  hp: number;
  maxHp: number;
  energy: number;
  alive: boolean;
  buffs: Buff[];
  damageDealt: number;
  damageTaken: number;
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
  return Math.max(0, card.tier[stat] + card.buffs.filter((buff) => buff.stat === stat).reduce((sum, buff) => sum + buff.value, 0));
}

function publicState(card: RuntimeCard): CardBattlePublicCardState {
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
  if (type.startsWith("damage_")) return "damage";
  if (type.startsWith("heal_")) return "heal";
  if (type.startsWith("energy_")) return "energy";
  if (type.startsWith("revive_")) return "revive";
  return "buff";
}

function effectLabel(type: CardBattleEffectCode, value: number) {
  if (type.startsWith("attack_")) return `攻击 +${value}`;
  if (type.startsWith("defense_")) return `防御 +${value}`;
  if (type.startsWith("speed_")) return `速度 +${value}`;
  if (type.startsWith("max_hp_")) return `生命上限 +${value}`;
  if (type.startsWith("energy_")) return `能量 +${value}`;
  if (type.startsWith("revive_")) return "复活";
  return "";
}

export function simulateCardBattle(players: CardBattlePlayerInput[], seed: string): CardBattleResult {
  if (players.length !== 2 || players.some((player) => player.cards.length !== CARD_BATTLE_LINEUP_SIZE)) {
    throw new CardBattleRuleError("卡牌对战必须由两名玩家各携带五张卡牌");
  }
  const ids = players.flatMap((player) => player.cards.map((card) => card.instanceId));
  if (new Set(ids).size !== ids.length) throw new CardBattleRuleError("战斗卡牌实例不能重复");
  const random = seededRandom(seed);
  const cards: RuntimeCard[] = players.flatMap((player) => player.cards.map((card) => ({
    ...card,
    userId: player.userId,
    seat: player.seat,
    row: card.slot <= 2 ? "front" : "rear",
    hp: card.tier.maxHp,
    maxHp: card.tier.maxHp,
    energy: 0,
    alive: true,
    buffs: [],
    damageDealt: 0,
    damageTaken: 0,
    lifeTriggeredThresholds: new Set<string>(),
    revivedRound: null,
  })));
  const initialStates = cards.map(publicState);
  const events: CardBattleEvent[] = [];
  let rootSequence = 0;
  const triggerEffectsByRoot = new Map<number, number>();
  let safetyStopped = false;
  let playbackDurationMs = 0;

  const byId = (id: string) => cards.find((card) => card.instanceId === id)!;
  const allies = (card: RuntimeCard, aliveOnly = true) => cards.filter((candidate) => candidate.seat === card.seat && (!aliveOnly || candidate.alive));
  const enemies = (card: RuntimeCard) => cards.filter((candidate) => candidate.seat !== card.seat && candidate.alive);
  const states = () => cards.map(publicState);
  const canAddEvent = (durationMs: number, finalEvent = false) => {
    const reservedEndDuration = finalEvent ? 0 : 1200;
    const eventLimitReached = finalEvent ? events.length >= CARD_BATTLE_MAX_EVENTS : events.length >= CARD_BATTLE_MAX_EVENTS - 1;
    return !eventLimitReached && playbackDurationMs + durationMs + reservedEndDuration <= CARD_BATTLE_MAX_PLAYBACK_MS;
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
    if (["heal_self", "energy_self", "defense_self", "speed_self", "max_hp_self", "attack_self"].includes(type)) return actor.alive ? [actor] : [];
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
    if (["heal_all_allies", "energy_all_allies", "defense_all_allies", "speed_all_allies", "max_hp_all_allies", "attack_all_allies"].includes(type)) return livingAllies;
    if (type === "revive_self") return actor.alive ? [] : [actor];
    const deadOwnCards = allies(actor, false).filter((card) => !card.alive);
    const deadAllies = deadOwnCards.filter((card) => card.instanceId !== actor.instanceId);
    if (type === "revive_all_allies") return deadOwnCards;
    if (type.startsWith("revive_ally_")) return shuffled(deadAllies, random).slice(0, Number(type.slice(-1)));
    return [];
  };

  const triggerQueue: Trigger[] = [];
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
    if (visual === "damage") {
      gainEnergy(actor, 10);
      for (const target of targets) {
        const beforeRatio = target.maxHp > 0 ? target.hp / target.maxHp : 0;
        const damage = Math.min(target.hp, Math.max(0, amount - effectiveStat(target, "defense")));
        if (damage > 0) {
          target.hp -= damage;
          actor.damageDealt += damage;
          target.damageTaken += damage;
          gainEnergy(target, 10);
        }
        visuals.push({ targetId: target.instanceId, amount: -damage, blocked: damage === 0 });
        if (target.hp <= 0 && target.alive) {
          target.hp = 0;
          target.alive = false;
          deadCards.push(target);
        } else if (target.alive && target.hp / target.maxHp < beforeRatio) crossedThresholds.push(target);
      }
    } else if (visual === "heal") {
      for (const target of targets) {
        const healed = Math.min(amount, Math.max(0, target.maxHp - target.hp));
        target.hp += healed;
        if (healed > 0) visuals.push({ targetId: target.instanceId, amount: healed });
      }
    } else if (visual === "energy") {
      for (const target of targets) {
        const before = target.energy;
        gainEnergy(target, amount);
        const gained = target.energy - before;
        if (gained > 0) visuals.push({ targetId: target.instanceId, amount: gained, label: effectLabel(effect.type, gained) });
      }
    } else if (visual === "buff") {
      for (const target of targets) {
        if (effect.type.startsWith("max_hp_")) {
          target.maxHp += amount;
          target.hp += amount;
        } else {
          const stat = effect.type.startsWith("attack_") ? "attack" : effect.type.startsWith("defense_") ? "defense" : "speed";
          target.buffs.push({ stat, value: amount, expiresAfterRound: round + Math.max(1, effect.duration ?? 1) - 1 });
        }
        visuals.push({ targetId: target.instanceId, amount, label: effectLabel(effect.type, amount) });
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
      visual,
      actorId: actor.instanceId,
      skillName: actor.tier.skillName || "卡牌技能",
      effects: visuals,
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

  const processTriggers = (round: number) => {
    const firedForRoot = new Set<string>();
    while (triggerQueue.length && !safetyStopped) {
      const trigger = triggerQueue.shift()!;
      const card = byId(trigger.cardId);
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
    }
  };

  const sideAlive = (seat: 1 | 2) => cards.some((card) => card.seat === seat && card.alive);
  const winnerAfterChains = () => sideAlive(1) === sideAlive(2) ? null : sideAlive(1) ? 1 as const : 2 as const;
  let completedRounds = 0;
  let winnerSeat: 1 | 2 | null = null;
  let endReason: CardBattleResult["endReason"] = "round_limit";

  for (let round = 1; round <= CARD_BATTLE_MAX_ROUNDS && !safetyStopped; round += 1) {
    completedRounds = round;
    if (!addEvent({ round, kind: "round", visual: "round", actorId: null, skillName: null, effects: [], durationMs: 500, text: `第 ${round} 回合` })) break;
    const initiative = shuffled(cards.filter((card) => card.alive), random)
      .sort((left, right) => effectiveStat(right, "speed") - effectiveStat(left, "speed"));
    for (const actor of initiative) {
      if (safetyStopped) break;
      if (!actor.alive || actor.revivedRound === round || !sideAlive(actor.seat === 1 ? 2 : 1)) continue;
      rootSequence += 1;
      const energyEffects = actor.tier.effects
        .filter((effect) => effect.condition === "energy_full")
        .sort((left, right) => left.order - right.order);
      if (actor.energy >= actor.tier.energyRequired && energyEffects.length) {
        actor.energy = 0;
        for (const effect of energyEffects) applyEffect(actor, effect, round, rootSequence);
        processTriggers(round);
      } else {
        const target = randomOne(basicTargets(actor));
        if (!target) continue;
        if (!canAddEvent(1100)) {
          safetyStopped = true;
          break;
        }
        const beforeRatio = target.hp / target.maxHp;
        const damage = Math.min(target.hp, Math.max(0, effectiveStat(actor, "attack") - effectiveStat(target, "defense")));
        gainEnergy(actor, 10);
        if (damage > 0) {
          target.hp -= damage;
          actor.damageDealt += damage;
          target.damageTaken += damage;
          gainEnergy(target, 10);
        }
        const died = target.hp <= 0 && target.alive;
        if (died) { target.hp = 0; target.alive = false; }
        addEvent({
          round, kind: "attack", visual: "damage", actorId: actor.instanceId, skillName: null,
          effects: [{ targetId: target.instanceId, amount: -damage, blocked: damage === 0 }], durationMs: 1100,
          text: `${actor.name} 攻击 ${target.name}`,
        });
        if (died) queueDeaths([target], actor, "normal_kill", rootSequence);
        else if (target.hp / target.maxHp < beforeRatio) triggerQueue.push({
          kind: "hp_below",
          cardId: target.instanceId,
          actorId: actor.instanceId,
          root: rootSequence,
          energyFullAtTrigger: target.energy >= target.tier.energyRequired,
        });
        processTriggers(round);
      }
      if (!sideAlive(1) || !sideAlive(2)) {
        winnerSeat = winnerAfterChains();
        endReason = winnerSeat ? "elimination" : "simultaneous_elimination";
        break;
      }
    }
    if (!safetyStopped) {
      for (const card of cards) card.buffs = card.buffs.filter((buff) => buff.expiresAfterRound > round);
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
    winnerSeat = one.alive !== two.alive ? (one.alive > two.alive ? 1 : 2)
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
    text: winnerSeat ? `${players.find((player) => player.seat === winnerSeat)?.nickname ?? "玩家"} 获胜` : "本局平局",
  }, true);
  const settlementPlayers = players.map((player) => ({
    userId: player.userId,
    nickname: player.nickname,
    seat: player.seat,
    cards: cards.filter((card) => card.seat === player.seat).sort((left, right) => left.slot - right.slot).map((card) => ({
      slot: card.slot,
      cardId: card.cardId,
      name: card.name,
      damageDealt: card.damageDealt,
      damageTaken: card.damageTaken,
    })),
  }));
  return {
    version: 1,
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
