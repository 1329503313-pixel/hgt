import { ChevronRight, Eye } from "lucide-react";
import type { NotificationItem, ViewRequestItem } from "../shared/types";

export function NotificationList({
  notifications,
  onRead,
  onOpen,
  max
}: {
  notifications: NotificationItem[];
  onRead: (id: string) => void;
  onOpen: (link: string) => void;
  max?: number;
}) {
  const visible = max ? notifications.slice(0, max) : notifications;

  if (notifications.length === 0) {
    return <p className="text-sm text-muted">暂无消息。</p>;
  }

  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg border border-line bg-white p-3 ${item.link || !item.isRead ? "cursor-pointer hover:border-primary/40 hover:shadow-sm" : ""}`}
          onClick={() => {
            if (!item.isRead) onRead(item.id);
            if (item.link) onOpen(item.link);
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-bold text-ink truncate">{item.title}</h2>
              <p className="mt-1 text-sm text-muted line-clamp-2">{item.content}</p>
              <p className="mt-1 text-xs text-muted/60">{new Date(item.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!item.isRead && <span className="h-2 w-2 rounded-full bg-primary" />}
              {item.link && <ChevronRight size={16} className="text-muted/40" />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function statusText(status: string) {
  if (status === "approved") return "已同意";
  if (status === "rejected") return "已拒绝";
  return "待处理";
}

export function RequestList({
  requests,
  onDecision,
  onOpenSoup,
  max
}: {
  requests: ViewRequestItem[];
  onDecision: (id: string, decision: "approved" | "rejected") => void;
  onOpenSoup?: (id: string) => void;
  max?: number;
}) {
  const visible = max ? requests.slice(0, max) : requests;

  if (requests.length === 0) {
    return <p className="text-sm text-muted">暂无申请。</p>;
  }

  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <div key={item.id} className="rounded-lg border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-ink">{item.soupTitle}</h3>
              <p className="mt-1 text-sm text-muted">
                {item.requesterName} · {statusText(item.status)}
              </p>
            </div>
            {onOpenSoup && (
              <button className="btn btn-secondary px-3" onClick={() => onOpenSoup(item.soupId)}>
                <Eye size={16} />
              </button>
            )}
          </div>
          {item.status === "pending" && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-primary" onClick={() => onDecision(item.id, "approved")}>同意</button>
              <button className="btn btn-secondary" onClick={() => onDecision(item.id, "rejected")}>拒绝</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
