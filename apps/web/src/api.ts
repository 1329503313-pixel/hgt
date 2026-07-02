import type {
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
export type SoupsResponse = { soups: SoupSummary[]; hasMore: boolean };
export type SoupResponse = { soup: SoupDetail };
export type NotificationsResponse = { notifications: NotificationItem[] };
export type RequestsResponse = { requests: ViewRequestItem[] };
export type UsersResponse = { users: PublicUser[] };
export type PasswordResponse = { ok: boolean };
export type NicknameResponse = { ok: boolean; nickname: string };
