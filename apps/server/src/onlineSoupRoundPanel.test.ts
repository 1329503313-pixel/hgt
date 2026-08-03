import assert from "node:assert/strict";
import test from "node:test";
import { finalizeOnlineSoupRoundPanelPage } from "./onlineSoupRoundPanel.js";

test("回合面板分页保留整页并返回下一游标", () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ message_sequence: index + 1, value: index + 1 }));
  const page = finalizeOnlineSoupRoundPanelPage(rows, 100, (row) => row.message_sequence);
  assert.equal(page.items.length, 100);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "100");
  assert.equal(rows.length, 101);
});

test("回合面板最后一页不生成多余游标", () => {
  const page = finalizeOnlineSoupRoundPanelPage([{ message_sequence: "8" }], 100, (row) => row.message_sequence);
  assert.equal(page.items.length, 1);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});
