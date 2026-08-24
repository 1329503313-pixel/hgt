import assert from "node:assert/strict";
import test from "node:test";
import {
  behaviorDateKey,
  USER_BEHAVIOR_DEFINITIONS
} from "./behaviorAnalytics.js";

test("用户行为统计使用北京时间自然日", () => {
  assert.equal(behaviorDateKey(new Date("2026-07-29T15:59:59.999Z")), "2026-07-29");
  assert.equal(behaviorDateKey(new Date("2026-07-29T16:00:00.000Z")), "2026-07-30");
});

test("用户行为定义包含13个稳定且不重复的类型", () => {
  assert.equal(USER_BEHAVIOR_DEFINITIONS.length, 13);
  assert.equal(new Set(USER_BEHAVIOR_DEFINITIONS.map((item) => item.key)).size, 13);
  assert.deepEqual(
    USER_BEHAVIOR_DEFINITIONS.map((item) => item.label),
    ["发布海龟汤", "查看汤", "AI 主持", "点赞", "收藏", "评论", "抽卡", "送礼", "圈子发言", "私信发言", "创建游戏房间", "进入游戏房间", "完成一轮游戏"]
  );
});
