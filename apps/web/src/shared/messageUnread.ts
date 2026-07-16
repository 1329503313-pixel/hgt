import type { ConversationItem, NotificationItem, ViewRequestItem } from "./types";

export const interactionNotificationTypes = new Set(["soup_like", "soup_favorite", "soup_evaluation", "user_follow"]);

export function getMessageUnreadCounts({ notifications, requests, notices, conversations }: {
  notifications: NotificationItem[];
  requests: ViewRequestItem[];
  notices: Array<{ isRead: boolean }>;
  conversations: ConversationItem[];
}) {
  const system = notifications.filter((item) => item.type !== "view_request" && !interactionNotificationTypes.has(item.type) && !item.isRead).length;
  const interactions = notifications.filter((item) => interactionNotificationTypes.has(item.type) && !item.isRead).length;
  const requestCount = requests.filter((item) => item.status === "pending").length;
  const noticeCount = notices.filter((item) => !item.isRead).length;
  const privateMessages = conversations.reduce((sum, item) => sum + item.unreadCount, 0);

  return {
    system,
    interactions,
    requests: requestCount,
    notices: noticeCount,
    privateMessages,
    total: system + interactions + requestCount + noticeCount + privateMessages
  };
}
