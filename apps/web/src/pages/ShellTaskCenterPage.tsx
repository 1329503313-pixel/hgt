import { CheckCircle2, ChevronRight, Gift, ListChecks, Shell } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { useApp } from "../context/AppContext";
import type { ShellTaskCenter } from "../shared/types";

export default function ShellTaskCenterPage() {
  const navigate = useNavigate();
  const { user, loadingUser, openAuth, showToast } = useApp();
  const [data, setData] = useState<ShellTaskCenter | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api<ShellTaskCenter>("/api/me/shells", { bypassCache: true })
      .then(setData)
      .catch((error) => showToast(error instanceof Error ? error.message : "任务中心加载失败"))
      .finally(() => setLoading(false));
  }, [user?.id, showToast]);

  if (loadingUser || loading) return <section className="space-y-3"><PageTopBar title="任务中心" /><MineBackButton /><ListSkeleton rows={7} /></section>;
  if (!user) return (
    <section className="space-y-3">
      <PageTopBar title="任务中心" />
      <MineBackButton />
      <div className="card p-6 text-center"><p className="text-sm text-muted">登录后完成每日任务并获得贝壳。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div>
    </section>
  );
  if (!data) return <section className="space-y-3"><PageTopBar title="任务中心" /><MineBackButton /><div className="card p-6 text-center text-sm text-muted">暂时无法加载任务</div></section>;

  const percentage = Math.min(100, Math.round(data.earnedToday / data.dailyLimit * 100));
  return (
    <section className="space-y-3">
      <PageTopBar title="任务中心" />
      <MineBackButton />

      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600 p-5 text-white shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-white/80">当前贝壳</p>
            <p className="mt-1 flex items-center gap-2 text-3xl font-black"><Shell size={28} />{data.balance.toLocaleString()}</p>
          </div>
          <button
            className="rounded-full bg-white/15 px-3 py-2 text-xs font-bold backdrop-blur-sm"
            onClick={() =>
              navigate("/mine/shells/transactions", {
                state: { shellReturnTo: "/mine/tasks" },
              })
            }
          >
            贝壳明细 <ChevronRight className="inline" size={14} />
          </button>
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs font-bold"><span>今日已获得</span><span>{data.earnedToday}/{data.dailyLimit}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${percentage}%` }} /></div>
          <p className="mt-2 text-xs text-white/75">任务理论奖励 {data.theoreticalMaximum} 贝壳，每日实际最多获得 {data.dailyLimit} 贝壳</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3"><ListChecks size={18} className="text-primary" /><h2 className="font-black text-ink">每日任务</h2><span className="ml-auto text-xs text-muted">北京时间 00:00 重置</span></div>
        <div className="divide-y divide-line">
          {data.tasks.map((task) => (
            <article key={task.type} className="flex items-center gap-3 p-4">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${task.completed ? "bg-emerald-100 text-emerald-600" : "bg-blue-50 text-primary"}`}>
                {task.completed ? <CheckCircle2 size={22} /> : <Gift size={21} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><h3 className="font-black text-ink">{task.name}</h3><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">+{task.reward} 贝壳/次</span></div>
                <p className="mt-1 text-xs text-muted">{task.description}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${task.completed ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${Math.min(100, task.progress / task.dailyLimit * 100)}%` }} /></div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-black text-ink">{task.progress}/{task.dailyLimit}</p>
                <p className="mt-1 text-[11px] text-muted">实得 {task.actualReward}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
