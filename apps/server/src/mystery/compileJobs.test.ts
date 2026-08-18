import assert from "node:assert/strict";
import test from "node:test";
import { mysteryCompileFailure, mysteryCompileRetryDelaySeconds } from "./compileJobs.js";
import { classifyMysteryModelNetworkError, MysteryModelError, normalizeCompilerCondition } from "./models.js";
import { mysteryRunAuditSummary, normalizeMysteryAuditPagination } from "./audit.js";

test("谜局编译任务按上限进行指数退避", () => {
  assert.equal(mysteryCompileRetryDelaySeconds(1), 15);
  assert.equal(mysteryCompileRetryDelaySeconds(2), 30);
  assert.equal(mysteryCompileRetryDelaySeconds(3), 60);
  assert.equal(mysteryCompileRetryDelaySeconds(10), 120);
});

test("模型临时错误保留安全错误码并允许任务重试", () => {
  const failure = mysteryCompileFailure(new MysteryModelError("MODEL_NETWORK_ERROR", "谜局 AI 暂时无法连接", true));
  assert.deepEqual(failure, { code: "MODEL_NETWORK_ERROR", message: "谜局 AI 暂时无法连接", retryable: true });
});

test("未知编译异常不会把内部错误原文写入任务记录", () => {
  const failure = mysteryCompileFailure(new Error("database password=should-not-leak"));
  assert.equal(failure.code, "COMPILE_INTERNAL_ERROR");
  assert.equal(failure.retryable, false);
  assert.ok(!failure.message.includes("password"));
});

test("谜局模型网络错误只暴露安全分类并明确本机阻断", () => {
  const blocked = new TypeError("fetch failed", { cause: Object.assign(new Error("socket detail must not leak"), { code: "EACCES" }) });
  assert.deepEqual(classifyMysteryModelNetworkError(blocked), {
    category: "blocked",
    code: "EACCES",
    message: "谜局 AI 网络访问被本机环境阻止，请检查防火墙或启动权限",
  });
  const unknown = classifyMysteryModelNetworkError(new Error("secret internal detail"));
  assert.equal(unknown.code, "UNKNOWN");
  assert.ok(!unknown.message.includes("secret"));
});

test("故事编译器把常见人物知识路径规范化为数组包含条件", () => {
  assert.deepEqual(
    normalizeCompilerCondition({ op: "exists", path: "knowledgeByActor.PLAYER_1.KNOWLEDGE_TARGET" }, "PLAYER_1"),
    { op: "includes", path: "knowledgeByActor.PLAYER_1", value: "KNOWLEDGE_TARGET" },
  );
  assert.deepEqual(
    normalizeCompilerCondition({ op: "includes", path: "actors.PLAYER_1.knownFactIds", value: "FACT_1" }, "PLAYER_1"),
    { op: "includes", path: "knowledgeByActor.PLAYER_1", value: "FACT_1" },
  );
});

test("谜局运行审计分页使用稳定默认值并限制单页数量", () => {
  assert.deepEqual(normalizeMysteryAuditPagination({}), { page: 1, limit: 20, offset: 0 });
  assert.deepEqual(normalizeMysteryAuditPagination({ page: 3, limit: 500 }), { page: 3, limit: 50, offset: 100 });
});

test("谜局运行审计分页拒绝负数、小数和非数字输入", () => {
  assert.deepEqual(normalizeMysteryAuditPagination({ page: -2, limit: 2.5 }), { page: 1, limit: 20, offset: 0 });
  assert.deepEqual(normalizeMysteryAuditPagination({ page: "bad", limit: "bad" }), { page: 1, limit: 20, offset: 0 });
});

test("谜局运行审计不会向后台接口映射会话种子", () => {
  const payload = mysteryRunAuditSummary({
    id: "RUN_1", story_id: "STORY_1", story_version_id: "VERSION_1", version_number: 2,
    owner_user_id: "USER_1", owner_nickname: "房主", room_id: null, status: "active",
    is_current_save: 1, state_version: 3, turn_sequence: 2, event_sequence: 5,
    current_world_time_seconds: 100, final_ending_id: null, key_node_count: 1,
    failed_turn_count: 0, started_at: new Date(0), updated_at: new Date(0), completed_at: null,
    session_seed: "must-not-leak",
  } as Parameters<typeof mysteryRunAuditSummary>[0]);
  assert.equal("sessionSeed" in payload, false);
  assert.equal("session_seed" in payload, false);
  assert.equal(payload.owner.nickname, "房主");
});
