import assert from "node:assert/strict";
import test from "node:test";
import { selectOnlineSoupHostSuccessor } from "./onlineSoupHostSuccession.js";

test("房主继承优先选择等级更高的在线成员", () => {
  const successor = selectOnlineSoupHostSuccessor([
    { userId: "early-low", experience: 100, joinedAt: "2026-01-01T00:00:00.000Z" },
    { userId: "late-high", experience: 12_000, joinedAt: "2026-01-01T00:10:00.000Z" }
  ]);
  assert.equal(successor?.userId, "late-high");
});

test("等级相同时优先选择更早加入房间的成员", () => {
  const successor = selectOnlineSoupHostSuccessor([
    { userId: "late", experience: 450, joinedAt: "2026-01-01T00:10:00.000Z" },
    { userId: "early", experience: 799, joinedAt: "2026-01-01T00:00:00.000Z" }
  ]);
  assert.equal(successor?.userId, "early");
});

test("等级和加入时间均相同时使用用户 ID 保证结果稳定", () => {
  const successor = selectOnlineSoupHostSuccessor([
    { userId: "user-b", experience: 10, joinedAt: "2026-01-01T00:00:00.000Z" },
    { userId: "user-a", experience: 10, joinedAt: "2026-01-01T00:00:00.000Z" }
  ]);
  assert.equal(successor?.userId, "user-a");
});
