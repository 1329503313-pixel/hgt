import { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Bell } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { subscribeServerEvent } from "../shared/serverEvents";
import { Modal } from "./Modal";

type PopupNotice = {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
};

export function GlobalNoticeModal() {
  const { user, showToast, triggerRefresh } = useApp();
  const [notice, setNotice] = useState<PopupNotice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const activeUserIdRef = useRef(user?.id ?? null);
  activeUserIdRef.current = user?.id ?? null;

  const loadPendingNotice = useCallback(async () => {
    if (!user) {
      setNotice(null);
      return;
    }
    const requestedUserId = user.id;
    try {
      const data = await api<{ notice: PopupNotice | null }>("/api/notices/popup");
      if (activeUserIdRef.current === requestedUserId) setNotice(data.notice);
    } catch {
      // 登录后的聚合页面仍可正常使用；窗口聚焦和实时事件会继续补拉。
    }
  }, [user]);

  useEffect(() => {
    setNotice(null);
    setConfirming(false);
    confirmingRef.current = false;
    refreshQueuedRef.current = false;
    if (!user) return;

    void loadPendingNotice();
    const refresh = () => {
      if (confirmingRef.current) {
        refreshQueuedRef.current = true;
        return;
      }
      void loadPendingNotice();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const unsubscribe = subscribeServerEvent("unread_changed", (event) => {
      try {
        const payload = JSON.parse(event.data) as { source?: string };
        if (payload.source?.startsWith("notice_")) refresh();
      } catch {
        // 格式异常时由窗口聚焦补拉恢复。
      }
    });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [user, loadPendingNotice]);

  const confirmNotice = useCallback(async () => {
    if (!notice || confirmingRef.current) return;
    const requestedUserId = user?.id;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      await api(`/api/notices/${notice.id}/read`, { method: "PATCH" });
      if (activeUserIdRef.current !== requestedUserId) return;
      setNotice(null);
      triggerRefresh();
      refreshQueuedRef.current = false;
      await loadPendingNotice();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void loadPendingNotice();
      }
    }
  }, [notice, user?.id, loadPendingNotice, showToast, triggerRefresh]);

  if (!notice) return null;

  return (
    <Modal onClose={() => void confirmNotice()} contentClassName="max-w-xl">
      <div className="space-y-5">
        <header className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-100 text-violet-600">
            <Bell size={23} />
          </span>
          <h2 className="mt-3 break-words text-xl font-black leading-snug text-ink">{notice.title}</h2>
        </header>
        <div
          className="notice-rich-content max-h-[55dvh] overflow-y-auto rounded-2xl bg-slate-50 p-4 text-ink"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(notice.content, { USE_PROFILES: { html: true } }) }}
        />
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={confirming}
          onClick={() => void confirmNotice()}
        >
          {confirming ? "确认中……" : "确认"}
        </button>
      </div>
    </Modal>
  );
}
