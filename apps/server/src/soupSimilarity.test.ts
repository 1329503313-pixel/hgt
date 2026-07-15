import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSoupSimilarity,
  findHighlySimilarSoup,
  normalizeSoupText,
  textSimilarity
} from "./soupSimilarity.js";

const original = {
  title: "消失的旅客",
  surface: "一名旅客走进旅店，第二天却凭空消失了。",
  bottom: "旅客其实是演员，所谓消失是剧组提前设计好的魔术表演。"
};

test("normalization ignores formatting-only differences", () => {
  assert.equal(normalizeSoupText(" 海龟ＴＥＳＴ！\n"), "海龟test");
  assert.equal(textSimilarity("他走了。", "他 走 了"), 1);
});

test("identical soup content is highly similar", () => {
  assert.equal(calculateSoupSimilarity(original, { ...original }), 1);
  assert.equal(findHighlySimilarSoup(original, [{ id: "existing", ...original }])?.id, "existing");
});

test("an edited soup excludes itself from duplicate detection", () => {
  assert.equal(findHighlySimilarSoup(original, [{ id: "current", ...original }], "current"), null);
});

test("unrelated soup content is not treated as a duplicate", () => {
  const unrelated = {
    title: "生日蜡烛",
    surface: "女孩每年生日都少点一根蜡烛。",
    bottom: "她按距离退休的年数准备蜡烛，用这种方式期待退休旅行。"
  };
  assert.equal(findHighlySimilarSoup(original, [{ id: "other", ...unrelated }]), null);
});
