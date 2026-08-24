import { useEffect, useState } from "react";
import { BookOpenCheck, Check, Play, RotateCcw, Search, Soup } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { UnifiedBackButton } from "../components/UnifiedBackButton";
import { defaultCoverUrl } from "../shared/staticAssets";
import type { OnlineSoupChoice } from "../shared/types";
import { Modal } from "../components/Modal";

const SOUP_TABS = [
  ["recommended", "推荐"],
  ["random", "随机"],
  ["latest", "最新"],
  ["liked", "点赞"],
  ["favorited", "收藏"],
  ["played", "玩过"],
  ["mine", "我的"]
] as const;

type SoupTab = (typeof SOUP_TABS)[number][0];
type SoupPage = { hostMode: "human" | "ai"; soups: OnlineSoupChoice[]; hasMore: boolean; nextPage: number | null };
type MysteryChoice = { id: string; title: string; coverUrl: string | null; tags: string[]; canContinue: boolean; saveStatus: string | null };
type MysteryPage = { mysteries: MysteryChoice[]; hasMore: boolean; nextPage: number | null };

export default function OnlineSoupSelectPage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useApp();
  const [tab, setTab] = useState<SoupTab>("recommended");
  const contentType = searchParams.get("contentType") === "mystery" ? "mystery" : "soup";
  const [keywords, setKeywords] = useState<Record<SoupTab, string>>({
    recommended: "", random: "", latest: "", liked: "", favorited: "", played: "", mine: ""
  });
  const [randomSeed, setRandomSeed] = useState(() => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const [soups, setSoups] = useState<OnlineSoupChoice[]>([]);
  const [mysteries, setMysteries] = useState<MysteryChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [hostMode, setHostMode] = useState<"human" | "ai">("human");
  const [pendingMystery, setPendingMystery] = useState<MysteryChoice | null>(null);
  const keyword = keywords[tab].trim();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ ...(contentType === "soup" ? { source: tab, seed: randomSeed } : {}), q: keyword, page: "0", limit: "40", roomId });
      const request = contentType === "soup"
        ? api<SoupPage>(`/api/online-soup/soups/eligible?${query.toString()}`, { bypassCache: true, dedupe: false })
        : api<MysteryPage>(`/api/online-soup/mysteries/eligible?${query.toString()}`, { bypassCache: true, dedupe: false });
      void request
        .then((data) => {
          if (cancelled) return;
          if ("soups" in data) { setSoups(data.soups); setHostMode(data.hostMode); }
          else setMysteries(data.mysteries);
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
  }, [contentType, keyword, randomSeed, roomId, showToast, tab]);

  async function loadMore() {
    if (nextPage == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ ...(contentType === "soup" ? { source: tab, seed: randomSeed } : {}), q: keyword, page: String(nextPage), limit: "40", roomId });
      const data = contentType === "soup"
        ? await api<SoupPage>(`/api/online-soup/soups/eligible?${query.toString()}`, { bypassCache: true, dedupe: false })
        : await api<MysteryPage>(`/api/online-soup/mysteries/eligible?${query.toString()}`, { bypassCache: true, dedupe: false });
      if ("soups" in data) { setSoups((current) => [...current, ...data.soups]); setHostMode(data.hostMode); }
      else setMysteries((current) => [...current, ...data.mysteries]);
      setNextPage(data.nextPage);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更多海龟汤加载失败");
    } finally {
      setLoadingMore(false);
    }
  }

  function selectSoupTab(nextTab: SoupTab) {
    if (nextTab === "random") setRandomSeed(crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setTab(nextTab);
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

  async function chooseMystery(mystery: MysteryChoice, choice: "continue" | "restart") {
    if (selectingId) return;
    setSelectingId(mystery.id);
    try {
      await api(`/api/online-soup/rooms/${roomId}/select-mystery`, { method: "POST", body: { mysteryId: mystery.id, choice } });
      navigate(`/online-soup/rooms/${roomId}`, { replace: true });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "选择谜局失败");
      setSelectingId(null);
    }
  }

  return (
    <div className="online-soup-selector min-h-screen bg-page pb-[max(32px,env(safe-area-inset-bottom))]">
      <header className="top-nav-shell">
        <div className="mx-auto flex max-w-[1388px] items-center gap-3 px-4 py-2.5 lg:px-8">
          <UnifiedBackButton compactOnMobile to={`/online-soup/rooms/${roomId}`} replace={false} />
          <div>
            <h1 className="font-black text-ink">选择游戏内容</h1>
            <p className="text-xs text-muted">当前房间类型：{contentType === "mystery" ? "谜局" : "海龟汤"}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1388px] px-4 pt-[76px] lg:px-8 lg:pt-[88px]">
        <div className="online-soup-selector-toolbar sticky top-[60px] z-20 -mx-4 border-b border-line bg-page/95 px-4 pb-3 backdrop-blur lg:mx-0 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-3 lg:rounded-2xl lg:border lg:bg-white/95 lg:p-3 lg:shadow-sm">
          <div className="flex min-h-11 items-center rounded-xl bg-slate-100 px-3 text-sm font-black text-primary">
            {contentType === "mystery" ? <BookOpenCheck size={16} className="mr-2" /> : <Soup size={16} className="mr-2" />}{contentType === "mystery" ? "选择谜局" : "选择海龟汤"}
          </div>
          <label className="field mt-3 flex items-center gap-2 bg-white lg:mt-0">
            <Search size={17} className="shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              value={keywords[tab]}
              onChange={(event) => setKeywords((old) => ({ ...old, [tab]: event.target.value }))}
              placeholder={contentType === "mystery" ? "搜索谜局标题或标签" : hostMode === "ai" ? "搜索支持 AI 主持的汤名或作者" : tab === "mine" ? "搜索我发布的汤名或作者" : "搜索汤名或作者"}
            />
          </label>
          {contentType === "soup" && hostMode === "human" && (
            <div className="-mx-1 mt-2 overflow-x-auto px-1 pb-1 lg:col-span-2 lg:mt-0" role="group" aria-label="海龟汤列表分类">
              <div className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1 lg:grid lg:min-w-0 lg:grid-cols-7">
                {SOUP_TABS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={tab === key}
                    className={`min-h-11 min-w-[72px] rounded-lg px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tab === key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`}
                    onClick={() => selectSoupTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-4 grid grid-cols-2 items-start gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl bg-slate-200" />)}
          </div>
        ) : contentType === "soup" && soups.length > 0 ? (
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
                    {soup.enableAiGame && <span className="ml-1.5 inline-flex h-6 items-center rounded-md bg-violet-50 px-2 text-xs font-semibold text-violet-600 ring-1 ring-violet-100">AI主持</span>}
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
        ) : contentType === "mystery" && mysteries.length > 0 ? <>
          <div className="mt-4 grid grid-cols-2 items-start gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
            {mysteries.map((mystery) => <article key={mystery.id} className={`soup-card overflow-hidden transition ${selectingId === mystery.id ? "ring-2 ring-primary" : ""}`}>
              <img className="soup-card-cover" src={mystery.coverUrl || defaultCoverUrl} alt={`${mystery.title} 封面`} loading="lazy" decoding="async" />
              <div className="p-3"><div className="flex items-start gap-2"><h2 className="line-clamp-2 min-w-0 flex-1 text-[16px] font-black leading-snug text-ink">{mystery.title}</h2>{selectingId === mystery.id && <Check size={18} className="text-primary" />}</div>
                <div className="mt-2 flex flex-wrap gap-1">{mystery.tags.map((tag) => <span key={tag} className="inline-flex min-h-6 items-center rounded-md bg-blue-50 px-2 text-xs font-semibold text-primary ring-1 ring-blue-100">{tag}</span>)}</div>
                {mystery.canContinue && <p className="mt-2 text-xs font-bold text-emerald-700">检测到当前存档</p>}
                <button className="btn btn-primary mt-3 w-full" disabled={selectingId !== null} onClick={() => mystery.canContinue ? setPendingMystery(mystery) : void chooseMystery(mystery, "restart")}><BookOpenCheck size={15} />选择谜局</button>
              </div>
            </article>)}
          </div>
          {nextPage != null && <button className="btn btn-secondary mx-auto my-5 flex" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "加载中…" : "加载更多"}</button>}
        </> : (
          <div className="card mt-4 py-14 text-center">
            <Soup className="mx-auto text-slate-300" size={36} />
            <p className="mt-3 font-bold text-muted">{contentType === "mystery" ? keyword ? "没有找到匹配的谜局" : "暂无已上架谜局" : keywords[tab].trim() ? "没有找到匹配的海龟汤" : hostMode === "ai" ? "暂无支持 AI 主持的海龟汤" : tab === "liked" ? "还没有点赞过可主持的海龟汤" : tab === "favorited" ? "还没有收藏可主持的海龟汤" : tab === "played" ? "还没有玩过可再次主持的海龟汤" : tab === "mine" ? "还没有发布可主持的海龟汤" : "暂无可主持的海龟汤"}</p>
          </div>
        )}
      </main>
      {pendingMystery && <Modal onClose={() => setPendingMystery(null)}><div className="space-y-4"><div><h2 className="text-xl font-black text-ink">继续「{pendingMystery.title}」？</h2><p className="mt-2 text-sm leading-6 text-muted">每位房主在同一谜局只有一个当前存档。重新开始会保留旧局事件历史，但当前存档将切换到新局。</p></div><div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary min-h-11" onClick={() => void chooseMystery(pendingMystery, "restart")}><RotateCcw size={16} />重新开始</button><button type="button" className="btn btn-primary min-h-11" onClick={() => void chooseMystery(pendingMystery, "continue")}><Play size={16} />继续游戏</button></div></div></Modal>}
    </div>
  );
}
