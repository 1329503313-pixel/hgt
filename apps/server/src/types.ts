export type PublicUser = {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  role: "admin" | "user";
  createdAt: string;
  equippedBadge: { key: string; iconUrl: string } | null;
};
