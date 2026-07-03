import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";
import type { SoupSummary } from "../shared/types";
import { api, SoupsResponse } from "../api";
import { useApp, soupTypes } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { MasonryList } from "../components/MasonryList";

export default function HomePage() {
  const { user, refreshKey } = useApp();
  const navigate = useNavigate();

  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);

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
    async (append = false) => {
      if (loadingRef.current) return;
      if (append && !hasMore) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
          if (value && value !== "all") params.set(key, value);
        });
        params.set("limit", "10");
        params.set("offset", String(append ? offsetRef.current : 0));
        const data = await api<SoupsResponse>(`/api/soups?${params.toString()}`);
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
        }
        setHasMore(data.hasMore);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [filters, hasMore]
  );

  useEffect(() => {
    loadSoups(false);
  }, [filters, refreshKey]);

  const handleLoadMore = () => loadSoups(true);

  return (
    <section className="space-y-3">
      <PageTopBar title="海龟汤" />

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-12 rounded-full bg-white pl-4 pr-11 text-[15px] shadow-soft"
            placeholder="搜索海龟汤标题、作者或摘要..."
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
          <img src="/home-banner.png" alt="故事背后藏着的真的是真相吗？" />
        </div>
      )}

      <MasonryList soups={soups} onOpen={(id) => navigate(`/soup/${id}`)} hasMore={hasMore} loading={loading} onLoadMore={handleLoadMore} />

      {soups.length === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-muted">{user ? "暂无符合条件的海龟汤" : "暂无公开海龟汤"}</div>
      )}
      {loading && <div className="flex items-center justify-center py-8 text-sm text-muted"><img src="/loading.gif" alt="加载中" className="mx-auto w-20 h-20 object-contain" /></div>}
    </section>
  );
}
