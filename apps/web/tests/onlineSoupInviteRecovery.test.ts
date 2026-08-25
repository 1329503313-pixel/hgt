import assert from "node:assert/strict";
import test from "node:test";
import {
  isClosedOnlineSoupInvite,
  isTerminalOnlineSoupJoinError,
} from "../src/shared/onlineSoupInviteRecovery";

test("temporary invite failures keep the pending QR invitation retryable", () => {
  for (const error of [new Error("network failed"), { code: "" }, { code: "UPSTREAM_UNAVAILABLE" }, null]) {
    assert.equal(isClosedOnlineSoupInvite(error), false);
    assert.equal(isTerminalOnlineSoupJoinError(error), false);
  }
});

test("only definitive room states terminate QR invitation recovery", () => {
  assert.equal(isClosedOnlineSoupInvite({ code: "ROOM_CLOSED" }), true);
  assert.equal(isTerminalOnlineSoupJoinError({ code: "ROOM_CLOSED" }), true);
  assert.equal(isTerminalOnlineSoupJoinError({ code: "ROOM_FULL" }), true);
  assert.equal(isClosedOnlineSoupInvite({ code: "ROOM_FULL" }), false);
});
