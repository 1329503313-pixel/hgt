import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ChevronLeft, ChevronRight, Clock3, Database,
  KeyRound, LoaderCircle, RefreshCw, ShieldCheck, UserRound,
} from "lucide-react";
import { api } from "../../api";

type RunStatus = "active" | "completed" | "superseded" | "abandoned";

type RunSummary = {
  id: string;
  storyId: string;
  storyVersionId: string;
  versionNumber: number;
  owner: { id: string; nickname: string };
  room: { id: string; code: string | null; name: string | null; status: string | null } | null;
  status: RunStatus;
  isCurrentSave: boolean;
  stateVersion: number;
  turnSequence: number;
  eventSequence: number;
  worldTimeSeconds: number;
  finalEndingId: string | null;
  keyNodeCount: number;
  failedTurnCount: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type RunDetail = RunSummary & { stateSnapshot: unknown };

type TurnAudit = {
  id: string;
  sequence: number | null;
  idempotencyKey: string;
  rawInput: string;
  inputClassification: string | null;
  injectionRisk: string | null;
  status: string;
  attemptCount: number;
  stateVersionBefore: number;
  stateVersionAfter: number | null;
  errorCode: string | null;
  processingExpiresAt: string | null;
  resolution: unknown | null;
  playerVisiblePacket: unknown | null;
  narrative: string | null;
  createdAt: string;
  completedAt: string | null;
};

type EventAudit = {
  id: string;
  turnId: string;
  eventIndex: number;
  eventType: string;
  worldTimeBefore: number;
  worldTimeAfter: number;
  actorIds: string[];
  targetIds: string[];
  locationId: string | null;
  irreversible: boolean;
  keyNode: boolean;
  keyNodeType: string | null;
  idempotencyKey: string;
  committedStateVersion: number;
  summary: string;
  payload: unknown;
  createdAt: string;
};

const PAGE_SIZE = 15;
const statusLabels: Record<RunStatus, string> = {
  active: "进行中", completed: "已结局", superseded: "已被新存档替换", abandoned: "已放弃",
};

function StatusPill({ status }: { status: RunStatus }) {
  const style = status === "active"
    ? "bg-blue-50 text-blue-700 ring-blue-200"
    : status === "completed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-slate-100 text-slate-700 ring-slate-200";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1 ${style}`}>{statusLabels[status]}</span>;
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function worldTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const day = Math.floor(seconds / 86_400) + 1;
  const withinDay = seconds % 86_400;
  const hour = Math.floor(withinDay / 3_600).toString().padStart(2, "0");
  const minute = Math.floor((withinDay % 3_600) / 60).toString().padStart(2, "0");
  const second = (withinDay % 60).toString().padStart(2, "0");
  return `第 ${day} 天 ${hour}:${minute}:${second}`;
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return <details className="rounded-xl border border-line bg-slate-50">
    <summary className="min-h-11 cursor-pointer select-none px-3 py-3 text-sm font-black text-ink">{label}</summary>
    <pre className="max-h-[28rem] overflow-auto border-t border-line p-3 text-xs leading-5 text-slate-700">{JSON.stringify(value, null, 2)}</pre>
  </details>;
}

export function MysteryRunAudit({ storyId }: { storyId: string }) {
  const [status, setStatus] = useState<RunStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [turns, setTurns] = useState<TurnAudit[]>([]);
  const [events, setEvents] = useState<EventAudit[]>([]);
  const [keyOnly, setKeyOnly] = useState(true);
  const [nextEventCursor, setNextEventCursor] = useState<number | null>(null);
  const [hasMoreEvents, setHasMoreEvents] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const eventsRequestSequence = useRef(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadRuns = useCallback(async () => {
    const requestSequence = ++listRequestSequence.current;
    setListLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (status !== "all") query.set("status", status);
      const data = await api<{ runs: RunSummary[]; total: number }>(
        `/api/admin/mysteries/${storyId}/runs?${query.toString()}`,
        { bypassCache: true, dedupe: false },
      );
      if (requestSequence !== listRequestSequence.current) return;
      setRuns(data.runs);
      setTotal(data.total);
      setSelectedRunId((current) => data.runs.some((run) => run.id === current) ? current : data.runs[0]?.id ?? null);
    } catch (loadError) {
      if (requestSequence !== listRequestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "运行审计列表加载失败");
    } finally {
      if (requestSequence === listRequestSequence.current) setListLoading(false);
    }
  }, [page, status, storyId]);

  const loadDetail = useCallback(async () => {
    if (!selectedRunId) return;
    const requestSequence = ++detailRequestSequence.current;
    setDetailLoading(true);
    setError(null);
    try {
      const data = await api<{ run: RunDetail; turns: TurnAudit[] }>(
        `/api/admin/mysteries/${storyId}/runs/${selectedRunId}`,
        { bypassCache: true, dedupe: false },
      );
      if (requestSequence !== detailRequestSequence.current) return;
      setDetail(data.run);
      setTurns(data.turns);
    } catch (loadError) {
      if (requestSequence !== detailRequestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "谜局进程详情加载失败");
    } finally {
      if (requestSequence === detailRequestSequence.current) setDetailLoading(false);
    }
  }, [selectedRunId, storyId]);

  const loadEvents = useCallback(async (append: boolean, before?: number) => {
    if (!selectedRunId) return;
    const requestSequence = ++eventsRequestSequence.current;
    setEventsLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ keyOnly: String(keyOnly), limit: "30" });
      if (before !== undefined) query.set("before", String(before));
      const data = await api<{ events: EventAudit[]; hasMore: boolean; nextCursor: number | null }>(
        `/api/admin/mysteries/${storyId}/runs/${selectedRunId}/events?${query.toString()}`,
        { bypassCache: true, dedupe: false },
      );
      if (requestSequence !== eventsRequestSequence.current) return;
      setEvents((current) => append ? [...current, ...data.events] : data.events);
      setHasMoreEvents(data.hasMore);
      setNextEventCursor(data.nextCursor);
    } catch (loadError) {
      if (requestSequence !== eventsRequestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "事件账本加载失败");
    } finally {
      if (requestSequence === eventsRequestSequence.current) setEventsLoading(false);
    }
  }, [keyOnly, selectedRunId, storyId]);

  useEffect(() => {
    setStatus("all");
    setPage(1);
    setSelectedRunId(null);
    setDetail(null);
    setTurns([]);
    setEvents([]);
    detailRequestSequence.current += 1;
    eventsRequestSequence.current += 1;
  }, [storyId]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => {
    setDetail(null);
    setTurns([]);
    if (selectedRunId) void loadDetail();
    else detailRequestSequence.current += 1;
  }, [loadDetail, selectedRunId]);
  useEffect(() => {
    setEvents([]);
    setNextEventCursor(null);
    setHasMoreEvents(false);
    if (selectedRunId) void loadEvents(false);
    else eventsRequestSequence.current += 1;
  }, [keyOnly, loadEvents, selectedRunId]);

  const currentRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? detail, [detail, runs, selectedRunId]);
  const refresh = () => {
    void loadRuns();
    if (selectedRunId) {
      void loadDetail();
      void loadEvents(false);
    }
  };

  return <section className="space-y-4" aria-label="谜局运行审计">
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="flex items-center gap-2 font-black text-ink"><ShieldCheck size={19} className="text-primary" />运行审计</h3><p className="mt-1 text-sm leading-6 text-muted">只读检查存档、回合、关键节点和服务端状态；这些隐藏信息不会进入玩家房间。</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="mystery-run-status">进程状态</label>
          <select id="mystery-run-status" className="field min-h-11" value={status} onChange={(event) => { setStatus(event.target.value as RunStatus | "all"); setPage(1); }}>
            <option value="all">全部进程</option><option value="active">进行中</option><option value="completed">已结局</option><option value="superseded">已替换</option><option value="abandoned">已放弃</option>
          </select>
          <button type="button" className="btn btn-secondary min-h-11" onClick={refresh} disabled={listLoading || detailLoading || eventsLoading}><RefreshCw size={16} className={listLoading || detailLoading || eventsLoading ? "animate-spin" : ""} />刷新</button>
        </div>
      </div>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{error}</p>}
    </div>

    <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-2xl border border-line bg-white p-3">
        <div className="mb-3 flex items-center justify-between"><strong className="text-sm text-ink">进程列表</strong><span className="text-xs font-bold text-muted">共 {total} 局</span></div>
        {listLoading ? <div className="space-y-2" role="status" aria-label="进程列表加载中">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-100" />)}</div>
          : runs.length ? <div className="space-y-2">{runs.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`min-h-11 w-full rounded-xl border p-3 text-left transition ${selectedRunId === run.id ? "border-primary bg-blue-50 ring-2 ring-blue-100" : "border-line hover:border-blue-300 hover:bg-slate-50"}`}>
            <div className="flex items-start justify-between gap-2"><span className="min-w-0"><strong className="block truncate text-sm text-ink">{run.owner.nickname}</strong><span className="mt-1 block text-xs text-muted">版本 {run.versionNumber} · 回合 {run.turnSequence}</span></span><StatusPill status={run.status} /></div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-muted">{run.isCurrentSave && <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-700">当前存档</span>}<span className="rounded-full bg-slate-100 px-2 py-1">关键节点 {run.keyNodeCount}</span>{run.failedTurnCount > 0 && <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">失败 {run.failedTurnCount}</span>}</div>
          </button>)}</div>
          : <div className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-muted"><Activity className="mx-auto mb-2 text-slate-300" />当前筛选下没有进程。</div>}
        {totalPages > 1 && <div className="mt-3 flex items-center justify-between border-t border-line pt-3"><button type="button" className="btn btn-secondary min-h-11 px-3" disabled={page <= 1 || listLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="上一页"><ChevronLeft size={16} /></button><span className="text-xs font-bold text-muted">{page} / {totalPages}</span><button type="button" className="btn btn-secondary min-h-11 px-3" disabled={page >= totalPages || listLoading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} aria-label="下一页"><ChevronRight size={16} /></button></div>}
      </aside>

      <div className="min-w-0 space-y-4">
        {detailLoading && !detail ? <div className="grid min-h-64 place-items-center rounded-2xl border border-line bg-white" role="status"><span className="flex items-center gap-2 font-bold text-muted"><LoaderCircle size={18} className="animate-spin" />正在读取进程状态</span></div>
          : detail && currentRun ? <>
            <section className="rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-ink">{detail.owner.nickname} 的进程</h3><StatusPill status={detail.status} />{detail.isCurrentSave && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-200">当前存档</span>}</div><p className="mt-1 break-all font-mono text-xs text-muted">{detail.id}</p></div><p className="text-xs font-bold text-muted">最后更新 {dateTime(detail.updatedAt)}</p></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {[{ icon: Clock3, label: "世界时间", value: worldTime(detail.worldTimeSeconds) }, { icon: Activity, label: "回合 / 状态版本", value: `${detail.turnSequence} / ${detail.stateVersion}` }, { icon: Database, label: "事件账本", value: `${detail.eventSequence} 条` }, { icon: KeyRound, label: "关键节点", value: `${detail.keyNodeCount} 条` }].map((item) => <div key={item.label} className="rounded-xl border border-line bg-slate-50 p-3"><item.icon size={16} className="text-primary" /><span className="mt-2 block text-xs font-bold text-muted">{item.label}</span><strong className="mt-1 block text-sm text-ink">{item.value}</strong></div>)}
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-bold text-muted">房主</dt><dd className="mt-1 flex items-center gap-1.5 font-bold text-ink"><UserRound size={15} />{detail.owner.nickname}</dd></div><div><dt className="font-bold text-muted">绑定房间</dt><dd className="mt-1 font-bold text-ink">{detail.room ? `${detail.room.name ?? "未命名房间"}${detail.room.code ? `（${detail.room.code}）` : ""}` : "当前未绑定房间"}</dd></div><div><dt className="font-bold text-muted">启动时间</dt><dd className="mt-1 text-ink">{dateTime(detail.startedAt)}</dd></div><div><dt className="font-bold text-muted">最终结局</dt><dd className="mt-1 break-all font-mono text-xs text-ink">{detail.finalEndingId ?? "尚未达成"}</dd></div></dl>
              <div className="mt-4"><JsonDetails label="查看完整 Run State 快照" value={detail.stateSnapshot} /></div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-ink">事件账本</h3><p className="mt-1 text-sm text-muted">按最新事件倒序展示，关键节点保留其完整服务端提案。</p></div><div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="事件筛选"><button type="button" className={`min-h-11 rounded-lg px-3 text-sm font-black ${keyOnly ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => setKeyOnly(true)}>关键节点</button><button type="button" className={`min-h-11 rounded-lg px-3 text-sm font-black ${!keyOnly ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => setKeyOnly(false)}>全部事件</button></div></div>
              {eventsLoading && events.length === 0 ? <div className="mt-4 flex min-h-32 items-center justify-center gap-2 text-sm font-bold text-muted" role="status"><LoaderCircle size={17} className="animate-spin" />正在读取事件账本</div>
                : events.length ? <ol className="mt-4 space-y-3">{events.map((event) => <li key={event.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">#{event.eventIndex}</span><strong className="break-all text-sm text-ink">{event.eventType}</strong>{event.keyNode && <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-black text-violet-700">{event.keyNodeType || "关键节点"}</span>}{event.irreversible && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-800"><AlertTriangle size={11} />不可逆</span>}</div><p className="mt-2 text-sm leading-6 text-ink">{event.summary}</p></div><span className="shrink-0 text-xs font-bold text-muted">{worldTime(event.worldTimeAfter)}</span></div>
                  <p className="mt-2 break-all font-mono text-[11px] leading-5 text-muted">状态版本 {event.committedStateVersion} · {event.locationId || "无地点"} · {worldTime(event.worldTimeBefore)} → {worldTime(event.worldTimeAfter)}</p>
                  <p className="mt-1 break-all text-xs text-muted">行动者：{event.actorIds.join("、") || "无"} · 对象：{event.targetIds.join("、") || "无"}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted">幂等键 {event.idempotencyKey} · 提交于 {dateTime(event.createdAt)}</p>
                  <div className="mt-3"><JsonDetails label="查看事件原始载荷" value={event.payload} /></div>
                </li>)}</ol>
                : <div className="mt-4 rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-muted">{keyOnly ? "本局还没有关键节点。" : "本局还没有已提交事件。"}</div>}
              {hasMoreEvents && <button type="button" className="btn btn-secondary mt-4 min-h-11 w-full" disabled={eventsLoading || nextEventCursor == null} onClick={() => nextEventCursor != null && void loadEvents(true, nextEventCursor)}>{eventsLoading ? <LoaderCircle size={16} className="animate-spin" /> : <ChevronRight size={16} />}加载更早事件</button>}
            </section>

            <section className="rounded-2xl border border-line bg-white p-4"><h3 className="font-black text-ink">最近回合</h3><p className="mt-1 text-sm text-muted">最多显示最近 50 个回合，包含重试次数和失败代码。</p>
              {turns.length ? <div className="mt-4 space-y-2">{turns.map((turn) => <details key={turn.id} className="rounded-xl border border-line"><summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-3"><span className="min-w-0"><strong className="text-sm text-ink">{turn.sequence == null ? "未提交回合" : `回合 ${turn.sequence}`}</strong><span className="ml-2 text-xs font-bold text-muted">{turn.status} · 尝试 {turn.attemptCount}</span></span><span className="text-xs text-muted">{dateTime(turn.createdAt)}</span></summary><div className="space-y-3 border-t border-line p-3"><div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">分类：{turn.inputClassification || "未分类"}</span><span className={`rounded-full px-2.5 py-1 ${turn.injectionRisk === "blocked" ? "bg-red-50 text-red-700" : turn.injectionRisk === "suspicious" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>注入风险：{turn.injectionRisk || "未检测"}</span>{turn.errorCode && <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">错误：{turn.errorCode}</span>}</div><div><strong className="text-xs text-muted">玩家原始输入</strong><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{turn.rawInput === "__SYSTEM_INITIALIZATION__" ? "系统初始化" : turn.rawInput}</p></div>{turn.narrative && <div><strong className="text-xs text-muted">已提交叙事</strong><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{turn.narrative}</p></div>}<p className="break-all font-mono text-[11px] leading-5 text-muted">状态 {turn.stateVersionBefore} → {turn.stateVersionAfter ?? "未提交"} · 幂等键 {turn.idempotencyKey}{turn.processingExpiresAt ? ` · 处理租约至 ${dateTime(turn.processingExpiresAt)}` : ""}</p>{turn.resolution != null && <JsonDetails label="查看裁决提案" value={turn.resolution} />}{turn.playerVisiblePacket != null && <JsonDetails label="查看玩家可见信息包" value={turn.playerVisiblePacket} />}</div></details>)}</div> : <p className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-muted">还没有玩家回合。</p>}
            </section>
          </> : <div className="grid min-h-64 place-items-center rounded-2xl border border-line bg-white text-sm text-muted">从左侧选择一个进程查看审计详情。</div>}
      </div>
    </div>
  </section>;
}
