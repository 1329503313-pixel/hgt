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
  bypassCache?: boolean;
};

type CacheEntry = { expiresAt: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

export function clearApiCache() {
  responseCache.clear();
  inFlightRequests.clear();
}

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code ?? null;
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { cacheTtlMs = 0, dedupe = true, bypassCache = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method ?? "GET").toUpperCase();
  const cacheKey = method === "GET" && !fetchOptions.body ? path : "";
  const shouldDedupe = Boolean(cacheKey && dedupe && !bypassCache);
  const cached = cacheKey && !bypassCache ? responseCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (shouldDedupe) {
    const pending = inFlightRequests.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const request = (async () => {
    const headers = new Headers(fetchOptions.headers);
    if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      cache: bypassCache ? "no-store" : fetchOptions.cache,
      credentials: "include",
      headers,
      body:
        fetchOptions.body && !(fetchOptions.body instanceof FormData) && typeof fetchOptions.body !== "string"
          ? JSON.stringify(fetchOptions.body)
          : (fetchOptions.body as BodyInit | null | undefined)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error ?? "请求失败", response.status, data.code);
    if (cacheKey && cacheTtlMs > 0) responseCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: data });
    if (method !== "GET") clearApiCache();
    return data as T;
  })();

  if (shouldDedupe) inFlightRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (shouldDedupe) inFlightRequests.delete(cacheKey);
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
  totalCollectionValue: number;
  unlockedCardCount: number;
  legendaryCardDrawCount: number;
  epicThreeStarCount: number;
  legendThreeStarCount: number;
  completePackCount: number;
  completeThreeStarPackCount: number;
  totalShellEarned: number;
  shellBalance: number;
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
export type EmailStatusResponse = {
  configured: boolean;
  email: { masked: string; verifiedAt: string } | null;
};
export type NicknameResponse = { ok: boolean; nickname: string };
export type AvatarResponse = { ok: boolean; avatar: string | null };
export type EvaluationsResponse = { evaluations: (Evaluation & { soupTitle: string })[]; total: number; hasMore: boolean };
