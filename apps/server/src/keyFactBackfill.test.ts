import assert from "node:assert/strict";
import test from "node:test";
import { AI_KEY_FACT_BACKFILL_INTERVAL_MS, backfillMissingAiKeyFacts, rebuildAllAiAtomicFacts } from "./keyFactBackfill.js";

test("关键点补齐任务固定每小时执行", () => {
  assert.equal(AI_KEY_FACT_BACKFILL_INTERVAL_MS, 3_600_000);
});

test("关键点补齐任务去重并处理全部缺失作品", async () => {
  const generated: string[] = [];
  let querySql = "";
  let queryCount = 0;
  const db = {
    async query(sql: string) {
      querySql = sql;
      queryCount += 1;
      return [queryCount === 1 ? [{ id: "soup-1" }, { id: "soup-2" }, { id: "soup-1" }] : [], []];
    },
  } as any;

  const result = await backfillMissingAiKeyFacts(db, async (soupId) => {
    generated.push(soupId);
  });

  assert.deepEqual(result, { checked: 2, remaining: 0, failed: [] });
  assert.deepEqual(generated.sort(), ["soup-1", "soup-2"]);
  assert.match(querySql, /hintContent/);
  assert.match(querySql, /JSON_TABLE/);
});

test("关键点补齐任务隔离单件失败并复查剩余作品", async () => {
  let queryCount = 0;
  const db = {
    async query() {
      queryCount += 1;
      return [queryCount === 1 ? [{ id: "good" }, { id: "bad" }] : [{ id: "bad" }], []];
    },
  } as any;
  const result = await backfillMissingAiKeyFacts(db, async (soupId) => {
    if (soupId === "bad") throw new Error("provider unavailable");
  });
  assert.deepEqual(result, { checked: 2, remaining: 1, failed: ["bad"] });
});

test("内部原子事实重建覆盖全部有效 AI 主持作品并汇总结果", async () => {
  const attempted: string[] = [];
  let querySql = "";
  const db = {
    async query(sql: string) {
      querySql = sql;
      return [[{ id: "soup-1" }, { id: "soup-2" }, { id: "soup-3" }, { id: "soup-1" }], []];
    },
  } as any;

  const result = await rebuildAllAiAtomicFacts(db, async (soupId) => {
    attempted.push(soupId);
    if (soupId === "soup-2") return false;
    if (soupId === "soup-3") throw new Error("model unavailable");
    return true;
  });

  assert.equal(result.total, 3);
  assert.equal(result.rebuilt, 1);
  assert.deepEqual(result.skipped, ["soup-2"]);
  assert.deepEqual(result.failed, [{ soupId: "soup-3", error: "model unavailable" }]);
  assert.deepEqual(attempted.sort(), ["soup-1", "soup-2", "soup-3"]);
  assert.match(querySql, /s\.enable_ai_game = 1/);
  assert.match(querySql, /creator\.role IN/);
  assert.doesNotMatch(querySql, /UPDATE/);
});
