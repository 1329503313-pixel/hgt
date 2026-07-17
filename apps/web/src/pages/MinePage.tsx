import { useEffect, useState } from "react";
import { ArrowLeft, Award, Check, ChevronLeft, ChevronRight, Medal, Plus, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, SoupsResponse } from "../api";
import { useApp } from "../context/AppContext";
import type { EquippedBadge, SocialProfile, SoupSummary } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { Modal } from "../components/Modal";
import { EquippedBadgeIcon, LegendaryBadge, LegendaryBadgeIcon } from "../components/BadgeVisuals";
import { BADGES, getBadgeKey } from "./MyAchievementsPage";
import { ProfileHero, SoupCoverGrid } from "../components/ProfileViews";
import { CoverGridSkeleton, ProfileSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";
import { MINE_CONTENT_CACHE_MAX_AGE, mineCountsCacheKey, mineListCacheKey, type MineContentCounts, type MineContentTab, type MineContentTabData } from "../shared/mineContentCache";
import { SoupExportButton } from "../components/SoupExportButton";

type BadgeCollectionResponse = { badgeKeys: string[]; legendaryBadges: LegendaryBadge[]; equippedBadge: EquippedBadge | null };
type TabKey = MineContentTab;
type TabData = MineContentTabData;
type TabCounts = MineContentCounts;

const emptyTab = (): TabData => ({ soups: [], total: 0, hasMore: false, loaded: false, loading: false });
const profileCacheKey = (userId: string) => `hgt:mine:profile:${userId}`;
const listEndpoints: Record<TabKey, string> = { published: "/api/me/soups", favorites: "/api/me/favorites", likes: "/api/me/likes" };
const tabLabels: Record<TabKey, string> = { published: "发布", favorites: "收藏", likes: "点赞" };
const pageSize = 10;

function paginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export default function MinePage() {
  const { user, loadingUser, openAuth, showToast, setUser } = useApp();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [tabs, setTabs] = useState<Record<TabKey, TabData>>({ published: emptyTab(), favorites: emptyTab(), likes: emptyTab() });
  const [countsReady, setCountsReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("published");
  const [pages, setPages] = useState<Record<TabKey, number>>({ published: 1, favorites: 1, likes: 1 });
  const [badgePickerOpen, setBadgePickerOpen] = useState(false);
  const [badgeCollection, setBadgeCollection] = useState<BadgeCollectionResponse | null>(null);
  const [badgeSaving, setBadgeSaving] = useState(false);

  async function loadProfile(userId: string) {
    const data = await api<{ profile: SocialProfile }>(`/api/users/${userId}/profile?includeSoups=false`);
    setProfile(data.profile);
    writeSessionCache(profileCacheKey(userId), data.profile);
  }

  async function loadCounts(userId: string) {
    const counts = await api<TabCounts>("/api/me/content-counts");
    setTabs((state) => ({
      published: { ...state.published, total: counts.published },
      favorites: { ...state.favorites, total: counts.favorites },
      likes: { ...state.likes, total: counts.likes }
    }));
    setCountsReady(true);
    writeSessionCache(mineCountsCacheKey(userId), counts);
  }

  async function loadTab(tab: TabKey, page = 1) {
    if (!user) return;
    const current = tabs[tab];
    if (current.loading) return;
    const offset = (page - 1) * pageSize;
    setTabs((state) => ({ ...state, [tab]: { ...state[tab], loading: true } }));
    try {
      const data = await api<SoupsResponse>(`${listEndpoints[tab]}?offset=${offset}`);
      setTabs((state) => {
        const next: TabData = {
          soups: data.soups,
          total: data.total,
          hasMore: data.hasMore,
          loaded: true,
          loading: false
        };
        if (page === 1) writeSessionCache(mineListCacheKey(user.id, tab), next);
        return { ...state, [tab]: next };
      });
    } catch (error) {
      setTabs((state) => ({ ...state, [tab]: { ...state[tab], loaded: true, loading: false } }));
      showToast((error as Error).message);
    }
  }

  useEffect(() => {
    if (!user) { setProfile(null); setTabs({ published: emptyTab(), favorites: emptyTab(), likes: emptyTab() }); setPages({ published: 1, favorites: 1, likes: 1 }); setCountsReady(false); return; }
    const cachedProfile = readSessionCache<SocialProfile>(profileCacheKey(user.id), 5 * 60_000);
    const cachedCounts = readSessionCache<TabCounts>(mineCountsCacheKey(user.id), MINE_CONTENT_CACHE_MAX_AGE);
    const cachedPublished = readSessionCache<TabData>(mineListCacheKey(user.id, "published"), MINE_CONTENT_CACHE_MAX_AGE);
    if (cachedProfile) setProfile(cachedProfile);
    if (cachedCounts) {
      setTabs((state) => ({
        published: { ...state.published, total: cachedCounts.published },
        favorites: { ...state.favorites, total: cachedCounts.favorites },
        likes: { ...state.likes, total: cachedCounts.likes }
      }));
      setCountsReady(true);
    } else {
      setCountsReady(false);
    }
    void loadProfile(user.id).catch((error) => { if (!cachedProfile) showToast((error as Error).message); });
    void loadCounts(user.id).catch((error) => { if (!cachedCounts) showToast((error as Error).message); });
    if (cachedPublished) setTabs((state) => ({ ...state, published: { ...cachedPublished, loading: false } }));
    setPages({ published: 1, favorites: 1, likes: 1 });
    void loadTab("published", 1);
  }, [user?.id]);

  useEffect(() => {
    if (activeTab === "published" || !user || tabs[activeTab].loaded || tabs[activeTab].loading) return;
    const cached = readSessionCache<TabData>(mineListCacheKey(user.id, activeTab), MINE_CONTENT_CACHE_MAX_AGE);
    if (cached) setTabs((state) => ({ ...state, [activeTab]: { ...cached, loading: false } }));
    void loadTab(activeTab, pages[activeTab]);
  }, [activeTab, user?.id, tabs[activeTab].loaded, tabs[activeTab].loading]);

  useEffect(() => {
    if (!user) return;
    const handleCacheUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; tab: TabKey; counts: TabCounts; tabData: TabData }>).detail;
      if (!detail || detail.userId !== user.id) return;
      setCountsReady(true);
      setTabs((state) => ({
        published: { ...state.published, total: detail.counts.published, ...(detail.tab === "published" && pages.published === 1 ? detail.tabData : {}) },
        favorites: { ...state.favorites, total: detail.counts.favorites, ...(detail.tab === "favorites" && pages.favorites === 1 ? detail.tabData : {}) },
        likes: { ...state.likes, total: detail.counts.likes, ...(detail.tab === "likes" && pages.likes === 1 ? detail.tabData : {}) }
      }));
    };
    window.addEventListener("hgt:mine-content-cache-updated", handleCacheUpdate);
    return () => window.removeEventListener("hgt:mine-content-cache-updated", handleCacheUpdate);
  }, [user?.id, pages]);

  function changePage(tab: TabKey, page: number) {
    const totalPages = Math.max(1, Math.ceil(tabs[tab].total / pageSize));
    const nextPage = Math.min(totalPages, Math.max(1, page));
    if (nextPage === pages[tab] || tabs[tab].loading) return;
    setPages((state) => ({ ...state, [tab]: nextPage }));
    void loadTab(tab, nextPage);
  }

  if (loadingUser) return <section><PageTopBar title="我的" /><ProfileSkeleton /></section>;
  if (!user) return <section><PageTopBar title="我的" /><div className="card p-6 text-center"><p className="text-sm text-muted">登录后查看个人主页</p><button className="btn btn-primary mt-4 w-full" onClick={openAuth}>登录</button></div></section>;
  if (!profile) return <section><PageTopBar title="我的" /><ProfileSkeleton /></section>;

  async function openBadges() {
    setBadgePickerOpen(true);
    try { setBadgeCollection(await api<BadgeCollectionResponse>("/api/me/badge-collection")); }
    catch (error) { showToast((error as Error).message); setBadgePickerOpen(false); }
  }

  async function equipBadge(badgeKey: string) {
    if (badgeSaving) return;
    setBadgeSaving(true);
    try {
      const badgeKeyValue = user!.equippedBadge?.key === badgeKey ? null : badgeKey;
      const data = await api<{ equippedBadge: EquippedBadge | null }>("/api/me/equipped-badge", { method: "PATCH", body: { badgeKey: badgeKeyValue } });
      setUser({ ...user!, equippedBadge: data.equippedBadge });
      setProfile((current) => {
        if (!current) return current;
        const next = { ...current, equippedBadge: data.equippedBadge };
        writeSessionCache(profileCacheKey(user!.id), next);
        return next;
      });
      showToast(data.equippedBadge ? "徽章已装配" : "徽章已卸下");
    } catch (error) { showToast((error as Error).message); } finally { setBadgeSaving(false); }
  }

  const features = [
    { label: "优秀作者", icon: Award, color: "bg-amber-100 text-amber-600", path: "/mine/excellent-author" },
    { label: "我的成就", icon: Trophy, color: "bg-violet-100 text-violet-600", path: "/mine/achievements" },
    { label: "排行榜", icon: Medal, color: "bg-orange-100 text-orange-600", path: "/mine/rankings" }
  ];

  return (
    <section className="space-y-3">
      <PageTopBar title="我的" />
      <ProfileHero profile={profile} showBadge={false} onFollowing={() => navigate(`/users/${user.id}/following`)} onFollowers={() => navigate(`/users/${user.id}/followers`)} onAvatar={() => navigate("/mine/settings")} actions={
        <button className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl border border-white/60 bg-white/20" onClick={openBadges} title="装配徽章">
          {profile.equippedBadge ? <EquippedBadgeIcon badge={profile.equippedBadge} className="h-full w-full rounded-xl" title={profile.equippedBadge.name} animated showName={false} /> : <Plus size={22} />}
        </button>
      } />

      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white px-2 py-4 shadow-soft">
        {features.map((feature) => { const Icon = feature.icon; return (
          <button key={feature.path} className="flex flex-col items-center gap-2" onClick={() => navigate(feature.path)}>
            <span className={`grid h-12 w-12 place-items-center rounded-2xl ${feature.color}`}><Icon size={23} /></span>
            <span className="text-xs font-bold text-ink">{feature.label}</span>
          </button>
        ); })}
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
        <div className="grid grid-cols-3 border-b border-line">
          {([['published', '发布'], ['favorites', '收藏'], ['likes', '点赞']] as const).map(([key, label]) => (
            <button key={key} className={`relative py-3.5 text-sm font-bold ${activeTab === key ? "text-ink" : "text-muted"}`} onClick={() => setActiveTab(key)}>
              {label} {countsReady || tabs[key].loaded ? <span className="ml-1 text-xs">{tabs[key].total}</span> : <span className="ml-1 inline-block h-3 w-4 animate-pulse rounded bg-slate-200 align-middle" />}
              {activeTab === key && <span className="absolute inset-x-7 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
        {tabs[activeTab].loading && !tabs[activeTab].loaded ? <CoverGridSkeleton /> : <>
          <SoupCoverGrid soups={tabs[activeTab].soups} emptyHint={activeTab === "published" ? "还没有发布作品" : activeTab === "favorites" ? "还没有收藏作品" : "还没有点赞作品"} />
          {tabs[activeTab].total > pageSize && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-line p-3">
              <button className="btn btn-secondary h-9 px-2.5 text-xs" disabled={pages[activeTab] <= 1 || tabs[activeTab].loading} onClick={() => changePage(activeTab, pages[activeTab] - 1)}><ChevronLeft size={15} />上一页</button>
              {paginationItems(pages[activeTab], Math.ceil(tabs[activeTab].total / pageSize)).map((item, index) => item === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="grid h-9 w-7 place-items-center text-sm text-muted">…</span>
              ) : (
                <button key={item} className={`grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold ${item === pages[activeTab] ? "bg-primary text-white" : "border border-line bg-white text-ink"}`} disabled={tabs[activeTab].loading} onClick={() => changePage(activeTab, item)}>{item}</button>
              ))}
              <button className="btn btn-secondary h-9 px-2.5 text-xs" disabled={pages[activeTab] >= Math.ceil(tabs[activeTab].total / pageSize) || tabs[activeTab].loading} onClick={() => changePage(activeTab, pages[activeTab] + 1)}>下一页<ChevronRight size={15} /></button>
            </div>
          )}
        </>}
      </div>

      <SoupExportButton
        soups={tabs[activeTab].soups}
        title={`我的${tabLabels[activeTab]} · 第 ${pages[activeTab]} 页`}
        fileName={`我的${tabLabels[activeTab]}-第${pages[activeTab]}页.png`}
        confirmText={`是否导出${tabLabels[activeTab]}栏当前页的 ${tabs[activeTab].soups.length} 条海龟汤列表？`}
        disabled={tabs[activeTab].loading}
      />

      {badgePickerOpen && <Modal full onClose={() => setBadgePickerOpen(false)}>
        <div className="flex items-center gap-3">
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink hover:bg-slate-100" onClick={() => setBadgePickerOpen(false)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
          <div><h2 className="text-lg font-black text-ink">装配徽章</h2><p className="mt-1 text-sm text-muted">点击装配，再次点击当前徽章即可卸下</p></div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {BADGES.filter((badge) => badgeCollection?.badgeKeys.includes(getBadgeKey(badge))).map((badge) => { const key = getBadgeKey(badge); const selected = profile.equippedBadge?.key === key; return (
            <button key={key} onClick={() => void equipBadge(key)} className={`relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border p-3 ${selected ? "border-primary bg-blue-50" : "border-line"}`}><span className="h-14 w-14 overflow-hidden rounded-xl">{badge.icon}</span><span className="text-xs font-bold text-ink">{badge.label}</span>{selected && <Check className="absolute right-2 top-2 text-primary" size={16} />}</button>
          ); })}
          {(badgeCollection?.legendaryBadges ?? []).map((badge) => { const selected = profile.equippedBadge?.key === badge.key; return (
            <button key={badge.key} onClick={() => void equipBadge(badge.key)} className={`relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border p-3 ${selected ? "border-fuchsia-300 bg-fuchsia-50" : "border-line"}`}><LegendaryBadgeIcon badge={badge} className="h-14 w-14" /><span className="text-xs font-bold text-ink">{badge.name}</span>{selected && <Check className="absolute right-2 top-2 text-primary" size={16} />}</button>
          ); })}
        </div>
      </Modal>}
    </section>
  );
}
