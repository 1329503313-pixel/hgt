import { useEffect, useState } from "react";
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
import { CircleManagement } from "../components/admin/CircleManagement";
import { DigitalAssetManagement } from "../components/admin/DigitalAssetManagement";
import { BannerManagement } from "../components/admin/BannerManagement";
import { FeedbackManagement } from "../components/admin/FeedbackManagement";
import { canAccessAdmin, isSuperAdminRole } from "../shared/roles";

export default function AdminPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>("data");

  useEffect(() => {
    if (loadingUser) return;
    if (!user || !canAccessAdmin(user.role)) { navigate("/"); return; }
  }, [user, loadingUser]);

  if (loadingUser) {
    return <main className="mx-auto max-w-7xl space-y-4 px-4 py-20"><CardSkeleton rows={4} /><CardSkeleton rows={6} /></main>;
  }
  if (!user || !canAccessAdmin(user.role)) return null;
  const isSuperAdmin = isSuperAdminRole(user.role);

  return (
    <section className="min-h-screen bg-page">
      <AdminTopBar />
      <AdminSidebar activeTab={activeTab} onTabChange={setActiveTab} role={user.role} />
      <div className="ml-20 px-3 pb-8 pt-[81px] sm:ml-44 sm:px-4">
        <div className="mx-auto max-w-7xl space-y-4">
          {activeTab === "data" && <AdminDashboard />}
          {activeTab === "banners" && isSuperAdmin && <BannerManagement />}
          {activeTab === "users" && <UserManagement isSuperAdmin={isSuperAdmin} />}
          {activeTab === "soups" && <SoupManagement canDelete={isSuperAdmin} />}
          {activeTab === "evaluations" && <EvaluationManagement />}
          {activeTab === "badges" && isSuperAdmin && <BadgeManagement />}
          {activeTab === "approvals" && isSuperAdmin && <ApprovalManagement />}
          {activeTab === "online-soup" && isSuperAdmin && <OnlineSoupRoomManagement />}
          {activeTab === "circles" && isSuperAdmin && <CircleManagement />}
          {activeTab === "assets" && isSuperAdmin && <DigitalAssetManagement />}
          {activeTab === "notices" && isSuperAdmin && <NoticeManagement />}
          {activeTab === "feedback" && <FeedbackManagement />}
        </div>
      </div>
    </section>
  );
}
