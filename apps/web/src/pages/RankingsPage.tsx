import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Crown, Flame, GalleryVerticalEnd, Medal, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { useApp } from "../context/AppContext";
import { ListSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";

type HotSoupRank = {
  rank: number;
  id: string;
  title: string;
  author: string;
  heatValue: number;
};

type AchievementUserRank = {
  rank: number;
  id: string;
  nickname: string;
  avatar: string | null;
  achievementPoints: number;
};

type CollectionUserRank = {
  rank: number;
  id: string;
  nickname: string;
  avatar: string | null;
  totalCollectionValue: number;
  unlockedCardCount: number;
  legendaryCardCount: number;
};

type LevelUserRank = {
  rank: number;
  id: string;
  nickname: string;
  avatar: string | null;
  level: number;
  experience: number;
};

type RankingsResponse = {
  hotSoups: HotSoupRank[];
  hotSoupOwn: HotSoupRank | null;
  achievementUsers: AchievementUserRank[];
  achievementOwn: AchievementUserRank | null;
  levelUsers: LevelUserRank[];
  levelOwn: LevelUserRank | null;
  collectionUsers: CollectionUserRank[];
  collectionOwn: CollectionUserRank | null;
};

type RankingTab = "soups" | "users" | "level" | "collection";

function RankMark({ rank, className = "" }: { rank: number; className?: string }) {
  const style = rank === 1
    ? "bg-amber-100 text-amber-600 ring-amber-200"
    : rank === 2
      ? "bg-slate-200 text-slate-600 ring-slate-300"
      : rank === 3
        ? "bg-orange-100 text-orange-600 ring-orange-200"
        : "bg-slate-100 text-muted ring-slate-200";
  return <span className={`rank-mark grid h-7 w-7 place-items-center rounded-full text-xs font-black ring-1 ${style} ${className}`}>{rank}</span>;
}

export default function RankingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loadingUser, openAuth } = useApp();
  const requestedTab = (location.state as { tab?: string } | null)?.tab;
  const initialTab: RankingTab = requestedTab === "users" || requestedTab === "level" || requestedTab === "collection" ? requestedTab : "soups";
  const [tab, setTab] = useState<RankingTab>(initialTab);
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const cacheKey = `hgt:rankings:v5:${user.id}`;
    const cached = readSessionCache<RankingsResponse>(cacheKey, 2 * 60_000);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    Promise.all([
      api<Omit<RankingsResponse, "collectionUsers" | "collectionOwn">>("/api/rankings"),
      api<{ ranking: CollectionUserRank[]; own: CollectionUserRank | null }>("/api/asset-rankings", { bypassCache: true })
    ])
      .then(([base, collection]) => { const result = { ...base, collectionUsers: collection.ranking, collectionOwn: collection.own }; setData(result); setError(""); writeSessionCache(cacheKey, result); })
      .catch((reason) => { if (!cached) setError(reason instanceof Error ? reason.message : "排行榜加载失败"); })
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loadingUser) return <section className="space-y-3"><PageTopBar title="排行榜" /><MineBackButton hideOnDesktop /><ListSkeleton rows={8} /></section>;
  if (!user) return (
    <section className="space-y-3">
      <PageTopBar title="排行榜" />
      <MineBackButton hideOnDesktop />
      <div className="card p-6 text-center"><p className="text-sm text-muted">登录后可查看排行榜。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div>
    </section>
  );

  const categoryCards: Array<{
    key: RankingTab;
    label: string;
    shortLabel: string;
    description: string;
    icon: typeof Flame;
    leader: string;
    leaderValue: string;
    tone: string;
  }> = [
    {
      key: "soups",
      label: "热门海龟汤",
      shortLabel: "热门榜",
      description: "发现全站讨论度最高的故事",
      icon: Flame,
      leader: data?.hotSoups[0]?.title ?? "等待上榜",
      leaderValue: data?.hotSoups[0] ? `${data.hotSoups[0].heatValue.toLocaleString()} 热力` : "暂无数据",
      tone: "is-hot"
    },
    {
      key: "users",
      label: "用户成就榜",
      shortLabel: "成就榜",
      description: "记录社区探索与创作里程碑",
      icon: Trophy,
      leader: data?.achievementUsers[0]?.nickname ?? "等待上榜",
      leaderValue: data?.achievementUsers[0] ? `${data.achievementUsers[0].achievementPoints.toLocaleString()} 成就点` : "暂无数据",
      tone: "is-achievement"
    },
    {
      key: "level",
      label: "用户等级榜",
      shortLabel: "等级榜",
      description: "见证社区用户的成长历程",
      icon: TrendingUp,
      leader: data?.levelUsers[0]?.nickname ?? "等待上榜",
      leaderValue: data?.levelUsers[0] ? `Lv${data.levelUsers[0].level} · ${data.levelUsers[0].experience.toLocaleString()} EXP` : "暂无数据",
      tone: "is-level"
    },
    {
      key: "collection",
      label: "卡牌收藏榜",
      shortLabel: "收藏榜",
      description: "展示最具价值的数字收藏",
      icon: GalleryVerticalEnd,
      leader: data?.collectionUsers[0]?.nickname ?? "等待上榜",
      leaderValue: data?.collectionUsers[0] ? `${data.collectionUsers[0].totalCollectionValue.toLocaleString()} 收藏值` : "暂无数据",
      tone: "is-collection"
    }
  ];

  const activeCategory = categoryCards.find((item) => item.key === tab)!;
  const podium = tab === "soups"
    ? (data?.hotSoups ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.title, detail: item.author, value: item.heatValue, suffix: "热力", avatar: null as string | null }))
    : tab === "users"
      ? (data?.achievementUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: "社区成就", value: item.achievementPoints, suffix: "成就点", avatar: item.avatar }))
      : tab === "level"
        ? (data?.levelUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: `Lv${item.level}`, value: item.experience, suffix: "经验值", avatar: item.avatar }))
        : (data?.collectionUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: `${item.unlockedCardCount} 张卡牌`, value: item.totalCollectionValue, suffix: "收藏值", avatar: item.avatar }));

  const ownRank = tab === "soups" ? data?.hotSoupOwn : tab === "users" ? data?.achievementOwn : tab === "level" ? data?.levelOwn : data?.collectionOwn;

  function openPodiumItem(item: (typeof podium)[number]) {
    navigate(tab === "soups" ? `/soup/${item.id}` : `/users/${item.id}`);
  }

  return (
    <section className="rankings-page space-y-3 lg:space-y-5">
      <PageTopBar title="排行榜" />
      <MineBackButton hideOnDesktop />

      <div className="rankings-category-panel card p-2 lg:p-4">
        <div className="rankings-category-heading hidden lg:block">
          <p className="text-xs font-black tracking-[0.16em] text-primary">LEADERBOARDS</p>
          <div className="mt-1 flex items-end justify-between gap-6"><h2 className="text-xl font-black text-ink">选择排行榜</h2><p className="text-sm text-muted">实时汇总全站公开数据，展示各榜单前 10 名</p></div>
        </div>
        <div className="rankings-category-grid grid grid-cols-2 gap-2 lg:mt-4">
          {categoryCards.map((category) => { const Icon = category.icon; const selected = tab === category.key; return (
            <button key={category.key} type="button" className={`rankings-category-card ${category.tone} ${selected ? "is-active" : ""}`} onClick={() => setTab(category.key)} aria-pressed={selected}>
              <span className="rankings-category-icon"><Icon size={20} /></span>
              <span className="rankings-category-copy"><strong className="hidden lg:block">{category.label}</strong><strong className="lg:hidden">{category.shortLabel}</strong><small>{category.description}</small></span>
              <span className="rankings-category-leader"><small>当前第 1 名</small><strong>{category.leader}</strong><span>{category.leaderValue}</span></span>
            </button>
          ); })}
        </div>
      </div>

      <div className="rankings-workspace">
        <aside className={`rankings-spotlight hidden lg:flex ${activeCategory.tone}`}>
          <div className="rankings-spotlight-heading">
            <span><Crown size={19} /></span>
            <div><p>TOP THREE</p><h2>本期前三名</h2></div>
          </div>
          {loading ? <ListSkeleton rows={3} /> : error ? <p className="py-10 text-center text-sm text-danger">暂时无法展示</p> : podium.length ? (
            <div className="rankings-podium-list">
              {podium.map((item) => (
                <button key={`${tab}-${item.id}`} type="button" className={`rankings-podium-item is-rank-${item.rank}`} onClick={() => openPodiumItem(item)}>
                  <span className="rankings-podium-avatar">
                    {item.avatar ? <img src={item.avatar} alt={`${item.name}头像`} loading="lazy" decoding="async" /> : tab === "soups" ? <Flame size={24} /> : item.name.slice(0, 1)}
                    <RankMark rank={item.rank} />
                  </span>
                  <span className="min-w-0 flex-1"><strong>{item.name}</strong><small>{item.detail}</small></span>
                  <span className="rankings-podium-value"><strong>{item.value.toLocaleString()}</strong><small>{item.suffix}</small></span>
                </button>
              ))}
            </div>
          ) : <p className="py-10 text-center text-sm text-muted">暂无可展示数据</p>}
          <div className="rankings-rule-card">
            <Sparkles size={17} />
            <div><strong>{activeCategory.label}统计口径</strong><p>{activeCategory.description}。{tab === "soups" ? "按平台热力值从高到低排列。" : tab === "collection" ? "同分时，先达到当前收藏值的用户优先。" : tab === "level" ? "按累计经验值从高到低排列，同经验值时注册更早的用户优先。" : "同分时，先达到当前成就点的用户优先。"}</p></div>
          </div>
          {ownRank && <div className="rankings-own-summary"><span>我的当前排名</span><strong>第 {ownRank.rank} 名</strong></div>}
        </aside>

      <div className="rankings-table-card card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${tab === "soups" ? "bg-orange-50 text-orange-500" : tab === "collection" ? "bg-indigo-50 text-indigo-600" : tab === "level" ? "bg-violet-50 text-violet-600" : "bg-amber-50 text-amber-500"}`}>
            {tab === "soups" ? <Flame size={22} /> : tab === "collection" ? <GalleryVerticalEnd size={22} /> : tab === "level" ? <TrendingUp size={22} /> : <Medal size={22} />}
          </span>
          <div className="min-w-0"><p className="hidden text-[11px] font-black tracking-[0.14em] text-primary lg:block">FULL RANKING</p><h2 className="font-black text-ink lg:mt-0.5 lg:text-lg">{tab === "soups" ? "热门海龟汤 Top 10" : tab === "collection" ? "卡牌收藏值 Top 10" : tab === "level" ? "用户等级 Top 10" : "用户成就点 Top 10"}</h2><p className="mt-0.5 text-xs text-muted">{tab === "soups" ? "按平台热力值从高到低排列" : tab === "collection" ? "同分时，先达到当前收藏值的用户优先" : tab === "level" ? "按累计经验值从高到低排列" : "同分时，先达到当前成就点的用户优先"}</p></div>
        </div>

        {loading ? <ListSkeleton rows={8} /> : error ? <div className="p-10 text-center text-sm text-danger">{error}</div> : tab === "soups" ? (
          <div>
            <div className="grid grid-cols-[44px_minmax(0,1fr)_80px_80px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]">
              <span>排名</span><span>汤名</span><span>作者</span><span className="text-right">热力值</span>
            </div>
            {(data?.hotSoups ?? []).map((item) => (
              <button key={item.id} type="button" className="ranking-table-row grid w-full grid-cols-[44px_minmax(0,1fr)_80px_80px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]" onClick={() => navigate(`/soup/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.title}</span>
                <span className="truncate text-xs text-muted sm:text-sm">{item.author}</span>
                <span className="text-right text-sm font-black text-orange-500">{item.heatValue.toLocaleString()}</span>
              </button>
            ))}
            {data?.hotSoupOwn && (
              <button type="button" className="grid w-full grid-cols-[44px_minmax(0,1fr)_80px_80px] items-center gap-2 border-t-2 border-orange-200 bg-orange-50 px-3 py-3 text-left hover:bg-orange-100/70 sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]" onClick={() => navigate(`/soup/${data.hotSoupOwn!.id}`)}>
                <RankMark rank={data.hotSoupOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.hotSoupOwn.title}</span>
                <span className="truncate text-xs text-muted sm:text-sm">{data.hotSoupOwn.author}</span>
                <span className="text-right text-sm font-black text-orange-500">{data.hotSoupOwn.heatValue.toLocaleString()}</span>
              </button>
            )}
            {data?.hotSoups.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无可排行的海龟汤</div>}
          </div>
        ) : tab === "users" ? (
          <div>
            <div className="grid grid-cols-[60px_minmax(0,1fr)_100px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_160px]">
              <span>排名</span><span>昵称</span><span className="text-right">成就点</span>
            </div>
            {(data?.achievementUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-sm font-black text-amber-600">{item.achievementPoints.toLocaleString()}</span>
              </button>
            ))}
            {data?.achievementOwn && (
              <button className="grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-t-2 border-amber-200 bg-amber-50 px-3 py-3 text-left hover:bg-amber-100/70 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${data.achievementOwn!.id}`)}>
                <RankMark rank={data.achievementOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.achievementOwn.nickname}</span>
                <span className="text-right text-sm font-black text-amber-600">{data.achievementOwn.achievementPoints.toLocaleString()}</span>
              </button>
            )}
            {data?.achievementUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无用户成就点数据</div>}
          </div>
        ) : tab === "level" ? (
          <div>
            <div className="grid grid-cols-[52px_minmax(0,1fr)_68px_92px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]">
              <span>排名</span><span>昵称</span><span className="text-center">等级</span><span className="text-right">经验值</span>
            </div>
            {(data?.levelUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[52px_minmax(0,1fr)_68px_92px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="flex justify-center"><LevelBadge level={item.level} /></span>
                <span className="text-right text-sm font-black text-violet-600">{item.experience.toLocaleString()}</span>
              </button>
            ))}
            {data?.levelOwn && (
              <button className="grid w-full grid-cols-[52px_minmax(0,1fr)_68px_92px] items-center gap-2 border-t-2 border-violet-200 bg-violet-50 px-3 py-3 text-left hover:bg-violet-100/70 sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]" onClick={() => navigate(`/users/${data.levelOwn!.id}`)}>
                <RankMark rank={data.levelOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.levelOwn.nickname}</span>
                <span className="flex justify-center"><LevelBadge level={data.levelOwn.level} /></span>
                <span className="text-right text-sm font-black text-violet-600">{data.levelOwn.experience.toLocaleString()}</span>
              </button>
            )}
            {data?.levelUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无用户等级数据</div>}
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[48px_minmax(0,1fr)_72px_88px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[70px_minmax(0,1fr)_120px_140px]">
              <span>排名</span><span>昵称</span><span className="text-right">卡片数</span><span className="text-right">收藏值</span>
            </div>
            {(data?.collectionUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[48px_minmax(0,1fr)_72px_88px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[70px_minmax(0,1fr)_120px_140px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-xs text-muted">{item.unlockedCardCount} 张</span>
                <span className="text-right text-sm font-black text-indigo-600">{item.totalCollectionValue.toLocaleString()}</span>
              </button>
            ))}
            {data?.collectionOwn && (
              <button className="grid w-full grid-cols-[48px_minmax(0,1fr)_72px_88px] items-center gap-2 border-t-2 border-indigo-200 bg-indigo-50 px-3 py-3 text-left hover:bg-indigo-100/70 sm:grid-cols-[70px_minmax(0,1fr)_120px_140px]" onClick={() => navigate(`/users/${data.collectionOwn!.id}`)}>
                <RankMark rank={data.collectionOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.collectionOwn.nickname}</span>
                <span className="text-right text-xs text-muted">{data.collectionOwn.unlockedCardCount} 张</span>
                <span className="text-right text-sm font-black text-indigo-600">{data.collectionOwn.totalCollectionValue.toLocaleString()}</span>
              </button>
            )}
            {data?.collectionUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">还没有用户获得卡片</div>}
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
