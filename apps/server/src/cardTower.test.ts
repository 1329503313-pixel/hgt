import test from "node:test";
import assert from "node:assert/strict";
import { emptyCardTowerFormations, replaceCardTowerFormation, cardTowerFormationError } from "@hgt/shared";
import { simulateCardBattle, type CardBattlePlayerInput, type CardBattleTier } from "./cardBattle.js";
import { defaultCardBattleTiers } from "./cardBattleConfig.js";

function squad(id: string, seat: 1 | 2, values: Partial<CardBattleTier> = {}): CardBattlePlayerInput {
  return { userId: id, nickname: id, seat, cards: Array.from({ length: 5 }, (_, i) => ({
    cardId: `${id}-${i}`, instanceId: `${id}-${i}`, slot: i + 1 as 1 | 2 | 3 | 4 | 5, name: `${id}-${i}`, rarity: "legend", starLevel: 3,
    imageUrl: "/cover", motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null, battleRole: "damage",
    tier: { ...defaultCardBattleTiers()[3]!, maxHp: 1000, attack: 100, defense: 0, speed: 100, critRate: 0, effects: [], ...values },
  })) };
}
test("闯关专属三阵容：新操作移走其他阵容重复卡牌及收藏品，保留无关卡位与绑定", () => {
  const before = emptyCardTowerFormations();
  before[0] = { cardIds: ["a", "b", "c", "d", "e"], collectibleBindings: [{ cardId: "a", collectibleId: "x" }, { cardId: "b", collectibleId: "y" }, { cardId: "c", collectibleId: "z" }] };
  const after = replaceCardTowerFormation(before, 1, { cardIds: ["a", "f", "g", "h", "i"], collectibleBindings: [{ cardId: "f", collectibleId: "y" }] });
  assert.deepEqual(after[0]!.cardIds, [null, "b", "c", "d", "e"]);
  assert.deepEqual(after[0]!.collectibleBindings, [{ cardId: "c", collectibleId: "z" }]);
  assert.equal(before[0]!.cardIds[0], "a");
  assert.match(cardTowerFormationError(after)!, /选满五张/);
  assert.equal(cardTowerFormationError(replaceCardTowerFormation(after, 0, { cardIds: Array(5).fill(null), collectibleBindings: [] })), null);
});
test("闯关共用50回合，普通对战仍为30回合", () => {
  const inputs = [squad("one", 1, { attack: 0 }), squad("boss", 2, { attack: 0 })];
  const tower = simulateCardBattle(inputs, "fifty", "tower");
  assert.equal(tower.rounds, 50); assert.equal(tower.endReason, "round_limit"); assert.equal(tower.winnerSeat, 2);
  assert.equal(simulateCardBattle(inputs, "thirty", "1v1").rounds, 30);
});
test("阵容接力保持BOSS血量能量状态，后备满血零能量上场，退场不再参与目标或复活", () => {
  const first = squad("first", 1, { maxHp: 80, attack: 20, speed: 200 });
  const second = squad("second", 1, { maxHp: 10000, attack: 500, speed: 90, energyRequired: 10,
    effects: [{ id: "revive", order: 0, condition: "energy_full", conditionValue: null, type: "revive_all_allies", value: 100, duration: null }] });
  const third = squad("third", 1, { maxHp: 10000, attack: 500 });
  const boss = squad("boss", 2, { attack: 200, maxHp: 2000, speed: 150 });
  const result = simulateCardBattle([first, second, third, boss], "relay", "tower");
  assert.deepEqual(result, simulateCardBattle([first, second, third, boss], "relay", "tower"));
  assert.equal(result.initialStates.length, 10);
  assert.ok(result.initialStates.every((state) => ["first", "boss"].includes(state.userId)));
  const index = result.events.findIndex((event) => event.text === "second 接替上场"); assert.ok(index > 0);
  const change = result.events[index]!, before = result.events[index - 1]!;
  assert.deepEqual(change.states.filter((state) => state.seat === 2), before.states.filter((state) => state.seat === 2));
  assert.ok(change.states.filter((state) => state.seat === 1).every((state) => state.userId === "second" && state.hp === state.maxHp && state.energy === 0 && !state.statuses?.length));
  assert.ok(result.events.slice(index).every((event) => event.states.every((state) => state.userId !== "first") && event.effects.every((effect) => !effect.targetId.startsWith("first"))));
  assert.ok(result.players.find((player) => player.userId === "first")!.cards.some((card) => card.damageDealt > 0));
  assert.equal(result.winnerSeat, 1);
});
test("三个阵容全部阵亡才失败；50回合计数不会因接替重置", () => {
  const inputs = [squad("one", 1, { maxHp: 1 }), squad("two", 1, { maxHp: 1 }), squad("three", 1, { maxHp: 1 }), squad("boss", 2, { maxHp: 10000, attack: 10000, speed: 1000 })];
  const result = simulateCardBattle(inputs, "all-dead", "tower");
  assert.equal(result.events.filter((event) => event.text.includes("接替上场")).length, 2);
  assert.equal(result.winnerSeat, 2); assert.equal(result.endReason, "elimination");
  const rounds = result.events.filter((event) => /^第 \d+ 回合$/.test(event.text)).map((event) => event.round);
  assert.equal(new Set(rounds).size, rounds.length);
});

test("死亡连锁同时消灭当前阵容与BOSS时，尚存后备阵容仍可通关", () => {
  const death = { id: "death", order: 0, condition: "self_death" as const, conditionValue: null, type: "damage_all" as const, value: 10000, duration: null };
  const first = squad("first", 1, { maxHp: 10, attack: 100, effects: [death] });
  const reserve = squad("reserve", 1);
  const boss = squad("boss", 2, { maxHp: 10, attack: 100, effects: [death] });
  const result = simulateCardBattle([first, reserve, boss], "mutual-with-reserves", "tower");
  assert.ok(result.finalStates.every((card) => !card.alive));
  assert.equal(result.winnerSeat, 1); assert.equal(result.endReason, "elimination");
});
