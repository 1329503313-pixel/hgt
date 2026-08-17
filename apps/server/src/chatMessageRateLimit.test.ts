import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_STICKER_COOLDOWN_MS,
  recordChatMessageForRateLimit,
  stickerCooldownMessage,
  stickerCooldownRemainingMs,
} from "./chatMessageRateLimit.js";
import type mysql from "mysql2/promise";

function fakeConnection(state = { consecutive_sticker_count: 0, elapsed_ms: null as number | null }) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const connection = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT consecutive_sticker_count")) return [[state], []];
      return [[], []];
    },
  } as unknown as mysql.PoolConnection;
  return { connection, queries };
}

test("前三个连续表情不受十秒间隔限制", () => {
  assert.equal(stickerCooldownRemainingMs(0, 0), 0);
  assert.equal(stickerCooldownRemainingMs(2, 0), 0);
});

test("第四个及后续表情与前一个至少间隔十秒", () => {
  assert.equal(stickerCooldownRemainingMs(3, 0), CHAT_STICKER_COOLDOWN_MS);
  assert.equal(stickerCooldownRemainingMs(3, 9_001), 999);
  assert.equal(stickerCooldownRemainingMs(4, 9_999), 1);
  assert.equal(stickerCooldownRemainingMs(8, 10_000), 0);
});

test("限速提示按整秒向上取整", () => {
  assert.equal(stickerCooldownMessage(9_001), "连续发送 3 个表情后，请等待 10 秒再发送");
  assert.equal(stickerCooldownMessage(1), "连续发送 3 个表情后，请等待 1 秒再发送");
});

test("自己发送非表情消息会重置当前会话内所有用户的连续表情计数", async () => {
  const { connection, queries } = fakeConnection({ consecutive_sticker_count: 3, elapsed_ms: 0 });
  await recordChatMessageForRateLimit(connection, {
    scopeType: "circle",
    scopeId: "circle-1",
    userId: "user-1",
    messageType: "text",
  });

  assert.ok(queries.some(({ sql }) => sql.includes("chat_message_rate_limit_scopes") && sql.includes("FOR UPDATE")));
  const reset = [...queries].reverse().find(({ sql }) => sql.includes("SET consecutive_sticker_count = 0"));
  assert.ok(reset);
  assert.doesNotMatch(reset.sql, /user_id\s*[=<>]/);
  assert.deepEqual(reset.params, ["circle", "circle-1"]);
});

test("其他用户成功发送消息会重置当前用户的连续表情计数", async () => {
  const { connection, queries } = fakeConnection();
  await recordChatMessageForRateLimit(connection, {
    scopeType: "private",
    scopeId: "conversation-1",
    userId: "user-2",
    messageType: "sticker",
  });

  const otherUserReset = queries.find(({ sql }) => sql.includes("user_id <> ?"));
  assert.ok(otherUserReset);
  assert.deepEqual(otherUserReset.params, ["private", "conversation-1", "user-2"]);
});

test("被限速拒绝的表情不会重置其他用户计数", async () => {
  const { connection, queries } = fakeConnection({ consecutive_sticker_count: 3, elapsed_ms: 0 });
  const remainingMs = await recordChatMessageForRateLimit(connection, {
    scopeType: "online_soup",
    scopeId: "room-1",
    userId: "user-1",
    messageType: "sticker",
  });

  assert.equal(remainingMs, CHAT_STICKER_COOLDOWN_MS);
  assert.equal(queries.some(({ sql }) => sql.includes("user_id <> ?")), false);
});
