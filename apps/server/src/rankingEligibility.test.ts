import assert from "node:assert/strict";
import test from "node:test";
import {
  HOT_SOUP_RANKING_ELIGIBLE_CREATOR_ROLES,
  HOT_SOUP_RANKING_ELIGIBLE_CREATOR_ROLES_SQL,
  USER_RANKING_ELIGIBLE_ROLES,
  USER_RANKING_ELIGIBLE_ROLES_SQL
} from "./rankingEligibility.js";

test("超级管理员发布的海龟汤可以进入作品热度榜", () => {
  assert.equal(HOT_SOUP_RANKING_ELIGIBLE_CREATOR_ROLES.includes("super_admin"), true);
  assert.match(HOT_SOUP_RANKING_ELIGIBLE_CREATOR_ROLES_SQL, /'super_admin'/);
});

test("超级管理员不能进入用户排行榜", () => {
  assert.deepEqual(USER_RANKING_ELIGIBLE_ROLES, ["user", "vip", "backoffice_admin"]);
  assert.equal(USER_RANKING_ELIGIBLE_ROLES.includes("super_admin" as never), false);
  assert.doesNotMatch(USER_RANKING_ELIGIBLE_ROLES_SQL, /'super_admin'/);
});
