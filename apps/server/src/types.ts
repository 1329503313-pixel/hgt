import type { UserRole } from "./roles.js";

export type PublicUser = {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  role: UserRole;
  createdAt: string;
  level: number;
  equippedBadge: { key: string; iconUrl: string; name: string; tier: "normal" | "rare" | "epic" | "legend" } | null;
};
