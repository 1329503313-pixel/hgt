import { isCardBattleTrueDamage } from "@hgt/shared";
import test from "node:test";
import assert from "node:assert/strict";
import { cardBattleBuffBonus, cardBattleEffectiveStat, cardBattleStatuses, rollCardBattleDamage, rollCardBattleCritical, type CardBattleBuff } from "./cardBattleMath.js";
import { cardBattleDebuffCodes, cardBattleDebuff } from "./cardBattleStatus.js";
import { calculateCardBattleScore } from "@hgt/shared";
import { CARD_BATTLE_MAX_EVENTS, CARD_BATTLE_MAX_PLAYBACK_MS, CARD_BATTLE_MAX_ROUNDS, cardBattleEffectCodes, calculateCardBattlePower, simulateCardBattle, type CardBattleDeckCard, type CardBattleSkillEffect } from "./cardBattle.js";

test("暴击率边界、150%倍率与旧阵容默认25%准确", () => {
  assert.deepEqual(rollCardBattleCritical({ critRate: 0, critDamage: 150 }, () => 0), { critical: false, multiplier: 1 });
  assert.deepEqual(rollCardBattleCritical({ critRate: 100, critDamage: 150 }, () => .9999), { critical: true, multiplier: 1.5 });
  assert.equal(rollCardBattleCritical({}, () => .24999).critical, true);
  assert.equal(rollCardBattleCritical({}, () => .25).critical, false);
  const critical = rollCardBattleCritical({ critRate: 100, critDamage: 150 }, () => 0);
  assert.deepEqual(rollCardBattleDamage(100 * critical.multiplier, 60, 1000, () => .5), { incomingDamage: 150, damage: 90 });
});

test("普攻25%暴击由服务端种子确定，承伤与扣血都使用暴击后的数值", () => {
  const side = (prefix: string) => [1, 2, 3, 4, 5].map((slot) => card(`${prefix}${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 1_000_000, attack: 100, defense: 0, critRate: 25, critDamage: 150 }));
  const inputs = players(side("a"), side("b"));
  const result = simulateCardBattle(inputs, "critical-basic");
  assert.deepEqual(result, simulateCardBattle(inputs, "critical-basic"));
  const attacks = result.events.filter((event) => event.kind === "attack");
  assert.ok(attacks.some((event) => event.effects[0]?.critical));
  assert.ok(attacks.some((event) => !event.effects[0]?.critical));
  for (const event of attacks) {
    const effect = event.effects[0]!;
    const amount = -effect.amount!;
    assert.ok(effect.critical ? amount >= 147 && amount <= 153 : amount >= 98 && amount <= 102);
    const after = event.states.find((state) => state.instanceId === effect.targetId)!;
    const before = result.events[event.sequence - 2]!.states.find((state) => state.instanceId === effect.targetId)!;
    assert.equal(after.damageTaken! - before.damageTaken!, amount);
  }
});

test("群体伤害逐目标暴击，治疗按施法卡暴击且不过量", () => {
  const aoe: CardBattleSkillEffect = { id: "critical-aoe", order: 0, condition: "energy_full", conditionValue: null, type: "damage_all", value: 100, duration: null };
  const one = [card("a1", 1, { maxHp: 100000, attack: 0, critRate: 100, critDamage: 150, energyRequired: 10 }, [aoe]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { maxHp: 100000, attack: 0 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 100000, attack: 0, defense: 0 }));
  const result = simulateCardBattle(players(one, two), "critical-aoe");
  const first = result.events.find((event) => event.kind === "skill" && event.visual === "damage")!;
  assert.equal(first.effects.length, 5);
  assert.ok(first.effects.every((effect) => effect.critical && -effect.amount! >= 147 && -effect.amount! <= 153));

  const heals: CardBattleSkillEffect[] = [100, 100000].map((value, order) => ({ id: `heal${order}`, order, condition: "self_hp_below_percent", conditionValue: 100, type: "heal_self", value, duration: null }));
  const healers = [1, 2, 3, 4, 5].map((slot) => card(`h${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 10000, attack: 0, defense: 0, critRate: 100, critDamage: 150 }, heals));
  const attackers = two.map((item) => ({ ...item, tier: { ...item.tier, attack: 1000 } }));
  const healing = simulateCardBattle(players(healers, attackers), "critical-heal");
  const events = healing.events.filter((event) => event.visual === "heal").slice(0, 2);
  assert.equal(events[0]!.effects[0]!.amount, 150);
  assert.ok(events.every((event) => event.effects[0]!.critical));
  const target = events[1]!.effects[0]!.targetId;
  assert.equal(events[1]!.states.find((state) => state.instanceId === target)!.hp, 10000);
  assert.equal(events[1]!.effects[0]!.amount, 10000 - events[0]!.states.find((state) => state.instanceId === target)!.hp);
});

test("100%暴击率也不会放大五种属性增益或直接能量恢复", () => {
  const types = ["attack_self", "attack_skill_damage_self", "defense_self", "speed_self", "max_hp_self", "energy_self"] as const;
  const effects = types.map((type, order): CardBattleSkillEffect => ({ id: type, order, type, condition: "energy_full", conditionValue: null, value: 100, duration: ["max_hp_self", "energy_self"].includes(type) ? null : 1 }));
  const one = [card("a1", 1, { critRate: 100, critDamage: 300, energyRequired: 10 }, effects), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 100000, attack: 0 }));
  const result = simulateCardBattle(players(one, two), "no-buff-critical");
  const skills = result.events.filter((event) => event.actorId === "a1" && event.kind === "skill").slice(0, 6);
  assert.deepEqual(skills.map((event) => event.effects[0]!.amount), [100, 50, 100, 100, 100, 10]);
  assert.ok(skills.every((event) => !event.effects[0]?.critical));
});

test("伤害先浮动98%-102%并四舍五入再减防御，完全抵挡和溢出伤害受正确限制", () => {
  assert.deepEqual(rollCardBattleDamage(800, 600, 1000, () => 0), { incomingDamage: 784, damage: 184 });
  assert.deepEqual(rollCardBattleDamage(800, 600, 1000, () => 1), { incomingDamage: 816, damage: 216 });
  assert.deepEqual(rollCardBattleDamage(125, 0, 1000, () => 0), { incomingDamage: 123, damage: 123 });
  assert.deepEqual(rollCardBattleDamage(800, 1000, 1000, () => 1), { incomingDamage: 816, damage: 0 });
  assert.deepEqual(rollCardBattleDamage(800, 600, 50, () => .5), { incomingDamage: 800, damage: 50 });
});

test("五种属性各自首层100%后续50%，过期后的最早存活层恢复100%", () => {
  for (const stat of ["attack", "skillDamage", "defense", "speed", "maxHp"] as const) {
    const buffs: CardBattleBuff[] = [
      { stat, value: 100, expiresAfterRound: 1 },
      { stat, value: 200, expiresAfterRound: 3 },
      { stat, value: 300, expiresAfterRound: 2 },
    ];
    assert.equal(cardBattleBuffBonus(buffs, stat), 350);
    assert.equal(cardBattleBuffBonus(buffs.filter((buff) => buff.expiresAfterRound > 1), stat), 350);
    assert.equal(cardBattleBuffBonus(buffs.filter((buff) => buff.expiresAfterRound > 2), stat), 200);
    assert.equal(cardBattleBuffBonus(buffs.filter((buff) => buff.expiresAfterRound > 3), stat), 0);
    assert.equal(cardBattleBuffBonus([{ stat, value: 0, expiresAfterRound: 1 }, buffs[1]!], stat), 200);
  }
  assert.equal(cardBattleBuffBonus([{ stat: "attack", value: 100, expiresAfterRound: 2 }, { stat: "defense", value: 200, expiresAfterRound: 2 }], "defense"), 200);
});

test("普攻与群攻完全抵挡仍逐次回能10，满能量不溢出且生命不下降", () => {
  const skill: CardBattleSkillEffect = { id: "blocked-aoe", order: 0, condition: "energy_full", conditionValue: null, type: "damage_all", value: 100, duration: null };
  const one = [1, 2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 100, defense: 1000, energyRequired: 20 }, slot === 1 ? [skill] : []));
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 100, defense: 1000, energyRequired: 20 }));
  const result = simulateCardBattle(players(one, two), "blocked-energy");
  let previous = result.initialStates;
  let normalHits = 0, skillHits = 0, cappedHits = 0;
  const rolls: number[] = [];
  for (const event of result.events) {
    if (event.visual === "damage") for (const effect of event.effects) {
      assert.equal(effect.blocked, true);
      const before = previous.find((state) => state.instanceId === effect.targetId)!;
      const after = event.states.find((state) => state.instanceId === effect.targetId)!;
      assert.equal(after.energy, Math.min(20, before.energy + 10));
      assert.equal(after.hp, before.hp);
      rolls.push(after.damageTaken! - before.damageTaken!);
      if (before.energy === 20) cappedHits++;
      if (event.kind === "attack") normalHits++; else skillHits++;
    }
    previous = event.states;
  }
  assert.ok(normalHits > 0 && skillHits > 0 && cappedHits > 0);
  assert.deepEqual(simulateCardBattle(players(one, two), "blocked-energy"), result, "同种子完整对局可复现");
  assert.ok(new Set(rolls).size > 1, "同伤害基数应实际随机跳动");
  assert.ok(rolls.every((amount) => amount >= 98 && amount <= 102));
});

test("组合增益按攻击与技能伤害分别叠层，首层到期后下一层恢复全额", () => {
  const effects: CardBattleSkillEffect[] = [
    { id: "attack-first", order: 0, condition: "energy_full", conditionValue: null, type: "attack_self", value: 100, duration: 1 },
    { id: "combined-second", order: 1, condition: "energy_full", conditionValue: null, type: "attack_skill_damage_self", value: 200, duration: 2 },
  ];
  const one = [card("a1", 1, { attack: 0, energyRequired: 20, speed: 1000 }, effects), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, defense: 10000 }));
  const result = simulateCardBattle(players(one, two), "split-buff");
  const buffs = result.events.filter((event) => event.actorId === "a1" && event.visual === "buff");
  assert.equal(buffs[0]!.states.find((state) => state.instanceId === "a1")!.attack, 100);
  assert.equal(buffs[1]!.states.find((state) => state.instanceId === "a1")!.attack, 200);
  assert.equal(buffs[1]!.effects[0]!.label, "攻击 +100 / 技能伤害 +200");
  const nextRound = result.events.find((event) => event.kind === "round" && event.round === buffs[1]!.round + 1)!;
  assert.equal(nextRound.states.find((state) => state.instanceId === "a1")!.attack, 200);
});

test("生命上限首层全额后续半额并按实际增量增加当前生命", () => {
  const effects: CardBattleSkillEffect[] = [
    { id: "hp-first", order: 0, condition: "energy_full", conditionValue: null, type: "max_hp_self", value: 100, duration: null },
    { id: "hp-second", order: 1, condition: "energy_full", conditionValue: null, type: "max_hp_self", value: 200, duration: null },
  ];
  const one = [card("a1", 1, { attack: 0, defense: 10000, energyRequired: 10, speed: 1000 }, effects), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0 }));
  const result = simulateCardBattle(players(one, two), "max-hp-stack");
  const buffs = result.events.filter((event) => event.actorId === "a1" && event.visual === "buff");
  assert.equal(buffs[0]!.states.find((state) => state.instanceId === "a1")!.maxHp, 1100);
  assert.equal(buffs[1]!.states.find((state) => state.instanceId === "a1")!.maxHp, 1200);
  assert.equal(buffs[1]!.states.find((state) => state.instanceId === "a1")!.hp, 1200);
  assert.equal(buffs[1]!.effects[0]!.label, "生命上限 +100");
});

test("同次连续治疗不受属性增益50%规则影响", () => {
  const heals = [0, 1].map((order): CardBattleSkillEffect => ({ id: `heal-${order}`, order, condition: "self_hp_below_percent", conditionValue: 100, type: "heal_self", value: 100, duration: null }));
  const one = [1, 2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 10000, attack: 0, defense: 0, speed: 1 }, heals));
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 1000, speed: 1000 }));
  const result = simulateCardBattle(players(one, two), "heals-not-buffs");
  const firstTwo = result.events.filter((event) => event.visual === "heal").slice(0, 2);
  assert.equal(firstTwo.length, 2);
  assert.deepEqual(firstTwo.map((event) => event.effects[0]?.amount), [100, 100]);
});

test("战力包含全部指定属性，百分比换算为小数，暴击伤害扣除基础倍率", () => {
  const stats = { maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50,
    critRate: 10, critDamage: 150, lifestealRate: 20, extraActionRate: 30, dodgeRate: 40, stunRate: 50 };
  assert.equal(calculateCardBattlePower(stats), 5500);
  const zero = { maxHp: 0, attack: 0, defense: 0, speed: 0, energyRequired: 0, critRate: 0, critDamage: 100 };
  assert.equal(calculateCardBattlePower(zero), 0);
  for (const [field, value, expected] of [
    ["maxHp", 100, 50], ["attack", 100, 200], ["defense", 100, 300], ["speed", 100, 300],
    ["critRate", 10, 150], ["critDamage", 150, 250], ["critDamage", 100, 0],
    ["lifestealRate", 10, 200], ["extraActionRate", 10, 300], ["dodgeRate", 10, 300],
    ["stunRate", 10, 300], ["energyRequired", 10, -200],
  ] as const) assert.equal(calculateCardBattlePower({ ...zero, [field]: value }), expected, field);
  assert.equal(calculateCardBattlePower({ maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50 }), 1725, "旧快照沿用暴击率25%、暴伤150%的战斗默认值");
});

test("单卡各项加总后再四舍五入，保留百分比的小数贡献", () => {
  const stats = { maxHp: 1000, attack: 0, defense: 0, speed: 0, energyRequired: 0, critRate: 0.01, critDamage: 100.01, lifestealRate: 0.01 };
  assert.equal(calculateCardBattlePower(stats), 500, "500.4向下取整");
  assert.equal(calculateCardBattlePower({ ...stats, maxHp: 1001 }), 501, "500.9向上取整，不能逐项取整");
  assert.equal(calculateCardBattlePower({ ...stats, critDamage: 100.03 }), 501, "500.5四舍五入");
});

test("忽防仅缩减本次有效防御，保留伤害浮动、暴击、最终取整与生命截断", () => {
  for (const [ignoreDefensePercent, damage] of [[0, 200], [50, 500], [100, 800], [12.25, 274]]) {
    assert.deepEqual(rollCardBattleDamage(800, 600, 1000, () => .5, ignoreDefensePercent), { incomingDamage: 800, damage });
  }
  assert.deepEqual(rollCardBattleDamage(800, 600, 1000, () => .5), rollCardBattleDamage(800, 600, 1000, () => .5, 0));
  assert.deepEqual(rollCardBattleDamage(800, 1200, 1000, () => .5, 0), { incomingDamage: 800, damage: 0 });
  assert.deepEqual(rollCardBattleDamage(800, 1200, 1000, () => .5, 100), { incomingDamage: 800, damage: 800 });
  assert.deepEqual(rollCardBattleDamage(800 * 1.5, 600, 5000, () => 0, 50), { incomingDamage: 1176, damage: 876 });
  assert.deepEqual(rollCardBattleDamage(800, 600, 50, () => .5, 100), { incomingDamage: 800, damage: 50 });
  assert.equal(rollCardBattleDamage(100, 3, 1000, () => .5, 50).damage, 99, "不对剩余防御提前取整");
});

test("所有伤害类型对各目标应用本行忽防比例，普攻和其他技能行保持原防御规则", () => {
  const damageTypes = cardBattleEffectCodes.filter((type) => type.startsWith("damage_") && !isCardBattleTrueDamage(type));
  const targetCounts: Record<string, number> = { damage_single: 1, damage_rear: 1, damage_random: 1, damage_all_front: 2,
    damage_all_rear: 3, damage_random_2: 2, damage_random_3: 3, damage_random_4: 4, damage_all: 5 };
  for (const type of damageTypes) {
    for (const ignoreDefensePercent of [undefined, 0, 50, 100]) {
      const effects: CardBattleSkillEffect[] = [
        { id: "piercing", order: 0, condition: "energy_full", conditionValue: null, type, value: 800, duration: null, ignoreDefensePercent },
        { id: "regular", order: 1, condition: "energy_full", conditionValue: null, type: "damage_all", value: 800, duration: null },
      ];
      const one = [card("a1", 1, { attack: 800, speed: 1000, energyRequired: 10, maxHp: 1_000_000 }, effects),
        ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0, maxHp: 1_000_000 }))];
      const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, defense: 1000, maxHp: 1_000_000 }));
      const inputs = players(one, two);
      const beforeInputs = JSON.stringify(inputs);
      const result = simulateCardBattle(inputs, `ignore-${type}`);
      assert.equal(JSON.stringify(inputs), beforeInputs, "不修改冻结阵容");
      const skills = result.events.filter((event) => event.kind === "skill" && event.visual === "damage" && event.actorId === "a1");
      assert.ok(skills.length >= 2);
      assert.equal(skills[0]!.effects.length, targetCounts[type]);
      const event = skills[0]!;
      const previous = result.events[result.events.indexOf(event) - 1]!.states;
      for (const hit of event.effects) {
        const state = event.states.find((item) => item.instanceId === hit.targetId)!;
        const old = previous.find((item) => item.instanceId === hit.targetId)!;
        const incoming = state.damageTaken! - old.damageTaken!;
        assert.ok(incoming >= 784 && incoming <= 816);
        assert.equal(hit.amount, -Math.max(0, Math.round(incoming - 1000 * (1 - (ignoreDefensePercent ?? 0) / 100))));
        assert.equal(state.defense, 1000);
      }
      assert.ok(skills[1]!.effects.every((hit) => hit.blocked), "下一技能行不继承忽防");
      assert.ok(result.events.filter((event) => event.kind === "attack" && event.actorId === "a1").every((event) => event.effects.every((hit) => hit.blocked)), "普攻不继承忽防");
      if (ignoreDefensePercent === undefined) {
        effects[0]!.ignoreDefensePercent = 0;
        assert.deepEqual(simulateCardBattle(inputs, `ignore-${type}`), result, "旧冻结技能与显式0%完全一致");
      }
    }
  }
});

function card(id: string, slot: 1 | 2 | 3 | 4 | 5, overrides: Partial<CardBattleDeckCard["tier"]> = {}, effects: CardBattleSkillEffect[] = []): CardBattleDeckCard {
  return {
    instanceId: id, cardId: id, name: id, imageUrl: `/${id}.webp`, rarity: "legend", battleRole: "damage", starLevel: 0, slot,
    motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
    tier: { starLevel: 0, maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50, critRate: 0, critDamage: 150, canAttackRear: false, skillName: "测试技能", skillDescription: "", effects, ...overrides },
  };
}

function players(one: CardBattleDeckCard[], two: CardBattleDeckCard[]) {
  return [
    { userId: "u1", nickname: "甲", seat: 1 as const, cards: one },
    { userId: "u2", nickname: "乙", seat: 2 as const, cards: two },
  ];
}

test("阅读节奏使用统一1.25倍时间，事件总长与服务器播放时间一致", () => {
  const damage: CardBattleSkillEffect = { id: "pace", order: 0, condition: "energy_full", conditionValue: null, type: "damage_single", value: 20, duration: null };
  const side = (prefix: string) => [1, 2, 3, 4, 5].map(slot => card(prefix + slot, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 10000, attack: 100, energyRequired: 10 }, [damage]));
  const result = simulateCardBattle(players(side("a"), side("b")), "readable-pace");
  assert.ok(result.events.some(e => e.kind === "attack"));
  assert.ok(result.events.some(e => e.kind === "skill" && e.visual === "damage"));
  for (const event of result.events) {
    if (event.kind === "attack") assert.equal(event.durationMs, 1375);
    if (event.kind === "skill" && event.visual === "damage") assert.equal(event.durationMs, 1625);
  }
  assert.equal(result.playbackDurationMs, result.events.reduce((sum, event) => sum + event.durationMs, 0));
});

test("治疗量归属施法卡，累计有效自疗与群疗，过量、复活及加上限不计入", () => {
  const effects: CardBattleSkillEffect[] = [
    { id: "heal", order: 0, type: "heal_all_allies", condition: "self_hp_below_percent", conditionValue: 100, value: 1000000, duration: null },
    { id: "hp", order: 1, type: "max_hp_self", condition: "energy_full", conditionValue: null, value: 100, duration: null },
    { id: "revive", order: 2, type: "revive_self", condition: "self_death", conditionValue: null, value: null, duration: null },
  ];
  const one = [1, 2, 3, 4, 5].map(slot => card(`a${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 1000, attack: 0, defense: 0, energyRequired: 10, critRate: 100 }, effects));
  const two = [1, 2, 3, 4, 5].map(slot => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 100000, attack: 600, speed: 500 }));
  const result = simulateCardBattle(players(one, two), "settlement-healing");
  assert.ok(result.events.some(event => event.visual === "heal" && event.effects.length));
  assert.ok(result.events.some(event => event.visual === "revive"));
  for (const player of result.players) for (const item of player.cards) {
    const state = result.finalStates.find(state => state.seat === player.seat && state.slot === item.slot)!;
    const total = result.events.filter(event => event.actorId === state.instanceId && event.visual === "heal").reduce((sum, event) => sum + event.effects.reduce((sum, effect) => sum + effect.amount!, 0), 0);
    assert.equal(item.healingDone, total);
    assert.equal(state.healingDone, total);
    assert.equal(item.supportBreakdown?.healing ?? 0, total);
    assert.equal(item.score, calculateCardBattleScore(item.damageDealt, item.damageTaken, item.supportDone));
    assert.ok(total < 1000000, "只统计扣除过量后的有效恢复");
  }
});

test("百分比减益保留半层精度，与正增益独立叠加，到期后下层恢复全效", () => {
  const layers: CardBattleBuff[] = [{ stat: "attack", value: 100, expiresAfterRound: 4 }, { stat: "attack", value: 25, expiresAfterRound: 1, debuff: true }, { stat: "attack", value: 25, expiresAfterRound: 3, debuff: true }];
  assert.equal(cardBattleBuffBonus(layers, "attack", true), 37.5);
  assert.equal(cardBattleEffectiveStat(300, layers, "attack"), 250);
  const next = layers.filter((layer) => layer.expiresAfterRound > 1);
  assert.equal(cardBattleEffectiveStat(300, next, "attack"), 300);
  assert.deepEqual(cardBattleStatuses(layers, 1).map(({ type, multiplier, remainingRounds }) => ({ type, multiplier, remainingRounds })), [
    { type: "attack_up", multiplier: 1, remainingRounds: 4 },
    { type: "attack_skill_damage_down", multiplier: 1, remainingRounds: 1 },
    { type: "attack_skill_damage_down", multiplier: .5, remainingRounds: 3 },
  ]);
  assert.equal(cardBattleStatuses(next, 2)[1]!.multiplier, 1);
  assert.equal(cardBattleEffectiveStat(100, [{ stat: "maxHp", value: 100, debuff: true, expiresAfterRound: 2 }], "maxHp", 1), 1);
  assert.equal(cardBattleEffectiveStat(100, [{ stat: "healingReceived", value: 100, debuff: true, expiresAfterRound: 2 }], "healingReceived"), 0);
});

test("25种减益均由服务端生成状态、目标范围和技能动画类型；最大生命到期不回血", () => {
  for (const type of cardBattleDebuffCodes) {
    const skill: CardBattleSkillEffect = { id: type, order: 0, type, condition: "energy_full", conditionValue: null, value: 25, duration: 1 };
    const side = (prefix: string) => [1, 2, 3, 4, 5].map((slot) => card(`${prefix}${slot}`, slot as 1 | 2 | 3 | 4 | 5, { maxHp: 10000, attack: 0, defense: 100, speed: 100 }));
    const one = side("a"), two = side("b");
    one[0] = card("a1", 1, { maxHp: 10000, attack: 0, speed: 1000, energyRequired: 10, critRate: 100, critDamage: 300 }, [skill]);
    const result = simulateCardBattle(players(one, two), type);
    const event = result.events.find((event) => event.effectType === type)!;
    assert.ok(event, type);
    assert.equal(event.visual, "debuff");
    const { target, status } = cardBattleDebuff(type)!;
    assert.equal(event.effects.length, target === "all" ? 5 : target === "front" ? 2 : target === "rear" ? 3 : 1, type);
    for (const effect of event.effects) {
      const state = event.states.find((state) => state.instanceId === effect.targetId)!;
      assert.equal(state.seat, 2);
      if (target === "single" || target === "front") assert.ok(state.slot <= 2);
      if (target === "rear") assert.ok(state.slot >= 3);
      assert.deepEqual(state.statuses, [{ type: status, category: "debuff", value: 25, remainingRounds: 1, multiplier: 1 }]);
      assert.equal(effect.amount, 25, "状态不暴击");
      assert.equal(effect.critical, undefined);
      if (status === "speed_down") assert.equal(state.speed, 75);
      if (status === "defense_down") assert.equal(state.defense, 75);
      if (status === "max_hp_down") {
        assert.equal(state.maxHp, 7500);
        assert.equal(state.hp, 7500);
        assert.equal(state.damageTaken, 0, "上限截断不算伤害");
        const after = result.events.find((item) => item.kind === "round" && item.round === event.round + 1)!.states.find((item) => item.instanceId === state.instanceId)!;
        assert.equal(after.maxHp, 10000);
        assert.equal(after.hp, 7500, "恢复上限不自动回血");
        assert.deepEqual(after.statuses, []);
      }
    }
  }
});

test("禁疗在治疗暴击之后结算，组合攻击减益同时降低普攻及伤害技能", () => {
  const effect = (type: CardBattleSkillEffect["type"], value: number, order = 0): CardBattleSkillEffect => ({ id: `${type}:${order}`, order, type, value, condition: "energy_full", conditionValue: null, duration: type.includes("_down_") ? 3 : null });
  const side = (prefix: string) => [1, 2, 3, 4, 5].map((slot) => card(`${prefix}${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, maxHp: 100000, defense: 0 }));
  for (const value of [50, 100]) {
    const one = side("a"), two = side("b");
    one[0] = card("a1", 1, { speed: 1000, attack: 0, energyRequired: 10 }, [effect("healing_received_down_all", value), effect("damage_all", 1000, 1)]);
    for (const target of two) { target.tier.critRate = 100; target.tier.effects = [{ ...effect("heal_self", 100), condition: "self_hp_below_percent", conditionValue: 100 }]; }
    const events = simulateCardBattle(players(one, two), `heal-received-${value}`).events.filter((event) => event.visual === "heal").slice(0, 5);
    assert.equal(events.length, 5);
    for (const event of events) {
      if (value === 100) assert.deepEqual(event.effects, []);
      else { assert.equal(event.effects[0]!.amount, 75); assert.equal(event.effects[0]!.critical, true); }
    }
  }
  const one = side("a"), two = side("b");
  one[0] = card("a1", 1, { maxHp: 100000, speed: 1000, attack: 0, defense: 0, energyRequired: 10 }, [effect("attack_skill_damage_down_all", 50)]);
  for (const target of two) { target.tier.attack = 100; target.tier.energyRequired = 20; target.tier.effects = [effect("damage_all", 100)]; }
  const events = simulateCardBattle(players(one, two), "attack-down-combined").events;
  const affected = events.filter((event) => event.actorId?.startsWith("b") && event.states.find((state) => state.instanceId === event.actorId)?.statuses?.some((status) => status.type === "attack_skill_damage_down"));
  const firstAttack = affected.find((event) => event.kind === "attack")!;
  assert.ok(firstAttack);
  const attackValue = firstAttack.states.find((state) => state.instanceId === firstAttack.actorId)!.attack;
  assert.ok(attackValue < 100);
  assert.ok(-firstAttack.effects[0]!.amount! >= Math.round(attackValue * .98) && -firstAttack.effects[0]!.amount! <= Math.round(attackValue * 1.02));
  const firstSkill = affected.find((event) => event.effectType === "damage_all")!;
  assert.ok(firstSkill);
  const actor = firstSkill.states.find((state) => state.instanceId === firstSkill.actorId)!;
  for (const hit of firstSkill.effects) assert.ok(-hit.amount! >= Math.round(actor.attack * .98) && -hit.amount! <= Math.round(actor.attack * 1.02));
});

test("状态按类型排序但同类型逐层展示，组合减益单层一个图标，复活清空状态", () => {
  const layers: CardBattleBuff[] = [
    { stat: "speed", value: 20, expiresAfterRound: 2, debuff: true },
    { stat: "attack", value: 100, expiresAfterRound: 2 },
    { stat: "attack", value: 200, expiresAfterRound: 4 },
    { stat: "skillDamage", value: 200, expiresAfterRound: 4 },
    { stat: "attack", value: 20, expiresAfterRound: 3, debuff: true },
    { stat: "skillDamage", value: 20, expiresAfterRound: 3, debuff: true },
    { stat: "maxHp", value: 100, expiresAfterRound: Infinity },
  ];
  assert.deepEqual(cardBattleStatuses(layers, 1).map((status) => [status.type, status.remainingRounds]), [["attack_up", 2], ["attack_up", 4], ["skill_damage_up", 4], ["max_hp_up", null], ["speed_down", 2], ["attack_skill_damage_down", 3]]);
  const revive: CardBattleSkillEffect = { id: "revive", order: 1, type: "revive_self", condition: "self_death", conditionValue: null, value: null, duration: null };
  const buff: CardBattleSkillEffect = { id: "buff", order: 0, type: "speed_self", condition: "energy_full", conditionValue: null, value: 100, duration: 3 };
  const one = [1, 2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, maxHp: 100, speed: 1000, energyRequired: 10 }, [buff, revive]));
  const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 10000, speed: 1 }));
  const events = simulateCardBattle(players(one, two), "status-revive").events;
  assert.ok(events.some((event) => event.states.some((state) => state.statuses?.length)));
  const revives = events.filter((event) => event.visual === "revive");
  assert.ok(revives.length);
  for (const event of revives) for (const effect of event.effects) assert.deepEqual(event.states.find((state) => state.instanceId === effect.targetId)!.statuses, []);
});

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
  const one = [card("a1", 1, { energyRequired: 10, speed: 1000 }, [skill]), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0, speed: 1 }))];
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
  assert.ok(Number(damageEvent?.effects[0]?.amount) >= -410 && Number(damageEvent?.effects[0]?.amount) <= -390);
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
  assert.ok(Number(allyDamageEvent?.effects[0]?.amount) >= -410 && Number(allyDamageEvent?.effects[0]?.amount) <= -390);
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

test("造成伤害按实际扣血统计，承伤按减防前统计，格挡仍产生受击能量", () => {
  const one = [card("a1", 1, { attack: 10_000, speed: 1000 }), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
  const two = [card("b1", 1, { maxHp: 123, defense: 0 }), card("b2", 2, { maxHp: 1000, defense: 20_000 }), ...[3, 4, 5].map((slot) => card(`b${slot}`, slot as 3 | 4 | 5, { maxHp: 1, defense: 20_000 }))];
  const result = simulateCardBattle(players(one, two), "actual-damage");
  const first = result.events.find((event) => event.kind === "attack" && event.actorId === "a1");
  assert.ok(first);
  const targetId = first.effects[0]!.targetId;
  if (targetId === "b1") {
    assert.equal(first.effects[0]!.amount, -123);
    assert.equal(result.players[0]!.cards.find((item) => item.cardId === "a1")!.damageDealt >= 123, true);
    const incoming = result.players[1]!.cards.find((item) => item.cardId === "b1")!.damageTaken;
    assert.ok(incoming >= 9800 && incoming <= 10200);
  } else {
    assert.equal(first.effects[0]!.blocked, true);
    assert.equal(first.states.find((state) => state.instanceId === targetId)?.energy, 10);
  }
});

for (const { label, defense, maxHp } of [
  { label: "800攻击减600防御实际扣200", defense: 600, maxHp: 200 },
  { label: "防御完全抵消伤害", defense: 1000, maxHp: 200 },
  { label: "剩余生命不足时包含溢出伤害", defense: 600, maxHp: 50 },
]) {
  test(`普通攻击承伤计入减防前800：${label}`, () => {
    const one = [card("a1", 1, { attack: 800, speed: 1000 }), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
    const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, defense, maxHp }));
    const result = simulateCardBattle(players(one, two), `incoming-${label}`);
    const attacks = result.events.filter((event) => event.kind === "attack" && event.actorId === "a1");
    assert.ok(attacks.length > 0);
    const firstHit = attacks[0]!.effects[0]!;
    const incoming = attacks[0]!.states.find((state) => state.instanceId === firstHit.targetId)!.damageTaken!;
    assert.ok(incoming >= 784 && incoming <= 816);
    assert.equal(firstHit.amount, -Math.min(maxHp, Math.max(0, incoming - defense)));
    for (const target of result.players[1]!.cards) {
      const hits = attacks.flatMap((event) => event.effects).filter((effect) => effect.targetId === target.cardId);
      assert.ok(target.damageTaken >= hits.length * 784 && target.damageTaken <= hits.length * 816);
    }
    assert.equal(result.players[0]!.cards[0]!.damageDealt, attacks.flatMap((event) => event.effects).reduce((sum, effect) => sum - Number(effect.amount), 0));
    if (defense >= 800) {
      assert.ok(result.finalStates.filter((state) => state.instanceId.startsWith("b")).every((state) => state.hp === maxHp));
      const targetId = attacks[0]!.effects[0]!.targetId;
      assert.equal(attacks[0]!.states.find((state) => state.instanceId === targetId)?.energy, 10);
    }
  });

  test(`群体技能承伤包含技能增益并按每个目标统计：${label}`, () => {
    const effects: CardBattleSkillEffect[] = [
      { id: "buff", order: 0, condition: "energy_full", conditionValue: null, type: "attack_skill_damage_self", value: 200, duration: 1 },
      { id: "damage", order: 1, condition: "energy_full", conditionValue: null, type: "damage_all", value: 600, duration: null },
    ];
    const one = [card("a1", 1, { attack: 0, speed: 1000, energyRequired: 10 }, effects), ...[2, 3, 4, 5].map((slot) => card(`a${slot}`, slot as 2 | 3 | 4 | 5, { attack: 0 }))];
    const two = [1, 2, 3, 4, 5].map((slot) => card(`b${slot}`, slot as 1 | 2 | 3 | 4 | 5, { attack: 0, defense, maxHp }));
    const result = simulateCardBattle(players(one, two), `incoming-skill-${label}`);
    const skills = result.events.filter((event) => event.kind === "skill" && event.visual === "damage" && event.actorId === "a1");
    assert.ok(skills.length > 0);
    assert.equal(skills[0]!.effects.length, 5);
    for (const effect of skills[0]!.effects) {
      const incoming = skills[0]!.states.find((state) => state.instanceId === effect.targetId)!.damageTaken!;
      assert.ok(incoming >= 784 && incoming <= 816);
      assert.equal(effect.amount, -Math.min(maxHp, Math.max(0, incoming - defense)));
    }
    for (const target of result.players[1]!.cards) {
      const hits = skills.flatMap((event) => event.effects).filter((effect) => effect.targetId === target.cardId).length;
      assert.ok(target.damageTaken >= hits * 784 && target.damageTaken <= hits * 816);
    }
    assert.equal(result.players[0]!.cards[0]!.damageDealt, skills.flatMap((event) => event.effects).reduce((sum, effect) => sum - Number(effect.amount), 0));
  });
}

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
