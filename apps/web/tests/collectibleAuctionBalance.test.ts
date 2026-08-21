import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const balanceHook = readFileSync(new URL("../src/shared/useShellBalance.ts", import.meta.url), "utf8");
const auctionPage = readFileSync(new URL("../src/pages/CollectibleAuctionDetailPage.tsx", import.meta.url), "utf8");
const collectibleRoutes = readFileSync(new URL("../../server/src/collectibles.ts", import.meta.url), "utf8");

test("藏品出价成功后立即发布接口返回的最新贝壳余额", () => {
  assert.match(auctionPage, /publishShellBalance\(user\?\.id,d\.balance\)/);
  assert.match(collectibleRoutes, /res\.json\(\{ auction: payload, balance:/);
});

test("新出价者和被超过者都会收到定向余额实时事件", () => {
  assert.match(collectibleRoutes, /emitUserEvent\(previousUserId, "shell_balance_changed"/);
  assert.match(collectibleRoutes, /emitUserEvent\(user\.id, "shell_balance_changed"/);
  assert.match(balanceHook, /subscribeServerEvent\("shell_balance_changed"/);
});

test("竞价未读事件作为余额查询兜底", () => {
  assert.match(balanceHook, /payload\.source === "collectible_bid"/);
  assert.match(balanceHook, /payload\.source === "collectible_outbid"/);
});
