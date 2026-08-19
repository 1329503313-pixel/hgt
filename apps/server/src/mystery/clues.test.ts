import assert from "node:assert/strict";
import test from "node:test";
import { mysteryClueContentSchema, nextMysteryClueNumber } from "./clues.js";

test("mystery clue content is trimmed and accepts multiline text", () => {
  assert.equal(mysteryClueContentSchema.parse("  第一行\n第二行  "), "第一行\n第二行");
  assert.equal(mysteryClueContentSchema.safeParse("   ").success, false);
  assert.equal(mysteryClueContentSchema.safeParse("线".repeat(2001)).success, false);
});

test("mystery clue numbers start at one and increase from the persisted maximum", () => {
  assert.equal(nextMysteryClueNumber(null), 1);
  assert.equal(nextMysteryClueNumber("7"), 8);
  assert.throws(() => nextMysteryClueNumber(-1), /Invalid mystery clue number/);
});
