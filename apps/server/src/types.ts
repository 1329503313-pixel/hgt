export type PublicUser = {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  role: "admin" | "user";
  createdAt: string;
  level: number;
  equippedBadge: { key: string; iconUrl: string; name: string; tier: "normal" | "rare" | "epic" | "legend" } | null;
};
