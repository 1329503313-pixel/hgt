import { ArrowLeft, Award, BarChart3, Bell, ClipboardCheck, RefreshCw, Users, Soup, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";

export type AdminTab = "data" | "users" | "badges" | "approvals" | "soups" | "evaluations" | "notices";

export function AdminTopBar({
  activeTab,
  onTabChange
}: {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}) {
  const navigate = useNavigate();

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: "data", label: "数据", icon: <BarChart3 size={16} /> },
    { key: "users", label: "用户", icon: <Users size={16} /> },
    { key: "badges", label: "徽章", icon: <Award size={16} /> },
    { key: "approvals", label: "审批", icon: <ClipboardCheck size={16} /> },
    { key: "soups", label: "汤品", icon: <Soup size={16} /> },
    { key: "evaluations", label: "评价", icon: <MessageSquare size={16} /> },
    { key: "notices", label: "通知", icon: <Bell size={16} /> }
  ];

  return (
    <header className="top-nav-shell">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-xl font-black text-ink">管理员后台</h1>
          <div className="ml-2 flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition ${
                  activeTab === tab.key
                    ? "bg-primary text-white shadow-sm"
                    : "text-ink hover:bg-blue-50 hover:text-primary"
                }`}
                onClick={() => onTabChange(tab.key)}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary rounded-full px-4" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />
            <span className="hidden sm:inline ml-1">刷新</span>
          </button>
          <button className="btn btn-secondary rounded-full px-4" onClick={() => navigate("/", { replace: true })}>
            <ArrowLeft size={16} />
            <span className="hidden sm:inline ml-1">返回首页</span>
          </button>
        </div>
      </div>
    </header>
  );
}
