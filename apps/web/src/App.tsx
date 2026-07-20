import { lazy, Suspense } from "react";
import { Navigate, Routes, Route } from "react-router-dom";
import { X } from "lucide-react";
import { useApp } from "./context/AppContext";
import { IncomingMessageBanner } from "./components/IncomingMessageBanner";
import ErrorBoundary from "./components/ErrorBoundary";
import MainLayout from "./layouts/MainLayout";

const HomePage = lazy(() => import("./pages/HomePage"));
const DetailPage = lazy(() => import("./pages/DetailPage"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const RequestsPage = lazy(() => import("./pages/RequestsPage"));
const NoticesPage = lazy(() => import("./pages/NoticesPage"));
const NoticeDetailPage = lazy(() => import("./pages/NoticeDetailPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const MinePage = lazy(() => import("./pages/MinePage"));
const MySoupsPage = lazy(() => import("./pages/MySoupsPage"));
const MyFavoritesPage = lazy(() => import("./pages/MyFavoritesPage"));
const MyEvaluationsPage = lazy(() => import("./pages/MyEvaluationsPage"));
const MyLikesPage = lazy(() => import("./pages/MyLikesPage"));
const MyAchievementsPage = lazy(() => import("./pages/MyAchievementsPage"));
const RankingsPage = lazy(() => import("./pages/RankingsPage"));
const ShellTaskCenterPage = lazy(() => import("./pages/ShellTaskCenterPage"));
const ShellTransactionsPage = lazy(() => import("./pages/ShellTransactionsPage"));
const ExcellentAuthorPage = lazy(() => import("./pages/ExcellentAuthorPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const UserProfilePage = lazy(() => import("./pages/UserProfilePage"));
const UserFollowsPage = lazy(() => import("./pages/UserFollowsPage"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage"));
const OnlineSoupLobbyPage = lazy(() => import("./pages/OnlineSoupLobbyPage"));
const OnlineSoupRoomPage = lazy(() => import("./pages/OnlineSoupRoomPage"));
const OnlineSoupSelectPage = lazy(() => import("./pages/OnlineSoupSelectPage"));
const CirclesPage = lazy(() => import("./pages/CirclesPage"));
const CircleChatPage = lazy(() => import("./pages/CircleChatPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AchievementUnlockOverlay = lazy(() => import("./components/AchievementUnlockOverlay").then((module) => ({ default: module.AchievementUnlockOverlay })));
const AuthModal = lazy(() => import("./components/AuthModal").then((module) => ({ default: module.AuthModal })));
const ExportPreview = lazy(() => import("./components/AuthModal").then((module) => ({ default: module.ExportPreview })));
const SoupEditor = lazy(() => import("./components/SoupEditor").then((module) => ({ default: module.SoupEditor })));
const EvalEditor = lazy(() => import("./components/EvalEditor").then((module) => ({ default: module.EvalEditor })));

function RouteFallback() {
  return <div className="mx-auto mt-24 h-28 max-w-3xl animate-pulse rounded-2xl bg-slate-200/70" aria-label="页面加载中" />;
}

export default function App() {
  const { toast, showToast, authMode, showSoupForm, showEvalForm, exportReady, badgeUnlock } = useApp();

  return (
    <div className="app-shell min-h-screen bg-page">
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
        {/* Main layout group — BottomNav visible */}
        <Route element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="mine" element={<MinePage />} />
          <Route path="mine/soups" element={<MySoupsPage />} />
          <Route path="mine/favorites" element={<MyFavoritesPage />} />
          <Route path="mine/evaluations" element={<MyEvaluationsPage />} />
          <Route path="mine/likes" element={<MyLikesPage />} />
          <Route path="mine/achievements" element={<MyAchievementsPage />} />
          <Route path="mine/excellent-author" element={<ExcellentAuthorPage />} />
          <Route path="mine/rankings" element={<RankingsPage />} />
          <Route path="mine/tasks" element={<ShellTaskCenterPage />} />
          <Route path="mine/shells/transactions" element={<ShellTransactionsPage />} />
          <Route path="mine/settings" element={<AccountSettingsPage />} />
          <Route path="mine/settings/password" element={<ResetPasswordPage />} />
          <Route path="online-soup" element={<OnlineSoupLobbyPage />} />
          <Route path="circles" element={<CirclesPage />} />
        </Route>

        {/* Detail page — independent layout, no BottomNav */}
        <Route path="soup/:id" element={<DetailPage />} />
        <Route path="online-soup/rooms/:roomId" element={<OnlineSoupRoomPage />} />
        <Route path="online-soup/rooms/:roomId/select-soup" element={<OnlineSoupSelectPage />} />
        <Route path="circles/:circleId" element={<CircleChatPage />} />

        {/* Messages / Notifications / Requests / Admin */}
        <Route path="messages" element={<MessagesPage />} />
        <Route path="messages/system" element={<NotificationsPage category="system" />} />
        <Route path="messages/interactions" element={<NotificationsPage category="interactions" />} />
        <Route path="messages/notifications" element={<Navigate to="/messages/system" replace />} />
        <Route path="messages/requests" element={<RequestsPage />} />
        <Route path="messages/notices" element={<NoticesPage />} />
        <Route path="messages/notices/:id" element={<NoticeDetailPage />} />
        <Route path="messages/chat/:id" element={<ChatPage />} />
        <Route path="users/:id" element={<UserProfilePage />} />
        <Route path="users/:id/following" element={<UserFollowsPage type="following" />} />
        <Route path="users/:id/followers" element={<UserFollowsPage type="followers" />} />
        <Route path="admin" element={<AdminPage />} />
      </Routes>
        </Suspense>
      </ErrorBoundary>

      <IncomingMessageBanner />

      {/* Global toast */}
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-primary shadow-lg">
          {toast}
          <button onClick={() => showToast("")} className="ml-2"><X size={16} /></button>
        </div>
      )}

      {/* Global modals */}
      <Suspense fallback={null}>
        {authMode && <AuthModal />}
        {showSoupForm && <SoupEditor />}
        {showEvalForm && <EvalEditor />}
        {exportReady && <ExportPreview />}
      </Suspense>
      {badgeUnlock && <Suspense fallback={null}><AchievementUnlockOverlay key={badgeUnlock.key} /></Suspense>}
    </div>
  );
}
