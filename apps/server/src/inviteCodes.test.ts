import assert from "node:assert/strict";
import test from "node:test";
import {
  generateInviteCode,
  INVITE_CODE_FORBIDDEN_FRAGMENTS,
  INVITE_CODE_PATTERN,
  isInviteCodeAllowed,
  normalizeInviteCode
} from "./inviteCodes.js";

test("invite codes use five uppercase alphanumeric characters with both character groups", () => {
  for (let index = 0; index < 500; index += 1) {
    const code = generateInviteCode();
    assert.match(code, INVITE_CODE_PATTERN);
    assert.match(code, /[A-Z]/);
    assert.match(code, /\d/);
    assert.equal(isInviteCodeAllowed(code), true);
  }
});

test("invite codes are normalized before validation", () => {
  assert.equal(normalizeInviteCode(" a1b2c "), "A1B2C");
  assert.equal(normalizeInviteCode(null), "");
});

test("invite codes reject ambiguous or offensive fragments", () => {
  for (const code of ["A1SB2", "DSB42", "NMSL8", "A438B", "C250D", "E748F", "1JB2C"]) {
    assert.equal(isInviteCodeAllowed(code), false, code);
  }
  assert.equal(isInviteCodeAllowed("A1B2C"), true);
  assert.ok(INVITE_CODE_FORBIDDEN_FRAGMENTS.includes("SB"));
  assert.ok(INVITE_CODE_FORBIDDEN_FRAGMENTS.includes("438"));
});
