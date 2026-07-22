import assert from "node:assert/strict";
import test from "node:test";
import { digitalAssetRules } from "./digitalAssets.js";

test("累计获得数量按1、4、9、19张自动升星", () => {
  assert.deepEqual([1, 3, 4, 8, 9, 18, 19, 20].map(digitalAssetRules.starForTotal), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(digitalAssetRules.duplicateProgress(3, 0), 2);
  assert.equal(digitalAssetRules.duplicateProgress(8, 1), 4);
  assert.equal(digitalAssetRules.duplicateProgress(18, 2), 9);
  assert.equal(digitalAssetRules.duplicateProgress(19, 3), 0);
});

test("收藏值按当前星级计算而非历史累计", () => {
  assert.deepEqual(digitalAssetRules.collectionValues.normal, [1, 2, 5, 15]);
  assert.deepEqual(digitalAssetRules.collectionValues.rare, [2, 5, 12, 35]);
  assert.deepEqual(digitalAssetRules.collectionValues.epic, [5, 12, 30, 100]);
  assert.deepEqual(digitalAssetRules.collectionValues.legend, [15, 40, 120, 360]);
});

test("保底为10、60、150且同时触发时优先最高品质", () => {
  assert.deepEqual(digitalAssetRules.pityLimits, { rare: 10, epic: 60, legend: 150 });
  assert.equal(digitalAssetRules.pityTrigger({ rare_count: 9, epic_count: 58, legend_count: 148 }), "rare");
  assert.equal(digitalAssetRules.pityTrigger({ rare_count: 9, epic_count: 59, legend_count: 148 }), "epic");
  assert.equal(digitalAssetRules.pityTrigger({ rare_count: 9, epic_count: 59, legend_count: 149 }), "legend");
});

test("高品质卡同时重置覆盖的低品质保底", () => {
  const state = { rare_count: 7, epic_count: 20, legend_count: 40 };
  assert.deepEqual(digitalAssetRules.updatePity(state, "rare"), { rare: 0, epic: 21, legend: 41 });
  assert.deepEqual(digitalAssetRules.updatePity(state, "epic"), { rare: 0, epic: 0, legend: 41 });
  assert.deepEqual(digitalAssetRules.updatePity(state, "legend"), { rare: 0, epic: 0, legend: 0 });
});

test("满星重复返还按品质固定", () => {
  assert.deepEqual(digitalAssetRules.fullStarRefunds, { normal: 2, rare: 4, epic: 8, legend: 30 });
});

test("卡包抽取统计将数据库聚合值转换为前端数字", () => {
  assert.deepEqual(digitalAssetRules.packDrawStatistics({ total_draw_count: "128", recent_7d_draw_count: "37" }), {
    totalDrawCount: 128,
    recent7dDrawCount: 37
  });
  assert.deepEqual(digitalAssetRules.packDrawStatistics({ total_draw_count: null, recent_7d_draw_count: undefined }), {
    totalDrawCount: 0,
    recent7dDrawCount: 0
  });
});
