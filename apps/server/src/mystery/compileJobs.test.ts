import assert from "node:assert/strict";
import test from "node:test";
import { mysteryCompileFailure, mysteryCompileRetryDelaySeconds } from "./compileJobs.js";
import {
  classifyMysteryModelNetworkError,
  MYSTERY_COMPILATION_REPAIR_ATTEMPTS,
  mysteryCompilationRepairPrompt,
  MysteryModelError,
  normalizeCompilerCondition,
  normalizeCompilerPackageSyntax,
} from "./models.js";
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

test("故事编译器把唯一匹配的地点名称引用转换为地点 ID", () => {
  const candidate = {
    package: {
      entityResourceGraph: {
        locations: [
          { locationId: "LOC_HALL", name: "大厅", connections: [{ toLocationId: "地下室" }] },
          { locationId: "LOC_BASEMENT", name: "地下室", connections: [] },
        ],
        actors: [{ actorId: "NPC_GUARD", name: "守卫", initialLocationId: "大厅" }],
        items: [{ itemInstanceId: "ITEM_KEY", name: "钥匙", initialLocationId: "地下室" }],
      },
    },
  };
  normalizeCompilerPackageSyntax(candidate, "PLAYER_1");
  assert.equal(candidate.package.entityResourceGraph.locations[0].connections[0].toLocationId, "LOC_BASEMENT");
  assert.equal(candidate.package.entityResourceGraph.actors[0].initialLocationId, "LOC_HALL");
  assert.equal(candidate.package.entityResourceGraph.items[0].initialLocationId, "LOC_BASEMENT");
});

test("故事编译器把地点内唯一匹配的人物名和物品名转换为实体 ID", () => {
  const candidate = {
    package: {
      entityResourceGraph: {
        locations: [{
          locationId: "LOC_HALL", name: "大厅", connections: [], initialActorIds: ["守卫"],
          initialItemInstanceIds: ["钥匙"], interactiveObjectIds: ["钥匙"], hiddenAreaIds: ["大厅"],
        }],
        actors: [{ actorId: "NPC_GUARD", name: "守卫" }],
        items: [{ itemInstanceId: "ITEM_KEY", name: "钥匙" }],
      },
    },
  };
  normalizeCompilerPackageSyntax(candidate, "PLAYER_1");
  const location = candidate.package.entityResourceGraph.locations[0];
  assert.deepEqual(location.initialActorIds, ["NPC_GUARD"]);
  assert.deepEqual(location.initialItemInstanceIds, ["ITEM_KEY"]);
  assert.deepEqual(location.interactiveObjectIds, ["ITEM_KEY"]);
  assert.deepEqual(location.hiddenAreaIds, ["LOC_HALL"]);
});

test("故事编译失败会进行有限多轮修复并携带具体错误", () => {
  assert.equal(MYSTERY_COMPILATION_REPAIR_ATTEMPTS, 3);
  const prompt = mysteryCompilationRepairPrompt(["地点第 1 项的初始人物编号第 2 项格式错误"]);
  assert.match(prompt, /完整 JSON/);
  assert.match(prompt, /initialActorIds/);
  assert.match(prompt, /地点第 1 项的初始人物编号第 2 项格式错误/);
});

test("故事编译器统一修复效果、知识、世界事件和结局中的唯一名称引用", () => {
  const candidate = {
    package: {
      coreFactGraph: { facts: [] },
      entityResourceGraph: {
        locations: [{ locationId: "LOC_HALL", name: "大厅", connections: [] }],
        actors: [{ actorId: "NPC_GUARD", name: "守卫", initialLocationId: "大厅", scheduleIds: ["巡逻"] }],
        items: [{ itemInstanceId: "ITEM_KEY", name: "钥匙", initialOwnerId: "守卫" }],
        resources: [{ resourceId: "RESOURCE_ENERGY", name: "体力", ownerId: "守卫" }],
      },
      knowledgeGraph: { knowledge: [{
        knowledgeId: "KNOWLEDGE_KEY", objectiveStatement: "钥匙藏在大厅", holderActorIds: ["守卫"],
        evidenceItemIds: ["钥匙"], evidenceLocationIds: ["大厅"], relatedEndingIds: ["逃脱"],
      }] },
      actionTransitionGraph: {
        transitions: [{ description: "开门", successEffectIds: ["获得钥匙"], audibleToLocationIds: ["大厅"] }],
        effects: [{
          effectId: "EFFECT_KEY", description: "获得钥匙", resourceChanges: [{ resourceId: "体力" }],
          itemChanges: [{ itemInstanceId: "钥匙", ownerId: "守卫", locationId: "大厅" }],
          actorChanges: [{ actorId: "守卫", locationId: "大厅" }],
          knowledgeChanges: [{ actorId: "守卫", knowledgeId: "钥匙藏在大厅" }],
        }],
      },
      timelineGraph: { scheduledEvents: [{ scheduledEventId: "SCHEDULE_PATROL", name: "巡逻", effectIds: ["获得钥匙"], visibleToLocationIds: ["大厅"] }] },
      endingStateGraph: { endings: [{ endingId: "ENDING_ESCAPE", name: "逃脱" }], fallbackEndingIds: ["逃脱"] },
    },
  };
  normalizeCompilerPackageSyntax(candidate, "PLAYER_1");
  const graph = candidate.package;
  assert.equal(graph.entityResourceGraph.actors[0].initialLocationId, "LOC_HALL");
  assert.deepEqual(graph.entityResourceGraph.actors[0].scheduleIds, ["SCHEDULE_PATROL"]);
  assert.equal(graph.entityResourceGraph.items[0].initialOwnerId, "NPC_GUARD");
  assert.equal(graph.entityResourceGraph.resources[0].ownerId, "NPC_GUARD");
  assert.deepEqual(graph.knowledgeGraph.knowledge[0].holderActorIds, ["NPC_GUARD"]);
  assert.deepEqual(graph.knowledgeGraph.knowledge[0].evidenceItemIds, ["ITEM_KEY"]);
  assert.deepEqual(graph.knowledgeGraph.knowledge[0].relatedEndingIds, ["ENDING_ESCAPE"]);
  assert.deepEqual(graph.actionTransitionGraph.transitions[0].successEffectIds, ["EFFECT_KEY"]);
  assert.equal(graph.actionTransitionGraph.effects[0].knowledgeChanges[0].knowledgeId, "KNOWLEDGE_KEY");
  assert.deepEqual(graph.timelineGraph.scheduledEvents[0].effectIds, ["EFFECT_KEY"]);
  assert.deepEqual(graph.endingStateGraph.fallbackEndingIds, ["ENDING_ESCAPE"]);
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
