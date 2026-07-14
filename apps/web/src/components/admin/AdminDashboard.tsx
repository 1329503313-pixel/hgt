import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, BarChart3, CalendarDays, Eye, MessageSquare, RefreshCw, Soup, Star, ThumbsUp, TrendingDown, TrendingUp, Users } from "lucide-react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip
} from "chart.js";
import { Bar, Doughnut, Line, Radar } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";

ChartJS.register(CategoryScale, LinearScale, RadialLinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);

type DashboardRange = "7d" | "15d" | "30d" | "90d";
type PeriodMetric = { current: number; previous: number; changePercent: number | null };
type GrowthMetric = { total: number; today: PeriodMetric; week: PeriodMetric };

type DashboardResponse = {
  generatedAt: string;
  timezone: "Asia/Shanghai";
  range: DashboardRange;
  summary: { users: GrowthMetric; soups: GrowthMetric; evaluations: GrowthMetric };
  trend: Array<{ date: string; users: number; soups: number; evaluations: number }>;
  userActivity: {
    today: number;
    last7Days: number;
    todayRate: number | null;
    daily: Array<{ date: string; users: number }>;
  };
  soups: {
    byType: Array<{ name: string; count: number }>;
    original: number;
    nonOriginal: number;
    publicSurface: number;
    publicBottom: number;
    aiEnabled: number;
    sensitive: number;
    top: Array<{ id: string; title: string; views: number; evaluations: number; comprehensiveScore: number; likes: number; favorites: number; heatValue: number }>;
  };
  evaluations: {
    averageTotal: number | null;
    withContentRate: number | null;
    scoreBuckets: Array<{ label: string; count: number }>;
    dimensions: Record<"writing" | "logic" | "share" | "mechanism" | "twist" | "depth", number | null>;
  };
};

const numberFormat = new Intl.NumberFormat("zh-CN");
const palette = ["#2563EB", "#14B8A6", "#F59E0B", "#8B5CF6", "#EC4899", "#64748B", "#22C55E", "#EF4444"];

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function GrowthTag({ metric, label }: { metric: PeriodMetric; label: string }) {
  const change = metric.changePercent;
  const rising = change != null && change > 0;
  const falling = change != null && change < 0;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label} <strong className="ml-1 text-ink">+{numberFormat.format(metric.current)}</strong></span>
      <span
        className={`inline-flex items-center gap-0.5 rounded-full px-2 py-1 font-bold ${
          rising ? "bg-emerald-50 text-emerald-700" : falling ? "bg-red-50 text-red-600" : "bg-slate-100 text-muted"
        }`}
        title={`上一可比周期：${metric.previous}`}
      >
        {rising ? <TrendingUp size={12} /> : falling ? <TrendingDown size={12} /> : null}
        {change == null ? "新增" : `${change > 0 ? "+" : ""}${change}%`}
      </span>
    </div>
  );
}

function MetricCard({
  title,
  metric,
  icon,
  accent
}: {
  title: string;
  metric: GrowthMetric;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <section className="card overflow-hidden p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-bold text-muted">{title}</p>
          <p className="mt-1 text-3xl font-black tracking-tight text-ink">{numberFormat.format(metric.total)}</p>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${accent}`}>{icon}</div>
      </div>
      <div className="mt-4 space-y-2 border-t border-line pt-3">
        <GrowthTag label="今日新增" metric={metric.today} />
        <GrowthTag label="本周新增" metric={metric.week} />
      </div>
    </section>
  );
}

function ChartCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-4">
        <h2 className="font-black text-ink">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-label="正在加载数据看板">
      <div className="h-14 rounded-2xl bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-44 rounded-2xl bg-slate-200" />)}
      </div>
      <div className="h-80 rounded-2xl bg-slate-200" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-80 rounded-2xl bg-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>("30d");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const loadDashboard = useCallback(async (force = false) => {
    const currentRequest = ++requestId.current;
    if (data) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const result = await api<DashboardResponse>(`/api/admin/dashboard?range=${range}${force ? "&refresh=1" : ""}`);
      if (currentRequest === requestId.current) setData(result);
    } catch (loadError) {
      if (currentRequest === requestId.current) setError(loadError instanceof Error ? loadError.message : "数据看板加载失败");
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [data, range]);

  useEffect(() => { loadDashboard(); }, [range]);

  const trendData = useMemo(() => ({
    labels: data?.trend.map((item) => shortDate(item.date)) ?? [],
    datasets: [
      { label: "新增用户", data: data?.trend.map((item) => item.users) ?? [], borderColor: "#2563EB", backgroundColor: "rgba(37,99,235,.1)", tension: 0.3, pointRadius: 2 },
      { label: "新增汤品", data: data?.trend.map((item) => item.soups) ?? [], borderColor: "#14B8A6", backgroundColor: "rgba(20,184,166,.1)", tension: 0.3, pointRadius: 2 },
      { label: "新增评价", data: data?.trend.map((item) => item.evaluations) ?? [], borderColor: "#F59E0B", backgroundColor: "rgba(245,158,11,.1)", tension: 0.3, pointRadius: 2 }
    ]
  }), [data]);

  const activityData = useMemo(() => ({
    labels: data?.userActivity.daily.map((item) => shortDate(item.date)) ?? [],
    datasets: [{
      label: "登录用户",
      data: data?.userActivity.daily.map((item) => item.users) ?? [],
      borderColor: "#2563EB",
      backgroundColor: "rgba(37,99,235,.12)",
      fill: true,
      tension: 0.3,
      pointRadius: 2
    }]
  }), [data]);

  const typeData = useMemo(() => ({
    labels: data?.soups.byType.map((item) => item.name) ?? [],
    datasets: [{ data: data?.soups.byType.map((item) => item.count) ?? [], backgroundColor: palette, borderWidth: 0 }]
  }), [data]);

  const evaluationBarData = useMemo(() => ({
    labels: data?.evaluations.scoreBuckets.map((item) => item.label) ?? [],
    datasets: [{ label: "评价数量", data: data?.evaluations.scoreBuckets.map((item) => item.count) ?? [], backgroundColor: ["#FCA5A5", "#FCD34D", "#60A5FA", "#34D399"], borderRadius: 6 }]
  }), [data]);

  const dimensionEntries = data ? [
    ["文笔", data.evaluations.dimensions.writing],
    ["逻辑", data.evaluations.dimensions.logic],
    ["分享性", data.evaluations.dimensions.share],
    ["机制", data.evaluations.dimensions.mechanism],
    ["反转", data.evaluations.dimensions.twist],
    ["深度", data.evaluations.dimensions.depth]
  ] as const : [];
  const dimensionData = {
    labels: dimensionEntries.map(([label]) => label),
    datasets: [{
      label: "六维均分",
      data: dimensionEntries.map(([, value]) => value ?? 0),
      backgroundColor: "rgba(37,99,235,.16)",
      borderColor: "#2563EB",
      pointBackgroundColor: "#2563EB",
      borderWidth: 2
    }]
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: { legend: { position: "top" as const, labels: { usePointStyle: true, boxWidth: 8 } } },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: range === "90d" ? 10 : 12 } },
      y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(148,163,184,.16)" } }
    }
  };

  if (loading && !data) return <DashboardSkeleton />;
  if (!data) {
    return (
      <div className="card flex min-h-72 flex-col items-center justify-center p-8 text-center">
        <AlertCircle className="text-red-500" size={36} />
        <h2 className="mt-3 font-black text-ink">数据看板加载失败</h2>
        <p className="mt-1 text-sm text-muted">{error || "请稍后重试"}</p>
        <button className="btn btn-primary mt-4" onClick={() => loadDashboard(true)}><RefreshCw size={16} />重新加载</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="card flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="text-primary" size={20} />
            <h2 className="font-black text-ink">平台数据概览</h2>
          </div>
          <p className="mt-1 text-xs text-muted">北京时间 · 更新于 {new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-slate-100 p-1" aria-label="趋势时间范围">
            {(["7d", "15d", "30d", "90d"] as DashboardRange[]).map((item) => (
              <button
                key={item}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${range === item ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`}
                onClick={() => setRange(item)}
              >
                近 {item.replace("d", "")} 天
              </button>
            ))}
          </div>
          <button className="btn btn-secondary h-9 px-3 text-xs" disabled={refreshing} onClick={() => loadDashboard(true)}>
            <RefreshCw className={refreshing ? "animate-spin" : ""} size={15} />{refreshing ? "刷新中" : "刷新"}
          </button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">刷新失败，当前仍展示上一次数据：{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="用户总数" metric={data.summary.users} accent="bg-blue-50 text-primary" icon={<Users size={20} />} />
        <MetricCard title="汤品总数" metric={data.summary.soups} accent="bg-teal-50 text-teal-600" icon={<Soup size={20} />} />
        <MetricCard title="评价总数" metric={data.summary.evaluations} accent="bg-amber-50 text-amber-600" icon={<MessageSquare size={20} />} />
      </div>

      <ChartCard title="内容增长趋势" description="按北京时间自然日统计；当天数据截至当前时刻">
        <div className="h-72"><Line data={trendData} options={lineOptions} /></div>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="用户登录活跃" description="登录用户指当天有登录或会话初始化记录的用户">
          <div className="mb-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-blue-50 p-3"><Activity size={16} className="text-primary" /><strong className="mt-2 block text-xl text-ink">{numberFormat.format(data.userActivity.today)}</strong><span className="text-xs text-muted">今日登录</span></div>
            <div className="rounded-xl bg-teal-50 p-3"><CalendarDays size={16} className="text-teal-600" /><strong className="mt-2 block text-xl text-ink">{numberFormat.format(data.userActivity.last7Days)}</strong><span className="text-xs text-muted">近 7 天登录</span></div>
            <div className="rounded-xl bg-amber-50 p-3"><TrendingUp size={16} className="text-amber-600" /><strong className="mt-2 block text-xl text-ink">{data.userActivity.todayRate == null ? "—" : `${data.userActivity.todayRate}%`}</strong><span className="text-xs text-muted">今日活跃率</span></div>
          </div>
          <div className="h-52"><Line data={activityData} options={{ ...lineOptions, plugins: { legend: { display: false } } }} /></div>
        </ChartCard>

        <ChartCard title="汤品类型分布" description="按当前存续汤品统计">
          {data.soups.byType.length > 0 ? <div className="h-72"><Doughnut data={typeData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" as const, labels: { usePointStyle: true, boxWidth: 8 } } }, cutout: "62%" }} /></div> : <div className="grid h-72 place-items-center text-sm text-muted">暂无汤品数据</div>}
        </ChartCard>
      </div>

      <ChartCard title="汤品内容状态">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["原创", data.soups.original, "bg-emerald-50 text-emerald-700"],
            ["非原创", data.soups.nonOriginal, "bg-slate-100 text-slate-700"],
            ["公开汤面", data.soups.publicSurface, "bg-blue-50 text-primary"],
            ["公开汤底", data.soups.publicBottom, "bg-cyan-50 text-cyan-700"],
            ["AI 玩汤", data.soups.aiEnabled, "bg-violet-50 text-violet-700"],
            ["敏感内容", data.soups.sensitive, "bg-red-50 text-red-600"]
          ].map(([label, value, className]) => (
            <div key={String(label)} className={`rounded-xl p-3 ${className}`}><strong className="block text-xl">{numberFormat.format(Number(value))}</strong><span className="text-xs font-semibold">{label}</span></div>
          ))}
        </div>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="评价分布" description={`平台平均总分 ${data.evaluations.averageTotal ?? "—"} · 文字评价占比 ${data.evaluations.withContentRate == null ? "—" : `${data.evaluations.withContentRate}%`}`}>
          <div className="h-64"><Bar data={evaluationBarData} options={{ ...lineOptions, plugins: { legend: { display: false } } }} /></div>
        </ChartCard>
        <ChartCard title="评价六维均分" description="仅统计已填写的维度评分">
          {dimensionEntries.some(([, value]) => value != null) ? <div className="h-64"><Radar data={dimensionData} options={{ responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 5, ticks: { stepSize: 1, display: false }, grid: { color: "rgba(148,163,184,.22)" }, angleLines: { color: "rgba(148,163,184,.22)" } } }, plugins: { legend: { display: false } } }} /></div> : <div className="grid h-64 place-items-center text-sm text-muted">暂无维度评分</div>}
        </ChartCard>
      </div>

      <ChartCard title="热门汤品 Top 10" description="热力值 =（综合评分 + 2）×（浏览 +（点赞 + 1）×（收藏 + 1）×（评价 + 1）× 5），按热力值降序排列">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr className="border-b border-line text-xs text-muted"><th className="px-3 py-2">排名</th><th className="px-3 py-2">汤品</th><th className="px-3 py-2 text-right">综合评分</th><th className="px-3 py-2 text-right">热力值</th><th className="px-3 py-2 text-right">浏览</th><th className="px-3 py-2 text-right">评价</th><th className="px-3 py-2 text-right">点赞</th><th className="px-3 py-2 text-right">收藏</th></tr></thead>
            <tbody>
              {data.soups.top.map((item, index) => (
                <tr key={item.id} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-3 font-black text-muted">{index + 1}</td>
                  <td className="px-3 py-3"><button className="max-w-72 truncate font-bold text-ink hover:text-primary" onClick={() => navigate(`/soup/${item.id}`)}>{item.title}</button></td>
                  <td className="px-3 py-3 text-right font-bold text-primary">{item.comprehensiveScore.toFixed(1)}</td>
                  <td className="px-3 py-3 text-right font-black text-amber-600">{numberFormat.format(item.heatValue)}</td>
                  <td className="px-3 py-3 text-right text-muted"><span className="inline-flex items-center gap-1"><Eye size={13} />{numberFormat.format(item.views)}</span></td>
                  <td className="px-3 py-3 text-right text-muted"><span className="inline-flex items-center gap-1"><MessageSquare size={13} />{numberFormat.format(item.evaluations)}</span></td>
                  <td className="px-3 py-3 text-right text-muted"><span className="inline-flex items-center gap-1"><ThumbsUp size={13} />{numberFormat.format(item.likes)}</span></td>
                  <td className="px-3 py-3 text-right text-muted"><span className="inline-flex items-center gap-1"><Star size={13} />{numberFormat.format(item.favorites)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.soups.top.length === 0 && <p className="py-8 text-center text-sm text-muted">暂无汤品数据</p>}
        </div>
      </ChartCard>
    </div>
  );
}
