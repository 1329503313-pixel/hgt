import { Outlet, useLocation } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { DesktopModuleHeader, type DesktopModuleKey } from "../components/DesktopModuleHeader";
import { UnifiedBackButton } from "../components/UnifiedBackButton";
import { parentRoute } from "../shared/routeHierarchy";

const desktopPrimaryPaths = new Set(["/online-soup", "/circles", "/mine/rankings", "/mine/store", "/mine/tasks", "/mine", "/messages"]);

const desktopModules: Record<string, { active: DesktopModuleKey; title: string; eyebrow: string }> = {
  "/online-soup": { active: "online-soup", title: "和朋友一起，进入实时推理房间", eyebrow: "玩汤 · ONLINE SOUP" },
  "/circles": { active: "circles", title: "找到同好，分享每一个精彩脑洞", eyebrow: "圈子 · COMMUNITY" },
  "/mine/rankings": { active: "rankings", title: "看看最受欢迎的创作者与故事", eyebrow: "排行 · RANKINGS" },
  "/mine/store": { active: "store", title: "发现装扮、卡包与更多社区好物", eyebrow: "商城 · STORE" },
  "/mine/asset-draw-history": { active: "store", title: "回顾每一次抽取与收藏收获", eyebrow: "抽卡记录 · DRAW HISTORY" },
  "/mine/tasks": { active: "tasks", title: "完成每日挑战，积累属于你的奖励", eyebrow: "任务 · MISSIONS" },
  "/mine/shells/transactions": { active: "tasks", title: "查看每一笔贝壳收入与支出", eyebrow: "贝壳明细 · SHELL HISTORY" },
  "/mine": { active: "mine", title: "管理作品、互动与个人资料", eyebrow: "个人中心 · PROFILE" },
  "/mine/soups": { active: "mine", title: "整理并回顾你发布的每一个故事", eyebrow: "我的作品 · MY SOUPS" },
  "/mine/favorites": { active: "mine", title: "收藏值得再次推理的精彩故事", eyebrow: "我的收藏 · FAVORITES" },
  "/mine/evaluations": { active: "mine", title: "回看你留下的判断与评价", eyebrow: "我的评价 · REVIEWS" },
  "/mine/likes": { active: "mine", title: "记录每一次真诚的喜欢", eyebrow: "我的点赞 · LIKES" },
  "/mine/achievements": { active: "achievements", title: "记录每一次探索与成长", eyebrow: "我的成就 · ACHIEVEMENTS" },
  "/mine/excellent-author": { active: "achievements", title: "提交作品，申请优秀作者认证", eyebrow: "作者认证 · CREATOR" },
  "/mine/cards": { active: "cards", title: "收藏故事旅程中的每一张珍贵卡片", eyebrow: "收藏柜 · COLLECTION" },
  "/mine/settings": { active: "mine", title: "管理账号、安全与主页展示", eyebrow: "账号设置 · SETTINGS" },
  "/mine/settings/password": { active: "mine", title: "更新密码，守护账号安全", eyebrow: "重置密码 · SECURITY" },
  "/mine/settings/backgrounds": { active: "cards", title: "选择已经解锁的主页背景", eyebrow: "卡牌背景 · BACKGROUNDS" },
  "/forgot-password": { active: "mine", title: "通过绑定邮箱找回账号", eyebrow: "找回密码 · ACCOUNT RECOVERY" },
  "/reset-password": { active: "mine", title: "设置新的登录密码", eyebrow: "重置密码 · ACCOUNT RECOVERY" }
};

function desktopModuleForPath(path: string) {
  if (/^\/mine\/store\/[^/]+$/.test(path)) {
    return { active: "store" as const, title: "查看卡包内容，开启新的收藏", eyebrow: "卡包详情 · PACK DETAILS" };
  }
  if (path === "/messages") {
    return { active: "messages" as const, title: "集中查看互动、通知与私信", eyebrow: "消息中心 · MESSAGES" };
  }
  if (path === "/messages/system") {
    return { active: "messages" as const, title: "查看账号与平台系统消息", eyebrow: "系统消息 · SYSTEM" };
  }
  if (path === "/messages/interactions") {
    return { active: "messages" as const, title: "查看点赞、收藏与评价互动", eyebrow: "互动消息 · INTERACTIONS" };
  }
  if (path === "/messages/requests") {
    return { active: "messages" as const, title: "处理汤底查看申请", eyebrow: "查看申请 · REQUESTS" };
  }
  if (path === "/messages/notices") {
    return { active: "messages" as const, title: "阅读平台发布的最新通知", eyebrow: "平台通知 · NOTICES" };
  }
  if (/^\/messages\/notices\/[^/]+$/.test(path)) {
    return { active: "messages" as const, title: "阅读平台通知详情", eyebrow: "通知详情 · NOTICE DETAILS" };
  }
  return desktopModules[path];
}

export default function MainLayout() {
  const location = useLocation();
  const path = location.pathname;
  const isHome = path === "/";
  const desktopModule = desktopModuleForPath(path);
  const desktopSecondary = Boolean(desktopModule && !desktopPrimaryPaths.has(path));

  // Hide BottomNav on detail page, but include "soup/" prefix for home tab active state
  const hideBottomNav = path.startsWith("/soup/") || path.startsWith("/messages") || /^\/mine\/store\/[^/]+$/.test(path);

  // home, mine, mine/* 用 PageTopBar 自行渲染 header
  // 这些页面的 header 由各自页面组件内部的 PageTopBar 处理

  return (
    <>
      {desktopModule && <DesktopModuleHeader key={path} {...desktopModule} />}
      <main className={`main-layout mx-auto max-w-6xl px-4 pt-[72px] pb-28 ${isHome ? "main-layout-home" : ""} ${desktopModule ? "main-layout-desktop-module" : ""} ${desktopSecondary ? "main-layout-desktop-secondary" : ""}`}>
        {desktopSecondary && <div className="desktop-secondary-back-row hidden lg:flex"><UnifiedBackButton to={parentRoute(path)} /></div>}
        <Outlet />
      </main>
      {!hideBottomNav && <BottomNav />}
    </>
  );
}
