import { Home, MessageCircleQuestion, Plus, User, CircleEllipsis } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../api";
import { useMessageUnreadCounts } from "../shared/useMessageUnread";

export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, openAuth, openSoupEditor, triggerRefresh, showToast } = useApp();
  const unreadCounts = useMessageUnreadCounts(user?.id, Boolean(user));

  const path = location.pathname;
  const isHomeActive = path === "/" || path.startsWith("/soup/");
  const isMineActive = path.startsWith("/mine");
  const isOnlineSoupActive = path.startsWith("/online-soup");
  const isCirclesActive = path.startsWith("/circles");
  const isCirclesList = path === "/circles" || path === "/circles/";
  const showCircleUnread = Boolean(user && !isCirclesList && unreadCounts.circleMessages > 0);
  const showCircleMention = Boolean(user && !isCirclesList && unreadCounts.circleMentions > 0);

  function handleHome() {
    if (path === "/") {
      triggerRefresh();
    } else {
      navigate("/");
    }
  }

  function handleMine() {
    if (!user) { openAuth(); return; }
    navigate("/mine");
  }

  async function handleCreate() {
    if (!user) { openAuth(); return; }
    try {
      const quota = await api<{ allowed: boolean; reason: string | null }>("/api/me/soup-publish-quota");
      if (!quota.allowed) {
        showToast(quota.reason || "今日暂时无法继续发布海龟汤");
        return;
      }
      openSoupEditor();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "发布额度检查失败");
    }
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_rgba(17,24,39,0.07)] backdrop-blur">
      <div className="relative mx-auto grid max-w-md grid-cols-5 items-end gap-1">
        <button
          className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition ${isHomeActive ? "text-primary" : "text-ink hover:bg-blue-50 hover:text-primary"}`}
          onClick={handleHome}
          onPointerEnter={() => { void import("../pages/HomePage"); }}
        >
          <Home size={20} />
          <span>首页</span>
        </button>
        <button
          className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition ${isOnlineSoupActive ? "text-primary" : "text-ink hover:bg-blue-50 hover:text-primary"}`}
          onClick={() => { if (!user) { openAuth(); return; } navigate("/online-soup"); }}
        >
          <MessageCircleQuestion size={20} />
          <span>玩汤</span>
        </button>
        <button className="flex min-h-[64px] flex-col items-center justify-end gap-1 text-xs font-semibold text-ink" onClick={handleCreate}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary text-white shadow-[0_8px_20px_rgba(37,99,235,0.28)]">
            <Plus size={26} strokeWidth={2.2} />
          </span>
          <span>创作</span>
        </button>
        <button
          className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition ${isCirclesActive ? "text-primary" : "text-ink hover:bg-blue-50 hover:text-primary"}`}
          onClick={() => { if (!user) { openAuth(); return; } navigate("/circles"); }}
          aria-label={showCircleMention ? "圈子，有未读@消息" : showCircleUnread ? "圈子，有未读消息" : "圈子"}
        >
          <span className="relative grid h-5 w-5 place-items-center">
            <CircleEllipsis size={20} />
            {showCircleMention ? (
              <span className="absolute -right-2 -top-1 grid h-3 w-3 place-items-center text-[12px] font-black leading-none text-red-500" aria-hidden="true">@</span>
            ) : showCircleUnread ? (
              <span className="absolute -right-2 -top-1 grid h-3 w-3 place-items-center" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /></span>
            ) : null}
          </span>
          <span>圈子</span>
        </button>
        <button
          className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition ${isMineActive ? "text-primary" : "text-ink hover:bg-blue-50 hover:text-primary"}`}
          onClick={handleMine}
          onPointerEnter={() => { if (user) void import("../pages/MinePage"); }}
        >
          <User size={20} />
          <span>我的</span>
        </button>
      </div>
    </nav>
  );
}
