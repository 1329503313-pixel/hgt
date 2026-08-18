import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_CARD_STAR_POINT_COUNT, AssetCardEffectTimer, assetCardEffectClockDelay, assetCardGlitterEffect } from "../src/components/AssetCardVisual";

const assetCardStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("二星与三星星点数量均为原 8 个的 150%", () => {
  assert.equal(ASSET_CARD_STAR_POINT_COUNT, 12);
});

test("史诗卡二星使用金色闪粉，三星改为炫彩闪粉", () => {
  assert.equal(assetCardGlitterEffect("epic", 1), null);
  assert.equal(assetCardGlitterEffect("epic", 2), "gold");
  assert.equal(assetCardGlitterEffect("epic", 3), "rainbow");
});

test("只有三星传说卡使用炫彩闪粉", () => {
  assert.equal(assetCardGlitterEffect("legend", 2), null);
  assert.equal(assetCardGlitterEffect("legend", 3), "rainbow");
});

test("普通和稀有卡满星后也不显示闪粉", () => {
  assert.equal(assetCardGlitterEffect("normal", 3), null);
  assert.equal(assetCardGlitterEffect("rare", 3), null);
});

test("二星与三星只保留零星星点，不再渲染白光或炫彩光层", () => {
  assert.doesNotMatch(assetCardStyles, /asset-card-light-sweep/);
  assert.doesNotMatch(assetCardStyles, /asset-card-glitter-twinkle/);
  assert.doesNotMatch(assetCardStyles, /\.asset-card-glitter(?:-gold|-rainbow)?::(?:before|after)/);
  assert.match(assetCardStyles, /@keyframes asset-card-gold-star-twinkle/);
  assert.match(assetCardStyles, /@keyframes asset-card-rainbow-star-twinkle/);
});

test("所有星级覆盖效果使用同一个文档时间轴延迟", () => {
  assert.equal(typeof AssetCardEffectTimer, "function");
  assert.equal(assetCardEffectClockDelay(0), "0ms");
  assert.equal(assetCardEffectClockDelay(5200.126), "-5200.13ms");
  assert.equal(assetCardEffectClockDelay(5200.126), assetCardEffectClockDelay(5200.126));
  assert.match(assetCardStyles, /var\(--asset-card-effect-delay, 0s\)/);
  assert.doesNotMatch(assetCardStyles, /--glitter-effect-delay/);
});
