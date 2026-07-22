import { useEffect, useState } from "react";
import { Check, Search, Soup } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { UnifiedBackButton } from "../components/UnifiedBackButton";
import { defaultCoverUrl } from "../shared/staticAssets";
import type { OnlineSoupChoice } from "../shared/types";
import { useOnlineSoupExitGuard } from "../shared/onlineSoupExitGuard";

type SoupTab = "library" | "mine";
type SoupPage = { soups: OnlineSoupChoice[]; hasMore: boolean; nextPage: number | null };

export default function OnlineSoupSelectPage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useApp();
  const [tab, setTab] = useState<SoupTab>("library");
  const [keywords, setKeywords] = useState<Record<SoupTab, string>>({ library: "", mine: "" });
  const [soups, setSoups] = useState<OnlineSoupChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  useOnlineSoupExitGuard(roomId, true, "selector");

  const keyword = keywords[tab].trim();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ source: tab, q: keyword, page: "0", limit: "40" });
      void api<SoupPage>(`/api/online-soup/soups/eligible?${query.toString()}`, { bypassCache: true, dedupe: false })
        .then((data) => {
          if (cancelled) return;
          setSoups(data.soups);
          setNextPage(data.nextPage);
        })
        .catch((error) => {
          if (!cancelled) showToast(error instanceof Error ? error.message : "海龟汤列表加载失败");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword, showToast, tab]);

  async function loadMore() {
    if (nextPage == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ source: tab, q: keyword, page: String(nextPage), limit: "40" });
      const data = await api<SoupPage>(`/api/online-soup/soups/eligible?${query.toString()}`, { bypassCache: true, dedupe: false });
      setSoups((current) => [...current, ...data.soups]);
      setNextPage(data.nextPage);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更多海龟汤加载失败");
    } finally {
      setLoadingMore(false);
    }
  }

  async function chooseSoup(soupId: string) {
    if (selectingId) return;
    setSelectingId(soupId);
    try {
      await api(`/api/online-soup/rooms/${roomId}/select-soup`, {
        method: "POST",
        body: { soupId }
      });
      navigate(`/online-soup/rooms/${roomId}`, { replace: true });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "选择海龟汤失败");
      setSelectingId(null);
    }
  }

  return (
    <div className="online-soup-selector min-h-screen bg-page pb-[max(32px,env(safe-area-inset-bottom))]">
      <header className="top-nav-shell">
        <div className="mx-auto flex max-w-[1388px] items-center gap-3 px-4 py-2.5 lg:px-8">
          <UnifiedBackButton compactOnMobile to={`/online-soup/rooms/${roomId}`} replace={false} />
          <div>
            <h1 className="font-black text-ink">选择海龟汤</h1>
            <p className="text-xs text-muted">选择后返回房间，由主持人开始游戏</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1388px] px-4 pt-[76px] lg:px-8 lg:pt-[88px]">
        <div className="online-soup-selector-toolbar sticky top-[60px] z-20 -mx-4 border-b border-line bg-page/95 px-4 pb-3 backdrop-blur lg:mx-0 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-4 lg:rounded-2xl lg:border lg:bg-white/95 lg:p-3 lg:shadow-sm">
          <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            <button
              className={`rounded-lg py-2.5 text-sm font-black transition ${tab === "library" ? "bg-white text-primary shadow-sm" : "text-muted"}`}
              onClick={() => setTab("library")}
            >
              汤库
            </button>
            <button
              className={`rounded-lg py-2.5 text-sm font-black transition ${tab === "mine" ? "bg-white text-primary shadow-sm" : "text-muted"}`}
              onClick={() => setTab("mine")}
            >
              发布
            </button>
          </div>
          <label className="field mt-3 flex items-center gap-2 bg-white lg:mt-0">
            <Search size={17} className="shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              value={keywords[tab]}
              onChange={(event) => setKeywords((old) => ({ ...old, [tab]: event.target.value }))}
              placeholder={tab === "library" ? "搜索汤名或作者" : "搜索我发布的汤名或作者"}
            />
          </label>
        </div>

        {loading ? (
          <div className="mt-4 grid grid-cols-2 items-start gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl bg-slate-200" />)}
          </div>
        ) : soups.length > 0 ? (
          <>
          <div className="mt-4 grid grid-cols-2 items-start gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
            {soups.map((soup) => (
              <article
                key={soup.id}
                className={`soup-card overflow-hidden transition ${selectingId === soup.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => void chooseSoup(soup.id)}
              >
                <img className="soup-card-cover" src={soup.coverImage || defaultCoverUrl} alt={`${soup.title} 封面`} loading="lazy" decoding="async" />
                <div className="p-3">
                  <div className="flex items-start gap-2">
                    <h2 className="line-clamp-2 min-w-0 flex-1 text-[16px] font-black leading-snug text-ink">{soup.title}</h2>
                    {selectingId === soup.id && <Check size={18} className="shrink-0 text-primary" />}
                  </div>
                  <p className="mt-1 truncate text-[13px] text-muted">{soup.author || "佚名"}</p>
                  <div className="mt-2">
                    <span className="inline-flex h-6 items-center rounded-md bg-blue-50 px-2 text-xs font-semibold text-primary ring-1 ring-blue-100">{soup.type}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-muted">{soup.summary || "暂无摘要"}</p>
                  <button className="btn btn-primary mt-3 w-full" disabled={selectingId !== null}>
                    <Soup size={15} /> {selectingId === soup.id ? "选择中…" : "选择此汤"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {nextPage != null && <button className="btn btn-secondary mx-auto my-5 flex" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "加载中…" : "加载更多"}</button>}
          </>
        ) : (
          <div className="card mt-4 py-14 text-center">
            <Soup className="mx-auto text-slate-300" size={36} />
            <p className="mt-3 font-bold text-muted">{keywords[tab].trim() ? "没有找到匹配的海龟汤" : tab === "library" ? "汤库中暂无可用海龟汤" : "暂无可用的已发布海龟汤"}</p>
          </div>
        )}
      </main>
    </div>
  );
}
