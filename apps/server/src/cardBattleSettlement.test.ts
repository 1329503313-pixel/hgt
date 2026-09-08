import assert from "node:assert/strict";
import test from "node:test";
import { calculateCardBattleScore } from "@hgt/shared";
import { resolveCardBattleSettlementPlayers } from "./cardBattleSettlement.js";
import { surrenderCardBattleResult } from "./cardBattlePlayback.js";
import type { CardBattleResult } from "./cardBattle.js";

test("评分按权重计算并在第二位小数四舍五入，整数权重避免浮点临界误差", () => {
  assert.equal(calculateCardBattleScore(0, 0, 0), 0);
  assert.equal(calculateCardBattleScore(1500, 2000, 5000), 7.8);
  assert.equal(calculateCardBattleScore(0, 1049, 0), 1);
  assert.equal(calculateCardBattleScore(0, 1050, 0), 1.1);
  assert.equal(calculateCardBattleScore(33, 0, 0), 0);
  assert.equal(calculateCardBattleScore(34, 0, 0), .1);
});

function fixture(legacy = false): CardBattleResult {
  const initialStates = ([1, 2] as const).map(seat => ({ instanceId: `card${seat}`, userId: `u${seat}`, seat, slot: 1 as const, row: "front" as const, hp: 1000, maxHp: 1000, energy: 0, energyRequired: 30, attack: 100, defense: 0, speed: 100, alive: true, damageDealt: 0, damageTaken: 0, ...(!legacy ? { healingDone: 0 } : {}) }));
  const damaged = initialStates.map(state => ({ ...state, hp: state.seat === 2 ? 500 : 1000, damageDealt: state.seat === 1 ? 500 : 0, damageTaken: state.seat === 2 ? 500 : 0 }));
  const healed = damaged.map(state => ({ ...state, hp: state.seat === 2 ? 600 : 1000, ...(!legacy ? { healingDone: state.seat === 2 ? 100 : 0 } : {}) }));
  const future = healed.map(state => ({ ...state, hp: 1000, ...(!legacy ? { healingDone: state.seat === 2 ? 500 : 0 } : {}) }));
  return { version: 1, winnerSeat: 1, endReason: "elimination", rounds: 1, playbackDurationMs: 3000, initialStates, finalStates: future,
    players: ([1, 2] as const).map(seat => ({ userId: `u${seat}`, nickname: `玩家${seat}`, seat, cards: [{ slot: 1, cardId: `c${seat}`, name: `卡${seat}`, damageDealt: seat === 1 ? 500 : 0, damageTaken: seat === 2 ? 500 : 0, ...(!legacy ? { healingDone: seat === 2 ? 500 : 0, score: 999 } : {}) }] })),
    events: [
      { sequence: 1, round: 1, kind: "attack", visual: "damage", actorId: "card1", skillName: null, durationMs: 1000, text: "攻击", effects: [{ targetId: "card2", amount: -500 }], states: damaged },
      { sequence: 2, round: 1, kind: "skill", visual: "heal", actorId: "card2", skillName: "治疗", durationMs: 1000, text: "治疗", effects: [{ targetId: "card2", amount: 100 }], states: healed },
      { sequence: 3, round: 1, kind: "skill", visual: "heal", actorId: "card2", skillName: "治疗", durationMs: 1000, text: "治疗", effects: [{ targetId: "card2", amount: 400 }], states: future },
    ],
  };
}

test("旧结算从真实治疗事件按施法者补算，不改变原快照且评分重新计算", () => {
  for (const legacy of [false, true]) {
    const result = fixture(legacy);
    const saved = structuredClone(result);
    const players = resolveCardBattleSettlementPlayers(result);
    assert.equal(players[0]!.cards[0]!.healingDone, 0);
    assert.equal(players[1]!.cards[0]!.healingDone, 500);
    assert.equal(players[1]!.cards[0]!.score, .9);
    assert.deepEqual(result, saved);
  }
});

test("认输按服务器命中时间截断治疗与评分，旧版无累计字段也不能算入未来治疗", () => {
  for (const legacy of [false, true]) for (const [time, healingDone, score] of [[0, 0, 0], [1549, 0, .5], [1550, 100, .6], [2200, 100, .6], [2550, 500, .9]]) {
    const result = surrenderCardBattleResult(fixture(legacy), "u2", new Date(0), time!)!;
    assert.equal(result.players[1]!.cards[0]!.healingDone, healingDone, `${legacy}:${time}`);
    assert.equal(result.players[1]!.cards[0]!.score, score, `${legacy}:${time}`);
  }
});
