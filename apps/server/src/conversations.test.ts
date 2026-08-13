import assert from "node:assert/strict";
import test from "node:test";
import { canonicalConversationUserIds, conversationOtherUserIdentity } from "./conversations.js";

test("私信双方顺序不受发起方向影响", () => {
  const forward = canonicalConversationUserIds("admin", "Xlev5fHCZBpnA6ew4Nlss");
  const reverse = canonicalConversationUserIds("Xlev5fHCZBpnA6ew4Nlss", "admin");

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward, ["admin", "Xlev5fHCZBpnA6ew4Nlss"]);
});

test("私信会话列表和详情使用实时经验计算对方等级", () => {
  assert.deepEqual(
    conversationOtherUserIdentity("target-user", "对方用户", 1_800),
    {
      id: "target-user",
      nickname: "对方用户",
      level: 7
    }
  );
});
