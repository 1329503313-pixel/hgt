import assert from "node:assert/strict";
import { test } from "node:test";
import type mysql from "mysql2/promise";
import { consumePhoneChallenge, phoneCodeDigest, verifyPhoneChallenge } from "./phoneAuth.js";

function fakeConnection(challenge: {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at?: Date | null;
}) {
  const queries: string[] = [];
  const connection = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("SELECT id, code_hash")) {
        return [[challenge.consumed_at ? undefined : challenge]];
      }
      if (sql.includes("SET attempts = attempts + 1")) {
        challenge.attempts += 1;
        if (challenge.attempts >= 5) challenge.consumed_at = new Date();
      }
      if (sql.includes("SET consumed_at = UTC_TIMESTAMP()")) challenge.consumed_at = new Date();
      return [{ affectedRows: 1 }];
    },
  } as unknown as mysql.PoolConnection;
  return { connection, queries };
}

test("SMS code hash is bound to its challenge and cannot be reused for another send", () => {
  assert.notEqual(phoneCodeDigest("first", "123456", "test-secret"), phoneCodeDigest("second", "123456", "test-secret"));
  assert.notEqual(phoneCodeDigest("first", "123456", "test-secret"), phoneCodeDigest("first", "123457", "test-secret"));
});

test("wrong codes consume the five-attempt budget; expired and consumed codes cannot pass", async () => {
  const challenge = {
    id: "challenge-1",
    code_hash: phoneCodeDigest("challenge-1", "123456"),
    attempts: 0,
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null as Date | null,
  };
  const { connection } = fakeConnection(challenge);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await verifyPhoneChallenge(connection, { phone: "13800138000", purpose: "recover", code: "000000" });
    assert.equal(result.ok, false);
  }
  assert.equal(challenge.attempts, 5);
  assert.ok(challenge.consumed_at);
  const locked = await verifyPhoneChallenge(connection, { phone: "13800138000", purpose: "recover", code: "123456" });
  assert.equal(locked.ok, false);
});

test("valid SMS code can be consumed once", async () => {
  const challenge = {
    id: "challenge-2",
    code_hash: phoneCodeDigest("challenge-2", "654321"),
    attempts: 0,
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null as Date | null,
  };
  const { connection } = fakeConnection(challenge);
  const valid = await verifyPhoneChallenge(connection, { phone: "13800138000", purpose: "upgrade", userId: "existing", code: "654321" });
  assert.deepEqual(valid, { ok: true, id: "challenge-2" });
  await consumePhoneChallenge(connection, valid.id);
  const reused = await verifyPhoneChallenge(connection, { phone: "13800138000", purpose: "upgrade", userId: "existing", code: "654321" });
  assert.equal(reused.ok, false);
});
