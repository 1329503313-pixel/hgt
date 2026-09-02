import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailSource = readFileSync(new URL("../src/pages/MyCollectibleDetailPage.tsx", import.meta.url), "utf8");
const roomSource = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");
const collectibleInfoModalSource = readFileSync(new URL("../src/components/CollectibleInfoModal.tsx", import.meta.url), "utf8");
const roomServerSource = readFileSync(new URL("../../server/src/onlineSoup.ts", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("../../server/src/db.ts", import.meta.url), "utf8");

test("收藏品详情为当前拥有者提供携带和卸下状态按钮", () => {
  assert.match(detailSource, /item\.owner\?\.id === user\?\.id/);
  assert.match(detailSource, /aria-pressed=\{Boolean\(item\.isEquipped\)\}/);
  assert.match(detailSource, /item\.isEquipped \? "卸下" : "携带"/);
  assert.match(detailSource, /\/api\/me\/collectibles\/\$\{item\.id\}\/equipment/);
});

test("收藏品详情的拥有者只展示昵称而不展示账号", () => {
  assert.match(detailSource, /value: item\.owner\?\.nickname \|\| "暂无拥有者"/);
  assert.doesNotMatch(detailSource, /item\.owner\.username/);
});

test("游戏房间入房消息展示所有品质的携带收藏品", () => {
  assert.match(roomSource, /message\.entryCollectible/);
  assert.match(roomSource, /携带着/);
  assert.match(roomSource, /limited: "text-rose-700"/);
  assert.match(roomSource, /collaboration: "text-cyan-700"/);
  assert.match(roomSource, /legend: "vip-name-rainbow"/);
  assert.match(roomSource, /epic: "text-amber-700"/);
  assert.doesNotMatch(roomServerSource, /WHERE u\.id = \? AND c\.rarity IN/);
  assert.match(databaseSource, /entry_collectible_rarity ENUM\('limited','collaboration','legend','epic'\)/);
});

test("任意房间成员可点击入房消息中的收藏品名称查看信息卡", () => {
  assert.match(roomSource, /onOpenCollectible=\{setCollectibleCardId\}/);
  assert.match(roomSource, /查看收藏品\$\{message\.entryCollectible\.name\}的信息/);
  assert.match(roomSource, /<CollectibleInfoModal collectibleId=\{collectibleCardId\}/);
  assert.match(roomServerSource, /entry_collectible_id/);
  assert.match(databaseSource, /entry_collectible_id VARCHAR\(64\) NULL/);
  assert.match(collectibleInfoModalSource, /\/api\/collectibles\/\$\{collectibleId\}/);
  assert.match(collectibleInfoModalSource, /item\.owner\?\.nickname \|\| "暂无拥有者"/);
});
