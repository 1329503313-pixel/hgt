import assert from "node:assert/strict";
import test from "node:test";
import { idempotentSoupId, isValidIdempotencyKey } from "./idempotency.js";

test("海龟汤创建幂等 ID 对同一用户和请求键保持稳定", () => {
  const key = "12345678-1234-4123-8123-123456789abc";
  assert.equal(idempotentSoupId("user-a", key), idempotentSoupId("user-a", key));
  assert.notEqual(idempotentSoupId("user-a", key), idempotentSoupId("user-b", key));
  assert.ok(idempotentSoupId("user-a", key).length <= 64);
});

test("幂等键只接受限定长度的安全字符", () => {
  assert.equal(isValidIdempotencyKey("12345678-1234-4123-8123-123456789abc"), true);
  assert.equal(isValidIdempotencyKey("too-short"), false);
  assert.equal(isValidIdempotencyKey("invalid key with spaces"), false);
});
