import { useCallback, useEffect, useRef, useState } from "react";
import { FileClock, MessageCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { subscribeServerEvent } from "../shared/serverEvents";

type PrivateMessagePayload = {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderNickname?: string;
  senderAvatar?: string | null;
  content: string;
};

type ViewRequestPayload = {
  requestId: string;
  soupId: string;
  soupTitle: string;
  requesterId: string;
  requesterName: string;
  requesterAvatar?: string | null;
};

type BannerItem = {
  key: string;
  kind: "private" | "request";
  sourceName: string;
  sourceAvatar?: string | null;
  title: string;
  detail: string;
  href: string;
  requestId?: string;
};

type Phase = "entering" | "visible" | "dragging" | "leaving-up" | "leaving-right";

function isSuppressed(pathname: string, item: BannerItem) {
  if (item.kind === "request") return pathname.startsWith("/messages/requests");
  if (pathname === "/messages") return true;
  return pathname === item.href;
}

function eventPayload<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

export function IncomingMessageBanner() {
  const { user, showToast } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location.pathname);
  const [current, setCurrent] = useState<BannerItem | null>(null);
  const [phase, setPhase] = useState<Phase>("entering");
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [decisionBusy, setDecisionBusy] = useState(false);
  const gestureRef = useRef({ pointerId: -1, startX: 0, startY: 0, x: 0, y: 0, moved: false, axis: "" as "" | "x" | "y" });
  useEffect(() => {
    locationRef.current = location.pathname;
    if (current && isSuppressed(location.pathname, current)) {
      setCurrent(null);
    }
  }, [location.pathname, current?.key]);

  const enqueue = useCallback((item: BannerItem) => {
    if (isSuppressed(locationRef.current, item)) return;
    setCurrent((previous) => previous?.key === item.key ? previous : item);
  }, []);

  useEffect(() => {
    if (!user) {
      setCurrent(null);
      return;
    }
    const onPrivateMessage = (event: Event) => {
      const payload = eventPayload<PrivateMessagePayload>(event);
      if (!payload?.conversationId || !payload.messageId) return;
      enqueue({
        key: `private:${payload.messageId}`,
        kind: "private",
        sourceName: payload.senderNickname || "新消息",
        sourceAvatar: payload.senderAvatar,
        title: "私信消息",
        detail: payload.content,
        href: `/messages/chat/${payload.conversationId}`
      });
    };
    const onViewRequest = (event: Event) => {
      const payload = eventPayload<ViewRequestPayload>(event);
      if (!payload?.requestId || !payload.soupId) return;
      enqueue({
        key: `request:${payload.requestId}`,
        kind: "request",
        sourceName: payload.requesterName || "新申请",
        sourceAvatar: payload.requesterAvatar,
        title: "申请查看汤底",
        detail: `申请查看《${payload.soupTitle}》的汤底和主持人手册`,
        href: "/messages/requests",
        requestId: payload.requestId
      });
    };
    const unsubscribePrivate = subscribeServerEvent("private_message", onPrivateMessage);
    const unsubscribeRequest = subscribeServerEvent("view_request", onViewRequest);
    return () => {
      unsubscribePrivate();
      unsubscribeRequest();
    };
  }, [user?.id, enqueue]);

  useEffect(() => {
    if (!current) return;
    setDrag({ x: 0, y: 0 });
    setDecisionBusy(false);
    setPhase("entering");
    const first = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("visible"));
    });
    return () => cancelAnimationFrame(first);
  }, [current?.key]);

  const dismiss = useCallback((direction: "up" | "right") => {
    const dismissingKey = current?.key;
    if (!dismissingKey) return;
    setPhase(direction === "right" ? "leaving-right" : "leaving-up");
    window.setTimeout(() => setCurrent((item) => item?.key === dismissingKey ? null : item), 300);
  }, [current?.key]);

  useEffect(() => {
    if (!current || phase !== "visible") return;
    const timer = window.setTimeout(() => dismiss("up"), 3000);
    return () => window.clearTimeout(timer);
  }, [current?.key, phase, dismiss]);

  function openCurrent() {
    if (!current || gestureRef.current.moved) return;
    navigate(current.href);
    dismiss("up");
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: 0, y: 0, moved: false, axis: "" };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPhase("dragging");
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;
    const rawX = event.clientX - gesture.startX;
    const rawY = event.clientY - gesture.startY;
    if (!gesture.axis && Math.hypot(rawX, rawY) > 7) gesture.axis = Math.abs(rawX) > Math.abs(rawY) ? "x" : "y";
    if (!gesture.axis) return;
    gesture.moved = true;
    gesture.x = gesture.axis === "x" ? Math.max(0, rawX) : 0;
    gesture.y = gesture.axis === "y" ? Math.min(0, rawY) : 0;
    setDrag({ x: gesture.x, y: gesture.y });
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;
    gestureRef.current.pointerId = -1;
    if (gesture.x > 72) return dismiss("right");
    if (gesture.y < -48) return dismiss("up");
    setDrag({ x: 0, y: 0 });
    setPhase("visible");
  }

  async function decide(event: React.MouseEvent, decision: "approved" | "rejected") {
    event.stopPropagation();
    if (!current?.requestId || decisionBusy) return;
    setDecisionBusy(true);
    try {
      await api(`/api/access-requests/${current.requestId}/decision`, { method: "POST", body: { decision } });
      window.dispatchEvent(new CustomEvent("hgt:requests-updated"));
      showToast(decision === "approved" ? "已同意查看申请" : "已拒绝查看申请");
      dismiss("up");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "处理申请失败");
      setDecisionBusy(false);
    }
  }

  if (!current) return null;

  const transform = phase === "entering"
    ? "translate3d(0, calc(-100% - 28px), 0)"
    : phase === "leaving-up"
      ? "translate3d(0, calc(-100% - 28px), 0)"
      : phase === "leaving-right"
        ? "translate3d(calc(100vw + 28px), 0, 0) rotate(4deg)"
        : `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${Math.min(3, drag.x / 45)}deg)`;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center px-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-5">
      <div
        className={`incoming-message-banner pointer-events-auto w-full max-w-md select-none overflow-hidden rounded-[22px] border border-white/80 bg-white/95 shadow-[0_16px_45px_rgba(15,23,42,0.22)] ${phase === "dragging" ? "cursor-grabbing" : "cursor-pointer"}`}
        style={{ transform, opacity: phase.startsWith("leaving") ? 0 : 1, touchAction: "none" }}
        role="status"
        aria-live="polite"
        onClick={openCurrent}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
          <span className={`grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full font-black ${current.kind === "request" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-primary"}`}>
            {current.sourceAvatar
              ? <img src={current.sourceAvatar} alt="" className="h-full w-full object-cover" />
              : current.sourceName.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[15px] font-black text-ink">{current.sourceName}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${current.kind === "request" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-primary"}`}>
                {current.kind === "request" ? <FileClock size={11} /> : <MessageCircle size={11} />}
                {current.title}
              </span>
            </span>
            <span className="mt-1.5 block line-clamp-2 text-sm leading-5 text-slate-600">{current.detail}</span>
          </span>
        </div>
        {current.kind === "request" && (
          <div className="flex gap-2 border-t border-slate-100 px-4 py-2.5">
            <button disabled={decisionBusy} className="flex-1 rounded-xl bg-primary py-2 text-xs font-black text-white disabled:opacity-60" onClick={(event) => void decide(event, "approved")}>同意</button>
            <button disabled={decisionBusy} className="flex-1 rounded-xl bg-slate-100 py-2 text-xs font-black text-ink disabled:opacity-60" onClick={(event) => void decide(event, "rejected")}>拒绝</button>
          </div>
        )}
      </div>
    </div>
  );
}
