import { levelForExperience } from "./levelSystem.js";
import { vipGrowthSnapshot } from "./vipGrowth.js";

export function canonicalConversationUserIds(firstUserId: string, secondUserId: string): [string, string] {
  return firstUserId.localeCompare(secondUserId, "en") <= 0
    ? [firstUserId, secondUserId]
    : [secondUserId, firstUserId];
}

export function conversationOtherUserIdentity(otherId: unknown, otherNickname: unknown, otherExperience: unknown, vipRow?: { role?: unknown; vip_growth_value?: unknown; vip_expires_at?: unknown; vip_legacy_active?: unknown }) {
  const vip = vipGrowthSnapshot(vipRow ?? {});
  return {
    id: String(otherId),
    nickname: String(otherNickname),
    level: levelForExperience(otherExperience),
    ...(vipRow ? { vipGrowthValue: vip.growthValue, vipLevel: vip.level, vipActive: vip.active } : {})
  };
}
