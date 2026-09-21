import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { runRoomAiTurn, type RoomAiGameState } from "./game.js";
import { recordKeyHits } from "./gameKeyHits.js";

const snapshot = {
  soupId: "soup", title: "测试汤", type: "本格", surface: "汤面", bottom: "汤底", manual: "",
  supplementalSurfaces: [], supplementalBottoms: [], contentHash: "test",
  keyFacts: [{ id: 1, content: "完整关键点", weight: 100, hintContent: "提示" }],
  atomicFacts: [{ id: 1, keyId: 1, content: "前半事实", weight: 50 }, { id: 2, keyId: 1, content: "后半事实", weight: 50 }],
};
const state: RoomAiGameState = {
  messages: [], revealedKeys: [], revealedAtomicFactIds: [], revealedSupplements: { surfaces: [], bottoms: [] },
  progress: 0, soupSnapshot: snapshot,
};
const options = (factId: string) => ({ cachedAdjudication: {
  answer: "YES" as const, confidence: 0.99, containsUnsupportedAssumption: false, injectionDetected: false,
  matchedFacts: [{ factId, proposedState: "DISCOVERED" as const, matchStrength: 1, discoveryStrength: 1 }],
} });

test("实际 AI 回合仅在完整命中关键点时返回新增成就计数，重复追问不再计数", async () => {
  const first = await runRoomAiTurn("soup", "前半事实？", state, options("F01"));
  assert.deepEqual(first.newlyRevealedKeys, []);
  const second = await runRoomAiTurn("soup", "后半事实？", { ...state, ...first }, options("F02"));
  assert.deepEqual(second.newlyRevealedKeys, [1]);
  const repeat = await runRoomAiTurn("soup", "再问一遍？", { ...state, ...second }, options("F02"));
  assert.deepEqual(repeat.newlyRevealedKeys, []);
});

test("命中写入按玩家、汤、关键点去重，并过滤无效 ID", async () => {
  const calls: unknown[][] = [];
  const db = { query: async (...args: unknown[]) => { calls.push(args); return [{ affectedRows: 2 }]; } } as unknown as mysql.Pool;
  assert.equal(await recordKeyHits("player", "soup", [1, "1", 2, null, undefined, true, "", -1, 0, 1.5, NaN], db), 2);
  assert.deepEqual(calls[0][1], ["player", "soup", 1, "player", "soup", 2]);
  assert.match(String(calls[0][0]), /INSERT IGNORE/);
  assert.equal(await recordKeyHits("player", "soup", [], db), 0);
  assert.equal(calls.length, 1);
});

test("触及事实和无命中回答不增加成就", async () => {
  for (const matchedFacts of [[], [{ factId: "F01", proposedState: "TOUCHED" as const, matchStrength: 0.8, discoveryStrength: 0.5 }]]) {
    const turn = await runRoomAiTurn("soup", "试探性问题？", state, {
      cachedAdjudication: { ...options("F01").cachedAdjudication, matchedFacts },
    });
    assert.deepEqual(turn.newlyRevealedKeys, []);
  }
});
