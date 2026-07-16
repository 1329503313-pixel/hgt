export type MessagePreview = {
  content: string;
  type: "text" | "sticker";
  stickerName?: string | null;
};

export function privateMessagePreview(message: MessagePreview) {
  if (message.type !== "sticker") return message.content;
  const name = message.stickerName?.trim();
  return `[${name || "表情"}]`;
}
