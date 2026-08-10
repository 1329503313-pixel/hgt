import assert from "node:assert/strict";
import test from "node:test";
import {
  homeSoupCategoryOrder,
  homeSoupCategoryRequiresAuth,
  parseHomeSoupCategory
} from "./homeSoupCategory.js";

test("首页分类参数未知时回退到推荐", () => {
  assert.equal(parseHomeSoupCategory(undefined), "recommended");
  assert.equal(parseHomeSoupCategory("unknown"), "recommended");
});

test("关注和玩过分类需要登录", () => {
  assert.equal(homeSoupCategoryRequiresAuth("following"), true);
  assert.equal(homeSoupCategoryRequiresAuth("played"), true);
  assert.equal(homeSoupCategoryRequiresAuth("ai"), false);
});

test("最新与关注按时间排序，AI 与玩过使用随机排序", () => {
  assert.equal(homeSoupCategoryOrder("recommended"), "default");
  assert.equal(homeSoupCategoryOrder("latest"), "latest");
  assert.equal(homeSoupCategoryOrder("following"), "latest");
  assert.equal(homeSoupCategoryOrder("ai"), "random");
  assert.equal(homeSoupCategoryOrder("played"), "random");
});
