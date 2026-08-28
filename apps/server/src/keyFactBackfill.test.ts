import assert from "node:assert/strict";
import test from "node:test";
import { AI_KEY_FACT_BACKFILL_INTERVAL_MS, backfillMissingAiKeyFacts } from "./keyFactBackfill.js";

test("关键点补齐任务固定每小时执行", () => {
  assert.equal(AI_KEY_FACT_BACKFILL_INTERVAL_MS, 3_600_000);
});

test("关键点补齐任务去重并处理全部缺失作品", async () => {
  const generated: string[] = [];
  let querySql = "";
  const db = {
    async query(sql: string) {
      querySql = sql;
      return [[{ id: "soup-1" }, { id: "soup-2" }, { id: "soup-1" }], []];
    },
  } as any;

  const count = await backfillMissingAiKeyFacts(db, async (soupId) => {
    generated.push(soupId);
  });

  assert.equal(count, 2);
  assert.deepEqual(generated.sort(), ["soup-1", "soup-2"]);
  assert.match(querySql, /hintContent/);
  assert.match(querySql, /JSON_TABLE/);
});
