import {
  Award,
  Bell,
  CircleEllipsis,
  GalleryVerticalEnd,
  Home,
  ListChecks,
  LogOut,
  MessageCircleQuestion,
  Plus,
  Shield,
  Shell,
  ShoppingBag,
  Trophy,
  UserRound
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { desktopNavigationBannerUrl } from "../shared/staticAssets";
import { useMessageUnread } from "../shared/useMessageUnread";
import { useDesktopHeroParallax } from "../shared/useDesktopHeroParallax";
import { useShellBalance } from "../shared/useShellBalance";

export type DesktopModuleKey = "online-soup" | "circles" | "rankings" | "store" | "tasks" | "mine" | "achievements" | "cards" | "messages";

export function DesktopModuleHeader({ active, title, eyebrow }: { active: DesktopModuleKey; title: string; eyebrow: string }) {
  const { user, openAuth, openSoupEditor, setUser, showToast, triggerRefresh } = useApp();
  const navigate = useNavigate();
  const unread = useMessageUnread(user?.id, Boolean(user));
  const heroParallax = useDesktopHeroParallax<HTMLElement>();
  const shellBalance = useShellBalance(user?.id);

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
      <img className="home-desktop-fixed-cover" src={desktopNavigationBannerUrl} alt="" aria-hidden="true" />
      <div className="home-desktop-hero-shade" aria-hidden="true" />
      <div className="home-desktop-nav">
        <button type="button" className="home-desktop-brand" onClick={() => navigate("/")} aria-label="返回首页">
          <img className="home-desktop-brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
          <span>汤汤解谜乐园</span>
        </button>
        <nav className="home-desktop-nav-links" aria-label="主导航">
          <button type="button" onClick={() => navigate("/")}><Home size={17} />首页</button>
          <button type="button" className={active === "online-soup" ? "is-active" : ""} onClick={() => navigateAuthenticated("/online-soup")}><MessageCircleQuestion size={17} />玩汤</button>
          <button type="button" className={active === "circles" ? "is-active" : ""} onClick={() => navigateAuthenticated("/circles")}><CircleEllipsis size={17} />圈子</button>
          <button type="button" className={active === "rankings" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/rankings")}><Trophy size={17} />排行</button>
          <button type="button" className={active === "store" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/store")}><ShoppingBag size={17} />商城</button>
          <button type="button" className={active === "tasks" ? "is-active" : ""} onClick={() => navigateAuthenticated("/mine/tasks")}><ListChecks size={17} />任务</button>
        </nav>
        <div className="home-desktop-account">
          {user ? (
            <>
              <button type="button" className={`home-desktop-icon-button ${active === "messages" ? "is-active" : ""}`} onClick={() => navigate("/messages")} aria-label="消息">
                <Bell size={19} />
                {unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}
              </button>
              {user.role === "admin" && (
                <button type="button" className="home-desktop-icon-button" onClick={() => navigate("/admin")} aria-label="后台"><Shield size={18} /></button>
              )}
              <details className="home-desktop-user-menu">
                <summary>
                  {user.avatar ? <img src={user.avatar} alt="" /> : <span>{(user.nickname || user.username).slice(0, 1)}</span>}
                  <strong>{(user.nickname || user.username).slice(0, 8)}</strong>
                </summary>
                <div>
                  <button type="button" onClick={() => navigate("/mine")}><UserRound size={16} />个人中心</button>
                  <button type="button" onClick={() => navigate("/mine/achievements")}><Award size={16} />我的成就</button>
                  <button type="button" onClick={() => navigate("/mine/cards")}><GalleryVerticalEnd size={16} />收藏柜</button>
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
    </header>
  );
}
