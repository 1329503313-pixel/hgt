import type { UserRole } from "../../shared/types";
import { isSuperAdminRole } from "../../shared/roles";

// 管理后台路由清单的唯一来源：新增模块必须先在这里声明路径、导航名称和权限。
export const adminRouteManifest = [
  { key: "data", path: "data", label: "数据", superAdminOnly: false },
  { key: "banners", path: "banners", label: "Banner", superAdminOnly: true },
  { key: "users", path: "users", label: "用户", superAdminOnly: false },
  { key: "vip", path: "vip", label: "VIP", superAdminOnly: true },
  { key: "entitlements", path: "entitlements", label: "权益", superAdminOnly: true },
  { key: "soups", path: "soups", label: "汤品", superAdminOnly: false },
  { key: "mysteries", path: "mysteries", label: "谜局", superAdminOnly: true },
  { key: "evaluations", path: "evaluations", label: "评价", superAdminOnly: false },
  { key: "gifts", path: "gifts", label: "礼物", superAdminOnly: true },
  { key: "badges", path: "badges", label: "徽章", superAdminOnly: true },
  { key: "approvals", path: "approvals", label: "审批", superAdminOnly: false },
  { key: "online-soup", path: "online-soup", label: "大厅", superAdminOnly: true },
  { key: "ai-host", path: "ai-host", label: "AI审计", superAdminOnly: true },
  { key: "circles", path: "circles", label: "圈子", superAdminOnly: true },
  { key: "collectibles", path: "collectibles", label: "收藏品", superAdminOnly: true },
  { key: "assets", path: "assets", label: "商城", superAdminOnly: true },
  { key: "notices", path: "notices", label: "通知", superAdminOnly: false },
  { key: "feedback", path: "feedback", label: "建议", superAdminOnly: false }
] as const;

export type AdminTab = (typeof adminRouteManifest)[number]["key"];
export type AdminRouteManifestEntry = (typeof adminRouteManifest)[number];
export const defaultAdminTab: AdminTab = "data";

export function adminRoutePath(tab: AdminTab) {
  const route = adminRouteManifest.find((item) => item.key === tab);
  return `/admin/${route?.path ?? defaultAdminTab}`;
}

export function adminRouteFromPathname(pathname: string): AdminRouteManifestEntry | undefined {
  const path = pathname.replace(/^\/admin\/?/, "").split("/")[0];
  return adminRouteManifest.find((route) => route.path === path);
}

export function canAccessAdminRoute(route: AdminRouteManifestEntry, role: UserRole) {
  return !route.superAdminOnly || isSuperAdminRole(role);
}
