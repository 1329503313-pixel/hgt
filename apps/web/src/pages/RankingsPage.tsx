import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Crown, Dices, Flame, GalleryVerticalEnd, Gift, Heart, Medal, Sparkles, TrendingUp, Trophy } from "lucide-react";
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

type DrawUserRank = {
  rank: number;
  id: string;
  nickname: string;
  avatar: string | null;
  drawCount: number;
};

type LevelUserRank = {
  rank: number;
  id: string;
  nickname: string;
  avatar: string | null;
  level: number;
  experience: number;
};

type CharmUserRank = {
  rank: number;
  id: string;
  nickname: string;
  avatar: string | null;
  charmValue: number;
};

type GenerosityUserRank = {
  rank: number;
  id: string;
  nickname: string;
  avatar: string | null;
  generosityValue: number;
};

type RankingsResponse = {
  hotSoups: HotSoupRank[];
  hotSoupOwn: HotSoupRank | null;
  achievementUsers: AchievementUserRank[];
  achievementOwn: AchievementUserRank | null;
  levelUsers: LevelUserRank[];
  levelOwn: LevelUserRank | null;
  charmUsers: CharmUserRank[];
  charmOwn: CharmUserRank | null;
  generosityUsers: GenerosityUserRank[];
  generosityOwn: GenerosityUserRank | null;
  collectionUsers: CollectionUserRank[];
  collectionOwn: CollectionUserRank | null;
  drawUsers: DrawUserRank[];
  drawOwn: DrawUserRank | null;
};

type RankingTab = "soups" | "users" | "level" | "charm" | "generosity" | "collection" | "draws";
type RankingGroup = "content" | "user";
type RankingPeriod = "7d" | "30d" | "all";

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
  const initialTab: RankingTab = requestedTab === "users" || requestedTab === "level" || requestedTab === "charm" || requestedTab === "generosity" || requestedTab === "collection" || requestedTab === "draws" ? requestedTab : "soups";
  const [tab, setTab] = useState<RankingTab>(initialTab);
  const [period, setPeriod] = useState<RankingPeriod>("7d");
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const cacheKey = `hgt:rankings:v10:${user.id}:${period}`;
    const cached = readSessionCache<RankingsResponse>(cacheKey, 2 * 60_000);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    Promise.all([
      api<Omit<RankingsResponse, "collectionUsers" | "collectionOwn" | "drawUsers" | "drawOwn">>(`/api/rankings?period=${period}`, { bypassCache: true }),
      api<{
        ranking: CollectionUserRank[];
        own: CollectionUserRank | null;
        drawRanking: DrawUserRank[];
        drawOwn: DrawUserRank | null;
      }>(`/api/asset-rankings?period=${period}`, { bypassCache: true })
    ])
      .then(([base, assets]) => {
        if (cancelled) return;
        const result = {
          ...base,
          collectionUsers: assets.ranking,
          collectionOwn: assets.own,
          drawUsers: assets.drawRanking,
          drawOwn: assets.drawOwn
        };
        setData(result);
        setError("");
        writeSessionCache(cacheKey, result);
      })
      .catch((reason) => { if (!cancelled && !cached) setError(reason instanceof Error ? reason.message : "排行榜加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, user?.id]);

  if (loadingUser) return <section className="space-y-3"><PageTopBar title="排行榜" /><MineBackButton hideOnDesktop /><ListSkeleton rows={8} /></section>;
  if (!user) return (
    <section className="space-y-3">
      <PageTopBar title="排行榜" />
      <MineBackButton hideOnDesktop />
      <div className="card p-6 text-center"><p className="text-sm text-muted">登录后可查看排行榜。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div>
    </section>
  );

  const periodLabel = period === "7d" ? "7日" : period === "30d" ? "30日" : "永久";
  const metricText = (value: number) => `${period === "all" || value < 0 ? "" : "+"}${value.toLocaleString()}`;
  const metricTitle = (name: string) => period === "all" ? name : `${periodLabel}${name}增长`;

  const rankingOptions: Array<{
    key: RankingTab;
    group: RankingGroup;
    label: string;
    shortLabel: string;
    description: string;
    icon: typeof Flame;
    tone: string;
  }> = [
    {
      key: "soups",
      group: "content",
      label: "热门海龟汤",
      shortLabel: "热门",
      description: "发现全站讨论度最高的故事",
      icon: Flame,
      tone: "is-hot"
    },
    {
      key: "users",
      group: "user",
      label: "用户成就榜",
      shortLabel: "成就",
      description: "记录社区探索与创作里程碑",
      icon: Trophy,
      tone: "is-achievement"
    },
    {
      key: "level",
      group: "user",
      label: "用户等级榜",
      shortLabel: "等级",
      description: "见证社区用户的成长历程",
      icon: TrendingUp,
      tone: "is-level"
    },
    {
      key: "collection",
      group: "user",
      label: "卡牌收藏榜",
      shortLabel: "收藏",
      description: "展示最具价值的数字收藏",
      icon: GalleryVerticalEnd,
      tone: "is-collection"
    },
    {
      key: "draws",
      group: "user",
      label: "抽卡榜",
      shortLabel: "抽卡",
      description: "看看谁抽出了最多卡牌",
      icon: Dices,
      tone: "is-draws"
    },
    {
      key: "charm",
      group: "user",
      label: "用户魅力榜",
      shortLabel: "魅力",
      description: "记录用户收到礼物积累的魅力",
      icon: Heart,
      tone: "is-charm"
    },
    {
      key: "generosity",
      group: "user",
      label: "用户慷慨榜",
      shortLabel: "慷慨",
      description: "记录用户送出礼物贡献的魅力价值",
      icon: Gift,
      tone: "is-generosity"
    }
  ];

  const activeCategory = rankingOptions.find((item) => item.key === tab)!;
  const activeGroup = activeCategory.group;
  const visibleRankingOptions = rankingOptions.filter((item) => item.group === activeGroup);
  const podium = tab === "soups"
    ? (data?.hotSoups ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.title, detail: item.author, value: item.heatValue, suffix: "热力", avatar: null as string | null }))
    : tab === "users"
      ? (data?.achievementUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: "社区成就", value: item.achievementPoints, suffix: "成就点", avatar: item.avatar }))
      : tab === "level"
        ? (data?.levelUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: `Lv${item.level}`, value: item.experience, suffix: "经验值", avatar: item.avatar }))
        : tab === "charm"
          ? (data?.charmUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: "礼物魅力", value: item.charmValue, suffix: "魅力值", avatar: item.avatar }))
          : tab === "generosity"
            ? (data?.generosityUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: "送礼贡献", value: item.generosityValue, suffix: "慷慨值", avatar: item.avatar }))
            : tab === "collection"
              ? (data?.collectionUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: `${item.unlockedCardCount} 张卡牌`, value: item.totalCollectionValue, suffix: "收藏值", avatar: item.avatar }))
              : (data?.drawUsers ?? []).slice(0, 3).map((item) => ({ id: item.id, rank: item.rank, name: item.nickname, detail: "成功抽卡", value: item.drawCount, suffix: "抽卡数", avatar: item.avatar }));

  const ownRank = tab === "soups" ? data?.hotSoupOwn : tab === "users" ? data?.achievementOwn : tab === "level" ? data?.levelOwn : tab === "charm" ? data?.charmOwn : tab === "generosity" ? data?.generosityOwn : tab === "collection" ? data?.collectionOwn : data?.drawOwn;

  function openPodiumItem(item: (typeof podium)[number]) {
    navigate(tab === "soups" ? `/soup/${item.id}` : `/users/${item.id}`);
  }

  function selectGroup(group: RankingGroup) {
    if (group === activeGroup) return;
    setTab(group === "content" ? "soups" : "users");
  }

  const rankingRewardSummary = (() => {
    if (activeGroup !== "user") return null;
    if (period === "all") return "永久榜不参与定时奖励";
    const currencyBoard = tab === "level" || tab === "charm" || tab === "generosity";
    if (currencyBoard) {
      return period === "7d"
        ? "周一 00:00 结算：第1名 100 EXP＋50 贝壳；第2–3名 60 EXP＋30 贝壳；第4–5名 40 EXP＋20 贝壳；第6–10名 30 EXP＋15 贝壳"
        : "每月首日 00:00 结算：第1名 500 EXP＋200 贝壳；第2–3名 300 EXP＋100 贝壳；第4–5名 200 EXP＋80 贝壳；第6–10名 100 EXP＋50 贝壳";
    }
    return period === "7d"
      ? "周一 00:00 结算：第1名 月亮小船×1；第2–3名 智慧水晶球×2；第4–5名 神秘钥匙×3；第6–10名 神秘钥匙×2"
      : "每月首日 00:00 结算：第1名 深海明珠×1；第2–3名 月亮小船×2；第4–5名 月亮小船×1；第6–10名 月亮小船×1";
  })();

  return (
    <section className="rankings-page space-y-3 lg:space-y-5">
      <PageTopBar title="排行榜" />
      <MineBackButton hideOnDesktop />

      <div className="rankings-filter-panel card">
        <div className="rankings-filter-heading">
          <div>
            <p className="hidden text-xs font-black tracking-[0.16em] text-primary lg:block">LEADERBOARDS</p>
            <h2 className="font-black text-ink lg:mt-1 lg:text-xl">选择排行榜</h2>
          </div>
          <p>{period === "all" ? "展示累计总值" : `展示最近${periodLabel}内增长的数值`}，各榜单取前 10 名</p>
        </div>

        <div className="rankings-filter-grid">
          <div className="rankings-filter-group">
            <span className="rankings-filter-label">榜单对象</span>
            <div className="rankings-segmented" aria-label="排行榜对象">
              <button type="button" className={activeGroup === "content" ? "is-active" : ""} onClick={() => selectGroup("content")} aria-pressed={activeGroup === "content"}>作品榜</button>
              <button type="button" className={activeGroup === "user" ? "is-active" : ""} onClick={() => selectGroup("user")} aria-pressed={activeGroup === "user"}>用户榜</button>
            </div>
          </div>

          <div className="rankings-filter-group rankings-metric-group">
            <span className="rankings-filter-label">排行维度</span>
            <div className="rankings-metric-options" aria-label="排行榜维度">
              {visibleRankingOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button key={option.key} type="button" className={`${option.tone} ${tab === option.key ? "is-active" : ""}`} onClick={() => setTab(option.key)} aria-pressed={tab === option.key}>
                    <Icon size={16} />
                    <span>{option.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rankings-filter-group">
            <span className="rankings-filter-label">统计周期</span>
            <div className="rankings-segmented" aria-label="排行榜时间范围">
              {([
                ["7d", "7日"],
                ["30d", "30日"],
                ["all", "永久"]
              ] as const).map(([value, label]) => (
                <button key={value} type="button" className={period === value ? "is-active" : ""} onClick={() => setPeriod(value)} aria-pressed={period === value}>{label}</button>
              ))}
            </div>
          </div>
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
                  <span className="rankings-podium-value"><strong>{metricText(item.value)}</strong><small>{period === "all" ? item.suffix : tab === "soups" ? "周期热力" : `${item.suffix}增长`}</small></span>
                </button>
              ))}
            </div>
          ) : <p className="py-10 text-center text-sm text-muted">暂无可展示数据</p>}
          <div className="rankings-rule-card">
            <Sparkles size={17} />
            <div><strong>{periodLabel}{activeCategory.label}统计口径</strong><p>{tab === "draws" ? `按${period === "all" ? "累计" : `最近${periodLabel}内`}成功抽出的卡牌张数排列，单抽计 1、十连计 10。` : tab === "soups" && period !== "all" ? `按最近${periodLabel}内的浏览、当前有效点赞与收藏、本周期新增或更新评价计算周期热力。` : <>{period === "all" ? "按累计总值排列。" : `按最近${periodLabel}内的净增长值排列。`}{tab === "collection" ? "统计收藏值增长。" : tab === "level" ? "统计经验增长。" : tab === "charm" ? "统计收礼获得的魅力增长。" : tab === "generosity" ? "统计送礼贡献的魅力价值。" : tab === "users" ? "统计成就点增长。" : "统计累计热力。"}</>}</p></div>
          </div>
          {ownRank && <div className="rankings-own-summary"><span>我的{periodLabel}排名</span><strong>第 {ownRank.rank} 名</strong></div>}
        </aside>

      <div className="rankings-table-card card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${tab === "soups" ? "bg-orange-50 text-orange-500" : tab === "collection" ? "bg-indigo-50 text-indigo-600" : tab === "draws" ? "bg-cyan-50 text-cyan-600" : tab === "level" ? "bg-violet-50 text-violet-600" : tab === "charm" ? "bg-rose-50 text-rose-600" : tab === "generosity" ? "bg-amber-50 text-amber-600" : "bg-amber-50 text-amber-500"}`}>
            {tab === "soups" ? <Flame size={22} /> : tab === "collection" ? <GalleryVerticalEnd size={22} /> : tab === "draws" ? <Dices size={22} /> : tab === "level" ? <TrendingUp size={22} /> : tab === "charm" ? <Heart size={22} /> : tab === "generosity" ? <Gift size={22} /> : <Medal size={22} />}
          </span>
          <div className="min-w-0"><p className="hidden text-[11px] font-black tracking-[0.14em] text-primary lg:block">{activeGroup === "content" ? "CONTENT RANKING" : "USER RANKING"}</p><h2 className="font-black text-ink lg:mt-0.5 lg:text-lg">{periodLabel} · {activeCategory.label} Top 10</h2><p className="mt-0.5 text-xs text-muted">{activeCategory.description} · {period === "all" ? "按累计总值排列" : tab === "soups" ? `按最近${periodLabel}周期热力排列` : `按最近${periodLabel}内增长值排列`}</p></div>
        </div>
        {rankingRewardSummary && <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-2 text-xs font-bold leading-5 text-amber-800"><Gift className="mr-1 inline" size={13} />排行榜奖励：{rankingRewardSummary}</div>}

        {loading ? <ListSkeleton rows={8} /> : error ? <div className="p-10 text-center text-sm text-danger">{error}</div> : tab === "soups" ? (
          <div>
            <div className="grid grid-cols-[44px_minmax(0,1fr)_80px_80px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]">
              <span>排名</span><span>汤名</span><span>作者</span><span className="text-right">{metricTitle("热力")}</span>
            </div>
            {(data?.hotSoups ?? []).map((item) => (
              <button key={item.id} type="button" className="ranking-table-row grid w-full grid-cols-[44px_minmax(0,1fr)_80px_80px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]" onClick={() => navigate(`/soup/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.title}</span>
                <span className="truncate text-xs text-muted sm:text-sm">{item.author}</span>
                <span className="text-right text-sm font-black text-orange-500">{metricText(item.heatValue)}</span>
              </button>
            ))}
            {data?.hotSoupOwn && (
              <button type="button" className="grid w-full grid-cols-[44px_minmax(0,1fr)_80px_80px] items-center gap-2 border-t-2 border-orange-200 bg-orange-50 px-3 py-3 text-left hover:bg-orange-100/70 sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]" onClick={() => navigate(`/soup/${data.hotSoupOwn!.id}`)}>
                <RankMark rank={data.hotSoupOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.hotSoupOwn.title}</span>
                <span className="truncate text-xs text-muted sm:text-sm">{data.hotSoupOwn.author}</span>
                <span className="text-right text-sm font-black text-orange-500">{metricText(data.hotSoupOwn.heatValue)}</span>
              </button>
            )}
            {data?.hotSoups.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无可排行的海龟汤</div>}
          </div>
        ) : tab === "users" ? (
          <div>
            <div className="grid grid-cols-[60px_minmax(0,1fr)_100px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_160px]">
              <span>排名</span><span>昵称</span><span className="text-right">{metricTitle("成就点")}</span>
            </div>
            {(data?.achievementUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-sm font-black text-amber-600">{metricText(item.achievementPoints)}</span>
              </button>
            ))}
            {data?.achievementOwn && (
              <button className="grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-t-2 border-amber-200 bg-amber-50 px-3 py-3 text-left hover:bg-amber-100/70 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${data.achievementOwn!.id}`)}>
                <RankMark rank={data.achievementOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.achievementOwn.nickname}</span>
                <span className="text-right text-sm font-black text-amber-600">{metricText(data.achievementOwn.achievementPoints)}</span>
              </button>
            )}
            {data?.achievementUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无用户成就点数据</div>}
          </div>
        ) : tab === "level" ? (
          <div>
            <div className="grid grid-cols-[52px_minmax(0,1fr)_68px_92px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]">
              <span>排名</span><span>昵称</span><span className="text-center">当前等级</span><span className="text-right">{metricTitle("经验")}</span>
            </div>
            {(data?.levelUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[52px_minmax(0,1fr)_68px_92px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="flex justify-center"><LevelBadge level={item.level} /></span>
                <span className="text-right text-sm font-black text-violet-600">{metricText(item.experience)}</span>
              </button>
            ))}
            {data?.levelOwn && (
              <button className="grid w-full grid-cols-[52px_minmax(0,1fr)_68px_92px] items-center gap-2 border-t-2 border-violet-200 bg-violet-50 px-3 py-3 text-left hover:bg-violet-100/70 sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]" onClick={() => navigate(`/users/${data.levelOwn!.id}`)}>
                <RankMark rank={data.levelOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.levelOwn.nickname}</span>
                <span className="flex justify-center"><LevelBadge level={data.levelOwn.level} /></span>
                <span className="text-right text-sm font-black text-violet-600">{metricText(data.levelOwn.experience)}</span>
              </button>
            )}
            {data?.levelUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无用户等级数据</div>}
          </div>
        ) : tab === "charm" ? (
          <div>
            <div className="grid grid-cols-[60px_minmax(0,1fr)_100px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_160px]">
              <span>排名</span><span>昵称</span><span className="text-right">{metricTitle("魅力值")}</span>
            </div>
            {(data?.charmUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-rose-50/50 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-sm font-black text-rose-600">{metricText(item.charmValue)}</span>
              </button>
            ))}
            {data?.charmOwn && (
              <button className="grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-t-2 border-rose-200 bg-rose-50 px-3 py-3 text-left hover:bg-rose-100/70 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${data.charmOwn!.id}`)}>
                <RankMark rank={data.charmOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.charmOwn.nickname}</span>
                <span className="text-right text-sm font-black text-rose-600">{metricText(data.charmOwn.charmValue)}</span>
              </button>
            )}
            {data?.charmUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无用户魅力值数据</div>}
          </div>
        ) : tab === "generosity" ? (
          <div>
            <div className="grid grid-cols-[60px_minmax(0,1fr)_100px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_160px]">
              <span>排名</span><span>昵称</span><span className="text-right">{metricTitle("慷慨值")}</span>
            </div>
            {(data?.generosityUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-amber-50/50 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-sm font-black text-amber-600">{metricText(item.generosityValue)}</span>
              </button>
            ))}
            {data?.generosityOwn && (
              <button className="grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-t-2 border-amber-200 bg-amber-50 px-3 py-3 text-left hover:bg-amber-100/70 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${data.generosityOwn!.id}`)}>
                <RankMark rank={data.generosityOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.generosityOwn.nickname}</span>
                <span className="text-right text-sm font-black text-amber-600">{metricText(data.generosityOwn.generosityValue)}</span>
              </button>
            )}
            {data?.generosityUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无用户慷慨值数据</div>}
          </div>
        ) : tab === "collection" ? (
          <div>
            <div className="grid grid-cols-[48px_minmax(0,1fr)_72px_88px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[70px_minmax(0,1fr)_120px_140px]">
              <span>排名</span><span>昵称</span><span className="text-right">持有卡片</span><span className="text-right">{metricTitle("收藏值")}</span>
            </div>
            {(data?.collectionUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[48px_minmax(0,1fr)_72px_88px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[70px_minmax(0,1fr)_120px_140px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-xs text-muted">{item.unlockedCardCount} 张</span>
                <span className="text-right text-sm font-black text-indigo-600">{metricText(item.totalCollectionValue)}</span>
              </button>
            ))}
            {data?.collectionOwn && (
              <button className="grid w-full grid-cols-[48px_minmax(0,1fr)_72px_88px] items-center gap-2 border-t-2 border-indigo-200 bg-indigo-50 px-3 py-3 text-left hover:bg-indigo-100/70 sm:grid-cols-[70px_minmax(0,1fr)_120px_140px]" onClick={() => navigate(`/users/${data.collectionOwn!.id}`)}>
                <RankMark rank={data.collectionOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.collectionOwn.nickname}</span>
                <span className="text-right text-xs text-muted">{data.collectionOwn.unlockedCardCount} 张</span>
                <span className="text-right text-sm font-black text-indigo-600">{metricText(data.collectionOwn.totalCollectionValue)}</span>
              </button>
            )}
            {data?.collectionUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">还没有用户获得卡片</div>}
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[60px_minmax(0,1fr)_100px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_160px]">
              <span>排名</span><span>昵称</span><span className="text-right">{period === "all" ? "累计抽卡" : `${periodLabel}抽卡`}</span>
            </div>
            {(data?.drawUsers ?? []).map((item) => (
              <button key={item.id} className="ranking-table-row grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-cyan-50/50 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-sm font-black text-cyan-600">{item.drawCount.toLocaleString()} 张</span>
              </button>
            ))}
            {data?.drawOwn && (
              <button className="grid w-full grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-t-2 border-cyan-200 bg-cyan-50 px-3 py-3 text-left hover:bg-cyan-100/70 sm:grid-cols-[80px_minmax(0,1fr)_160px]" onClick={() => navigate(`/users/${data.drawOwn!.id}`)}>
                <RankMark rank={data.drawOwn.rank} />
                <span className="truncate text-sm font-bold text-ink">{data.drawOwn.nickname}</span>
                <span className="text-right text-sm font-black text-cyan-600">{data.drawOwn.drawCount.toLocaleString()} 张</span>
              </button>
            )}
            {data?.drawUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">该周期内还没有抽卡记录</div>}
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
