import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, FileText } from "lucide-react";
import type { PublicUser, SoupSummary } from "../shared/types";
import { api, SoupsResponse } from "../api";
import { useApp, soupTypes } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { MasonryList } from "../components/MasonryList";
import { homeBannerUrl } from "../shared/staticAssets";
import { CoverGridSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";
import { EquippedBadgeIcon } from "../components/BadgeVisuals";

type HomeCacheData = Pick<SoupsResponse, "soups" | "hasMore">;
type SearchUser = Pick<PublicUser, "id" | "nickname" | "avatar" | "equippedBadge">;
type UserSearchResponse = { users: SearchUser[]; total: number };

function createHomeRandomSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function HomePage() {
  const { user, refreshKey, setExportReady, openAuth } = useApp();
  const navigate = useNavigate();

  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  const previousRefreshKeyRef = useRef(refreshKey);
  const randomSeedRef = useRef(createHomeRandomSeed());
  const [matchedUsers, setMatchedUsers] = useState<SearchUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersExpanded, setUsersExpanded] = useState(false);
  const userSearchRequestRef = useRef(0);
  const [showExportConfirm, setShowExportConfirm] = useState(false);

  const [filters, setFilters] = useState({
    keyword: "",
    type: "",
    minRating: "all",
    bottomPublic: "all"
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const activeFilterCount = [filters.type, filters.minRating !== "all", filters.bottomPublic !== "all"].filter(Boolean).length;
  const isResultMode = Boolean(filters.keyword) || activeFilterCount > 0;

  const submitSearch = () => setFilters((old) => ({ ...old, keyword: searchKeyword.trim() }));

  const loadSoups = useCallback(
    async (append = false, bypassCache = false) => {
      if (loadingRef.current) return;
      if (append && !hasMore) return;
      loadingRef.current = true;
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== "all") params.set(key, value);
      });
      params.set("limit", "10");
      params.set("offset", String(append ? offsetRef.current : 0));
      params.set("seed", randomSeedRef.current);
      const cacheKey = `hgt:home:${user?.id ?? "guest"}:${params.toString()}`;
      const cached = append || bypassCache ? null : readSessionCache<HomeCacheData>(cacheKey, 45_000);
      if (cached) {
        setSoups(cached.soups);
        offsetRef.current = cached.soups.length;
        setHasMore(cached.hasMore);
      }
      setLoading(append || !cached);
      try {
        const data = await api<SoupsResponse>(`/api/soups?${params.toString()}`, {
          cacheTtlMs: append ? 0 : 30_000,
          bypassCache
        });
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
          writeSessionCache(cacheKey, { soups: data.soups, hasMore: data.hasMore } satisfies HomeCacheData);
        }
        setHasMore(data.hasMore);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [filters, hasMore, user?.id]
  );

  useEffect(() => {
    const bypassCache = previousRefreshKeyRef.current !== refreshKey;
    previousRefreshKeyRef.current = refreshKey;
    if (bypassCache) randomSeedRef.current = createHomeRandomSeed();
    loadSoups(false, bypassCache);
  }, [filters, refreshKey]);

  useEffect(() => {
    const keyword = filters.keyword.trim();
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
  }, [filters.keyword]);

  const handleLoadMore = () => loadSoups(true);

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
    <section className="space-y-3">
      <PageTopBar title="海龟汤" />

      <div className="home-search-sticky flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-12 rounded-full bg-white pl-4 pr-11 text-[15px] shadow-soft"
            placeholder="搜索海龟汤或用户昵称..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
          />
          <button className="absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-primary transition hover:bg-blue-50" type="button" aria-label="搜索" onClick={submitSearch}>
            <Search size={20} />
          </button>
        </div>
        <button
          className="relative inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-bold text-primary shadow-soft"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <SlidersHorizontal size={19} />
          <span className="hidden sm:inline">筛选</span>
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-white">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {filtersOpen && (
        <div className="grid gap-2 rounded-2xl border border-line bg-white p-3 shadow-soft sm:grid-cols-3">
          <label className="filter-field">
            <span>类型</span>
            <select className="field" value={filters.type} onChange={(e) => setFilters((old) => ({ ...old, type: e.target.value }))}>
              <option value="">全部类型</option>
              {soupTypes.map((t) => <option key={t}>{t}</option>)}
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
        </div>
      )}

      {!isResultMode && (
        <div className="home-hero-banner">
          <img src={homeBannerUrl} alt="故事背后藏着的真的是真相吗？" />
        </div>
      )}

      {filters.keyword && (usersLoading || matchedUsers.length > 0) && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-soft">
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
                  <span className="block truncate text-sm font-black text-ink">{matchedUser.nickname}</span>
                  {matchedUser.equippedBadge && (
                    <span className="mt-1 inline-flex max-w-full">
                      <EquippedBadgeIcon badge={matchedUser.equippedBadge} className="h-5 w-5 rounded-md" animated={false} />
                    </span>
                  )}
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

      {filters.keyword && <h2 className="px-1 pt-1 text-base font-black text-ink">海龟汤</h2>}

      <MasonryList soups={soups} onOpen={(id) => navigate(`/soup/${id}`)} hasMore={hasMore} loading={loading} onLoadMore={handleLoadMore} />

      {soups.length === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-muted">{user ? "暂无符合条件的海龟汤" : "暂无公开海龟汤"}</div>
      )}
      {loading && <CoverGridSkeleton count={soups.length ? 2 : 6} />}

      {/* 导出汤名悬浮按钮 */}
      <button
        className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition hover:bg-blue-600 active:scale-95"
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
            <p className="mt-2 text-sm text-muted">是否导出当前页面最新 10 条海龟汤列表？</p>
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
