import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, Eye, Play, Plus, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../Modal";
import { AdminPagination, useAdminPagination } from "./AdminPagination";

type DecisionSummary = {
  id: string;
  status: string;
  preliminaryAnswer: string | null;
  finalAnswer: string | null;
  confidence: number | null;
  verifierStatus: string;
  errorKind: string | null;
  errorMessage: string | null;
  attemptCount: number;
  question: string;
  questionNumber: number;
  progressDelta: number | null;
  progressAfter: number | null;
  playerName: string;
  soupTitle: string;
  createdAt: string;
};

type DecisionDetail = {
  decision: DecisionSummary & {
    publicAnswer: string | null;
    unsupported: boolean;
    injectionDetected: boolean;
    matchedFacts: unknown[];
    verifierIssues: string[];
    roundStatus: string;
    roundProgress: number;
  };
  calls: Array<{
    id: string;
    callType: string;
    model: string;
    request: unknown;
    response: unknown;
    startedAt: string;
    durationMs: number;
    success: boolean;
    totalTokens: number | null;
    errorKind: string | null;
    errorMessage: string | null;
  }>;
  facts: Array<{
    id: string;
    content: string;
    weight: number;
    core: boolean;
    mustHave: boolean;
    state: "UNSEEN" | "TOUCHED" | "DISCOVERED";
  }>;
  corrections: Array<{
    id: string;
    correctedAnswer: string | null;
    reason: string;
    appliedToLiveRound: boolean;
    operatorName: string;
    createdAt: string;
  }>;
};

type RegressionCase = {
  id: string;
  soupId: string;
  soupTitle: string;
  name: string;
  question: string;
  expectedAnswer: string;
  expectedFactIds: string[];
  enabled: boolean;
  lastRun: null | { passed: boolean; actualAnswer: string | null; errorMessage: string | null; durationMs: number; createdAt: string };
};

const answerLabels: Record<string, string> = {
  yes: "是", no: "不是", both: "是也不是", unknown: "不知道", irrelevant: "不重要",
};

const statusLabels: Record<string, string> = {
  queued: "排队中", fast_answering: "快速判定", adjudicating: "完整判定", verifying: "二次验证",
  committing: "提交中", completed: "已完成", failed: "失败", cancelled: "已取消",
};

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-3 text-xs leading-5 text-blue-100">{JSON.stringify(value, null, 2)}</pre>;
}

export function AiHostAuditManagement() {
  const [items, setItems] = useState<DecisionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [factStateDraft, setFactStateDraft] = useState<Record<string, "UNSEEN" | "TOUCHED" | "DISCOVERED">>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [regressionCases, setRegressionCases] = useState<RegressionCase[]>([]);
  const [regressionRunning, setRegressionRunning] = useState(false);
  const [caseDraft, setCaseDraft] = useState({ soupId: "", name: "", question: "", expectedAnswer: "unknown", expectedFactIds: "" });
  const pagination = useAdminPagination(total);
  const { page, pageSize, onPageChange } = pagination;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status, q: query.trim(), limit: String(pageSize), offset: String((page - 1) * pageSize) });
      const data = await api<{ total: number; decisions: DecisionSummary[] }>(`/api/online-soup/admin/ai/decisions?${params}`, { bypassCache: true, dedupe: false });
      setItems(data.decisions);
      setTotal(data.total);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "AI 审计列表加载失败");
    } finally { setLoading(false); }
  }, [page, pageSize, query, status]);

  useEffect(() => { void load(); }, [load]);

  const loadRegressionCases = useCallback(async () => {
    try {
      const data = await api<{ cases: RegressionCase[] }>("/api/online-soup/admin/ai/regression-cases", { bypassCache: true, dedupe: false });
      setRegressionCases(data.cases);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "回归样本加载失败");
    }
  }, []);

  useEffect(() => { void loadRegressionCases(); }, [loadRegressionCases]);

  async function createRegressionCase() {
    const expectedFactIds = caseDraft.expectedFactIds.split(/[,，\s]+/).map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (!caseDraft.soupId.trim() || !caseDraft.name.trim() || !caseDraft.question.trim()) return;
    setSaving(true);
    try {
      await api("/api/online-soup/admin/ai/regression-cases", {
        method: "POST",
        body: { ...caseDraft, soupId: caseDraft.soupId.trim(), name: caseDraft.name.trim(), question: caseDraft.question.trim(), expectedFactIds, recentContext: [] },
      });
      setCaseDraft({ soupId: "", name: "", question: "", expectedAnswer: "unknown", expectedFactIds: "" });
      await loadRegressionCases();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "回归样本创建失败");
    } finally { setSaving(false); }
  }

  async function runRegressionCases() {
    setRegressionRunning(true);
    try {
      await api("/api/online-soup/admin/ai/regression-cases/run", { method: "POST", body: {} });
      await loadRegressionCases();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "回归执行失败");
    } finally { setRegressionRunning(false); }
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    setError("");
    try {
      const data = await api<DecisionDetail>(`/api/online-soup/admin/ai/decisions/${id}`, { bypassCache: true, dedupe: false });
      setDetail(data);
      setAnswer("");
      setFactStateDraft(Object.fromEntries(data.facts.map((fact) => [fact.id, fact.state])));
      setReason("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "AI 审计详情加载失败");
    } finally { setDetailLoading(false); }
  }

  async function submitCorrection() {
    if (!detail || !reason.trim()) return;
    const factStates = detail.facts.flatMap((fact) => factStateDraft[fact.id] && factStateDraft[fact.id] !== fact.state
      ? [{ factId: fact.id, state: factStateDraft[fact.id] }]
      : []);
    if (!answer && factStates.length === 0) return;
    setSaving(true);
    try {
      await api(`/api/online-soup/admin/ai/decisions/${detail.decision.id}/corrections`, {
        method: "POST",
        body: { ...(answer ? { answer } : {}), reason: reason.trim(), factStates },
      });
      await openDetail(detail.decision.id);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "AI 判定纠错失败");
    } finally { setSaving(false); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-xl font-black text-ink">AI 主持审计</h2><p className="text-sm text-muted">查看模型原始请求、结构化判定、事实状态和错误样本</p></div>
      <button className="btn btn-secondary" onClick={load}><RefreshCw size={16} />刷新</button>
    </div>
    <div className="flex flex-wrap gap-2 rounded-2xl border border-line bg-white p-3">
      <input className="field min-w-56 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { onPageChange(1); void load(); } }} placeholder="搜索问题、汤名或玩家" />
      <select className="field" value={status} onChange={(event) => { setStatus(event.target.value); onPageChange(1); }} aria-label="AI 判定状态">
        <option value="all">全部状态</option><option value="completed">已完成</option><option value="failed">失败</option><option value="adjudicating">判定中</option><option value="cancelled">已取消</option>
      </select>
    </div>
    {error && <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-line bg-slate-50 text-xs text-muted"><tr><th className="p-3">时间</th><th className="p-3">海龟汤 / 玩家</th><th className="p-3">问题</th><th className="p-3">答案</th><th className="p-3">进度</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id} className="border-b border-line last:border-0"><td className="p-3 text-xs">{new Date(item.createdAt).toLocaleString("zh-CN")}</td><td className="p-3"><p className="font-bold text-ink">{item.soupTitle}</p><p className="text-xs text-muted">{item.playerName}</p></td><td className="max-w-80 p-3"><p className="line-clamp-2">#{item.questionNumber} {item.question}</p>{item.errorMessage && <p className="mt-1 text-xs text-red-600">{item.errorMessage}</p>}</td><td className="p-3">{item.finalAnswer ? answerLabels[item.finalAnswer] : item.preliminaryAnswer ? `${answerLabels[item.preliminaryAnswer]}（临时）` : "—"}</td><td className="p-3">{item.progressDelta ? `+${item.progressDelta}%` : "0%"}{item.progressAfter != null && <small className="block text-muted">当前 {item.progressAfter}%</small>}</td><td className="p-3"><span className={item.status === "failed" ? "font-bold text-red-600" : "font-bold text-ink"}>{statusLabels[item.status] ?? item.status}</span><small className="block text-muted">验证：{item.verifierStatus}</small></td><td className="p-3"><button className="btn btn-secondary px-3" onClick={() => openDetail(item.id)}><Eye size={15} />详情</button></td></tr>)}</tbody>
      </table>
      {loading && <div className="p-8 text-center text-muted">加载中…</div>}{!loading && !items.length && <div className="p-10 text-center text-muted"><Bot className="mx-auto mb-2" />暂无 AI 判定记录</div>}
      {!loading && total > 0 && <div className="px-4 pb-4"><AdminPagination {...pagination} /></div>}
    </div>
    <section className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-ink">AI 回归样本</h3><p className="text-xs text-muted">执行同一套结构化判定协议；答案与发现事实必须同时一致才通过。</p></div><button className="btn btn-primary" disabled={regressionRunning || !regressionCases.some((item) => item.enabled)} onClick={runRegressionCases}><Play size={15} />{regressionRunning ? "执行中…" : "运行全部启用样本"}</button></div>
      <div className="grid gap-2 lg:grid-cols-[1fr_1fr_2fr_150px_1fr_auto]"><input className="field" value={caseDraft.soupId} onChange={(event) => setCaseDraft((draft) => ({ ...draft, soupId: event.target.value }))} placeholder="汤 ID" /><input className="field" value={caseDraft.name} onChange={(event) => setCaseDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="样本名称" /><input className="field" value={caseDraft.question} onChange={(event) => setCaseDraft((draft) => ({ ...draft, question: event.target.value }))} placeholder="玩家问题" /><select className="field" value={caseDraft.expectedAnswer} onChange={(event) => setCaseDraft((draft) => ({ ...draft, expectedAnswer: event.target.value }))}>{Object.entries(answerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="field" value={caseDraft.expectedFactIds} onChange={(event) => setCaseDraft((draft) => ({ ...draft, expectedFactIds: event.target.value }))} placeholder="期望事实，如 F01,F03" /><button className="btn btn-secondary" disabled={saving} onClick={createRegressionCase}><Plus size={15} />新增</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-line text-xs text-muted"><tr><th className="p-2">样本</th><th className="p-2">问题</th><th className="p-2">期望</th><th className="p-2">最近执行</th><th className="p-2">启用</th></tr></thead><tbody>{regressionCases.map((item) => <tr key={item.id} className="border-b border-line last:border-0"><td className="p-2"><strong>{item.name}</strong><small className="block text-muted">{item.soupTitle}</small></td><td className="max-w-96 p-2">{item.question}</td><td className="p-2">{answerLabels[item.expectedAnswer] ?? item.expectedAnswer}<small className="block text-muted">{item.expectedFactIds.join(", ") || "无新事实"}</small></td><td className="p-2">{item.lastRun ? <span className={item.lastRun.passed ? "font-bold text-emerald-700" : "font-bold text-red-600"}>{item.lastRun.passed ? "通过" : item.lastRun.errorMessage || `失败（实际 ${answerLabels[item.lastRun.actualAnswer ?? ""] ?? "—"}）`}<small className="block font-normal text-muted">{item.lastRun.durationMs}ms</small></span> : "未执行"}</td><td className="p-2"><input type="checkbox" checked={item.enabled} aria-label={`${item.name}启用状态`} onChange={async (event) => { await api(`/api/online-soup/admin/ai/regression-cases/${item.id}`, { method: "PATCH", body: { enabled: event.target.checked } }); await loadRegressionCases(); }} /></td></tr>)}</tbody></table>{!regressionCases.length && <p className="py-5 text-center text-sm text-muted">暂无回归样本</p>}</div>
    </section>
    {detailLoading && <div className="card p-8 text-center text-muted" role="status">审计详情加载中…</div>}
    {detail && <Modal onClose={() => setDetail(null)} full><div className="space-y-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-ink">AI 判定详情</h2><p className="mt-1 text-sm text-muted">{detail.decision.soupTitle} · {detail.decision.playerName}</p></div><button className="btn btn-secondary" onClick={() => setDetail(null)}>关闭</button></div>
      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={17} /><p>以下内容包含汤底、主持手册和模型原始输入，只限超级管理员排查错误。</p></div>
      <section className="card p-4"><h3 className="font-black text-ink">玩家问题</h3><p className="mt-2 whitespace-pre-wrap">{detail.decision.question}</p><div className="mt-3 grid gap-2 text-sm sm:grid-cols-4"><span>最终回答：{detail.decision.finalAnswer ? answerLabels[detail.decision.finalAnswer] : "—"}</span><span>置信度：{detail.decision.confidence ?? "—"}</span><span>无依据假设：{detail.decision.unsupported ? "是" : "否"}</span><span>Prompt Injection：{detail.decision.injectionDetected ? "是" : "否"}</span></div></section>
      <section><h3 className="mb-2 font-black text-ink">事实追踪</h3><div className="grid gap-2 sm:grid-cols-2">{detail.facts.map((fact) => <div key={fact.id} className="rounded-xl border border-line bg-white p-3"><div className="flex items-center justify-between gap-3"><strong>{fact.id}</strong><div className="flex items-center gap-2"><span className="text-sm text-muted">{fact.weight}%</span><select className="field h-8 py-0 text-xs" aria-label={`${fact.id}事实状态`} value={factStateDraft[fact.id] ?? fact.state} onChange={(event) => setFactStateDraft((current) => ({ ...current, [fact.id]: event.target.value as "UNSEEN" | "TOUCHED" | "DISCOVERED" }))}><option value="UNSEEN">UNSEEN</option><option value="TOUCHED">TOUCHED</option><option value="DISCOVERED">DISCOVERED</option></select></div></div><p className="mt-1 text-sm">{fact.content}</p><p className="mt-1 text-xs text-muted">{fact.core ? "核心 " : ""}{fact.mustHave ? "必需" : ""}</p></div>)}</div></section>
      <section className="space-y-3"><h3 className="font-black text-ink">模型调用路径</h3>{detail.calls.map((call) => <details key={call.id} className="rounded-xl border border-line bg-white p-3"><summary className="cursor-pointer font-bold">{call.callType} · {call.model} · {call.durationMs}ms · {call.success ? "成功" : "失败"}</summary><div className="mt-3 grid gap-3 lg:grid-cols-2"><div><p className="mb-1 text-xs font-bold text-muted">原始请求</p><JsonBlock value={call.request} /></div><div><p className="mb-1 text-xs font-bold text-muted">原始响应</p><JsonBlock value={call.response} /></div></div></details>)}</section>
      <section className="card p-4"><h3 className="font-black text-ink">人工纠错</h3><p className="mt-1 text-xs text-muted">可在上方修改事实状态；进行中回合会立即重算进度，已结束回合只记录审计，不回滚奖励。</p><div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto]"><select className="field" value={answer} onChange={(event) => setAnswer(event.target.value)}><option value="">不修改答案</option>{Object.entries(answerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="field" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="纠错原因（必填）" /><button className="btn btn-primary" disabled={saving || !reason.trim()} onClick={submitCorrection}>{saving ? "保存中…" : "记录纠错"}</button></div>{detail.corrections.length > 0 && <div className="mt-3 space-y-2">{detail.corrections.map((correction) => <p key={correction.id} className="rounded-lg bg-slate-50 p-2 text-xs">{correction.operatorName}：{correction.reason} · {correction.appliedToLiveRound ? "已应用" : "仅审计"}</p>)}</div>}</section>
    </div></Modal>}
  </div>;
}
