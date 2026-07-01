export type PublicUser = {
  id: string;
  username: string;
  nickname: string;
  role: "admin" | "user";
  createdAt: string;
};
