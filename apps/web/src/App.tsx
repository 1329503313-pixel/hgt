import { Navigate, Routes, Route } from "react-router-dom";
import { X } from "lucide-react";
import { useApp } from "./context/AppContext";
import { AuthModal, ExportPreview } from "./components/AuthModal";
import { SoupEditor } from "./components/SoupEditor";
import { EvalEditor } from "./components/EvalEditor";
import { AchievementUnlockOverlay } from "./components/AchievementUnlockOverlay";
import ErrorBoundary from "./components/ErrorBoundary";
import MainLayout from "./layouts/MainLayout";

import HomePage from "./pages/HomePage";
import DetailPage from "./pages/DetailPage";
import MessagesPage from "./pages/MessagesPage";
import NotificationsPage from "./pages/NotificationsPage";
import RequestsPage from "./pages/RequestsPage";
import NoticesPage from "./pages/NoticesPage";
import NoticeDetailPage from "./pages/NoticeDetailPage";
import MinePage from "./pages/MinePage";
import MySoupsPage from "./pages/MySoupsPage";
import MyFavoritesPage from "./pages/MyFavoritesPage";
import MyEvaluationsPage from "./pages/MyEvaluationsPage";
import MyLikesPage from "./pages/MyLikesPage";
import MyAchievementsPage from "./pages/MyAchievementsPage";
import RankingsPage from "./pages/RankingsPage";
import ExcellentAuthorPage from "./pages/ExcellentAuthorPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  const { toast, showToast, authMode, showSoupForm, showEvalForm, badgeUnlock } = useApp();

  return (
    <div className="app-shell min-h-screen bg-page">
      <ErrorBoundary>
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
        </Route>

        {/* Detail page — independent layout, no BottomNav */}
        <Route path="soup/:id" element={<DetailPage />} />

        {/* Messages / Notifications / Requests / Admin */}
        <Route path="messages" element={<MessagesPage />} />
        <Route path="messages/system" element={<NotificationsPage category="system" />} />
        <Route path="messages/interactions" element={<NotificationsPage category="interactions" />} />
        <Route path="messages/notifications" element={<Navigate to="/messages/system" replace />} />
        <Route path="messages/requests" element={<RequestsPage />} />
        <Route path="messages/notices" element={<NoticesPage />} />
        <Route path="messages/notices/:id" element={<NoticeDetailPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Routes>
      </ErrorBoundary>

      {/* Global toast */}
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-primary shadow-lg">
          {toast}
          <button onClick={() => showToast("")} className="ml-2"><X size={16} /></button>
        </div>
      )}

      {/* Global modals */}
      {authMode && <AuthModal />}
      {showSoupForm && <SoupEditor />}
      {showEvalForm && <EvalEditor />}
      <ExportPreview />
      {badgeUnlock && <AchievementUnlockOverlay key={badgeUnlock.key} />}
    </div>
  );
}
