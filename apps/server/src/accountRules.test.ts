import assert from "node:assert/strict";
import test from "node:test";
import { accountBioSchema, accountNicknameSchema, accountPasswordSchema, accountUsernameSchema } from "./accountRules.js";

test("new account names require at least six printable ASCII characters", () => {
  assert.equal(accountUsernameSchema.safeParse("abc123").success, true);
  assert.equal(accountUsernameSchema.safeParse("A-b_1!").success, true);
  assert.equal(accountUsernameSchema.safeParse("abc12").success, false);
  assert.equal(accountUsernameSchema.safeParse("账号123456").success, false);
  assert.equal(accountUsernameSchema.safeParse("abc 123").success, false);
});

test("new passwords require at least six characters", () => {
  assert.equal(accountPasswordSchema.safeParse("123456").success, true);
  assert.equal(accountPasswordSchema.safeParse("12345").success, false);
});

test("nicknames are trimmed and limited to eight characters", () => {
  assert.equal(accountNicknameSchema.parse("  汤友  "), "汤友");
  assert.equal(accountNicknameSchema.safeParse("123456789").success, false);
});

test("bios can be cleared and are trimmed and limited to forty characters", () => {
  assert.equal(accountBioSchema.parse("  喜欢推理，也喜欢写汤。  "), "喜欢推理，也喜欢写汤。");
  assert.equal(accountBioSchema.safeParse("").success, true);
  assert.equal(accountBioSchema.safeParse("简介".repeat(20)).success, true);
  assert.equal(accountBioSchema.safeParse(`简介${"介".repeat(39)}`).success, false);
});
