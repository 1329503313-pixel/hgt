import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailSource = readFileSync(new URL("../src/pages/MyCollectibleDetailPage.tsx", import.meta.url), "utf8");
const roomSource = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");

test("收藏品详情为当前拥有者提供携带和卸下状态按钮", () => {
  assert.match(detailSource, /item\.owner\?\.id === user\?\.id/);
  assert.match(detailSource, /aria-pressed=\{Boolean\(item\.isEquipped\)\}/);
  assert.match(detailSource, /item\.isEquipped \? "卸下" : "携带"/);
  assert.match(detailSource, /\/api\/me\/collectibles\/\$\{item\.id\}\/equipment/);
});

test("游戏房间入房消息展示携带收藏品并区分史诗和传说品质", () => {
  assert.match(roomSource, /message\.entryCollectible/);
  assert.match(roomSource, /携带着/);
  assert.match(roomSource, /entryCollectible\.rarity === "legend" \? "vip-name-rainbow" : "text-amber-700"/);
});
