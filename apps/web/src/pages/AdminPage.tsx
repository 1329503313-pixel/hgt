import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { AdminSidebar, AdminTopBar, AdminTab } from "../components/admin/AdminTopBar";
import { UserManagement } from "../components/admin/UserManagement";
import { SoupManagement } from "../components/admin/SoupManagement";
import { EvaluationManagement } from "../components/admin/EvaluationManagement";
import { ApprovalManagement } from "../components/admin/ApprovalManagement";
import { AdminDashboard } from "../components/admin/AdminDashboard";
import { BadgeManagement } from "../components/admin/BadgeManagement";
import { NoticeManagement } from "../components/admin/NoticeManagement";
import { CardSkeleton } from "../components/Skeletons";
import { OnlineSoupRoomManagement } from "../components/admin/OnlineSoupRoomManagement";
import { AiHostAuditManagement } from "../components/admin/AiHostAuditManagement";
import { CircleManagement } from "../components/admin/CircleManagement";
import { StoreManagement } from "../components/admin/StoreManagement";
import { CollectibleManagement } from "../components/admin/CollectibleManagement";
import { BannerManagement } from "../components/admin/BannerManagement";
import { FeedbackManagement } from "../components/admin/FeedbackManagement";
import { GiftManagement } from "../components/admin/GiftManagement";
import { VipManagement } from "../components/admin/VipManagement";
import { EntitlementManagement } from "../components/admin/EntitlementManagement";
import { MysteryManagement } from "../components/admin/MysteryManagement";
import { canAccessAdmin, isSuperAdminRole } from "../shared/roles";
import { api } from "../api";
import { subscribeServerEvent } from "../shared/serverEvents";

export default function AdminPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>("data");
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
    if (!user || !canAccessAdmin(user.role)) { navigate("/"); return; }
  }, [user, loadingUser]);

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
    if (activeTab !== "feedback") return;
    setModuleUnread((current) => ({ ...current, feedback: false }));
    void api("/api/admin/module-unread/feedback/read", { method: "PATCH" }).catch(() => {});
  }, [activeTab]);

  if (loadingUser) {
    return <main className="mx-auto max-w-7xl space-y-4 px-4 py-20"><CardSkeleton rows={4} /><CardSkeleton rows={6} /></main>;
  }
  if (!user || !canAccessAdmin(user.role)) return null;
  const isSuperAdmin = isSuperAdminRole(user.role);

  return (
    <section className="min-h-screen bg-page">
      <AdminTopBar />
      <AdminSidebar activeTab={activeTab} onTabChange={setActiveTab} role={user.role} unread={moduleUnread} />
      <div className="ml-20 px-3 pb-8 pt-[81px] sm:ml-44 sm:px-4">
        <div className="mx-auto max-w-7xl space-y-4">
          {activeTab === "data" && <AdminDashboard />}
          {activeTab === "banners" && isSuperAdmin && <BannerManagement />}
          {activeTab === "users" && <UserManagement isSuperAdmin={isSuperAdmin} />}
          {activeTab === "vip" && isSuperAdmin && <VipManagement />}
          {activeTab === "entitlements" && isSuperAdmin && <EntitlementManagement />}
          {activeTab === "soups" && <SoupManagement canDelete={isSuperAdmin} />}
          {activeTab === "mysteries" && <MysteryManagement />}
          {activeTab === "evaluations" && <EvaluationManagement />}
          {activeTab === "gifts" && isSuperAdmin && <GiftManagement />}
          {activeTab === "badges" && isSuperAdmin && <BadgeManagement />}
          {activeTab === "approvals" && <ApprovalManagement canReviewExcellentAuthor={isSuperAdmin} onPendingChange={loadModuleUnread} />}
          {activeTab === "online-soup" && isSuperAdmin && <OnlineSoupRoomManagement />}
          {activeTab === "ai-host" && isSuperAdmin && <AiHostAuditManagement />}
          {activeTab === "circles" && isSuperAdmin && <CircleManagement />}
          {activeTab === "collectibles" && isSuperAdmin && <CollectibleManagement />}
          {activeTab === "assets" && isSuperAdmin && <StoreManagement />}
          {activeTab === "notices" && <NoticeManagement />}
          {activeTab === "feedback" && <FeedbackManagement />}
        </div>
      </div>
    </section>
  );
}
