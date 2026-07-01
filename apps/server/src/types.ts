import type { Request } from "express";

export type PublicUser = {
  id: string;
  username: string;
  nickname: string;
  role: "admin" | "user";
  createdAt: string;
};

declare module "express-session" {
  interface SessionData {
    user?: PublicUser;
  }
}

export type AuthedRequest = Request & {
  session: Request["session"] & {
    user: PublicUser;
  };
};
