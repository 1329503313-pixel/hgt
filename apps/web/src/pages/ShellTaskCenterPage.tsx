import {
  BookOpenCheck,
  Bot,
  BookmarkCheck,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Crown,
  Gift,
  Heart,
  HeartHandshake,
  ListChecks,
  MessageSquareHeart,
  MessageCircleMore,
  Shell,
  Sparkles,
  Star,
  Trophy,
  UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { LevelBadge } from "../components/LevelBadge";
import { useApp } from "../context/AppContext";
import { useShellBalance } from "../shared/useShellBalance";
import type { ShellTask, ShellTaskCenter } from "../shared/types";

type TaskVisual = {
  icon: ComponentType<{ size?: number; className?: string }>;
  color: string;
};

const TASK_VISUALS: Record<ShellTask["type"], TaskVisual> = {
  daily_login: { icon: CalendarCheck2, color: "bg-sky-50 text-sky-600" },
  publish_soup: { icon: BookOpenCheck, color: "bg-indigo-50 text-indigo-600" },
  like_soup: { icon: Heart, color: "bg-rose-50 text-rose-500" },
  favorite_soup: { icon: Star, color: "bg-amber-50 text-amber-600" },
  publish_evaluation: { icon: MessageCircleMore, color: "bg-violet-50 text-violet-600" },
  speak_circle: { icon: UsersRound, color: "bg-cyan-50 text-cyan-600" },
  join_online_soup: { icon: Sparkles, color: "bg-fuchsia-50 text-fuchsia-600" },
  host_online_soup: { icon: Crown, color: "bg-orange-50 text-orange-600" },
  receive_soup_like: { icon: HeartHandshake, color: "bg-pink-50 text-pink-600" },
  receive_soup_favorite: { icon: BookmarkCheck, color: "bg-yellow-50 text-yellow-700" },
  receive_soup_evaluation: { icon: MessageSquareHeart, color: "bg-purple-50 text-purple-600" },
  soup_ai_played: { icon: Bot, color: "bg-blue-50 text-blue-600" },
  soup_online_completed: { icon: Trophy, color: "bg-emerald-50 text-emerald-600" },
};

function TaskIcon({ task, size = 21 }: { task: ShellTask; size?: number }) {
  const visual = TASK_VISUALS[task.type];
  const Icon = task.completed ? CheckCircle2 : visual.icon;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl ${task.completed ? "bg-emerald-50 text-emerald-600" : visual.color}`}
      style={{ width: size + 24, height: size + 24 }}
    >
      <Icon size={size} />
    </span>
  );
}

function ProgressBar({ task }: { task: ShellTask }) {
  const progress = Math.min(100, (task.progress / task.dailyLimit) * 100);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-all ${task.completed ? "bg-emerald-500" : "bg-primary"}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export default function ShellTaskCenterPage() {
  const navigate = useNavigate();
  const { user, loadingUser, openAuth, showToast } = useApp();
  const [data, setData] = useState<ShellTaskCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const liveShellBalance = useShellBalance(user?.id);

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

  if (loadingUser || loading) {
    return <section className="space-y-3"><PageTopBar title="任务中心" /><MineBackButton hideOnDesktop /><ListSkeleton rows={7} /></section>;
  }
  if (!user) {
    return (
      <section className="space-y-3">
        <PageTopBar title="任务中心" />
        <MineBackButton hideOnDesktop />
        <div className="card p-6 text-center"><p className="text-sm text-muted">登录后完成每日任务，同时获得贝壳和经验值。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div>
      </section>
    );
  }
  if (!data) {
    return <section className="space-y-3"><PageTopBar title="任务中心" /><MineBackButton hideOnDesktop /><div className="card p-6 text-center text-sm text-muted">暂时无法加载任务</div></section>;
  }

  const percentage = Math.min(100, Math.round((data.earnedToday / data.dailyLimit) * 100));
  const completedCount = data.tasks.filter((task) => task.completed).length;
  const goToTransactions = () => navigate("/mine/shells/transactions", { state: { shellReturnTo: "/mine/tasks" } });

  return (
    <section className="space-y-4 lg:space-y-6">
      <PageTopBar title="任务中心" />
      <MineBackButton hideOnDesktop />

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 p-5 text-white shadow-soft lg:col-span-6 lg:min-h-60 lg:p-7">
          <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full border-[32px] border-white/5" />
          <div className="absolute -bottom-20 right-24 h-44 w-44 rounded-full bg-white/5 blur-2xl" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-white/70">当前贝壳余额</p>
                <p className="mt-2 flex items-center gap-2 text-4xl font-black tracking-tight lg:text-5xl"><Shell size={34} />{(liveShellBalance ?? data.balance).toLocaleString()}</p>
              </div>
              <button className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold backdrop-blur-sm transition hover:bg-white/20 lg:px-4 lg:py-2.5" onClick={goToTransactions}>
                贝壳明细 <ChevronRight className="inline" size={14} />
              </button>
            </div>
            <div className="mt-7 lg:mt-auto">
              <div className="flex items-center justify-between text-xs font-bold text-white/80"><span>今日获取进度</span><span className="text-white">{data.earnedToday} / {data.dailyLimit}</span></div>
              <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${percentage}%` }} /></div>
              <p className="mt-3 text-xs leading-5 text-white/65">任务奖励自动到账；每日实际最多获得 {data.dailyLimit} 贝壳</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:col-span-6 lg:grid-cols-2 lg:gap-5">
          <div className="card flex min-h-28 flex-col justify-between p-4 lg:min-h-0 lg:p-5">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-primary"><CircleGauge size={21} /></span>
            <div className="mt-4"><p className="flex items-center gap-2 text-2xl font-black text-ink lg:text-3xl"><LevelBadge level={data.levelProgress.level} animated />{data.levelProgress.isMaxLevel ? "满级" : `${data.levelProgress.progressPercent}%`}</p><p className="mt-1 text-xs font-bold text-muted">当前成长等级</p></div>
          </div>
          <div className="card flex min-h-28 flex-col justify-between p-4 lg:min-h-0 lg:p-5">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Trophy size={21} /></span>
            <div className="mt-4"><p className="text-2xl font-black text-ink lg:text-3xl">{completedCount}<span className="ml-1 text-sm text-muted">/ {data.tasks.length}</span></p><p className="mt-1 text-xs font-bold text-muted">已完成任务</p></div>
          </div>
          <div className="card col-span-2 p-4 lg:p-5">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold text-muted">累计经验值</p><p className="mt-1 text-2xl font-black text-ink lg:text-3xl">{data.levelProgress.experience.toLocaleString()}<span className="ml-1 text-sm font-bold text-muted">EXP</span></p></div><div className="rounded-2xl bg-violet-50 px-3 py-2 text-right text-xs font-bold leading-5 text-violet-700">今日获得<br />+{data.earnedExperienceToday} EXP</div></div>
            <div className="mt-3 flex items-center justify-between text-xs font-bold text-muted"><span>{data.levelProgress.isMaxLevel ? "已达到最高等级" : `距 Lv${data.levelProgress.level + 1} 还需 ${data.levelProgress.remainingExperience.toLocaleString()} EXP`}</span><span className="text-ink">{data.levelProgress.isMaxLevel ? "MAX" : `${data.levelProgress.currentLevelExperience.toLocaleString()} / ${data.levelProgress.experienceForNextLevel.toLocaleString()}`}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500" style={{ width: `${data.levelProgress.progressPercent}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3.5 lg:px-6 lg:py-5">
          <ListChecks size={20} className="text-primary" />
          <div><h2 className="font-black text-ink lg:text-lg">每日任务</h2><p className="mt-0.5 hidden text-xs text-muted lg:block">完成后自动获得同等经验；经验不受每日贝壳获取上限影响，无需手动领取</p></div>
          <span className="ml-auto text-xs text-muted">北京时间 00:00 重置</span>
        </div>

        <div className="divide-y divide-line lg:hidden">
          {data.tasks.map((task) => (
            <article key={task.type} className="flex items-center gap-3 p-4">
              <TaskIcon task={task} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-ink">{task.name}</h3><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">+{task.reward} 贝壳</span><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-black text-violet-700">+{task.experienceReward} EXP</span></div>
                <p className="mt-1 text-xs text-muted">{task.description}</p>
                <div className="mt-2"><ProgressBar task={task} /></div>
              </div>
              <div className="shrink-0 text-right"><p className="text-sm font-black text-ink">{task.progress}/{task.dailyLimit}</p><p className="mt-1 text-[11px] text-muted">实得 {task.actualReward} 贝壳</p><p className="text-[11px] text-violet-600">+{task.actualExperience} EXP</p></div>
            </article>
          ))}
        </div>

        <div className="hidden lg:block">
          <div className="grid grid-cols-[minmax(300px,1.7fr)_0.9fr_minmax(220px,1fr)_0.8fr_0.6fr] items-center gap-5 border-b border-line bg-slate-50/70 px-6 py-3 text-xs font-bold text-muted">
            <span>任务内容</span><span>单次奖励</span><span>今日进度</span><span>今日实得</span><span className="text-right">状态</span>
          </div>
          <div className="divide-y divide-line">
            {data.tasks.map((task) => (
              <article key={task.type} className="grid grid-cols-[minmax(300px,1.7fr)_0.9fr_minmax(220px,1fr)_0.8fr_0.6fr] items-center gap-5 px-6 py-4 transition hover:bg-slate-50/60">
                <div className="flex min-w-0 items-center gap-3.5">
                  <TaskIcon task={task} size={20} />
                  <div className="min-w-0"><h3 className="font-black text-ink">{task.name}</h3><p className="mt-1 truncate text-xs text-muted">{task.description}</p></div>
                </div>
                <span className="font-black text-amber-700">+{task.reward} <span className="text-xs font-bold text-muted">贝壳</span><span className="mt-1 block text-violet-700">+{task.experienceReward} <span className="text-xs text-muted">EXP</span></span></span>
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold text-ink">{task.progress} / {task.dailyLimit}</span><span className="text-muted">{Math.min(100, Math.round((task.progress / task.dailyLimit) * 100))}%</span></div>
                  <ProgressBar task={task} />
                </div>
                <span className="font-black text-ink">{task.actualReward} <span className="text-xs font-bold text-muted">贝壳</span><span className="mt-1 block text-violet-700">{task.actualExperience} <span className="text-xs text-muted">EXP</span></span></span>
                <div className="text-right">
                  <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ${task.completed ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{task.completed ? "已完成" : "进行中"}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
