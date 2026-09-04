import test from "node:test";
import assert from "node:assert/strict";
import { CARD_BATTLE_MAX_EVENTS, CARD_BATTLE_MAX_PLAYBACK_MS, CARD_BATTLE_MAX_ROUNDS, simulateCardBattle, type CardBattleDeckCard, type CardBattleSkillEffect } from "./cardBattle.js";

function card(id: string, slot: 1 | 2 | 3 | 4 | 5, overrides: Partial<CardBattleDeckCard["tier"]> = {}, effects: CardBattleSkillEffect[] = []): CardBattleDeckCard {
  return {
    instanceId: id, cardId: id, name: id, imageUrl: `/${id}.webp`, rarity: "legend", starLevel: 0, slot,
    tier: { starLevel: 0, maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50, canAttackRear: false, skillName: "测试技能", skillDescription: "", effects, ...overrides },
  };
}

function players(one: CardBattleDeckCard[], two: CardBattleDeckCard[]) {
  return [
    { userId: "u1", nickname: "甲", seat: 1 as const, cards: one },
    { userId: "u2", nickname: "乙", seat: 2 as const, cards: two },
  ];
}

test("每方五张卡且前排存活时不可攻击后排，前排清空后自动兜底", () => {
  const one = [1, 2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 2000, speed: 500 }));
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 200 }));
  const result = simulateCardBattle(players(one, two), "rows");
  const firstTargets = result.events.filter((event) => event.kind === "attack" && event.actorId?.startsWith("a")).slice(0, 2).flatMap((event) => event.effects.map((effect) => effect.targetId));
  assert.ok(firstTargets.every((id) => id === "b1" || id === "b2"));
  assert.ok(result.events.some((event) => event.kind === "attack" && event.effects.some((effect) => ["b3", "b4", "b5"].includes(effect.targetId))));
});

test("满能量技能代替普通攻击且技能伤害为双方恢复能量", () => {
  const skill: CardBattleSkillEffect = { id: "energy", order: 0, condition: "energy_full", conditionValue: null, type: "damage_single", value: 900, duration: null };
  const one = [card("a1", 1, { energyRequired: 10 }, [skill]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0, speed: 1 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, maxHp: 5000 }));
  const result = simulateCardBattle(players(one, two), "energy");
  const firstActorEvents = result.events.filter((event) => event.actorId === "a1");
  assert.equal(firstActorEvents[0]?.kind, "attack");
  assert.equal(firstActorEvents[1]?.kind, "skill");
  assert.ok((firstActorEvents[1]?.states.find((state) => state.instanceId === "a1")?.energy ?? -1) >= 0);
  assert.ok(firstActorEvents[1]?.effects.some((effect) => Number(effect.amount) < 0));
});

test("死亡技能可以无限次复活自己，安全阀最终兜底平局", () => {
  const revive: CardBattleSkillEffect = { id: "revive", order: 0, condition: "self_death", conditionValue: null, type: "revive_self", value: null, duration: null };
  const one = [card("a1", 1, { maxHp: 100 }, [revive]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { maxHp: 1 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 5000, speed: 500 }));
  const result = simulateCardBattle(players(one, two), "revive");
  assert.ok(result.events.filter((event) => event.visual === "revive" && event.effects.some((effect) => effect.targetId === "a1")).length >= 2);
});

test("临时攻击提升持续回合到期后失效，回合数绝不超过30", () => {
  const buff: CardBattleSkillEffect = { id: "buff", order: 0, condition: "energy_full", conditionValue: null, type: "attack_self", value: 200, duration: 1 };
  const one = [card("a1", 1, { energyRequired: 10, attack: 0 }, [buff]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0 }));
  const result = simulateCardBattle(players(one, two), "rounds");
  assert.equal(result.rounds, CARD_BATTLE_MAX_ROUNDS);
  assert.ok(result.events.some((event) => event.visual === "buff"));
  assert.equal(result.finalStates.find((state) => state.instanceId === "a1")?.attack, 0);
});

test("自身攻击与技能伤害提升同时加成普通攻击属性和攻击性技能伤害", () => {
  const effects: CardBattleSkillEffect[] = [
    { id: "self-combined-buff", order: 0, condition: "energy_full", conditionValue: null, type: "attack_skill_damage_self", value: 200, duration: 2 },
    { id: "self-damage", order: 1, condition: "energy_full", conditionValue: null, type: "damage_single", value: 300, duration: null },
  ];
  const one = [card("a1", 1, { attack: 100, energyRequired: 10, speed: 1000 }, effects), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0, speed: 1 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, defense: 100, maxHp: 5000 }));
  const result = simulateCardBattle(players(one, two), "self-attack-skill-damage");
  const buffEvent = result.events.find((event) => event.actorId === "a1" && event.visual === "buff");
  const damageEvent = result.events.find((event) => event.actorId === "a1" && event.kind === "skill" && event.visual === "damage");
  assert.equal(buffEvent?.states.find((state) => state.instanceId === "a1")?.attack, 300);
  assert.equal(buffEvent?.effects[0]?.label, "攻击与技能伤害 +200");
  assert.equal(damageEvent?.effects[0]?.amount, -400);
});

test("全体攻击与技能伤害提升会加成友军随后释放的攻击性技能", () => {
  const teamBuff: CardBattleSkillEffect = { id: "team-combined-buff", order: 0, condition: "energy_full", conditionValue: null, type: "attack_skill_damage_all_allies", value: 200, duration: 2 };
  const damageSkill: CardBattleSkillEffect = { id: "ally-damage", order: 0, condition: "energy_full", conditionValue: null, type: "damage_single", value: 300, duration: null };
  const one = [
    card("a1", 1, { attack: 100, energyRequired: 10, speed: 1000 }, [teamBuff]),
    card("a2", 2, { attack: 100, energyRequired: 10, speed: 900 }, [damageSkill]),
    ...[3, 4, 5].map((slot) => card(`a${slot}`, slot as 3 | 4 | 5, { attack: 0, speed: 1 })),
  ];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, defense: 100, maxHp: 5000 }));
  const result = simulateCardBattle(players(one, two), "team-attack-skill-damage");
  const buffEvent = result.events.find((event) => event.actorId === "a1" && event.visual === "buff");
  const allyDamageEvent = result.events.find((event) => event.actorId === "a2" && event.kind === "skill" && event.visual === "damage");
  assert.equal(buffEvent?.states.find((state) => state.instanceId === "a2")?.attack, 300);
  assert.equal(allyDamageEvent?.effects[0]?.amount, -400);
});

test("技能指定后排时优先命中后排，后排清空后使用前排兜底", () => {
  const rearSkill: CardBattleSkillEffect = { id: "rear", order: 0, condition: "energy_full", conditionValue: null, type: "damage_rear", value: 2000, duration: null };
  const one = [card("a1", 1, { energyRequired: 10, attack: 0, speed: 1000 }, [rearSkill]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0, speed: 1 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, maxHp: slot >= 3 ? 1 : 5000 }));
  const result = simulateCardBattle(players(one, two), "rear-fallback");
  const skillEvents = result.events.filter((event) => event.actorId === "a1" && event.kind === "skill");
  assert.ok(skillEvents.length >= 4);
  assert.ok(["b3", "b4", "b5"].includes(skillEvents[0]!.effects[0]!.targetId));
  assert.ok(skillEvents.slice(3).some((event) => ["b1", "b2"].includes(event.effects[0]!.targetId)));
});

test("友军阵亡后复活的卡牌回到原槽位、满血零能量且当回合不再次行动", () => {
  const revive: CardBattleSkillEffect = { id: "ally-revive", order: 0, condition: "ally_death", conditionValue: null, type: "revive_ally_1", value: null, duration: null };
  const one = [
    card("a1", 1, { maxHp: 1, speed: 1000 }),
    card("a2", 2, { maxHp: 100000, defense: 100000, speed: 1 }, [revive]),
    ...[3, 4, 5].map((slot) => card(`a${slot}`, slot as 3 | 4 | 5, { attack: 0, speed: 1 })),
  ];
  const two = [card("b1", 1, { attack: 5000, speed: 2000 }), ...[2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0, speed: 1 }))];
  let result = simulateCardBattle(players(one, two), "revive-turn-0");
  for (let attempt = 1; attempt < 50 && !result.events.some((event) => event.visual === "revive" && event.round === 1); attempt += 1) {
    result = simulateCardBattle(players(one, two), `revive-turn-${attempt}`);
  }
  const reviveEvent = result.events.find((event) => event.visual === "revive" && event.round === 1);
  assert.ok(reviveEvent, "the deterministic seed search should find b1 targeting a1");
  const revived = reviveEvent.states.find((state) => state.instanceId === "a1");
  assert.deepEqual({ slot: revived?.slot, hp: revived?.hp, maxHp: revived?.maxHp, energy: revived?.energy, alive: revived?.alive }, { slot: 1, hp: 1, maxHp: 1, energy: 0, alive: true });
  assert.equal(result.events.some((event) => event.round === 1 && event.kind === "attack" && event.actorId === "a1"), false);
});

test("生命比例条件每条生命只触发一次，复活后可再次触发", () => {
  const threshold: CardBattleSkillEffect = { id: "threshold-heal", order: 0, condition: "self_hp_below_percent", conditionValue: 90, type: "heal_self", value: 1, duration: null };
  const revive: CardBattleSkillEffect = { id: "self-revive", order: 1, condition: "self_death", conditionValue: null, type: "revive_self", value: null, duration: null };
  const one = [card("a1", 1, { maxHp: 30, attack: 0, defense: 0 }, [threshold, revive]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { maxHp: 1, attack: 0 }))];
  const two = [card("b1", 1, { attack: 20, speed: 1000, canAttackRear: true }), ...[2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0, speed: 1 }))];
  const result = simulateCardBattle(players(one, two), "threshold-life");
  const thresholdHeals = result.events.filter((event) => event.visual === "heal" && event.actorId === "a1");
  const revives = result.events.filter((event) => event.visual === "revive" && event.actorId === "a1");
  assert.ok(revives.length >= 1);
  assert.ok(thresholdHeals.length >= 2, "threshold should be available again after a revive resets per-life triggers");
  assert.ok(thresholdHeals.length <= revives.length + 1, "threshold must not repeatedly trigger during the same life");
});

test("结算伤害按实际扣血统计，格挡不产生承伤或受击能量", () => {
  const one = [card("a1", 1, { attack: 10_000, speed: 1000 }), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
  const two = [card("b1", 1, { maxHp: 123, defense: 0 }), card("b2", 2, { maxHp: 1000, defense: 20_000 }), ...[3, 4, 5].map((slot) => card(`b${slot}`, slot as 3 | 4 | 5, { maxHp: 1, defense: 20_000 }))];
  const result = simulateCardBattle(players(one, two), "actual-damage");
  const first = result.events.find((event) => event.kind === "attack" && event.actorId === "a1");
  assert.ok(first);
  const targetId = first.effects[0]!.targetId;
  if (targetId === "b1") {
    assert.equal(first.effects[0]!.amount, -123);
    assert.equal(result.players[0]!.cards.find((item) => item.cardId === "a1")!.damageDealt >= 123, true);
    assert.equal(result.players[1]!.cards.find((item) => item.cardId === "b1")!.damageTaken, 123);
  } else {
    assert.equal(first.effects[0]!.blocked, true);
    assert.equal(first.states.find((state) => state.instanceId === targetId)?.energy, 0);
  }
});

test("治疗或回能未改变数值时不生成误导性的 +0 反馈", () => {
  const restoreEnergy: CardBattleSkillEffect = { id: "energy-all", order: 0, condition: "energy_full", conditionValue: null, type: "energy_all_allies", value: 10, duration: null };
  const healAtFull: CardBattleSkillEffect = { id: "heal-full", order: 0, condition: "energy_full", conditionValue: null, type: "heal_self", value: 100, duration: null };
  const one = [
    card("a1", 1, { energyRequired: 10, speed: 1000 }, [restoreEnergy]),
    card("a2", 2, { energyRequired: 10, speed: 900 }, [healAtFull]),
    ...[3, 4, 5].map((slot) => card(`a${slot}`, slot as 3 | 4 | 5, { attack: 0, speed: 1 })),
  ];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, maxHp: 5000 }));
  const result = simulateCardBattle(players(one, two), "no-zero-feedback");
  const energyEvent = result.events.find((event) => event.visual === "energy" && event.actorId === "a1");
  const healEvent = result.events.find((event) => event.visual === "heal" && event.actorId === "a2");
  assert.ok(energyEvent);
  assert.ok(energyEvent.effects.every((effect) => Number(effect.amount) > 0));
  assert.ok(healEvent);
  assert.deepEqual(healEvent.effects, []);
});

test("死亡触发的自身治疗不会让已下场卡牌出现幽灵生命值", () => {
  const healOnDeath: CardBattleSkillEffect = { id: "dead-heal", order: 0, condition: "self_death", conditionValue: null, type: "heal_self", value: 500, duration: null };
  const one = [card("a1", 1, { maxHp: 1 }, [healOnDeath]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { maxHp: 1 }))];
  const two = [card("b1", 1, { attack: 5000, speed: 1000, canAttackRear: true }), ...[2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 2 | 3 | 4 | 5, { attack: 5000, speed: 900 }))];
  const result = simulateCardBattle(players(one, two), "dead-heal");
  const final = result.finalStates.find((state) => state.instanceId === "a1");
  assert.deepEqual({ alive: final?.alive, hp: final?.hp }, { alive: false, hp: 0 });
});

test("多卡同时阵亡后即使先被友军复活，自己的死亡技能仍会结算", () => {
  const reviveAll: CardBattleSkillEffect = { id: "revive-all", order: 0, condition: "self_death", conditionValue: null, type: "revive_all_allies", value: null, duration: null };
  const deathDamage: CardBattleSkillEffect = { id: "death-damage", order: 0, condition: "self_death", conditionValue: null, type: "damage_all", value: 100, duration: null };
  const aoe: CardBattleSkillEffect = { id: "aoe", order: 0, condition: "energy_full", conditionValue: null, type: "damage_all", value: 5000, duration: null };
  const one = [
    card("a1", 1, { maxHp: 1000, attack: 0 }, [reviveAll]),
    card("a2", 2, { maxHp: 1000, attack: 0 }, [deathDamage]),
    ...[3, 4, 5].map((slot) => card(`a${slot}`, slot as 3 | 4 | 5, { maxHp: 1000, attack: 0 })),
  ];
  const two = [
    card("b1", 1, { maxHp: 10000, attack: 0, energyRequired: 10, speed: 2000 }, [aoe]),
    ...[2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 2 | 3 | 4 | 5, { maxHp: 10000, attack: 0, speed: 1 })),
  ];
  const result = simulateCardBattle(players(one, two), "simultaneous-death-triggers");
  const reviveIndex = result.events.findIndex((event) => event.actorId === "a1" && event.visual === "revive");
  const secondDeathSkillIndex = result.events.findIndex((event) => event.actorId === "a2" && event.kind === "skill");
  assert.ok(reviveIndex >= 0);
  assert.ok(secondDeathSkillIndex > reviveIndex, "a2 的死亡事实不应因先被 a1 复活而消失");
});

test("技能连锁始终保留结束动画并受事件数和七分钟总时长双重限制", () => {
  const buffs = Array.from({ length: 50 }, (_, order): CardBattleSkillEffect => ({
    id: `buff-${order}`, order, condition: "energy_full", conditionValue: null,
    type: "defense_self", value: 1, duration: 1,
  }));
  const one = [1, 2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, energyRequired: 10 }, buffs));
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, energyRequired: 10 }, buffs));
  const result = simulateCardBattle(players(one, two), "bounded-playback");
  assert.ok(result.events.length <= CARD_BATTLE_MAX_EVENTS);
  assert.ok(result.playbackDurationMs <= CARD_BATTLE_MAX_PLAYBACK_MS);
  assert.equal(result.events.at(-1)?.kind, "end");
  assert.equal(result.endReason, "safety_limit");
  assert.deepEqual(result.events.at(-1)?.states, result.events.at(-2)?.states, "安全结束前不能存在没有动画记录的隐藏状态变化");
});
