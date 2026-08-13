import assert from "node:assert/strict";
import test from "node:test";
import { hasPendingApprovals } from "./adminModuleUnread.js";

test("审批红点仅由当前待审批项触发", () => {
  assert.equal(hasPendingApprovals({ soups: 0, bottomRequests: 0, excellentAuthors: 0 }, true), false);
  assert.equal(hasPendingApprovals({ soups: 1, bottomRequests: 0, excellentAuthors: 0 }, false), true);
  assert.equal(hasPendingApprovals({ soups: 0, bottomRequests: 1, excellentAuthors: 0 }, false), true);
});

test("优秀作者待审批只触发超级管理员红点", () => {
  const counts = { soups: 0, bottomRequests: 0, excellentAuthors: 1 };
  assert.equal(hasPendingApprovals(counts, false), false);
  assert.equal(hasPendingApprovals(counts, true), true);
});
