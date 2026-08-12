import {
  ArrowLeft,
  Award,
  BarChart3,
  Bell,
  CircleEllipsis,
  ClipboardCheck,
  Images,
  MessageSquare,
  MessageSquareText,
  PackageOpen,
  Gift,
  Crown,
  Radio,
  RefreshCw,
  Soup,
  Users
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { UserRole } from "../../shared/types";
import { isSuperAdminRole } from "../../shared/roles";

export type AdminTab = "data" | "banners" | "users" | "vip" | "soups" | "evaluations" | "gifts" | "badges" | "approvals" | "online-soup" | "circles" | "assets" | "notices" | "feedback";

const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
  { key: "data", label: "数据", icon: <BarChart3 size={17} /> },
  { key: "banners", label: "Banner", icon: <Images size={17} /> },
  { key: "users", label: "用户", icon: <Users size={17} /> },
  { key: "vip", label: "VIP", icon: <Crown size={17} /> },
  { key: "soups", label: "汤品", icon: <Soup size={17} /> },
  { key: "evaluations", label: "评价", icon: <MessageSquare size={17} /> },
  { key: "gifts", label: "礼物", icon: <Gift size={17} /> },
  { key: "badges", label: "徽章", icon: <Award size={17} /> },
  { key: "approvals", label: "审批", icon: <ClipboardCheck size={17} /> },
  { key: "online-soup", label: "玩汤", icon: <Radio size={17} /> },
  { key: "circles", label: "圈子", icon: <CircleEllipsis size={17} /> },
  { key: "assets", label: "商城", icon: <PackageOpen size={17} /> },
  { key: "notices", label: "通知", icon: <Bell size={17} /> },
  { key: "feedback", label: "建议", icon: <MessageSquareText size={17} /> }
];
const backofficeTabs = new Set<AdminTab>(["data", "users", "soups", "evaluations", "approvals", "feedback"]);

export function AdminTopBar() {
  const navigate = useNavigate();

  return (
    <header className="top-nav-shell">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-2.5">
        <h1 className="truncate text-xl font-black text-ink">管理员后台</h1>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary rounded-full px-3 sm:px-4" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />
            <span className="hidden sm:inline">刷新</span>
          </button>
          <button className="btn btn-secondary rounded-full px-3 sm:px-4" onClick={() => navigate("/", { replace: true })}>
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">返回首页</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function AdminSidebar({
  activeTab,
  onTabChange,
  role,
  unread
}: {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  role: UserRole;
  unread?: Partial<Record<AdminTab, boolean>>;
}) {
  const visibleTabs = isSuperAdminRole(role) ? tabs : tabs.filter((tab) => backofficeTabs.has(tab.key));
  return (
    <aside className="fixed inset-y-0 left-0 z-20 w-20 border-r border-line bg-white/95 pt-[65px] shadow-[8px_0_24px_rgba(17,24,39,0.04)] backdrop-blur sm:w-44">
      <nav className="h-full overflow-y-auto px-2 py-4 sm:px-3" aria-label="管理后台模块">
        <div className="space-y-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-bold transition sm:min-h-11 sm:flex-row sm:justify-start sm:gap-2 sm:px-3 sm:py-0 sm:text-sm ${
                activeTab === tab.key
                  ? "bg-primary text-white shadow-sm"
                  : "text-ink hover:bg-blue-50 hover:text-primary"
              }`}
              onClick={() => onTabChange(tab.key)}
              aria-current={activeTab === tab.key ? "page" : undefined}
            >
              <span className="shrink-0">{tab.icon}</span>
              <span className="inline-flex items-center gap-1.5">{tab.label}{unread?.[tab.key] && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-2 ring-white" aria-label="有新消息" />}</span>
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );
}
