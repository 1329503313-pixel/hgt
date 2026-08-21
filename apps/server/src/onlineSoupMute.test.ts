import assert from "node:assert/strict";
import test from "node:test";
import { onlineSoupMuteRemainingMinutes } from "./onlineSoupMute.js";

test("禁言剩余分钟向上取整并在到期后归零", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");
  assert.equal(onlineSoupMuteRemainingMinutes("2026-08-21T00:00:01.000Z", now), 1);
  assert.equal(onlineSoupMuteRemainingMinutes("2026-08-21T00:05:00.000Z", now), 5);
  assert.equal(onlineSoupMuteRemainingMinutes("2026-08-20T23:59:59.000Z", now), 0);
  assert.equal(onlineSoupMuteRemainingMinutes(null, now), 0);
});
