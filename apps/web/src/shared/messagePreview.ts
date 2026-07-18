export type MessagePreview = {
  content: string;
  type: "text" | "sticker" | "room_invite" | "soup_share";
  stickerName?: string | null;
  roomInvite?: { roomName?: string | null } | null;
  soupShare?: { title?: string | null } | null;
};

export function privateMessagePreview(message: MessagePreview) {
  if (message.type === "room_invite") return `[玩汤邀请] ${message.roomInvite?.roomName || "加入房间"}`;
  if (message.type === "soup_share") return `[海龟汤] ${message.soupShare?.title || "查看分享"}`;
  if (message.type !== "sticker") return message.content;
  const name = message.stickerName?.trim();
  return `[${name || "表情"}]`;
}
