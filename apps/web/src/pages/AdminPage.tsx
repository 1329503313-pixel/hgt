import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { AdminTopBar, AdminTab } from "../components/admin/AdminTopBar";
import { UserManagement } from "../components/admin/UserManagement";
import { SoupManagement } from "../components/admin/SoupManagement";
import { EvaluationManagement } from "../components/admin/EvaluationManagement";
import { ApprovalManagement } from "../components/admin/ApprovalManagement";
import { AdminDashboard } from "../components/admin/AdminDashboard";
import { BadgeManagement } from "../components/admin/BadgeManagement";
import { NoticeManagement } from "../components/admin/NoticeManagement";

export default function AdminPage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>("data");

  useEffect(() => {
    if (loadingUser) return;
    if (!user || user.role !== "admin") { navigate("/"); return; }
  }, [user, loadingUser]);

  if (loadingUser) {
    return <div className="flex items-center justify-center py-20 text-sm text-muted">正在喝汤中……</div>;
  }

  return (
    <section className="min-h-screen bg-page">
      <AdminTopBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="mx-auto max-w-7xl px-4 pt-[72px] pb-8 space-y-4">
        {activeTab === "data" && <AdminDashboard />}
        {activeTab === "users" && <UserManagement />}
        {activeTab === "badges" && <BadgeManagement />}
        {activeTab === "approvals" && <ApprovalManagement />}
        {activeTab === "soups" && <SoupManagement />}
        {activeTab === "evaluations" && <EvaluationManagement />}
        {activeTab === "notices" && <NoticeManagement />}
      </div>
    </section>
  );
}
