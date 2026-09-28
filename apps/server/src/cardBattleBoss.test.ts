import test from "node:test";
import assert from "node:assert/strict";
import { simulateCardBattle, type CardBattlePlayerInput, type CardBattleTier, type CardBattleSkillEffect } from "./cardBattle.js";
import { bossInputSchema, bossIsAvailable } from "./cardBattleBossRules.js";
import { defaultCardBattleTiers } from "./cardBattleConfig.js";

const tier: CardBattleTier = { ...defaultCardBattleTiers()[3]!, maxHp: 1000, attack: 200, defense: 0, speed: 100, critRate: 0, energyRequired: 50, effects: [] };
function player(userId: string, seat: 1 | 2, personalSeat?: 1 | 2 | 3, values: Partial<CardBattleTier> = {}): CardBattlePlayerInput {
  return { userId, nickname: userId, seat, playerSeat: personalSeat, cards: Array.from({ length: seat === 1 ? 3 : 5 }, (_, i) => ({
    cardId: `${seat}-${i}`, instanceId: `${userId}:${i}`, slot: i + 1 as 1 | 2 | 3 | 4 | 5, name: `卡${i}`, rarity: "legend", starLevel: 3,
    imageUrl: "/cover", motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null, battleRole: "damage", tier: { ...tier, ...values },
  })) };
}
const effect = (type: CardBattleSkillEffect["type"], value: number | null, duration: number | null = null): CardBattleSkillEffect => ({ id: "effect", order: 0, condition: "energy_full", conditionValue: null, type, value, duration });

test("BOSS 支持一至三名队友，允许同款卡但保留独立实例、三前排六后排及个人统计", () => {
  for (const count of [1, 2, 3]) {
    const players = Array.from({ length: count }, (_, i) => player(`p${i}`, 1, i + 1 as 1 | 2 | 3));
    const inputs = [...players, player("boss", 2, undefined, { maxHp: 1, attack: 0, speed: 0 })];
    const result = simulateCardBattle(inputs, "boss-cooperation", "boss");
    assert.deepEqual(result, simulateCardBattle(inputs, "boss-cooperation", "boss"));
    assert.equal(result.winnerSeat, 1); assert.equal(result.endReason, "elimination");
    assert.equal(result.initialStates.length, count * 3 + 5);
    assert.equal(new Set(result.initialStates.map((card) => card.instanceId)).size, count * 3 + 5);
    assert.equal(result.initialStates.filter((card) => card.seat === 1 && card.row === "front").length, count);
    assert.equal(result.initialStates.filter((card) => card.seat === 1 && card.row === "rear").length, count * 2);
    for (const one of result.players.filter((item) => item.seat === 1)) {
      assert.equal(one.cards.length, 3);
      for (const card of one.cards) assert.equal(card.damageDealt, result.finalStates.find((state) => state.userId === one.userId && state.slot === card.slot)!.damageDealt);
    }
  }
});
test("BOSS 全体伤害对三名队友的九张卡逐目标应用忽防比例", () => {
  for (const ignoreDefensePercent of [50, 100]) {
    const team = [1, 2, 3].map((seat) => player(`p${seat}`, 1, seat as 1 | 2 | 3, { attack: 0, defense: 1000, maxHp: 1_000_000 }));
    const boss = player("boss", 2, undefined, { attack: 0, maxHp: 1_000_000, speed: 200, energyRequired: 10,
      effects: [{ ...effect("damage_all", 800), ignoreDefensePercent }] });
    const result = simulateCardBattle([...team, boss], "boss-ignore-defense", "boss");
    const first = result.events.find((event) => event.effectType === "damage_all")!;
    assert.ok(first);
    assert.equal(first.effects.length, 9);
    const previous = result.events[result.events.indexOf(first) - 1]!.states;
    for (const hit of first.effects) {
      const state = first.states.find((item) => item.instanceId === hit.targetId)!;
      const before = previous.find((item) => item.instanceId === hit.targetId)!;
      const incoming = state.damageTaken! - before.damageTaken!;
      assert.equal(hit.amount, -(incoming - 1000 * (1 - ignoreDefensePercent / 100)));
      assert.equal(state.defense, 1000);
    }
  }
});

test("BOSS 超过三名队友、个人重复卡、缺少卡牌均拒绝", () => {
  const boss = player("boss", 2);
  assert.throws(() => simulateCardBattle([boss], "invalid", "boss"));
  assert.throws(() => simulateCardBattle([0, 1, 2, 3].map((i) => player(String(i), 1)).concat(boss), "invalid", "boss"));
  const challenger = player("p", 1); challenger.cards[1]!.cardId = challenger.cards[0]!.cardId;
  assert.throws(() => simulateCardBattle([challenger, boss], "invalid", "boss"));
});
test("BOSS 三十回合未清空全部敌人视为失败，即使九张队友全部存活", () => {
  const result = simulateCardBattle([player("a", 1, 1, { attack: 0 }), player("b", 1, 2, { attack: 0 }), player("c", 1, 3, { attack: 0 }), player("boss", 2, undefined, { attack: 0 })], "timeout", "boss");
  assert.equal(result.endReason, "round_limit"); assert.equal(result.rounds, 30); assert.equal(result.winnerSeat, 2);
});

test("BOSS与闯关每过完整回合按初始值降低0.5%，玩家及普通对战属性不变", () => {
  for (const mode of ["boss", "tower", "1v1"] as const) {
    const stats = { maxHp: 1_000_000, attack: 1000, defense: 1000, speed: 1000, energyRequired: 100000 };
    const team = player("team", mode === "boss" ? 1 : 2, undefined, stats);
    team.seat = 1;
    const boss = player("boss", 2, undefined, stats);
    const input = [team, boss], frozen = structuredClone(input);
    const result = simulateCardBattle(input, `linear-decay-${mode}`, mode);
    const rounds = result.events.filter(e => e.kind === "round" && e.visual === "round");
    assert.ok(rounds.some(e => e.round === 21), mode);
    for (const event of rounds) {
      for (const state of event.states) {
        const expected = mode !== "1v1" && state.seat === 2 ? 1000 - (event.round - 1) * 5 : 1000;
        assert.equal(state.attack, expected, `${mode}/${event.round}/attack`);
        assert.equal(state.defense, expected, `${mode}/${event.round}/defense`);
        assert.equal(state.speed, expected, `${mode}/${event.round}/speed`);
        assert.equal(state.maxHp, 1_000_000);
        assert.equal(state.energyRequired, 100000);
        assert.equal(state.critRate, 0);
      }
    }
    if (mode !== "1v1") {
      assert.equal(result.rounds, mode === "tower" ? 50 : 30);
      assert.ok(result.finalStates.filter(s => s.seat === 2).every(s => s.attack === 1000 - result.rounds * 5));
      assert.match(rounds[1]!.text, /累计降低 0.5%/);
    }
    assert.deepEqual(input, frozen, "不改写BOSS配置或冻结阵容");
    assert.deepEqual(result, simulateCardBattle(input, `linear-decay-${mode}`, mode));
  }
});

test("BOSS速度衰减影响下一回合行动顺序，增益与净化不清除衰减", () => {
  const team = player("team", 1, undefined, { maxHp: 1_000_000, attack: 0, speed: 996 });
  const boss = player("boss", 2, undefined, { maxHp: 1_000_000, attack: 1000, defense: 1000, speed: 1000, energyRequired: 10 });
  for (const card of boss.cards) card.tier.effects = [effect("cleanse_self", null)];
  boss.cards[0]!.cardNo = "boss-first";
  boss.cards[0]!.tier.bonds = [{ event: "energy_empty", cardNos: ["boss-first"], actions: [{ type: "attack_up", target: "allies", value: 200, duration: 30 }] }];
  const result = simulateCardBattle([team, boss], "decay-initiative", "boss");
  for (const [round, first] of [[1, "boss"], [2, "team"]] as const) {
    const action = result.events.find(e => e.round === round && !e.bond && e.actorId && ["attack", "skill"].includes(e.kind))!;
    assert.ok(action.actorId!.startsWith(first), `round ${round}`);
  }
  const cleansed = result.events.find(e => e.round === 2 && e.effectType === "cleanse_self")!;
  assert.ok(cleansed);
  const state = cleansed.states.find(s => s.instanceId === cleansed.actorId)!;
  assert.equal(state.attack, 1195, "基础攻击995加羁绊增益200，衰减不是可净化的减益");
  assert.equal(state.defense, 995);
  assert.equal(state.speed, 995);
});

test("BOSS复活保留已经累计的回合衰减", () => {
  const team = player("team", 1, undefined, { maxHp: 1_000_000, attack: 15, defense: 0, speed: 2000 });
  const boss = player("boss", 2, undefined, { maxHp: 1_000_000, attack: 10, defense: 0, speed: 1000 });
  boss.cards[0]!.tier = { ...boss.cards[0]!.tier, maxHp: 50,
    effects: [{ ...effect("revive_self", null), condition: "self_death" }] };
  const result = simulateCardBattle([team, boss], "decay-revival", "boss");
  const revivals = result.events.filter(e => e.effectType === "revive_self");
  assert.ok(revivals.length > 0);
  for (const event of revivals) {
    assert.ok(event.round > 1);
    const revived = event.states.find(s => s.instanceId === "boss:0")!;
    assert.equal(revived.speed, 1000 - (event.round - 1) * 5);
    assert.equal(revived.attack, Math.round(10 * (1 - (event.round - 1) * .005)));
    assert.equal(revived.hp, 50);
    assert.ok(revived.alive);
  }
});
test("BOSS 普攻遵循全队前排保护，群攻后排同时命中六张卡，全体增益覆盖九张友军", () => {
  const team = [player("a", 1, 1, { attack: 0, maxHp: 1_000_000, energyRequired: 10, effects: [effect("defense_all_allies", 1, 2)] }), player("b", 1, 2, { attack: 0, maxHp: 1_000_000 }), player("c", 1, 3, { attack: 0, maxHp: 1_000_000 })];
  const boss = player("boss", 2, undefined, { attack: 5, speed: 200, energyRequired: 10, effects: [effect("damage_all_rear", 10)] });
  const result = simulateCardBattle([...team, boss], "team-targets", "boss");
  for (const event of result.events.filter((event) => event.kind === "attack" && event.actorId?.startsWith("boss"))) {
    assert.ok(event.effects.every((target) => result.initialStates.find((state) => state.instanceId === target.targetId)?.row === "front"));
  }
  const rear = result.events.find((event) => event.kind === "skill" && event.actorId?.startsWith("boss"))!;
  assert.equal(rear.effects.length, 6); assert.equal(new Set(rear.effects.map((target) => target.targetId.split(":")[0])).size, 3);
  const buff = result.events.find((event) => event.kind === "skill" && event.actorId?.startsWith("a:"))!;
  assert.equal(buff.effects.length, 9);
});
test("上架严格复用商城技能校验、固定三星，草稿可保留空卡位，开放区间左闭右开", () => {
  const now = Date.now();
  const card = { name: "BOSS卡", imageUrl: `/api/online-soup/card-battle-boss/covers/${"a".repeat(64)}`, tier: { ...tier, skillName: "群攻", skillDescription: "攻击所有敌人", effects: [effect("damage_all", 10)] } };
  const draft = { name: "测试房间", enabled: true, startsAt: new Date(now).toISOString(), endsAt: new Date(now + 10000).toISOString(), rewardShells: 500, cards: Array(5).fill(card) };
  assert.equal(bossInputSchema.safeParse(draft).success, true);
  assert.equal(bossInputSchema.safeParse({ ...draft, enabled: false, cards: Array(5).fill(null) }).success, true);
  for (const invalid of [null, { ...card, imageUrl: "/mall/card" }, { ...card, tier: { ...card.tier, starLevel: 2 } }, { ...card, tier: { ...card.tier, skillName: "" } }, { ...card, tier: { ...card.tier, effects: [effect("defense_all_allies", 10)] } }]) {
    assert.equal(bossInputSchema.safeParse({ ...draft, cards: [invalid, ...draft.cards.slice(1)] }).success, false);
  }
  const boss = { enabled: 1, starts_at: draft.startsAt, ends_at: draft.endsAt };
  assert.equal(bossIsAvailable(boss, now - 1), false); assert.equal(bossIsAvailable(boss, now), true);
  assert.equal(bossIsAvailable(boss, now + 10000), false); assert.equal(bossIsAvailable({ ...boss, enabled: 0 }, now), false);
});
