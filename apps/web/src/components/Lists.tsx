import { Award, ChevronRight, Eye, Heart, MessageSquare, ShieldCheck, Star } from "lucide-react";
import type { NotificationItem, ViewRequestItem } from "../shared/types";

function notificationVisual(type: string) {
  if (type === "badge_unlock") return { icon: Award, className: "bg-amber-100 text-amber-600" };
  if (type === "soup_like") return { icon: Heart, className: "bg-rose-100 text-rose-500" };
  if (type === "soup_favorite") return { icon: Star, className: "bg-orange-100 text-orange-500" };
  if (type === "soup_evaluation") return { icon: MessageSquare, className: "bg-emerald-100 text-emerald-600" };
  return { icon: ShieldCheck, className: "bg-blue-100 text-blue-600" };
}

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
    return <p className="py-16 text-center text-sm text-muted">暂无消息</p>;
  }

  return (
    <div className="divide-y divide-line">
      {visible.map((item) => {
        const visual = notificationVisual(item.type);
        const Icon = visual.icon;
        return (
          <button
            key={item.id}
            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100"
            onClick={() => {
              if (!item.isRead) onRead(item.id);
              if (item.link) onOpen(item.link);
            }}
          >
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${visual.className}`}>
              <Icon size={21} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`truncate text-[15px] ${item.isRead ? "font-semibold text-ink" : "font-black text-slate-950"}`}>{item.title}</span>
                {!item.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
              </span>
              <span className="mt-1 block truncate text-sm text-muted">{item.content}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted/70">
              {new Date(item.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
              {item.link && <ChevronRight size={16} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function statusText(status: string) {
  if (status === "approved") return "已同意";
  if (status === "rejected") return "已拒绝";
  return "等待你的处理";
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
    return <p className="py-16 text-center text-sm text-muted">暂无申请</p>;
  }

  return (
    <div className="divide-y divide-line">
      {visible.map((item) => (
        <div key={item.id} className="flex items-center gap-3 px-4 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-700">
            {item.requesterName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-ink">{item.requesterName} 申请查看汤底</p>
            <button className="mt-1 max-w-full truncate text-left text-sm text-muted hover:text-primary" onClick={() => onOpenSoup?.(item.soupId)}>
              《{item.soupTitle}》 · {statusText(item.status)}
            </button>
            <p className="mt-1 text-xs text-muted/70">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
          </div>
          {item.status === "pending" ? (
            <div className="flex shrink-0 gap-2">
              <button className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white" onClick={() => onDecision(item.id, "approved")}>同意</button>
              <button className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-ink" onClick={() => onDecision(item.id, "rejected")}>拒绝</button>
            </div>
          ) : onOpenSoup ? (
            <button className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-muted" onClick={() => onOpenSoup(item.soupId)} aria-label="查看海龟汤">
              <Eye size={16} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
