import { useEffect, useState } from "react";
import { api } from "../api";
import { subscribeServerEvent } from "./serverEvents";

export type MessageUnreadCounts = {
  system: number;
  interactions: number;
  requests: number;
  notices: number;
  privateMessages: number;
  circleMessages: number;
  circleMentions: number;
  total: number;
};

const emptyCounts: MessageUnreadCounts = {
  system: 0,
  interactions: 0,
  requests: 0,
  notices: 0,
  privateMessages: 0,
  circleMessages: 0,
  circleMentions: 0,
  total: 0
};
const countsByUser = new Map<string, MessageUnreadCounts>();
const inFlightByUser = new Map<string, Promise<MessageUnreadCounts>>();
const refreshQueuedByUser = new Set<string>();
const listeners = new Set<(userId: string, counts: MessageUnreadCounts) => void>();

function publish(userId: string, counts: MessageUnreadCounts) {
  countsByUser.set(userId, counts);
  for (const listener of listeners) listener(userId, counts);
}

async function loadUnreadCounts(userId: string, force = false): Promise<MessageUnreadCounts> {
  const pending = inFlightByUser.get(userId);
  if (pending) {
    if (force) refreshQueuedByUser.add(userId);
    return pending;
  }

  const request = api<{ counts: MessageUnreadCounts }>("/api/messages/unread-counts", {
    bypassCache: true,
    dedupe: false
  }).then(({ counts }) => {
    publish(userId, counts);
    return counts;
  }).finally(() => {
    inFlightByUser.delete(userId);
    if (refreshQueuedByUser.delete(userId)) void loadUnreadCounts(userId, true).catch(() => {});
  });
  inFlightByUser.set(userId, request);
  return request;
}

export function useMessageUnreadCounts(userId: string | undefined, enabled = true) {
  const [counts, setCounts] = useState<MessageUnreadCounts>(() => userId ? countsByUser.get(userId) ?? emptyCounts : emptyCounts);

  useEffect(() => {
    if (!enabled || !userId) {
      setCounts(emptyCounts);
      return;
    }
    setCounts(countsByUser.get(userId) ?? emptyCounts);
    const listener = (changedUserId: string, value: MessageUnreadCounts) => {
      if (changedUserId === userId) setCounts(value);
    };
    const refresh = () => void loadUnreadCounts(userId, true).catch(() => {});
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    listeners.add(listener);
    void loadUnreadCounts(userId).catch(() => {});
    const unsubscribe = subscribeServerEvent("unread_changed", refresh);
    // SSE 负责实时更新；两分钟轮询仅用于代理断流但浏览器尚未触发重连的兜底场景。
    const fallbackTimer = window.setInterval(refresh, 2 * 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      listeners.delete(listener);
      unsubscribe();
      window.clearInterval(fallbackTimer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, userId]);

  return counts;
}

export function useMessageUnread(userId: string | undefined, enabled = true) {
  return useMessageUnreadCounts(userId, enabled).total;
}
