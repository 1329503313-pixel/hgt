import assert from "node:assert/strict";
import { test } from "node:test";
import { observeBattleMotionPresentation } from "../src/shared/battleMotionPresentation.js";

test("canvas is retained only after a measured improvement, with bounded sampling and complete cleanup", () => {
  const pending = new Map<number, FrameRequestCallback>();
  let next = 0, now = 100;
  const previous = ["document", "requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => { pending.set(++next, callback); return next; } });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (id: number) => pending.delete(id) });
  const advance = (ms: number, interval: number) => {
    const end = now + ms;
    while (now < end) { now += interval; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(now)); }
  };
  const run = (nativeInterval: number, canvasInterval: number) => {
    const choices: boolean[] = [];
    const a = observeBattleMotionPresentation(value => choices.push(value));
    const b = observeBattleMotionPresentation(() => {});
    a.active(true); b.active(true);
    advance(2100, nativeInterval); advance(2200, canvasInterval);
    assert.equal(pending.size, 0, "sampling stops after the comparison");
    a.dispose(); b.dispose();
    return choices;
  };
  try {
    assert.deepEqual(run(16.67, 16.67), [false], "smooth native playback incurs no frame copying");
    assert.deepEqual(run(33.34, 16.67), [false, true], "a 30 to 60 Hz improvement retains canvas");
    assert.deepEqual(run(33.34, 40), [false, true, false], "a regression restores native playback");
    const a = observeBattleMotionPresentation(() => {}), b = observeBattleMotionPresentation(() => {});
    a.active(true); b.active(true); advance(100, 33.34); a.dispose(); b.dispose();
    assert.equal(pending.size, 0, "unmount cancels an unfinished trial");
  } finally {
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
