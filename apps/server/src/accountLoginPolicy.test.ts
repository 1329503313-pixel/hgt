import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseOriginalAccount } from "./accountLoginPolicy.js";

test("historical user may log in with the original password before choosing to bind", () => {
  const state = { role: "user", usernameGenerated: false, legacyLoginEnabled: true };
  assert.equal(canUseOriginalAccount(state), true);
});

test("upgraded historical user cannot log in with original account", () => {
  const state = { role: "user", usernameGenerated: false, legacyLoginEnabled: false };
  assert.equal(canUseOriginalAccount(state), false);
});

test("new phone registrant has no original account login", () => {
  const state = { role: "user", usernameGenerated: true, legacyLoginEnabled: false };
  assert.equal(canUseOriginalAccount(state), false);
});

test("super administrator may use the original account without a phone", () => {
  const state = { role: "super_admin", usernameGenerated: false, legacyLoginEnabled: true };
  assert.equal(canUseOriginalAccount(state), true);
});
