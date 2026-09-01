import assert from "node:assert/strict";
import test from "node:test";
import { formatAuctionRemainingTime } from "../src/shared/collectibles";

test("藏品拍卖剩余时间按天、小时、分、秒完整展示", () => {
  const seconds = 37 * 86_400 + 12 * 3_600 + 24 * 60 + 17;
  assert.equal(formatAuctionRemainingTime(seconds), "37天12小时24分17秒");
});

test("不足一天时仍保留四级时间单位", () => {
  assert.equal(formatAuctionRemainingTime(65), "0天0小时1分5秒");
  assert.equal(formatAuctionRemainingTime(0), "0天0小时0分0秒");
});
