import test from "node:test";
import assert from "node:assert/strict";
import { emptyCardTowerFormations, replaceCardTowerFormation, cardTowerFormationError } from "@hgt/shared";
import { simulateCardBattle, type CardBattlePlayerInput, type CardBattleTier } from "./cardBattle.js";
import { defaultCardBattleTiers } from "./cardBattleConfig.js";
import { resolveCardBattlePlayback } from "./cardBattlePlayback.js";
import { calculateCardTowerPower } from "./cardTowerPower.js";

function squad(id: string, seat: 1 | 2, values: Partial<CardBattleTier> = {}): CardBattlePlayerInput {
  return { userId: id, nickname: id, seat, cards: Array.from({ length: 5 }, (_, i) => ({
    cardId: `${id}-${i}`, instanceId: `${id}-${i}`, slot: i + 1 as 1 | 2 | 3 | 4 | 5, name: `${id}-${i}`, rarity: "legend", starLevel: 3,
    imageUrl: "/cover", motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null, battleRole: "damage",
    tier: { ...defaultCardBattleTiers()[3]!, maxHp: 1000, attack: 100, defense: 0, speed: 100, critRate: 0, effects: [], ...values },
  })) };
}
test("历史闯关战力按新公式统计全部冻结阵容与收藏品，排除BOSS且不重叠收藏加成", () => {
  const stats = { maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50,
    critRate: 10, critDamage: 150, lifestealRate: 20, extraActionRate: 30, dodgeRate: 40, stunRate: 50 };
  const players = [squad("first", 1, stats), squad("reserve-2", 1, stats), squad("reserve-3", 1, stats),
    squad("boss", 2, { maxHp: 1_000_000_000 })];
  const first = players[0]!.cards[0]!, reserve = players[2]!.cards[0]!;
  first.collectionBaseTier = { ...first.tier, maxHp: 1, attack: 1 }; // Must use the already boosted frozen tier.
  first.collectible = { id: "crit", collectibleNo: "1", name: "冻结收藏品", imageUrl: "/fixture",
    battleEffectDescription: "", battleEffectType: "crit_damage", battleEffectValue: 50 };
  reserve.collectible = { ...first.collectible, id: "energy", battleEffectType: "energy_reduction", battleEffectValue: 100 };
  const frozen = structuredClone(players);
  // 15 cards * 5500, plus 50pp crit damage * 5 and (50 - 10) energy * 20.
  assert.equal(calculateCardTowerPower(players), 83_550);
  assert.equal(calculateCardTowerPower(players), 83_550, "重复读取不能叠加收藏品");
  assert.deepEqual(players, frozen, "重算不能改写冻结属性与历史阵容");
  assert.equal(calculateCardTowerPower([players[3]!]), 0);
});

test("历史闯关战力逐卡四舍五入，旧快照缺失暴击属性沿用统一默认值", () => {
  const player = squad("rounding", 1, { maxHp: 1000, attack: 0, defense: 0, speed: 0, energyRequired: 0,
    critRate: 0.01, critDamage: 100.03, lifestealRate: 0.01, extraActionRate: 0, dodgeRate: 0, stunRate: 0 });
  assert.equal(calculateCardTowerPower([player]), 2505, "每卡500.5取501后求和，而非总和2502.5取2503");
  for (const card of player.cards) {
    const { critRate, critDamage, ...legacy } = card.tier;
    card.tier = { ...legacy, maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50, lifestealRate: 0 } as CardBattleTier;
  }
  assert.equal(calculateCardTowerPower([player]), 1725 * 5);
});

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

test("闯关BOSS普攻、普通及真实技能伤害与治疗技能按累计衰减结算", () => {
  for (const type of ["damage_all", "damage_true_all"] as const) {
    const team = squad("team", 1, { maxHp: 10_000_000, attack: 20000, defense: 0, speed: 2000, energyRequired: 10,
      effects: [{ id: "team-damage", order: 0, condition: "energy_full", conditionValue: null, type: "damage_all", value: 20000, duration: null }] });
    const boss = squad("boss", 2, { maxHp: 10_000_000, attack: 1000, defense: 0, speed: 1000, energyRequired: 10,
      effects: [{ id: "damage", order: 0, condition: "energy_full", conditionValue: null, type, value: 10000, duration: null },
        { id: "heal", order: 1, condition: "energy_full", conditionValue: null, type: "heal_all_allies", value: 1000, duration: null }] });
    // Keep one caster and four basic attackers to cover both paths without hitting event limits.
    // Use support cards so hits still charge the same per-round casting schedule.
    for (const card of [...team.cards, ...boss.cards]) card.battleRole = "support";
    for (const card of boss.cards.slice(1)) card.tier.effects = [];
    const input = [team, boss];
    const normal = simulateCardBattle(input, `decay-output-${type}`, "1v1");
    const tower = simulateCardBattle(input, `decay-output-${type}`, "tower");
    for (const round of [1, 2, 3, 11]) {
      const multiplier = 1 - (round - 1) * 0.005;
      const baseline = normal.events.filter(e => e.round === round && e.actorId?.startsWith("boss") && e.visual === "damage");
      const weakened = tower.events.filter(e => e.round === round && e.actorId?.startsWith("boss") && e.visual === "damage");
      assert.ok(baseline.length > 0, `${type}/${round}`);
      assert.equal(weakened.length, baseline.length);
      for (const [index, event] of weakened.entries()) {
        assert.equal(event.actorId, baseline[index]!.actorId);
        for (const [targetIndex, hit] of event.effects.entries()) {
          const original = baseline[index]!.effects[targetIndex]!;
          assert.equal(hit.targetId, original.targetId);
          assert.ok(Math.abs(hit.amount! - Math.round(original.amount! * multiplier)) <= 1, `${type}/${round}: ${hit.amount} vs ${original.amount}`);
        }
      }
      const heals = tower.events.filter(e => e.round === round && e.actorId?.startsWith("boss") && e.visual === "heal").flatMap(e => e.effects);
      assert.ok(heals.length > 0);
      if (round > 1) assert.equal(heals.length, 5);
      assert.ok(heals.every(h => h.amount === Math.round(1000 * multiplier)), `${type}/${round}/healing`);
    }
  }
});

test("闯关换队延续已完成的回合衰减，同回合接替不多扣一次", () => {
  const first = squad("first", 1, { maxHp: 2000, attack: 0, defense: 0, speed: 2000 });
  const reserve = squad("reserve", 1, { maxHp: 1_000_000, attack: 0, defense: 0, speed: 3000 });
  const boss = squad("boss", 2, { maxHp: 1_000_000, attack: 0, defense: 1000, speed: 1000, energyRequired: 10,
    effects: [{ id: "damage", order: 0, condition: "energy_full", conditionValue: null, type: "damage_all", value: 1000, duration: null }] });
  const result = simulateCardBattle([first, reserve, boss], "decay-relay", "tower");
  const joined = result.events.find(e => e.text === "reserve 接替上场")!;
  assert.ok(joined && joined.round > 1);
  for (const event of result.events.filter(e => e.sequence >= joined.sequence)) {
    const completed = event.kind === "end" && result.endReason === "round_limit" ? event.round : event.round - 1;
    assert.ok(event.states.filter(s => s.seat === 2).every(s => s.speed === 1000 - completed * 5 && s.defense === 1000 - completed * 5));
  }
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

test("后备速度更高仍按一二三队依次上场，回放中途及结束保持实际在场队伍", () => {
  const inputs = [squad("one", 1, { maxHp: 1, speed: 10 }), squad("two", 1, { maxHp: 1, speed: 2000 }),
    squad("three", 1, { maxHp: 1, speed: 3000 }), squad("boss", 2, { maxHp: 100000, attack: 10000, speed: 1000 })];
  const result = simulateCardBattle(inputs, "ordered-relay", "tower");
  const order = ["one", "two", "three"];
  assert.deepEqual(result.events.filter((event) => event.text.includes("接替上场")).map((event) => event.text), ["two 接替上场", "three 接替上场"]);
  let previous = 0, elapsed = 0;
  const start = new Date("2026-09-15T00:00:00Z");
  for (const event of result.events) {
    const squadIds = [...new Set(event.states.filter((state) => state.seat === 1).map((state) => state.userId))];
    assert.equal(squadIds.length, 1);
    const current = order.indexOf(squadIds[0]!);
    assert.ok(current === previous || current === previous + 1);
    previous = current;
    elapsed += event.durationMs;
    const playback = resolveCardBattlePlayback(result, start, "playing", start.getTime() + elapsed);
    assert.deepEqual(playback.states, event.states);
  }
  assert.equal(previous, 2);
  const completed = resolveCardBattlePlayback(result, start, "ended", start.getTime() + elapsed);
  assert.equal(completed.complete, true);
  assert.deepEqual(completed.states, result.finalStates);
  assert.ok(completed.states.filter((state) => state.seat === 1).every((state) => state.userId === "three"));
});
