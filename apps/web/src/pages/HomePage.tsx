import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import { Award, Bell, BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleEllipsis, FileText, GalleryVerticalEnd, Home, ListChecks, LoaderCircle, LogOut, MessageCircleQuestion, Plus, RotateCcw, Search, Settings, Shell, Shield, ShoppingBag, SlidersHorizontal, Trophy, UserRound } from "lucide-react";
import type { PublicUser, SoupSummary } from "../shared/types";
import { api, SoupsResponse } from "../api";
import { useApp, soupDifficulties, soupTypes } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { MasonryList } from "../components/MasonryList";
import { HomeBannerCarousel } from "../components/HomeBannerCarousel";
import { CoverGridSkeleton, SoupCardSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";
import { LevelBadge } from "../components/LevelBadge";
import { VipIdentity } from "../components/VipIdentity";
import { useMessageUnread } from "../shared/useMessageUnread";
import { desktopNavigationBannerUrl } from "../shared/staticAssets";
import { useDesktopHeroParallax } from "../shared/useDesktopHeroParallax";
import { useShellBalance } from "../shared/useShellBalance";
import { canAccessAdmin } from "../shared/roles";
import { DesktopAppDownload } from "../components/DesktopAppDownload";
import { DesktopGlobalSearch } from "../components/DesktopGlobalSearch";
import { useDismissibleDetails } from "../shared/useDismissibleDetails";
import { homeCategoryRoutes, type HomeCategory } from "../shared/homeRoutes";
import { Modal } from "../components/Modal";

type HomeCacheData = Pick<SoupsResponse, "soups" | "total" | "hasMore">;
type SearchUser = Pick<PublicUser, "id" | "nickname" | "avatar" | "level" | "equippedBadge" | "vipLevel" | "vipActive" | "vipGrowthValue">;
type UserSearchResponse = { users: SearchUser[]; total: number };
type HomeFilters = {
  keyword: string;
  type: string;
  difficulty: string;
  minRating: string;
  bottomPublic: string;
  aiGame: string;
};
type HomeRouteState = { homeFilters?: HomeFilters; homeSearchKeyword?: string };
type HomeViewSnapshot = HomeCacheData & {
  isDesktop: boolean;
  currentPage: number;
  offset: number;
  randomSeed: string;
  filters: HomeFilters;
  searchKeyword: string;
  matchedUsers: SearchUser[];
  usersExpanded: boolean;
  filtersOpen: boolean;
  scrollY: number;
};
const mobilePageSize = 10;
const desktopFirstPageSize = 6;
const desktopPageSize = 8;
const homeCategoryTabs: Array<{ key: HomeCategory; label: string; requiresAuth?: boolean }> = [
  { key: "recommended", label: "推荐" },
  { key: "latest", label: "最新" },
  { key: "following", label: "关注", requiresAuth: true },
  { key: "ai", label: "AI" },
  { key: "played", label: "玩过", requiresAuth: true },
  { key: "mystery", label: "谜局", requiresAuth: true }
];

type MysterySummary = {
  id: string;
  title: string;
  coverUrl: string | null;
  tags: string[];
  saveStatus: string | null;
  canContinue: boolean;
};

function MysteryCatalog({ keyword, onOpen }: { keyword: string; onOpen: (mystery: MysterySummary, choice: "continue" | "restart") => void }) {
  const { showToast } = useApp();
  const [items, setItems] = useState<MysterySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<MysterySummary | null>(null);

  const load = useCallback(async (append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const offset = append ? nextOffset ?? items.length : 0;
      const params = new URLSearchParams({ limit: "24", offset: String(offset) });
      if (keyword.trim()) params.set("q", keyword.trim());
      const data = await api<{ mysteries: MysterySummary[]; hasMore: boolean; nextOffset: number | null }>(`/api/mysteries?${params.toString()}`, { bypassCache: true });
      setItems((current) => append ? [...current, ...data.mysteries] : data.mysteries);
      setHasMore(data.hasMore);
      setNextOffset(data.nextOffset);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "谜局列表加载失败");
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [items.length, keyword, nextOffset, showToast]);

  useEffect(() => { void load(false); }, [keyword]);

  return (
    <section className="space-y-4" aria-label="谜局列表">
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-white"><BookOpen size={22} /></span>
          <div><h2 className="text-base font-black text-ink">谜局——AI故事推理挑战</h2><p className="mt-1 text-sm leading-6 text-muted">进入一段架空的故事，自由的做出你的选择，你所做的一切选择和言行都会影响最终的结局。</p></div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="谜局加载中">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="aspect-[4/5] animate-pulse rounded-2xl bg-slate-200/70" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card py-12 text-center"><BookOpen className="mx-auto text-slate-300" size={38} /><p className="mt-3 text-sm font-bold text-muted">{keyword ? "没有找到匹配的谜局" : "暂无已上架的谜局"}</p></div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((mystery) => (
            <button key={mystery.id} type="button" className="group overflow-hidden rounded-2xl border border-line bg-white text-left shadow-soft transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setSelected(mystery)}>
              <span className="relative block aspect-[4/3] overflow-hidden bg-slate-100">
                {mystery.coverUrl ? <img src={mystery.coverUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <span className="grid h-full place-items-center text-slate-300"><BookOpen size={34} /></span>}
                {mystery.canContinue && <span className="absolute right-2 top-2 rounded-full bg-slate-950/75 px-2 py-1 text-[11px] font-black text-white">有存档</span>}
              </span>
              <span className="block p-3 sm:p-4">
                <strong className="line-clamp-2 text-sm font-black leading-5 text-ink sm:text-base">{mystery.title}</strong>
                <span className="mt-2 flex min-h-6 flex-wrap gap-1.5">{mystery.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-primary">{tag}</span>)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {hasMore && <button type="button" className="btn btn-secondary mx-auto min-h-11" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? <LoaderCircle size={16} className="animate-spin" /> : null}{loadingMore ? "加载中…" : "加载更多"}</button>}

      {selected && <Modal onClose={() => setSelected(null)}>
        <div className="space-y-4">
          <div><p className="text-xs font-black tracking-[.12em] text-primary">进入谜局</p><h2 className="mt-1 text-xl font-black text-ink">{selected.title}</h2><p className="mt-2 text-sm leading-6 text-muted">将创建一个在线玩汤房间。进程绑定你这位房主，正式行动也只能由你提交。</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="btn btn-primary min-h-12" disabled={!selected.canContinue} onClick={() => onOpen(selected, "continue")}>继续游戏</button>
            <button type="button" className="btn btn-secondary min-h-12" onClick={() => onOpen(selected, "restart")}>{selected.canContinue ? "重新开始" : "开始新游戏"}</button>
          </div>
          {!selected.canContinue && <p className="text-xs text-muted">当前没有可继续的存档，将从故事开头开始。</p>}
        </div>
      </Modal>}
    </section>
  );
}

function paginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

function createHomeRandomSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function homeViewCacheKey(userId: string | undefined, url: string) {
  return `hgt:home:view:v1:${userId ?? "guest"}:${url}`;
}

export default function HomePage({ category: homeCategory = "recommended" }: { category?: HomeCategory }) {
  const { user, loadingUser, refreshKey, setExportReady, openAuth, openSoupEditor, setUser, showToast, triggerRefresh } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const routedSearchKeyword = searchParams.get("search")?.trim() ?? "";
  const initialIsDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const currentHomeUrl = `${location.pathname}${location.search}`;
  const viewCacheKey = homeViewCacheKey(user?.id, currentHomeUrl);
  const routeState = location.state as HomeRouteState | null;
  const [restoredSnapshot] = useState<HomeViewSnapshot | null>(() => {
    if (navigationType !== "POP") return null;
    const snapshot = readSessionCache<HomeViewSnapshot>(viewCacheKey, 30 * 60_000);
    return snapshot?.isDesktop === initialIsDesktop ? snapshot : null;
  });
  const initialFilters: HomeFilters = {
    keyword: routedSearchKeyword,
    type: restoredSnapshot?.filters.type ?? routeState?.homeFilters?.type ?? "",
    difficulty: restoredSnapshot?.filters.difficulty ?? routeState?.homeFilters?.difficulty ?? "",
    minRating: restoredSnapshot?.filters.minRating ?? routeState?.homeFilters?.minRating ?? "all",
    bottomPublic: restoredSnapshot?.filters.bottomPublic ?? routeState?.homeFilters?.bottomPublic ?? "all",
    aiGame: restoredSnapshot?.filters.aiGame ?? routeState?.homeFilters?.aiGame ?? "all"
  };
  const unread = useMessageUnread(user?.id, Boolean(user));
  const heroParallax = useDesktopHeroParallax<HTMLDivElement>();
  const shellBalance = useShellBalance(user?.id);
  const userMenuRef = useDismissibleDetails();

  const [soups, setSoups] = useState<SoupSummary[]>(() => restoredSnapshot?.soups ?? []);
  const [total, setTotal] = useState(() => restoredSnapshot?.total ?? 0);
  const [hasMore, setHasMore] = useState(() => restoredSnapshot?.hasMore ?? true);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => restoredSnapshot?.currentPage ?? 1);
  const [isDesktop, setIsDesktop] = useState(initialIsDesktop);
  const loadingRef = useRef(false);
  const offsetRef = useRef(restoredSnapshot?.offset ?? restoredSnapshot?.soups.length ?? 0);
  const previousRefreshKeyRef = useRef(refreshKey);
  const previousFiltersRef = useRef("");
  const skipInitialLoadRef = useRef(Boolean(restoredSnapshot));
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const randomSeedRef = useRef(restoredSnapshot?.randomSeed ?? createHomeRandomSeed());
  const loadRequestRef = useRef(0);
  const [matchedUsers, setMatchedUsers] = useState<SearchUser[]>(() => restoredSnapshot?.matchedUsers ?? []);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersExpanded, setUsersExpanded] = useState(() => restoredSnapshot?.usersExpanded ?? false);
  const userSearchRequestRef = useRef(0);
  const skipInitialUserSearchRef = useRef(Boolean(restoredSnapshot && initialFilters.keyword));
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [categoryRefreshKey, setCategoryRefreshKey] = useState(0);

  const [filters, setFilters] = useState<HomeFilters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(() => restoredSnapshot?.filtersOpen ?? false);
  const [searchKeyword, setSearchKeyword] = useState(() => restoredSnapshot?.searchKeyword ?? routeState?.homeSearchKeyword ?? routedSearchKeyword);
  const activeFilterCount = [
    filters.type,
    filters.difficulty,
    filters.minRating !== "all",
    filters.bottomPublic !== "all",
    filters.aiGame !== "all"
  ].filter(Boolean).length;
  const isResultMode = Boolean(filters.keyword) || activeFilterCount > 0;
  const firstDesktopPageSize = isResultMode ? desktopPageSize : desktopFirstPageSize;

  const submitSearch = () => {
    const keyword = searchKeyword.trim();
    setFilters((old) => ({ ...old, keyword }));
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (keyword) next.set("search", keyword);
      else next.delete("search");
      return next;
    }, { replace: true });
  };
  const resetFilters = () => setFilters((old) => ({
    ...old,
    type: "",
    difficulty: "",
    minRating: "all",
    bottomPublic: "all",
    aiGame: "all"
  }));

  const loadSoups = useCallback(
    async (append = false, bypassCache = false, page = currentPage) => {
      if (homeCategory === "mystery") {
        loadingRef.current = false;
        setLoading(false);
        return;
      }
      if (append && loadingRef.current) return;
      if (append && !hasMore) return;
      const requestId = ++loadRequestRef.current;
      loadingRef.current = true;
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== "all") params.set(key, value);
      });
      const pageSize = isDesktop ? (page === 1 ? firstDesktopPageSize : desktopPageSize) : mobilePageSize;
      const pageOffset = isDesktop
        ? page === 1 ? 0 : firstDesktopPageSize + (page - 2) * desktopPageSize
        : append ? offsetRef.current : 0;
      params.set("limit", String(pageSize));
      params.set("offset", String(pageOffset));
      params.set("seed", randomSeedRef.current);
      params.set("category", homeCategory);
      params.set("includeTotal", isDesktop ? "1" : "0");
      if (homeCategory === "recommended" && !filters.keyword && !filters.type && !filters.difficulty && filters.minRating === "all" && filters.bottomPublic === "all" && filters.aiGame === "all") {
        params.set("homeFeatured", "1");
      }
      const cacheKey = `hgt:home:v3:${user?.id ?? "guest"}:${params.toString()}`;
      const cached = append || bypassCache ? null : readSessionCache<HomeCacheData>(cacheKey, 45_000);
      if (cached) {
        setSoups(cached.soups);
        offsetRef.current = cached.soups.length;
        setHasMore(cached.hasMore);
        setTotal(cached.total ?? 0);
      }
      setLoading(append || !cached);
      try {
        const data = await api<SoupsResponse>(`/api/soups?${params.toString()}`, {
          cacheTtlMs: append ? 0 : 30_000,
          bypassCache
        });
        if (requestId !== loadRequestRef.current) return;
        if (append) {
          setSoups((old) => {
            const seen = new Set(old.map((s) => s.id));
            const next = data.soups.filter((s) => !seen.has(s.id));
            offsetRef.current += next.length;
            return [...old, ...next];
          });
        } else {
          setSoups(data.soups);
          offsetRef.current = data.soups.length;
          writeSessionCache(cacheKey, { soups: data.soups, total: data.total, hasMore: data.hasMore } satisfies HomeCacheData);
        }
        setHasMore(data.hasMore);
        setTotal(data.total ?? 0);
      } finally {
        if (requestId === loadRequestRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [currentPage, filters, firstDesktopPageSize, hasMore, homeCategory, isDesktop, user?.id]
  );

  function saveHomeViewSnapshot() {
    writeSessionCache(viewCacheKey, {
      soups,
      total,
      hasMore,
      isDesktop,
      currentPage,
      offset: offsetRef.current,
      randomSeed: randomSeedRef.current,
      filters,
      searchKeyword,
      matchedUsers,
      usersExpanded,
      filtersOpen,
      scrollY: window.scrollY
    } satisfies HomeViewSnapshot);
  }

  const selectHomeCategory = (nextCategory: HomeCategory, requiresAuth = false) => {
    if (requiresAuth && !user) {
      openAuth();
      return;
    }
    if (nextCategory === homeCategory) {
      if (nextCategory !== "ai" && nextCategory !== "played") return;
      randomSeedRef.current = createHomeRandomSeed();
      setCurrentPage(1);
      setSoups([]);
      setTotal(0);
      setHasMore(true);
      offsetRef.current = 0;
      setCategoryRefreshKey((key) => key + 1);
      return;
    }
    saveHomeViewSnapshot();
    navigate(`${homeCategoryRoutes[nextCategory]}${location.search}`, {
      state: { homeFilters: filters, homeSearchKeyword: searchKeyword } satisfies HomeRouteState
    });
  };

  useLayoutEffect(() => {
    if (!restoredSnapshot) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoredSnapshot.scrollY, left: 0, behavior: "auto" });
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: restoredSnapshot.scrollY, left: 0, behavior: "auto" });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [restoredSnapshot]);

  useEffect(() => {
    setSearchKeyword(routedSearchKeyword);
    setFilters((old) => old.keyword === routedSearchKeyword ? old : { ...old, keyword: routedSearchKeyword });
  }, [routedSearchKeyword]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const filterKey = JSON.stringify(filters);
    if (skipInitialLoadRef.current) {
      skipInitialLoadRef.current = false;
      previousFiltersRef.current = filterKey;
      previousRefreshKeyRef.current = refreshKey;
      return;
    }
    const filtersChanged = previousFiltersRef.current !== "" && previousFiltersRef.current !== filterKey;
    previousFiltersRef.current = filterKey;
    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }
    const bypassCache = previousRefreshKeyRef.current !== refreshKey;
    previousRefreshKeyRef.current = refreshKey;
    if (bypassCache) randomSeedRef.current = createHomeRandomSeed();
    loadSoups(false, bypassCache, currentPage);
  }, [filters, refreshKey, currentPage, isDesktop, homeCategory, categoryRefreshKey]);

  useEffect(() => {
    if (!loadingUser && !user && (homeCategory === "following" || homeCategory === "played" || homeCategory === "mystery")) {
      navigate(`/${location.search}`, {
        replace: true,
        state: { homeFilters: filters, homeSearchKeyword: searchKeyword } satisfies HomeRouteState
      });
    }
  }, [filters, homeCategory, loadingUser, location.search, navigate, searchKeyword, user]);

  useEffect(() => {
    if (homeCategory === "mystery") {
      setMatchedUsers([]);
      setUsersLoading(false);
      return;
    }
    const keyword = filters.keyword.trim();
    if (skipInitialUserSearchRef.current) {
      skipInitialUserSearchRef.current = false;
      return;
    }
    const requestId = ++userSearchRequestRef.current;
    setUsersExpanded(false);
    if (!keyword) {
      setMatchedUsers([]);
      setUsersLoading(false);
      return;
    }
    const cacheKey = `hgt:user-search:${keyword}`;
    const cached = readSessionCache<UserSearchResponse>(cacheKey, 60_000);
    if (cached) setMatchedUsers(cached.users);
    else setMatchedUsers([]);
    setUsersLoading(!cached);
    void api<UserSearchResponse>(`/api/users/search?keyword=${encodeURIComponent(keyword)}&limit=50`, { cacheTtlMs: 60_000 })
      .then((data) => {
        if (requestId !== userSearchRequestRef.current) return;
        setMatchedUsers(data.users);
        writeSessionCache(cacheKey, data);
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === userSearchRequestRef.current) setUsersLoading(false);
      });
  }, [filters.keyword, homeCategory]);

  const handleLoadMore = () => loadSoups(true);
  const totalPages = isDesktop
    ? total <= firstDesktopPageSize ? 1 : 1 + Math.ceil((total - firstDesktopPageSize) / desktopPageSize)
    : Math.max(1, Math.ceil(total / mobilePageSize));

  function changePage(page: number) {
    if (loading || page === currentPage || page < 1 || page > totalPages) return;
    setCurrentPage(page);
    window.requestAnimationFrame(() => listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function navigateAuthenticated(path: string) {
    if (!user) { openAuth(); return; }
    navigate(path);
  }

  async function handleCreate() {
    if (!user) { openAuth(); return; }
    try {
      const quota = await api<{ allowed: boolean; reason: string | null }>("/api/me/soup-publish-quota");
      if (!quota.allowed) {
        showToast(quota.reason || "今日暂时无法继续发布海龟汤");
        return;
      }
      openSoupEditor();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "发布额度检查失败");
    }
  }

  async function handleLogout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    showToast("已退出登录");
    triggerRefresh();
    navigate("/");
  }

  async function handleExportSoups() {
    setShowExportConfirm(false);
    const latest = soups.slice(0, 10);
    if (latest.length === 0) return;
    const [{ toPng }, { default: QRCode }] = await Promise.all([
      import("html-to-image"),
      import("qrcode")
    ]);

    const sheet = document.createElement("div");
    sheet.className = "export-sheet";
    sheet.style.position = "absolute";
    sheet.style.left = "0"; sheet.style.top = "0";
    sheet.style.zIndex = "-1";
    sheet.style.pointerEvents = "none";

    // Header banner (same style as export-header)
    const header = document.createElement("div");
    header.className = "export-header";
    const eyebrow = document.createElement("div");
    eyebrow.className = "export-eyebrow"; eyebrow.textContent = "海龟汤";
    const title = document.createElement("h1"); title.textContent = "故事背后藏着的真的是真相吗？";
    header.append(eyebrow, title);

    // Body: soup list
    const body = document.createElement("div");
    body.className = "export-body";

    const list = document.createElement("div");
    list.className = "export-soup-list";
    latest.forEach((soup) => {
      const item = document.createElement("div");
      item.className = "export-soup-item";

      const left = document.createElement("div");
      left.className = "export-soup-item-left";

      const itemTitle = document.createElement("div");
      itemTitle.className = "export-soup-item-title";
      itemTitle.textContent = soup.title;

      const itemMeta = document.createElement("div");
      itemMeta.className = "export-soup-item-meta";
      itemMeta.textContent = `${soup.author || soup.creatorName} · ${soup.type}`;

      const itemSummary = document.createElement("div");
      itemSummary.className = "export-soup-item-summary";
      itemSummary.textContent = soup.summary || "暂无摘要";

      left.append(itemTitle, itemMeta, itemSummary);

      const right = document.createElement("div");
      right.className = "export-soup-item-right";
      right.textContent = soup.averageTotal != null ? `${soup.averageTotal}分` : "-";

      item.append(left, right);
      list.appendChild(item);
    });
    body.appendChild(list);
    sheet.append(header, body);

    // Footer: QR code centered
    const footer = document.createElement("div");
    footer.className = "export-footer export-footer-qr-only";

    const footerRight = document.createElement("div");
    footerRight.className = "export-footer-right";
    const homeUrl = window.location.origin;
    const qrDataUrl = await QRCode.toDataURL(homeUrl, {
      width: 180,
      margin: 2,
      color: { dark: "#1e293b", light: "#ffffff" }
    });
    const qrImg = document.createElement("img");
    qrImg.src = qrDataUrl;
    qrImg.alt = "二维码";
    footerRight.appendChild(qrImg);
    const qrLabel = document.createElement("div");
    qrLabel.className = "export-footer-label";
    qrLabel.textContent = "扫码查看更多海龟汤";
    footerRight.appendChild(qrLabel);
    footer.appendChild(footerRight);
    sheet.appendChild(footer);

    document.body.appendChild(sheet);

    try {
      const dataUrl = await toPng(sheet, {
        backgroundColor: "#F5F7FA", pixelRatio: 2, cacheBust: true, skipFonts: true,
        width: sheet.scrollWidth, height: sheet.scrollHeight
      });
      setExportReady({ url: dataUrl, name: "海龟汤列表.png" });
    } finally { sheet.remove(); }
  }

  return (
    <section className={`home-page space-y-3 lg:space-y-0 ${isResultMode ? "home-page-result-mode" : ""} ${activeFilterCount > 0 && !filters.keyword ? "home-page-filter-result-mode" : ""}`}>
      <PageTopBar title="海龟汤" />

      <div ref={heroParallax.heroRef} className="home-desktop-hero" onPointerMove={heroParallax.onPointerMove} onPointerLeave={heroParallax.onPointerLeave}>
        <div className="home-desktop-hero-media" aria-hidden="true">
          <img className="home-desktop-fixed-cover" src={desktopNavigationBannerUrl} alt="" />
          <div className="home-desktop-hero-shade" />
        </div>
        <div className="home-desktop-nav">
          <button type="button" className="home-desktop-brand" onClick={() => triggerRefresh()} aria-label="刷新首页">
            <img className="home-desktop-brand-mark" src="/logo.png" alt="" aria-hidden="true" />
            <span>汤汤解谜乐园</span>
          </button>
          <nav className="home-desktop-nav-links" aria-label="首页主导航">
            <button type="button" className="is-active" onClick={() => triggerRefresh()}><Home size={17} />首页</button>
            <button type="button" onClick={() => navigateAuthenticated("/online-soup")}><MessageCircleQuestion size={17} />玩汤</button>
            <button type="button" onClick={() => navigateAuthenticated("/circles")}><CircleEllipsis size={17} />圈子</button>
            <button type="button" onClick={() => navigateAuthenticated("/mine/rankings")}><Trophy size={17} />排行</button>
            <button type="button" onClick={() => navigateAuthenticated("/mine/store")}><ShoppingBag size={17} />商城</button>
            <button type="button" onClick={() => navigateAuthenticated("/mine/tasks")}><ListChecks size={17} />任务</button>
            <button type="button" onClick={() => navigateAuthenticated("/mine/cards")}><GalleryVerticalEnd size={17} />收藏</button>
            <button type="button" onClick={() => navigateAuthenticated("/mine/achievements")}><Award size={17} />成就</button>
          </nav>
          <div className="home-desktop-account">
            <DesktopAppDownload />
            {user ? (
              <>
                <button type="button" className="home-desktop-icon-button" onClick={() => navigate("/messages")} aria-label="消息">
                  <Bell size={19} />
                  {unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}
                </button>
                {canAccessAdmin(user.role) && (
                  <button type="button" className="home-desktop-icon-button" onClick={() => navigate("/admin")} aria-label="后台"><Shield size={18} /></button>
                )}
                <details ref={userMenuRef} className="home-desktop-user-menu">
                  <summary>
                    {user.avatar ? <img src={user.avatar} alt="" /> : <span>{(user.nickname || user.username).slice(0, 1)}</span>}
                    <strong>{(user.nickname || user.username).slice(0, 8)}</strong>
                  </summary>
                  <div>
                    <button type="button" onClick={() => navigate("/mine")}><UserRound size={16} />个人中心</button>
                    <button type="button" onClick={() => navigate("/mine/settings")}><Settings size={16} />账号设置</button>
                    <button type="button" onClick={handleLogout}><LogOut size={16} />退出登录</button>
                  </div>
                </details>
                <span className="home-desktop-shell-balance" aria-label={`贝壳余额：${shellBalance ?? "加载中"}`}><Shell size={15} aria-hidden="true" />贝壳余额：{shellBalance ?? "—"}</span>
              </>
            ) : (
              <button type="button" className="home-desktop-login" onClick={openAuth}>登录</button>
            )}
            <button type="button" className="home-desktop-create" onClick={handleCreate}><Plus size={18} />发布海龟汤</button>
          </div>
        </div>
        <div className="home-desktop-hero-copy">
          <span>汤汤解谜乐园</span>
          <strong>从一个问题开始，走向故事真正的结局</strong>
        </div>
        <div className="home-desktop-search-tools">
          {homeCategory !== "mystery" && filtersOpen && (
            <div className="home-desktop-filter-popover">
              <label>
                <span>类型</span>
                <select value={filters.type} onChange={(event) => setFilters((old) => ({ ...old, type: event.target.value }))}>
                  <option value="">全部类型</option>
                  {soupTypes.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label>
                <span>难度</span>
                <select value={filters.difficulty} onChange={(event) => setFilters((old) => ({ ...old, difficulty: event.target.value }))}>
                  <option value="">全部难度</option>
                  {soupDifficulties.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}
                </select>
              </label>
              <label>
                <span>评分</span>
                <select value={filters.minRating} onChange={(event) => setFilters((old) => ({ ...old, minRating: event.target.value }))}>
                  <option value="all">全部评分</option>
                  <option value="2">2分以上</option>
                  <option value="3">3分以上</option>
                  <option value="4">4分以上</option>
                </select>
              </label>
              <label>
                <span>公开情况</span>
                <select value={filters.bottomPublic} onChange={(event) => setFilters((old) => ({ ...old, bottomPublic: event.target.value }))}>
                  <option value="all">全部</option>
                  <option value="surface">汤面公开</option>
                  <option value="bottom">汤底公开</option>
                </select>
              </label>
              <label>
                <span>AI 玩汤</span>
                <select value={filters.aiGame} onChange={(event) => setFilters((old) => ({ ...old, aiGame: event.target.value }))}>
                  <option value="all">全部</option>
                  <option value="enabled">已开启</option>
                  <option value="disabled">未开启</option>
                </select>
              </label>
              <button className="home-filter-reset" type="button" disabled={activeFilterCount === 0} onClick={resetFilters}>
                <RotateCcw size={14} />重置筛选
              </button>
            </div>
          )}
          <DesktopGlobalSearch value={searchKeyword} onChange={setSearchKeyword} onSubmit={submitSearch} placeholder={homeCategory === "mystery" ? "搜索谜局标题或标签..." : undefined} />
          {homeCategory !== "mystery" && <button
            type="button"
            className={`home-desktop-filter-trigger ${filtersOpen ? "is-open" : ""}`}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={17} />筛选
            {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>}
        </div>
      </div>

      <div className="home-search-sticky flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-12 rounded-full bg-white pl-4 pr-11 text-[15px] shadow-soft"
            placeholder={homeCategory === "mystery" ? "搜索谜局标题或标签..." : "搜索海龟汤或用户昵称..."}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
          />
          <button className="absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-primary transition hover:bg-blue-50" type="button" aria-label="搜索" onClick={submitSearch}>
            <Search size={20} />
          </button>
        </div>
        {homeCategory !== "mystery" && <button
          className="relative inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-bold text-primary shadow-soft"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <SlidersHorizontal size={19} />
          <span className="hidden sm:inline">筛选</span>
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-white">{activeFilterCount}</span>
          )}
        </button>}
      </div>

      {homeCategory !== "mystery" && <div className={`home-filter-panel ${filtersOpen ? "is-open" : ""}`}>
          <label className="filter-field">
            <span>类型</span>
            <select className="field" value={filters.type} onChange={(e) => setFilters((old) => ({ ...old, type: e.target.value }))}>
              <option value="">全部类型</option>
              {soupTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>难度</span>
            <select className="field" value={filters.difficulty} onChange={(e) => setFilters((old) => ({ ...old, difficulty: e.target.value }))}>
              <option value="">全部难度</option>
              {soupDifficulties.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>评分</span>
            <select className="field" value={filters.minRating} onChange={(e) => setFilters((old) => ({ ...old, minRating: e.target.value }))}>
              <option value="all">全部评分</option>
              <option value="2">2分以上</option>
              <option value="3">3分以上</option>
              <option value="4">4分以上</option>
            </select>
          </label>
          <label className="filter-field">
            <span>公开情况</span>
            <select className="field" value={filters.bottomPublic} onChange={(e) => setFilters((old) => ({ ...old, bottomPublic: e.target.value }))}>
              <option value="all">全部</option>
              <option value="surface">汤面公开</option>
              <option value="bottom">汤底公开</option>
            </select>
          </label>
          <label className="filter-field">
            <span>AI 玩汤</span>
            <select className="field" value={filters.aiGame} onChange={(e) => setFilters((old) => ({ ...old, aiGame: e.target.value }))}>
              <option value="all">全部</option>
              <option value="enabled">已开启</option>
              <option value="disabled">未开启</option>
            </select>
          </label>
          <button className="home-filter-reset" type="button" disabled={activeFilterCount === 0} onClick={resetFilters}>
            <RotateCcw size={15} />重置筛选
          </button>
      </div>}

      <nav className="home-category-tabs" aria-label="首页内容分类" role="tablist">
        {homeCategoryTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={homeCategory === tab.key}
            className={homeCategory === tab.key ? "is-active" : ""}
            onClick={() => selectHomeCategory(tab.key, Boolean(tab.requiresAuth))}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {homeCategory === "mystery" && <MysteryCatalog keyword={filters.keyword} onOpen={(mystery, choice) => {
        navigate(`/online-soup?mystery=${encodeURIComponent(mystery.id)}&choice=${choice}`);
      }} />}

      {homeCategory !== "mystery" && !isResultMode && (
        <div className="home-mobile-banner"><HomeBannerCarousel /></div>
      )}

      {homeCategory !== "mystery" && filters.keyword && (usersLoading || matchedUsers.length > 0) && (
        <section className="home-user-search-results overflow-hidden rounded-2xl bg-white shadow-soft">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-base font-black text-ink">用户</h2>
          </div>
          <div className="divide-y divide-line">
            {usersLoading && matchedUsers.length === 0 && Array.from({ length: 2 }, (_, index) => (
              <div key={index} className="flex animate-pulse items-center gap-3 px-4 py-3">
                <span className="h-12 w-12 shrink-0 rounded-full bg-slate-200" />
                <span className="flex-1 space-y-2"><span className="block h-4 w-24 rounded bg-slate-200" /><span className="block h-3 w-32 rounded bg-slate-100" /></span>
              </div>
            ))}
            {(usersExpanded ? matchedUsers : matchedUsers.slice(0, 2)).map((matchedUser) => (
              <button
                key={matchedUser.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100"
                onClick={() => user ? navigate(`/users/${matchedUser.id}`) : openAuth()}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 text-base font-black text-primary">
                  {matchedUser.avatar ? <img className="h-full w-full object-cover" src={matchedUser.avatar} alt="" /> : matchedUser.nickname.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <VipIdentity nickname={matchedUser.nickname} userLevel={matchedUser.level} vipLevel={matchedUser.vipLevel} vipActive={matchedUser.vipActive} equippedBadge={matchedUser.equippedBadge} className="max-w-full text-sm font-black text-ink" />
                </span>
              </button>
            ))}
          </div>
          {matchedUsers.length > 2 && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-xs font-bold text-primary transition hover:bg-blue-50"
              onClick={() => setUsersExpanded((expanded) => !expanded)}
              aria-label={usersExpanded ? "收起更多用户" : "展开更多用户"}
            >
              {usersExpanded ? <><ChevronUp size={17} />收起</> : <><ChevronDown size={17} />展开更多用户（{matchedUsers.length - 2}）</>}
            </button>
          )}
        </section>
      )}

      {homeCategory !== "mystery" && filters.keyword && (
        <div className="home-content-heading is-search-result">
          <h2>海龟汤</h2>
        </div>
      )}

      <div ref={listTopRef} className="home-list-anchor" aria-hidden="true" />

      {homeCategory !== "mystery" && <MasonryList
        soups={isDesktop && loading ? [] : soups}
        onOpen={(id) => {
          saveHomeViewSnapshot();
          navigate(`/soup/${id}`, {
            state: { soupReturnTo: currentHomeUrl, soupReturnHistory: true }
          });
        }}
        hasMore={!isDesktop && hasMore}
        loading={loading}
        onLoadMore={handleLoadMore}
        desktopLeadingContent={!isResultMode && currentPage === 1 ? <HomeBannerCarousel variant="desktop" /> : undefined}
        desktopLoadingContent={loading ? Array.from(
          { length: currentPage === 1 ? firstDesktopPageSize : desktopPageSize },
          (_, index) => <SoupCardSkeleton key={`loading-${index}`} />
        ) : undefined}
      />}

      {homeCategory !== "mystery" && isDesktop && totalPages > 1 && (
        <nav className="home-desktop-pagination" aria-label="海龟汤分页">
          <button type="button" className="btn btn-secondary h-9 px-3 text-xs" disabled={currentPage <= 1 || loading} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={15} />上一页</button>
          {paginationItems(currentPage, totalPages).map((item, index) => item === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="grid h-9 w-7 place-items-center text-sm text-muted">…</span>
          ) : (
            <button type="button" key={item} className={`grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold ${item === currentPage ? "bg-primary text-white" : "border border-line bg-white text-ink"}`} aria-current={item === currentPage ? "page" : undefined} disabled={loading} onClick={() => changePage(item)}>{item}</button>
          ))}
          <button type="button" className="btn btn-secondary h-9 px-3 text-xs" disabled={currentPage >= totalPages || loading} onClick={() => changePage(currentPage + 1)}>下一页<ChevronRight size={15} /></button>
        </nav>
      )}

      {homeCategory !== "mystery" && soups.length === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-muted">{user ? "暂无符合条件的海龟汤" : "暂无公开海龟汤"}</div>
      )}
      {homeCategory !== "mystery" && loading && <div className="home-mobile-loading-skeleton"><CoverGridSkeleton count={soups.length ? 2 : 6} /></div>}

      {/* 导出汤名悬浮按钮 */}
      <button
        className="hidden"
        aria-label="导出汤名"
        title="导出汤名"
        onClick={() => setShowExportConfirm(true)}
      >
        <FileText size={22} />
      </button>

      {/* 导出确认弹框 */}
      {showExportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-sm rounded-[20px] bg-white p-6 shadow-soft">
            <p className="text-base font-bold text-ink">导出汤名</p>
            <p className="mt-2 text-sm text-muted">是否导出当前页面的海龟汤列表？</p>
            <div className="mt-5 flex gap-3">
              <button
                className="btn btn-secondary flex-1"
                onClick={() => setShowExportConfirm(false)}
              >
                否
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={handleExportSoups}
              >
                是
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
