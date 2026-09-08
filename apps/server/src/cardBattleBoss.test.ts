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
const effect = (type: CardBattleSkillEffect["type"], value: number, duration: number | null = null): CardBattleSkillEffect => ({ id: "effect", order: 0, condition: "energy_full", conditionValue: null, type, value, duration });

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
