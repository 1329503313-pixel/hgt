import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { evaluationAdminFilter, evaluationTypeSchema, presentEvaluation, presentEvaluationInteraction, syncEvaluationNotification } from "./evaluationPrivacy.js";

const evaluation = {
  id: "evaluation-1", soupId: "soup-1", isAnonymous: true,
  reviewer: "真实昵称", reviewerId: "secret-user", reviewerAvatar: "/api/media/users/secret-user/avatar",
  reviewerLevel: 40, reviewerVipGrowthValue: 9999, reviewerVipLevel: 9,
  reviewerVipActive: true, reviewerEquippedBadge: { key: "private-badge", name: "徽章", iconUrl: "/secret-badge.png" },
  isCreatorEvaluation: true, countsTowardScore: false,
  total: 4.5, writing: 4, content: "评价内容", isContentHidden: false,
};

test("匿名评价对访客、其他用户、上传者及本人隐藏全部身份字段", () => {
  for (const viewer of [undefined, "visitor", "author", "admin", "secret-user"]) {
    const result = presentEvaluation(evaluation, viewer);
    assert.equal(result.reviewer, "匿名用户");
    assert.equal(result.reviewerId, null);
    assert.equal(result.reviewerAvatar, null);
    assert.equal(result.reviewerLevel, 0);
    assert.equal(result.reviewerVipGrowthValue, 0);
    assert.equal(result.reviewerVipLevel, 0);
    assert.equal(result.reviewerVipActive, false);
    assert.equal(result.reviewerEquippedBadge, null);
    assert.equal(result.isCreatorEvaluation, false);
    assert.equal(result.isOwnEvaluation, viewer === "secret-user");
    assert.equal(result.total, 4.5);
    assert.equal(result.countsTowardScore, false);
    assert.equal(result.content, evaluation.content);
    assert.doesNotMatch(JSON.stringify(result), /secret-user|真实昵称|private-badge|secret-badge/);
  }
  assert.equal(evaluation.reviewerId, "secret-user");
});

test("后台保留匿名评价真实身份，正常评价展示不变，匿名不绕过文字隐藏", () => {
  assert.deepEqual(presentEvaluation(evaluation, undefined, "admin"), { ...evaluation, isOwnEvaluation: false });
  const normal = { ...evaluation, isAnonymous: false };
  assert.deepEqual(presentEvaluation(normal, "secret-user"), { ...normal, isOwnEvaluation: true });
  assert.equal(presentEvaluation({ ...evaluation, content: null, isContentHidden: true }).content, null);
});

test("作品互动列表隐藏匿名评价人并保留独立评价编号，不能用用户ID关联身份", () => {
  const result = presentEvaluationInteraction({ id: "evaluation-1", isAnonymous: true, userId: "secret-user", nickname: "真实昵称", avatar: "/secret-user.png", total: 4.5 });
  assert.deepEqual(result, { id: "evaluation-1", isAnonymous: true, userId: null, nickname: "匿名用户", avatar: null, total: 4.5 });
});

test("后台类型筛选与关键词组合使用同一条件并拒绝未知类型", () => {
  assert.equal(evaluationTypeSchema.parse(undefined), "all");
  assert.equal(evaluationTypeSchema.safeParse("anonymous OR 1=1").success, false);
  assert.deepEqual(evaluationAdminFilter("", "all"), { where: "", params: [] });
  assert.deepEqual(evaluationAdminFilter("", "normal"), { where: "WHERE e.is_anonymous = ?", params: [0] });
  assert.deepEqual(evaluationAdminFilter("真实昵称", "anonymous"), {
    where: "WHERE (e.reviewer LIKE ? OR e.content LIKE ? OR s.title LIKE ?) AND e.is_anonymous = ?",
    params: ["%真实昵称%", "%真实昵称%", "%真实昵称%", 1],
  });
});

test("匿名通知不写入姓名或身份链接，改为匿名时清除既有通知身份", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const connection = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } } as unknown as mysql.PoolConnection;
  const input = { soupId: "soup-1", soupTitle: "作品", creatorId: "author", reviewerId: "secret-user", reviewer: "真实昵称", total: 4.5, isAnonymous: true, created: true };
  assert.equal(await syncEvaluationNotification(connection, input), true);
  assert.deepEqual(calls[0].params.slice(1), ["author", "匿名用户 评价了你的海龟汤《作品》，评分 4.5 分", "soup-1", null]);
  assert.equal(await syncEvaluationNotification(connection, { ...input, created: false }), true);
  assert.match(calls[1].sql, /actor_id = NULL WHERE type = 'soup_evaluation' AND related_id = \? AND actor_id = \?/);
  assert.deepEqual(calls[1].params, ["匿名用户 评价了你的海龟汤《作品》，评分 4.5 分", "soup-1", "secret-user"]);
  assert.equal(await syncEvaluationNotification(connection, { ...input, created: false, isAnonymous: false }), false);
  assert.equal(await syncEvaluationNotification(connection, { ...input, creatorId: input.reviewerId }), false);
  assert.equal(calls.length, 2);
  await syncEvaluationNotification(connection, { ...input, isAnonymous: false });
  assert.deepEqual(calls[2].params.slice(1), ["author", "真实昵称 评价了你的海龟汤《作品》，评分 4.5 分", "soup-1", "secret-user"]);
});
