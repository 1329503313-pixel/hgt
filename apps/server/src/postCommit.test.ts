import assert from "node:assert/strict";
import test from "node:test";
import { runPostCommitTask } from "./postCommit.js";

test("提交后的辅助任务失败不会反向使主业务请求失败", async () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.doesNotThrow(() => runPostCommitTask("approval unread event", async () => {
      throw new Error("event table unavailable");
    }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]?.[0]), /approval unread event failed/);
  } finally {
    console.error = originalError;
  }
});
