import {
  Award,
  BarChart3,
  Bell,
  Bot,
  CircleEllipsis,
  ClipboardCheck,
  Images,
  MessageSquare,
  MessageSquareText,
  BookOpenCheck,
  PackageOpen,
  Gift,
  Crown,
  Gem,
  Radio,
  Soup,
  ShieldCheck,
  Users,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { adminRouteManifest, type AdminTab } from "./adminRouteManifest";
import { AdminDashboard } from "./AdminDashboard";
import { AiHostAuditManagement } from "./AiHostAuditManagement";
import { ApprovalManagement } from "./ApprovalManagement";
import { BadgeManagement } from "./BadgeManagement";
import { BannerManagement } from "./BannerManagement";
import { CircleManagement } from "./CircleManagement";
import { CollectibleManagement } from "./CollectibleManagement";
import { EntitlementManagement } from "./EntitlementManagement";
import { EvaluationManagement } from "./EvaluationManagement";
import { FeedbackManagement } from "./FeedbackManagement";
import { GiftManagement } from "./GiftManagement";
import { MysteryManagement } from "./MysteryManagement";
import { NoticeManagement } from "./NoticeManagement";
import { OnlineSoupRoomManagement } from "./OnlineSoupRoomManagement";
import { SoupManagement } from "./SoupManagement";
import { StoreManagement } from "./StoreManagement";
import { UserManagement } from "./UserManagement";
import { VipManagement } from "./VipManagement";

type AdminRouteContext = {
  isSuperAdmin: boolean;
  refreshModuleUnread: () => void;
};

type AdminRoutePresentation = {
  icon: LucideIcon;
  render: (context: AdminRouteContext) => ReactNode;
};

// Record<AdminTab, ...> 让新增清单项在缺少页面或图标时直接触发 TypeScript 构建错误。
const adminRoutePresentations: Record<AdminTab, AdminRoutePresentation> = {
  data: { icon: BarChart3, render: () => <AdminDashboard /> },
  banners: { icon: Images, render: () => <BannerManagement /> },
  users: { icon: Users, render: ({ isSuperAdmin }) => <UserManagement isSuperAdmin={isSuperAdmin} /> },
  vip: { icon: Crown, render: () => <VipManagement /> },
  entitlements: { icon: ShieldCheck, render: () => <EntitlementManagement /> },
  soups: { icon: Soup, render: ({ isSuperAdmin }) => <SoupManagement canDelete={isSuperAdmin} /> },
  mysteries: { icon: BookOpenCheck, render: () => <MysteryManagement /> },
  evaluations: { icon: MessageSquare, render: () => <EvaluationManagement /> },
  gifts: { icon: Gift, render: () => <GiftManagement /> },
  badges: { icon: Award, render: () => <BadgeManagement /> },
  approvals: { icon: ClipboardCheck, render: ({ isSuperAdmin, refreshModuleUnread }) => <ApprovalManagement canReviewExcellentAuthor={isSuperAdmin} onPendingChange={refreshModuleUnread} /> },
  "online-soup": { icon: Radio, render: () => <OnlineSoupRoomManagement /> },
  "ai-host": { icon: Bot, render: () => <AiHostAuditManagement /> },
  circles: { icon: CircleEllipsis, render: () => <CircleManagement /> },
  collectibles: { icon: Gem, render: () => <CollectibleManagement /> },
  assets: { icon: PackageOpen, render: () => <StoreManagement /> },
  notices: { icon: Bell, render: () => <NoticeManagement /> },
  feedback: { icon: MessageSquareText, render: () => <FeedbackManagement /> }
};

export const adminRoutes = adminRouteManifest.map((route) => ({ ...route, ...adminRoutePresentations[route.key] }));
