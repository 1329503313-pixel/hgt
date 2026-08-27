import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { AdminSidebar, AdminTopBar } from "../components/admin/AdminTopBar";
import { CardSkeleton } from "../components/Skeletons";
import { adminRoutes } from "../components/admin/adminRoutes";
import { adminRouteFromPathname, adminRoutePath, canAccessAdminRoute, defaultAdminTab } from "../components/admin/adminRouteManifest";
import { canAccessAdmin, isSuperAdminRole } from "../shared/roles";
import { api } from "../api";
import { subscribeServerEvent } from "../shared/serverEvents";

export default function AdminPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const contentRef = useRef<HTMLElement>(null);
  const [moduleUnread, setModuleUnread] = useState({ approvals: false, feedback: false });

  const loadModuleUnread = useCallback(async () => {
    if (!user || !canAccessAdmin(user.role)) return;
    try {
      const next = await api<{ approvals: boolean; feedback: boolean }>("/api/admin/module-unread", { bypassCache: true, dedupe: false });
      setModuleUnread(next);
    } catch {
      // 后台红点拉取失败不阻断管理功能。
    }
  }, [user]);

  useEffect(() => {
    if (loadingUser) return;
    if (!user || !canAccessAdmin(user.role)) { navigate("/", { replace: true }); return; }
  }, [user, loadingUser, navigate]);

  useEffect(() => {
    if (!user || !canAccessAdmin(user.role)) return;
    void loadModuleUnread();
    const timer = window.setInterval(loadModuleUnread, 30_000);
    const handleFocus = () => void loadModuleUnread();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [user, loadModuleUnread]);

  useEffect(() => {
    const update = (unread: boolean) => (event: MessageEvent<string>) => {
      try {
        const { moduleKey } = JSON.parse(event.data) as { moduleKey?: "approvals" | "feedback" };
        if (moduleKey === "approvals") void loadModuleUnread();
        else if (moduleKey) setModuleUnread((current) => ({ ...current, [moduleKey]: unread }));
      } catch {
        // 忽略格式异常的后台模块事件。
      }
    };
    const unsubscribeUnread = subscribeServerEvent("admin_module_unread", update(true));
    const unsubscribeRead = subscribeServerEvent("admin_module_read", update(false));
    return () => {
      unsubscribeUnread();
      unsubscribeRead();
    };
  }, [loadModuleUnread]);

  useEffect(() => {
    if (!user || !canAccessAdmin(user.role) || adminRouteFromPathname(location.pathname)?.key !== "feedback") return;
    setModuleUnread((current) => ({ ...current, feedback: false }));
    void api("/api/admin/module-unread/feedback/read", { method: "PATCH" }).catch(() => {});
  }, [location.pathname, user]);

  useEffect(() => {
    if (loadingUser || !user || !canAccessAdmin(user.role)) return;
    contentRef.current?.focus({ preventScroll: true });
  }, [loadingUser, location.pathname, user]);

  if (loadingUser) {
    return <main className="mx-auto max-w-7xl space-y-4 px-4 py-20"><CardSkeleton rows={4} /><CardSkeleton rows={6} /></main>;
  }
  if (!user || !canAccessAdmin(user.role)) return null;
  const isSuperAdmin = isSuperAdminRole(user.role);
  const requestedRoute = adminRouteFromPathname(location.pathname);
  const activeRoute = requestedRoute && canAccessAdminRoute(requestedRoute, user.role)
    ? requestedRoute
    : adminRoutes.find((route) => route.key === defaultAdminTab)!;
  const routeContext = {
    isSuperAdmin,
    refreshModuleUnread: () => { void loadModuleUnread(); }
  };

  return (
    <section className="min-h-screen bg-page">
      <AdminTopBar />
      <AdminSidebar activeTab={activeRoute.key} onTabChange={(tab) => navigate(adminRoutePath(tab))} role={user.role} unread={moduleUnread} />
      <main ref={contentRef} tabIndex={-1} aria-label={`${activeRoute.label}管理`} className="ml-20 px-3 pb-8 pt-[81px] outline-none sm:ml-44 sm:px-4">
        <div className="mx-auto max-w-7xl space-y-4">
          <Routes>
            <Route index element={<Navigate to={adminRoutePath(defaultAdminTab)} replace />} />
            {adminRoutes.map((route) => (
              <Route
                key={route.key}
                path={route.path}
                element={canAccessAdminRoute(route, user.role)
                  ? route.render(routeContext)
                  : <Navigate to={adminRoutePath(defaultAdminTab)} replace />}
              />
            ))}
            <Route path="*" element={<Navigate to={adminRoutePath(defaultAdminTab)} replace />} />
          </Routes>
        </div>
      </main>
    </section>
  );
}
