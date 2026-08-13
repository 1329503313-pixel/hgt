import type { GiftMessage } from "./types";

export type GiftTimelineMessage = {
  id: string;
  type: string;
  gift?: GiftMessage | null;
  recalledAt?: string | null;
};

export type GiftTimelineEntry<T extends GiftTimelineMessage> =
  | { kind: "message"; key: string; message: T }
  | { kind: "gift_bundle"; key: string; messages: T[]; gifts: GiftMessage[] };

/** 保留连续送礼的前三张完整卡片，第 4 张起收进紧凑汇总卡。 */
export function giftTimelineEntries<T extends GiftTimelineMessage>(messages: readonly T[]): GiftTimelineEntry<T>[] {
  const entries: GiftTimelineEntry<T>[] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (message.type !== "gift" || !message.gift || message.recalledAt) {
      entries.push({ kind: "message", key: message.id, message });
      index += 1;
      continue;
    }

    const senderId = message.gift.sender.id;
    let end = index + 1;
    while (
      end < messages.length
      && messages[end].type === "gift"
      && !messages[end].recalledAt
      && messages[end].gift?.sender.id === senderId
    ) end += 1;

    const run = messages.slice(index, end);
    run.slice(0, 3).forEach((item) => entries.push({ kind: "message", key: item.id, message: item }));
    if (run.length > 3) {
      const bundled = run.slice(3);
      entries.push({
        kind: "gift_bundle",
        key: `gift-bundle:${bundled[0].id}`,
        messages: bundled,
        gifts: bundled.map((item) => item.gift!),
      });
    }
    index = end;
  }
  return entries;
}
