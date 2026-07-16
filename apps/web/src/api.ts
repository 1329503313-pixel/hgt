import type {
  Evaluation,
  NotificationItem,
  AccountUser,
  PublicUser,
  ExcellentAuthorApplicationDetail,
  ExcellentAuthorApplicationItem,
  ExcellentAuthorApplicationStatus,
  SoupDetail,
  SoupSummary,
  ViewRequestItem
} from "./shared/types";

const API_URL = "";

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | object | null;
  cacheTtlMs?: number;
  dedupe?: boolean;
};

type CacheEntry = { expiresAt: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { cacheTtlMs = 0, dedupe = true, ...fetchOptions } = options;
  const method = String(fetchOptions.method ?? "GET").toUpperCase();
  const cacheKey = method === "GET" && !fetchOptions.body ? path : "";
  const cached = cacheKey ? responseCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cacheKey && dedupe) {
    const pending = inFlightRequests.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const request = (async () => {
    const headers = new Headers(fetchOptions.headers);
    if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      credentials: "include",
      headers,
      body:
        fetchOptions.body && !(fetchOptions.body instanceof FormData) && typeof fetchOptions.body !== "string"
          ? JSON.stringify(fetchOptions.body)
          : (fetchOptions.body as BodyInit | null | undefined)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "请求失败");
    if (cacheKey && cacheTtlMs > 0) responseCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: data });
    if (method !== "GET") responseCache.clear();
    return data as T;
  })();

  if (cacheKey && dedupe) inFlightRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (cacheKey) inFlightRequests.delete(cacheKey);
  }
}

export function prefetchApi<T>(path: string, cacheTtlMs = 30_000) {
  return api<T>(path, { cacheTtlMs }).then(() => undefined).catch(() => undefined);
}

export type MeResponse = { user: AccountUser | null };
export type SoupsResponse = { soups: SoupSummary[]; total: number; hasMore: boolean };
export type SoupResponse = { soup: SoupDetail };
export type NotificationsResponse = { notifications: NotificationItem[] };
export type RequestsResponse = { requests: ViewRequestItem[]; total: number };
export type ExcellentAuthorEligibilityResponse = {
  eligibleSoups: SoupSummary[];
  certified: boolean;
  application: ExcellentAuthorApplicationStatus | null;
};
export type ExcellentAuthorApplicationsResponse = { applications: ExcellentAuthorApplicationItem[]; total: number };
export type ExcellentAuthorApplicationDetailResponse = { application: ExcellentAuthorApplicationDetail };
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
  badgeType: "achievement" | "activity" | "limited";
  activityConditions: Array<{
    kind: "login" | "publish" | "like_given" | "comment_given" | "favorite_given" | "like_received" | "comment_received" | "favorite_received";
    startDate: string;
    endDate: string;
    target: number;
  }>;
  unlockedAt: string | null;
  tier: "epic" | "legend";
};
export type BadgeUnlocksResponse = { unlocks: string[]; specialBadges: SpecialBadgeUnlock[]; stats: StatsResponse };
export type PasswordResponse = { ok: boolean };
export type NicknameResponse = { ok: boolean; nickname: string };
export type AvatarResponse = { ok: boolean; avatar: string | null };
export type EvaluationsResponse = { evaluations: (Evaluation & { soupTitle: string })[]; total: number; hasMore: boolean };
