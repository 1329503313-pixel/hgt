import assert from "node:assert/strict";
import test from "node:test";
import { luckyRedPacketAmount } from "./circleRedPackets.js";

test("lucky red packet leaves at least one shell for each remaining packet", () => {
  assert.equal(luckyRedPacketAmount(10, 5, (_min, max) => max - 1), 4);
  assert.equal(luckyRedPacketAmount(6, 5, (_min, max) => max - 1), 2);
  assert.equal(luckyRedPacketAmount(5, 5, () => 1), 1);
});

test("last lucky red packet receives the complete remainder", () => {
  assert.equal(luckyRedPacketAmount(37, 1), 37);
});

test("invalid lucky red packet remainder is rejected", () => {
  assert.throws(() => luckyRedPacketAmount(2, 3), /INVALID_RED_PACKET_REMAINDER/);
});
