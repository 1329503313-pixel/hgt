import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_STICKER_COOLDOWN_MS,
  stickerCooldownMessage,
  stickerCooldownRemainingMs,
} from "./chatMessageRateLimit.js";

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
