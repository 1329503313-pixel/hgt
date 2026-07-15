import type {
  Evaluation,
  NotificationItem,
  PublicUser,
  SoupDetail,
  SoupSummary,
  ViewRequestItem
} from "./shared/types";

const API_URL = "";

type ApiOptions = Omit<RequestInit, "body"> & { body?: BodyInit | object | null };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers,
    body:
      options.body && !(options.body instanceof FormData) && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : (options.body as BodyInit | null | undefined)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "请求失败");
  }
  return data as T;
}

export type MeResponse = { user: PublicUser | null };
export type SoupsResponse = { soups: SoupSummary[]; total: number; hasMore: boolean };
export type SoupResponse = { soup: SoupDetail };
export type NotificationsResponse = { notifications: NotificationItem[] };
export type RequestsResponse = { requests: ViewRequestItem[]; total: number };
export type UsersResponse = { users: PublicUser[] };
export type StatsResponse = {
  soupCount: number;
  favoriteCount: number;
  evaluationCount: number;
  likeCount: number;
  criticalHitCount: number;
  loginDayCount: number;
  receivedLikeCount: number;
  receivedFavoriteCount: number;
  receivedCommentCount: number;
  writtenCommentCount: number;
  aiCompletionCount: number;
  maxOriginalSoupHeat: number;
};
export type SpecialBadgeUnlock = {
  id: string;
  key: string;
  name: string;
  description: string;
  requirement: string | null;
  iconUrl: string;
  achievementPoints: number;
  badgeType: "activity" | "limited";
  activityConditions: Array<{
    kind: "login" | "publish" | "like_given" | "comment_given" | "favorite_given" | "like_received" | "comment_received" | "favorite_received";
    startDate: string;
    endDate: string;
    target: number;
  }>;
  unlockedAt: string | null;
  tier: "legend";
};
export type BadgeUnlocksResponse = { unlocks: string[]; specialBadges: SpecialBadgeUnlock[]; stats: StatsResponse };
export type PasswordResponse = { ok: boolean };
export type NicknameResponse = { ok: boolean; nickname: string };
export type AvatarResponse = { ok: boolean; avatar: string | null };
export type EvaluationsResponse = { evaluations: (Evaluation & { soupTitle: string })[]; total: number; hasMore: boolean };
