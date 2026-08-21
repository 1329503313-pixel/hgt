import { lazy, Suspense } from "react";
import { Navigate, Routes, Route } from "react-router-dom";
import { useApp } from "./context/AppContext";
import { IncomingMessageBanner } from "./components/IncomingMessageBanner";
import ErrorBoundary from "./components/ErrorBoundary";
import MainLayout from "./layouts/MainLayout";
import ContentNavLayout from "./layouts/ContentNavLayout";
import { RouteScrollManager } from "./components/RouteScrollManager";
import { GlobalNoticeModal } from "./components/GlobalNoticeModal";
import { VipOnlineBanner } from "./components/VipOnlineBanner";

const HomePage = lazy(() => import("./pages/HomePage"));
const DetailPage = lazy(() => import("./pages/DetailPage"));
const SoupEvaluationsPage = lazy(() => import("./pages/SoupEvaluationsPage"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const RequestsPage = lazy(() => import("./pages/RequestsPage"));
const NoticesPage = lazy(() => import("./pages/NoticesPage"));
const NoticeDetailPage = lazy(() => import("./pages/NoticeDetailPage"));
const RankingRewardDetailPage = lazy(() => import("./pages/RankingRewardDetailPage"));
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
const AssetStorePage = lazy(() => import("./pages/AssetStorePage"));
const StickerStorePage = lazy(() => import("./pages/StickerStorePage"));
const AssetPackPage = lazy(() => import("./pages/AssetPackPage"));
const CollectionPage = lazy(() => import("./pages/CollectionPage"));
const MyCollectiblesPage = lazy(() => import("./pages/MyCollectiblesPage"));
const MyCollectibleDetailPage = lazy(() => import("./pages/MyCollectibleDetailPage"));
const CollectibleAuctionsPage = lazy(() => import("./pages/CollectibleAuctionsPage"));
const CollectibleAuctionDetailPage = lazy(() => import("./pages/CollectibleAuctionDetailPage"));
const CardCabinetPage = lazy(() => import("./pages/CardCabinetPage"));
const AssetDrawHistoryPage = lazy(() => import("./pages/AssetDrawHistoryPage"));
const ExcellentAuthorPage = lazy(() => import("./pages/ExcellentAuthorPage"));
const UserProfilePage = lazy(() => import("./pages/UserProfilePage"));
const UserFollowsPage = lazy(() => import("./pages/UserFollowsPage"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage"));
const MyInvitationsPage = lazy(() => import("./pages/MyInvitationsPage"));
const OnlineSoupLobbyPage = lazy(() => import("./pages/OnlineSoupLobbyPage"));
const OnlineSoupRoomPage = lazy(() => import("./pages/OnlineSoupRoomPage"));
const OnlineSoupSelectPage = lazy(() => import("./pages/OnlineSoupSelectPage"));
const CirclesPage = lazy(() => import("./pages/CirclesPage"));
const CircleChatPage = lazy(() => import("./pages/CircleChatPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ProfileBackgroundsPage = lazy(() => import("./pages/ProfileBackgroundsPage"));
const SiteContentPage = lazy(() => import("./pages/SiteContentPage"));
const AchievementUnlockOverlay = lazy(() => import("./components/AchievementUnlockOverlay").then((module) => ({ default: module.AchievementUnlockOverlay })));
const AuthModal = lazy(() => import("./components/AuthModal").then((module) => ({ default: module.AuthModal })));
const ExportPreview = lazy(() => import("./components/AuthModal").then((module) => ({ default: module.ExportPreview })));
const SoupEditor = lazy(() => import("./components/SoupEditor").then((module) => ({ default: module.SoupEditor })));
const EvalEditor = lazy(() => import("./components/EvalEditor").then((module) => ({ default: module.EvalEditor })));

function RouteFallback() {
  return <div className="mx-auto mt-24 h-28 max-w-3xl animate-pulse rounded-2xl bg-slate-200/70" aria-label="页面加载中" />;
}

export default function UserApp() {
  const { authMode, showSoupForm, showEvalForm, exportReady, badgeUnlock } = useApp();

  return (
    <div className="app-shell min-h-screen bg-page">
      <RouteScrollManager />
      <VipOnlineBanner />
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<MainLayout />}>
              <Route index element={<HomePage key="home-recommended-root" category="recommended" />} />
              <Route path="home/recommended" element={<HomePage key="home-recommended" category="recommended" />} />
              <Route path="home/latest" element={<HomePage key="home-latest" category="latest" />} />
              <Route path="home/following" element={<HomePage key="home-following" category="following" />} />
              <Route path="home/ai" element={<HomePage key="home-ai" category="ai" />} />
              <Route path="home/played" element={<HomePage key="home-played" category="played" />} />
              <Route path="home/mystery" element={<HomePage key="home-mystery" category="mystery" />} />
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
              <Route path="mine/store" element={<AssetStorePage />} />
              <Route path="mine/store/cards" element={<AssetStorePage />} />
              <Route path="mine/store/stickers" element={<StickerStorePage />} />
              <Route path="mine/store/auctions" element={<CollectibleAuctionsPage />} />
              <Route path="mine/store/auctions/:id" element={<CollectibleAuctionDetailPage />} />
              <Route path="mine/collection" element={<CollectionPage />} />
              <Route path="mine/collectibles" element={<MyCollectiblesPage />} />
              <Route path="mine/collectibles/:id" element={<MyCollectibleDetailPage />} />
              <Route path="mine/cards" element={<CardCabinetPage />} />
              <Route path="mine/asset-draw-history" element={<AssetDrawHistoryPage />} />
              <Route path="mine/settings" element={<AccountSettingsPage />} />
              <Route path="mine/settings/invitations" element={<MyInvitationsPage />} />
              <Route path="mine/settings/password" element={<ResetPasswordPage />} />
              <Route path="mine/settings/backgrounds" element={<ProfileBackgroundsPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="reset-password" element={<ForgotPasswordPage />} />
              <Route path="online-soup" element={<OnlineSoupLobbyPage />} />
              <Route path="circles" element={<CirclesPage />} />
              <Route path="mine/store/cards/:packId" element={<AssetPackPage />} />
              <Route path="mine/store/:packId" element={<AssetPackPage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="messages/system" element={<NotificationsPage category="system" />} />
              <Route path="messages/interactions" element={<NotificationsPage category="interactions" />} />
              <Route path="messages/notifications" element={<Navigate to="/messages/system" replace />} />
              <Route path="messages/requests" element={<RequestsPage />} />
              <Route path="messages/notices" element={<NoticesPage />} />
              <Route path="messages/notices/:id" element={<NoticeDetailPage />} />
              <Route path="messages/ranking-rewards/:settlementId" element={<RankingRewardDetailPage />} />
            </Route>

            <Route element={<ContentNavLayout />}>
              <Route path="soup/:id" element={<DetailPage />} />
              <Route path="soup/:id/evaluations" element={<SoupEvaluationsPage />} />
              <Route path="users/:id" element={<UserProfilePage />} />
              <Route path="users/:id/following" element={<UserFollowsPage type="following" />} />
              <Route path="users/:id/followers" element={<UserFollowsPage type="followers" />} />
            </Route>

            <Route path="online-soup/rooms/:roomId" element={<OnlineSoupRoomPage />} />
            <Route path="online-soup/rooms/:roomId/select-soup" element={<OnlineSoupSelectPage />} />
            <Route path="circles/:circleId" element={<CircleChatPage />} />
            <Route path="messages/chat/:id" element={<ChatPage />} />
            <Route path="site/:slug" element={<SiteContentPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>

      <IncomingMessageBanner />
      <GlobalNoticeModal />

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
