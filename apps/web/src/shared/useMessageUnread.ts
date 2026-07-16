import { useEffect, useState } from "react";
import { api, type NotificationsResponse, type RequestsResponse } from "../api";
import type { ConversationItem } from "./types";
import { getMessageUnreadCounts } from "./messageUnread";
import { subscribeServerEvent } from "./serverEvents";

const unreadByUser = new Map<string, number>();
const loadedAtByUser = new Map<string, number>();
const inFlightByUser = new Map<string, Promise<number>>();
const listeners = new Set<(userId: string, unread: number) => void>();
const CACHE_MAX_AGE = 15_000;

async function loadMessageUnread(userId: string, force = false) {
  const cachedAt = loadedAtByUser.get(userId) ?? 0;
  if (!force && Date.now() - cachedAt < CACHE_MAX_AGE) return unreadByUser.get(userId) ?? 0;
  const pending = inFlightByUser.get(userId);
  if (pending) return pending;

  const request = Promise.all([
    api<NotificationsResponse>("/api/notifications"),
    api<RequestsResponse>("/api/access-requests"),
    api<{ notices: { isRead: boolean }[] }>("/api/notices"),
    api<{ conversations: ConversationItem[] }>("/api/conversations")
  ]).then(([notificationData, requestData, noticeData, conversationData]) => {
    const unread = getMessageUnreadCounts({
      notifications: notificationData.notifications,
      requests: requestData.requests,
      notices: noticeData.notices,
      conversations: conversationData.conversations
    }).total;
    unreadByUser.set(userId, unread);
    loadedAtByUser.set(userId, Date.now());
    for (const listener of listeners) listener(userId, unread);
    return unread;
  }).finally(() => inFlightByUser.delete(userId));

  inFlightByUser.set(userId, request);
  return request;
}

export function useMessageUnread(userId: string | undefined, enabled = true) {
  const [unread, setUnread] = useState(() => userId ? unreadByUser.get(userId) ?? 0 : 0);

  useEffect(() => {
    if (!enabled || !userId) {
      setUnread(0);
      return;
    }
    setUnread(unreadByUser.get(userId) ?? 0);
    const listener = (changedUserId: string, value: number) => {
      if (changedUserId === userId) setUnread(value);
    };
    listeners.add(listener);
    void loadMessageUnread(userId).catch(() => {});
    const unsubscribe = subscribeServerEvent("unread_changed", () => {
      void loadMessageUnread(userId, true).catch(() => {});
    });
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  }, [enabled, userId]);

  return unread;
}
