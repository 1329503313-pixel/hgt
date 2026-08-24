import {
  Award,
  Bell,
  GalleryVerticalEnd,
  Home,
  ListChecks,
  LogOut,
  MessageCircleQuestion,
  Plus,
  Settings,
  Shield,
  Shell,
  ShoppingBag,
  Trophy,
  UserRound
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { desktopNavigationBannerUrl } from "../shared/staticAssets";
import { useMessageUnreadCounts } from "../shared/useMessageUnread";
import { useDesktopHeroParallax } from "../shared/useDesktopHeroParallax";
import { useShellBalance } from "../shared/useShellBalance";
import { useDismissibleDetails } from "../shared/useDismissibleDetails";
import { canAccessAdmin } from "../shared/roles";
import { DesktopAppDownload } from "./DesktopAppDownload";
import { DesktopGlobalSearch } from "./DesktopGlobalSearch";
import { CircleNavigationIcon, circleNavigationStatus } from "./CircleNavigationIcon";

export type DesktopModuleKey = "online-soup" | "circles" | "rankings" | "store" | "tasks" | "mine" | "achievements" | "cards" | "messages";

export function DesktopModuleHeader({ active, title, eyebrow }: { active: DesktopModuleKey; title: string; eyebrow: string }) {
  const { user, openAuth, openSoupEditor, setUser, showToast, triggerRefresh } = useApp();
  const navigate = useNavigate();
  const unreadCounts = useMessageUnreadCounts(user?.id, Boolean(user));
  const unread = unreadCounts.total;
  const circleStatus = circleNavigationStatus({
    hasUnclaimedRedPacket: unreadCounts.circleUnclaimedRedPackets > 0,
    hasUnreadMention: unreadCounts.circleMentions > 0
  });
  const heroParallax = useDesktopHeroParallax<HTMLElement>();
  const shellBalance = useShellBalance(user?.id);
  const userMenuRef = useDismissibleDetails();
  const [searchKeyword, setSearchKeyword] = useState("");

  function submitGlobalSearch() {
    const keyword = searchKeyword.trim();
    navigate(keyword ? `/?search=${encodeURIComponent(keyword)}` : "/");
  }

  function navigateAuthenticated(path: string) {
    if (!user) {
      openAuth();
      return;
    }
    navigate(path);
  }

  async function handleCreate() {
    if (!user) {
      openAuth();
      return;
    }
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

  async function handleLogout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    showToast("已退出登录");
    triggerRefresh();
    navigate("/");
  }

  return (
    <header ref={heroParallax.heroRef} className="home-desktop-hero desktop-module-hero" onPointerMove={heroParallax.onPointerMove} onPointerLeave={heroParallax.onPointerLeave}>
      <div className="home-desktop-hero-media" aria-hidden="true">
        <img className="home-desktop-fixed-cover" src={desktopNavigationBannerUrl} alt="" />
        <div className="home-desktop-hero-shade" />
      </div>
      <div className="home-desktop-nav">
        <button type="button" className="home-desktop-brand" onClick={() => navigate("/")} aria-label="返回首页">
          <img className="home-desktop-brand-mark" src="/logo.png" alt="" aria-hidden="true" />
          <span>汤物语</span>
        </button>
        <nav className="home-desktop-nav-links" aria-label="主导航">
          <button type="button" onClick={() => navigate("/")}><Home size={17} />首页</button>
          <button type="button" className={active === "online-soup" ? "is-active" : ""} onClick={() => navigateAuthenticated("/online-soup")}><MessageCircleQuestion size={17} />大厅</button>
          <button type="button" className={active === "circles" ? "is-active" : ""} onClick={() => navigateAuthenticated("/circles")} aria-label={circleStatus === "red_packet" ? "圈子，有未领取红包" : circleStatus === "mention" ? "圈子，有未读@消息" : "圈子"}><CircleNavigationIcon status={circleStatus} size={17} />圈子</button>
          <button type="button" className={active === "rankings" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/rankings")}><Trophy size={17} />排行</button>
          <button type="button" className={active === "store" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/store")}><ShoppingBag size={17} />商城</button>
          <button type="button" className={active === "tasks" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/tasks")}><ListChecks size={17} />任务</button>
          <button type="button" className={active === "cards" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/collection")}><GalleryVerticalEnd size={17} />收藏</button>
          <button type="button" className={active === "achievements" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/achievements")}><Award size={17} />成就</button>
        </nav>
        <div className="home-desktop-account">
          <DesktopAppDownload />
          {user ? (
            <>
              <button type="button" className={`home-desktop-icon-button ${active === "messages" ? "is-active" : ""}`} onClick={() => navigate("/messages")} aria-label="消息">
                <Bell size={19} />
                {unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}
              </button>
              {canAccessAdmin(user.role) && (
                <button type="button" className="home-desktop-icon-button" onClick={() => navigate("/admin")} aria-label="后台"><Shield size={18} /></button>
              )}
              <details ref={userMenuRef} className="home-desktop-user-menu">
                <summary>
                  {user.avatar ? <img src={user.avatar} alt="" /> : <span>{(user.nickname || user.username).slice(0, 1)}</span>}
                  <strong>{(user.nickname || user.username).slice(0, 8)}</strong>
                </summary>
                <div>
                  <button type="button" onClick={() => navigate("/mine")}><UserRound size={16} />个人中心</button>
                  <button type="button" onClick={() => navigate("/mine/settings")}><Settings size={16} />账号设置</button>
                  <button type="button" onClick={handleLogout}><LogOut size={16} />退出登录</button>
                </div>
              </details>
              <span className="home-desktop-shell-balance" aria-label={`贝壳余额：${shellBalance ?? "加载中"}`}><Shell size={15} aria-hidden="true" />贝壳余额：{shellBalance ?? "—"}</span>
            </>
          ) : (
            <button type="button" className="home-desktop-login" onClick={openAuth}>登录</button>
          )}
          <button type="button" className="home-desktop-create" onClick={() => void handleCreate()}><Plus size={18} />发布海龟汤</button>
        </div>
      </div>
      <div className="home-desktop-hero-copy desktop-module-hero-copy">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
      </div>
      <div className="home-desktop-search-tools desktop-module-search-tools">
        <DesktopGlobalSearch value={searchKeyword} onChange={setSearchKeyword} onSubmit={submitGlobalSearch} />
      </div>
    </header>
  );
}
