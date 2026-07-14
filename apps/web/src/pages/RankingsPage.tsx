import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Flame, Medal, Trophy } from "lucide-react";
import { api } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { useApp } from "../context/AppContext";

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
  achievementPoints: number;
};

type RankingsResponse = {
  hotSoups: HotSoupRank[];
  achievementUsers: AchievementUserRank[];
};

function RankMark({ rank }: { rank: number }) {
  const style = rank === 1
    ? "bg-amber-100 text-amber-600 ring-amber-200"
    : rank === 2
      ? "bg-slate-200 text-slate-600 ring-slate-300"
      : rank === 3
        ? "bg-orange-100 text-orange-600 ring-orange-200"
        : "bg-slate-100 text-muted ring-slate-200";
  return <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ring-1 ${style}`}>{rank}</span>;
}

export default function RankingsPage() {
  const navigate = useNavigate();
  const { user, loadingUser, openAuth } = useApp();
  const [tab, setTab] = useState<"soups" | "users">("soups");
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api<RankingsResponse>("/api/rankings")
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "排行榜加载失败"))
      .finally(() => setLoading(false));
  }, [user]);

  if (loadingUser) return <section className="space-y-3"><PageTopBar title="排行榜" /><div className="card p-8 text-center text-sm text-muted">正在加载排行榜…</div></section>;
  if (!user) return (
    <section className="space-y-3">
      <PageTopBar title="排行榜" />
      <div className="card p-6 text-center"><p className="text-sm text-muted">登录后可查看排行榜。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div>
    </section>
  );

  return (
    <section className="space-y-3">
      <PageTopBar title="排行榜" />
      <button className="flex min-h-10 items-center gap-2 text-sm font-bold text-muted" onClick={() => navigate("/mine")}>
        <ArrowLeft size={17} /> 返回我的
      </button>

      <div className="card p-2">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${tab === "soups" ? "bg-primary text-white shadow-sm" : "text-muted hover:bg-blue-50 hover:text-primary"}`} onClick={() => setTab("soups")}>
            <Flame size={18} />热门海龟汤
          </button>
          <button type="button" className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${tab === "users" ? "bg-primary text-white shadow-sm" : "text-muted hover:bg-blue-50 hover:text-primary"}`} onClick={() => setTab("users")}>
            <Trophy size={18} />用户成就点排名
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${tab === "soups" ? "bg-orange-50 text-orange-500" : "bg-amber-50 text-amber-500"}`}>
            {tab === "soups" ? <Flame size={22} /> : <Medal size={22} />}
          </span>
          <div><h2 className="font-black text-ink">{tab === "soups" ? "热门海龟汤 Top 10" : "用户成就点 Top 10"}</h2><p className="mt-0.5 text-xs text-muted">{tab === "soups" ? "按平台热力值从高到低排列" : "同分时，先达到当前成就点的用户优先"}</p></div>
        </div>

        {loading ? <div className="p-10 text-center text-sm text-muted">正在加载排行榜…</div> : error ? <div className="p-10 text-center text-sm text-danger">{error}</div> : tab === "soups" ? (
          <div>
            <div className="grid grid-cols-[44px_minmax(0,1fr)_80px_80px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]">
              <span>排名</span><span>汤名</span><span>作者</span><span className="text-right">热力值</span>
            </div>
            {(data?.hotSoups ?? []).map((item) => (
              <button key={item.id} type="button" className="grid w-full grid-cols-[44px_minmax(0,1fr)_80px_80px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left last:border-0 hover:bg-blue-50/50 sm:grid-cols-[60px_minmax(0,1fr)_140px_120px]" onClick={() => navigate(`/soup/${item.id}`)}>
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.title}</span>
                <span className="truncate text-xs text-muted sm:text-sm">{item.author}</span>
                <span className="text-right text-sm font-black text-orange-500">{item.heatValue.toLocaleString()}</span>
              </button>
            ))}
            {data?.hotSoups.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无可排行的海龟汤</div>}
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[60px_minmax(0,1fr)_100px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_160px]">
              <span>排名</span><span>昵称</span><span className="text-right">成就点</span>
            </div>
            {(data?.achievementUsers ?? []).map((item) => (
              <div key={item.id} className="grid grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2 border-b border-line/70 px-3 py-3 last:border-0 sm:grid-cols-[80px_minmax(0,1fr)_160px]">
                <RankMark rank={item.rank} />
                <span className="truncate text-sm font-bold text-ink">{item.nickname}</span>
                <span className="text-right text-sm font-black text-amber-600">{item.achievementPoints.toLocaleString()}</span>
              </div>
            ))}
            {data?.achievementUsers.length === 0 && <div className="p-10 text-center text-sm text-muted">暂无用户成就点数据</div>}
          </div>
        )}
      </div>
    </section>
  );
}
