import { levelForExperience } from "./levelSystem.js";

export function canonicalConversationUserIds(firstUserId: string, secondUserId: string): [string, string] {
  return firstUserId.localeCompare(secondUserId, "en") <= 0
    ? [firstUserId, secondUserId]
    : [secondUserId, firstUserId];
}

export function conversationOtherUserIdentity(otherId: unknown, otherNickname: unknown, otherExperience: unknown) {
  return {
    id: String(otherId),
    nickname: String(otherNickname),
    level: levelForExperience(otherExperience)
  };
}
