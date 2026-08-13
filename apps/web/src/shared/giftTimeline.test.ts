import assert from "node:assert/strict";
import test from "node:test";
import { giftTimelineEntries, type GiftTimelineMessage } from "./giftTimeline";
import type { GiftMessage } from "./types";

function giftMessage(id: string, senderId = "sender-a"): GiftTimelineMessage {
  const gift: GiftMessage = {
    giftSendId: `send-${id}`,
    giftId: `gift-${id}`,
    giftName: `礼物${id}`,
    iconUrl: `/gift-${id}.webp`,
    quantity: 1,
    sender: { id: senderId, nickname: senderId },
    recipient: { id: "receiver", nickname: "收礼人" },
    shellReward: 1,
    charmReward: 1,
    createdAt: "2026-08-12T00:00:00.000Z",
  };
  return { id, type: "gift", gift, recalledAt: null };
}

test("连续送礼保留前三张并将第四张起折叠", () => {
  const entries = giftTimelineEntries([1, 2, 3, 4, 5].map((id) => giftMessage(String(id))));
  assert.deepEqual(entries.map((entry) => entry.kind), ["message", "message", "message", "gift_bundle"]);
  assert.equal(entries[3].kind === "gift_bundle" ? entries[3].gifts.length : 0, 2);
});

test("发送者改变或出现非礼物消息会结束连续段", () => {
  const text = { id: "text", type: "text", gift: null, recalledAt: null };
  const entries = giftTimelineEntries([
    giftMessage("1"), giftMessage("2"), giftMessage("3"), giftMessage("4"),
    text,
    giftMessage("5"), giftMessage("6"), giftMessage("7"), giftMessage("8", "sender-b"),
  ]);
  assert.equal(entries.filter((entry) => entry.kind === "gift_bundle").length, 1);
  assert.equal(entries.length, 9);
});
