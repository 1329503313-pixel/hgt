import assert from "node:assert/strict";
import test from "node:test";
import { PROFILE_SOUP_ORDER_SQL, PROFILE_SOUP_PIN_LIMIT, profilePinEvictionIds } from "./soupProfilePins.js";

test("个人主页最多保留四个置顶作品并淘汰最早置顶项", () => {
  const pinnedSoups = [
    { id: "newest", profile_pinned_at: "2026-08-27T04:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z" },
    { id: "oldest", profile_pinned_at: "2026-08-27T01:00:00.000Z", created_at: "2026-08-04T00:00:00.000Z" },
    { id: "third", profile_pinned_at: "2026-08-27T03:00:00.000Z", created_at: "2026-08-02T00:00:00.000Z" },
    { id: "second", profile_pinned_at: "2026-08-27T02:00:00.000Z", created_at: "2026-08-03T00:00:00.000Z" },
  ];

  assert.equal(PROFILE_SOUP_PIN_LIMIT, 4);
  assert.deepEqual(profilePinEvictionIds(pinnedSoups), ["oldest"]);
});

test("不足四个置顶作品时不淘汰，异常超限时恢复到三项后再加入新作品", () => {
  assert.deepEqual(profilePinEvictionIds([
    { id: "a", profile_pinned_at: "2026-08-27T01:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z" },
    { id: "b", profile_pinned_at: "2026-08-27T02:00:00.000Z", created_at: "2026-08-02T00:00:00.000Z" },
    { id: "c", profile_pinned_at: "2026-08-27T03:00:00.000Z", created_at: "2026-08-03T00:00:00.000Z" },
  ]), []);
  assert.deepEqual(profilePinEvictionIds([
    { id: "a", profile_pinned_at: "2026-08-27T01:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z" },
    { id: "b", profile_pinned_at: "2026-08-27T02:00:00.000Z", created_at: "2026-08-02T00:00:00.000Z" },
    { id: "c", profile_pinned_at: "2026-08-27T03:00:00.000Z", created_at: "2026-08-03T00:00:00.000Z" },
    { id: "d", profile_pinned_at: "2026-08-27T04:00:00.000Z", created_at: "2026-08-04T00:00:00.000Z" },
    { id: "e", profile_pinned_at: "2026-08-27T05:00:00.000Z", created_at: "2026-08-05T00:00:00.000Z" },
  ]), ["a", "b"]);
});

test("个人主页先展示置顶作品且置顶组按发布时间倒序", () => {
  assert.equal(
    PROFILE_SOUP_ORDER_SQL,
    "s.profile_pinned_at IS NOT NULL DESC, s.created_at DESC, s.id DESC",
  );
});
