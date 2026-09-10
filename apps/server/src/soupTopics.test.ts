import assert from "node:assert/strict";
import test from "node:test";
import {
  SOUP_TOPIC_NAME_MAX_LENGTH,
  shouldRequireActiveSoupTopic,
  soupTopicDirectMatchOrderSql,
  soupTopicNameLength,
  soupTopicSearchFilterSql,
  soupKeywordFilter,
  soupTopicSummaryColumnsSql
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

test("点击或输入 #话题只精确查找绑定话题，名称作为参数且不作为通配符", () => {
  for (const name of ["校园怪谈", "100%_谜题", "带'引号", "#双井号", "空 格&问号?"]) {
    const filter = soupKeywordFilter(`  #${name}  `);
    assert.deepEqual(filter.params, [name]);
    assert.equal(filter.orderKeyword, null);
    assert.match(filter.sql, /matched_topic.name = \?/);
    assert.doesNotMatch(filter.sql, /LIKE|is_active|s\.title/);
  }
});

test("普通话题关键词保留模糊搜索和直接内容命中优先", () => {
  const filter = soupKeywordFilter(" 校园 ");
  assert.equal(filter.sql, soupTopicSearchFilterSql());
  assert.deepEqual(filter.params, Array(4).fill("%校园%"));
  assert.equal(filter.orderKeyword, "%校园%");
  assert.equal(soupKeywordFilter("#").orderKeyword, "%#%");
});

test("共享列表投影读取话题名称和状态，不遗漏下架话题", () => {
  const columns = soupTopicSummaryColumnsSql("listed");
  assert.match(columns, /listed\.topic_id/);
  assert.match(columns, /AS topic_name/);
  assert.match(columns, /AS topic_is_active/);
  assert.doesNotMatch(columns, /is_active\s*=/);
});
