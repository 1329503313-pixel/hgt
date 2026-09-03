import assert from "node:assert/strict";
import test from "node:test";
import {
  SOUP_TOPIC_NAME_MAX_LENGTH,
  shouldRequireActiveSoupTopic,
  soupTopicDirectMatchOrderSql,
  soupTopicNameLength,
  soupTopicSearchFilterSql
} from "./soupTopics.js";

test("话题名称按用户可见字符计数并限制为 16 个字", () => {
  assert.equal(SOUP_TOPIC_NAME_MAX_LENGTH, 16);
  assert.equal(soupTopicNameLength("  校园怪谈  "), 4);
  assert.equal(soupTopicNameLength("🐢"), 1);
});

test("已绑定的下架话题可原样保留，但新增或改绑必须校验上架状态", () => {
  assert.equal(shouldRequireActiveSoupTopic(null, "old-topic"), false);
  assert.equal(shouldRequireActiveSoupTopic("old-topic", "old-topic"), false);
  assert.equal(shouldRequireActiveSoupTopic("new-topic", "old-topic"), true);
  assert.equal(shouldRequireActiveSoupTopic("new-topic", null), true);
});

test("话题搜索包含下架话题，并把直接内容命中排在仅话题命中之前", () => {
  const filterSql = soupTopicSearchFilterSql();
  const orderSql = soupTopicDirectMatchOrderSql();
  assert.match(filterSql, /FROM soup_topics matched_topic/);
  assert.doesNotMatch(filterSql, /is_active/);
  assert.match(orderSql, /s\.title LIKE \?.*s\.author LIKE \?.*s\.summary LIKE \?/);
  assert.doesNotMatch(orderSql, /soup_topics|topic_id/);
});
