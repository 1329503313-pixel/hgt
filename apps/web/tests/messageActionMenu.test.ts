import assert from "node:assert/strict";
import test from "node:test";
import {
  availableMessageActions,
  canRecallMessage,
  MESSAGE_RECALL_WINDOW_MS,
  type MessageAction
} from "../src/components/MessageActionMenu.js";

test("客户端比服务端慢 5 秒时，新消息仍提供撤回资格", () => {
  const clientNow = Date.parse("2026-08-28T08:00:00.000Z");
  const serverCreatedAt = new Date(clientNow + 5_000).toISOString();

  assert.equal(canRecallMessage(serverCreatedAt, null, clientNow), true);
});

test("长按打开菜单时使用最新时间过滤已经过期的操作", () => {
  const availableUntil = Date.parse("2026-08-28T08:02:00.000Z");
  const actions: MessageAction[] = [
    { label: "回复", onSelect: () => {} },
    { label: "撤回", availableUntil, onSelect: () => {} }
  ];

  assert.deepEqual(
    availableMessageActions(actions, availableUntil).map((action) => action.label),
    ["回复", "撤回"]
  );
  assert.deepEqual(
    availableMessageActions(actions, availableUntil + 1).map((action) => action.label),
    ["回复"]
  );
});

test("撤回资格仍拒绝无效时间、已撤回消息和超过两分钟的消息", () => {
  const now = Date.parse("2026-08-28T08:02:00.001Z");
  const createdAt = new Date(now - MESSAGE_RECALL_WINDOW_MS - 1).toISOString();

  assert.equal(canRecallMessage("invalid", null, now), false);
  assert.equal(canRecallMessage(new Date(now).toISOString(), "2026-08-28T08:01:00.000Z", now), false);
  assert.equal(canRecallMessage(createdAt, null, now), false);
});
