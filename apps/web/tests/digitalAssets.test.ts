import assert from "node:assert/strict";
import test from "node:test";
import { assetRarityLabel, assetRarityMatchesQuery } from "../src/shared/digitalAssets.js";

test("卡面品质名称按卡包类型添加同胶囊前缀", () => {
  assert.equal(assetRarityLabel("rare", "permanent"), "稀有");
  assert.equal(assetRarityLabel("rare", "limited"), "限定稀有");
  assert.equal(assetRarityLabel("epic", "collaboration"), "联动史诗");
});

test("特殊卡包展示名称仍保留基础品质检索词", () => {
  for (const packType of ["permanent", "limited", "collaboration"] as const) {
    assert.ok(assetRarityLabel("epic", packType).includes("史诗"));
  }
  assert.equal(assetRarityMatchesQuery("epic", "史诗"), true);
  assert.equal(assetRarityMatchesQuery("epic", "史诗卡"), true);
  assert.equal(assetRarityMatchesQuery("epic", "限定史诗"), true);
  assert.equal(assetRarityMatchesQuery("rare", "史诗"), false);
});
