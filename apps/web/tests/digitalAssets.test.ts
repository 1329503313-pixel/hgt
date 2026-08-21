import assert from "node:assert/strict";
import test from "node:test";
import { assetRarityLabel, assetRarityMatchesQuery, sortAssetDrawResultsForDisplay } from "../src/shared/digitalAssets.js";

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

test("十连展示优先按品质降序、同品质按抽取次序升序", () => {
  const results = [
    { drawIndex: 1, rarity: "normal" as const },
    { drawIndex: 2, rarity: "epic" as const },
    { drawIndex: 3, rarity: "legend" as const },
    { drawIndex: 4, rarity: "rare" as const },
    { drawIndex: 5, rarity: "epic" as const },
    { drawIndex: 6, rarity: "legend" as const }
  ];

  const sorted = sortAssetDrawResultsForDisplay(results);

  assert.deepEqual(sorted.map((result) => result.drawIndex), [3, 6, 2, 5, 4, 1]);
  assert.deepEqual(results.map((result) => result.drawIndex), [1, 2, 3, 4, 5, 6]);
});
