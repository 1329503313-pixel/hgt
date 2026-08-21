import assert from "node:assert/strict";
import test from "node:test";
import { onlineSoupEligibleSourceSql, onlineSoupEligibleSources } from "./onlineSoupEligibleSource.js";

test("选汤页提供七个新模块并移除旧来源", () => {
  assert.deepEqual(onlineSoupEligibleSources, ["recommended", "random", "latest", "liked", "favorited", "played", "mine"]);
  assert.equal(onlineSoupEligibleSources.includes("library" as never), false);
});

test("推荐、随机、最新和我的使用指定排序", () => {
  assert.match(onlineSoupEligibleSourceSql("recommended", "u1", "seed").orderBy, /eligible_heat_eval/);
  assert.match(onlineSoupEligibleSourceSql("random", "u1", "seed-1").orderBy, /CRC32/);
  assert.deepEqual(onlineSoupEligibleSourceSql("random", "u1", "seed-1").orderParams, ["seed-1"]);
  assert.equal(onlineSoupEligibleSourceSql("latest", "u1", "seed").orderBy, "s.created_at DESC, s.id DESC");
  assert.deepEqual(onlineSoupEligibleSourceSql("mine", "u1", "seed").conditions, ["s.creator_id = ?"]);
});

test("点赞、收藏和玩过按当前用户的最新行为时间排序", () => {
  const liked = onlineSoupEligibleSourceSql("liked", "u1", "seed");
  const favorited = onlineSoupEligibleSourceSql("favorited", "u1", "seed");
  const played = onlineSoupEligibleSourceSql("played", "u1", "seed");
  assert.match(liked.orderBy, /eligible_like_order\.created_at.*DESC/);
  assert.match(favorited.orderBy, /eligible_favorite_order\.created_at.*DESC/);
  assert.match(played.orderBy, /GREATEST/);
  assert.match(played.orderBy, /completed_at/);
  assert.deepEqual(played.conditionParams, ["u1", "u1", "u1"]);
  assert.deepEqual(played.orderParams, ["u1", "u1", "u1"]);
});
