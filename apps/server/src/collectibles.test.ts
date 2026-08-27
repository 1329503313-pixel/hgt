import assert from "node:assert/strict";
import test from "node:test";
import { collectibleAuctionEndAfterBid, collectibleProbabilityWins, insertNotification, optimizeCollectibleImages } from "./collectibles.js";
import { COLLECTIBLE_RANKING_ELIGIBLE_ROLES, CURRENT_COLLECTIBLE_HOLDINGS_SQL } from "./collectibleRankings.js";

test("收藏品排行榜按用户当前拥有且未删除的藏品价值总和统计", () => {
  assert.match(CURRENT_COLLECTIBLE_HOLDINGS_SQL, /SUM\(collectible_value\)/);
  assert.match(CURRENT_COLLECTIBLE_HOLDINGS_SQL, /owner_user_id IS NOT NULL/);
  assert.match(CURRENT_COLLECTIBLE_HOLDINGS_SQL, /status = 'owned'/);
  assert.match(CURRENT_COLLECTIBLE_HOLDINGS_SQL, /deleted_at IS NULL/);
});

test("收藏品排行榜与奖励结算排除超级管理员", () => {
  assert.deepEqual(COLLECTIBLE_RANKING_ELIGIBLE_ROLES, ["user", "vip", "backoffice_admin"]);
  assert.equal(COLLECTIBLE_RANKING_ELIGIBLE_ROLES.includes("super_admin" as never), false);
});

test("收藏品对每件藏品使用独立概率阈值", () => {
  assert.equal(collectibleProbabilityWins(1, 999_999), true);
  assert.equal(collectibleProbabilityWins(1, 1_000_000), false);
  assert.deepEqual([
    collectibleProbabilityWins(50, 10_000_000),
    collectibleProbabilityWins(50, 20_000_000)
  ], [true, true]);
});

test("最后一分钟内出价后延长至出价时间后一整分钟", () => {
  const bidAt = new Date("2026-08-21T10:00:00.000Z");
  assert.equal(collectibleAuctionEndAfterBid(new Date("2026-08-21T10:00:30.000Z"), bidAt).toISOString(), "2026-08-21T10:01:00.000Z");
});

test("最后一分钟以外的出价不改变结束时间", () => {
  const end = new Date("2026-08-21T10:02:00.000Z");
  assert.equal(collectibleAuctionEndAfterBid(end, new Date("2026-08-21T10:00:00.000Z")), end);
});

test("同一拍卖重复被超价时刷新既有通知而不阻断出价事务", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const connection = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [];
    }
  };

  await insertNotification(connection as never, "previous-user", "collectible_outbid", "藏品竞拍出价被超过", "100 贝壳已退回余额", "auction-1");

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(calls[0].sql, /is_read=FALSE/);
  assert.match(calls[0].sql, /created_at=CURRENT_TIMESTAMP/);
  assert.deepEqual(calls[0].params.slice(1), ["previous-user", "collectible_outbid", "藏品竞拍出价被超过", "100 贝壳已退回余额", "auction-1", "previous-user"]);
});

test("本地未配置 OSS 时收藏品封面回退为优化后的 WebP data URL", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>').toString("base64");
  const media = await optimizeCollectibleImages(`data:image/svg+xml;base64,${svg}`, "local-test", false);
  assert.match(media.full, /^data:image\/webp;base64,/);
  assert.match(media.thumbnail, /^data:image\/webp;base64,/);
});
