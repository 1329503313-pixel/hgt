import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Search, Star, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Evaluation } from "../../shared/types";
import { api, EvaluationsResponse } from "../../api";
import type { EvalForm } from "../../context/AppContext";
import { AdminColumn, ColumnSelector, gridTemplate } from "./ColumnSelector";
import { AdminPageSize, AdminPagination } from "./AdminPagination";
import { ListSkeleton } from "../Skeletons";
import { Modal } from "../Modal";
import { ScoreInput } from "../FormWidgets";

type EvalRow = Evaluation & { soupTitle: string };
type EvaluationColumn = "reviewer" | "total" | "soup" | "content" | "dimensions" | "createdAt" | "actions";

const evaluationColumns: readonly AdminColumn<EvaluationColumn>[] = [
  { key: "reviewer", label: "评价者", width: "130px" },
  { key: "total", label: "总分", width: "90px" },
  { key: "soup", label: "汤品", width: "minmax(180px, 1fr)" },
  { key: "content", label: "评价内容", width: "minmax(220px, 1.2fr)" },
  { key: "dimensions", label: "维度评分", width: "260px" },
  { key: "createdAt", label: "评价时间", width: "110px" },
  { key: "actions", label: "操作", width: "170px" }
];

const dimensionLabels: Array<{ key: "writing" | "logic" | "share" | "mechanism" | "twist" | "depth"; label: string }> = [
  { key: "writing", label: "文笔" },
  { key: "logic", label: "逻辑" },
  { key: "share", label: "分享" },
  { key: "mechanism", label: "机制" },
  { key: "twist", label: "反转" },
  { key: "depth", label: "深度" }
];

function evaluationToForm(evaluation: EvalRow): EvalForm {
  return {
    total: String(evaluation.total),
    writing: evaluation.writing == null ? "" : String(evaluation.writing),
    logic: evaluation.logic == null ? "" : String(evaluation.logic),
    share: evaluation.share == null ? "" : String(evaluation.share),
    mechanism: evaluation.mechanism == null ? "" : String(evaluation.mechanism),
    twist: evaluation.twist == null ? "" : String(evaluation.twist),
    depth: evaluation.depth == null ? "" : String(evaluation.depth),
    content: evaluation.content ?? ""
  };
}

export function EvaluationManagement() {
  const navigate = useNavigate();
  const [evaluations, setEvaluations] = useState<EvalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [editing, setEditing] = useState<EvalRow | null>(null);
  const [editForm, setEditForm] = useState<EvalForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<Set<EvaluationColumn>>(() => new Set(evaluationColumns.map((column) => column.key)));
  const template = useMemo(() => gridTemplate(evaluationColumns, visibleColumns), [visibleColumns]);

  const loadEvaluations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (submittedKeyword) params.set("keyword", submittedKeyword);
      params.set("limit", String(pageSize));
      params.set("offset", String((page - 1) * pageSize));
      const data = await api<EvaluationsResponse>(`/api/admin/evaluations?${params.toString()}`);
      setEvaluations(data.evaluations);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [submittedKeyword, page, pageSize]);

  useEffect(() => { loadEvaluations(); }, [loadEvaluations]);

  async function handleDelete(id: string, reviewer: string) {
    if (!confirm(`确定删除 ${reviewer} 的评价吗？`)) return;
    await api(`/api/evaluations/${id}`, { method: "DELETE" });
    setEvaluations((old) => old.filter((evaluation) => evaluation.id !== id));
    setTotal((old) => Math.max(0, old - 1));
  }

  function openEditor(evaluation: EvalRow) {
    setEditing(evaluation);
    setEditForm(evaluationToForm(evaluation));
    setSaveError("");
  }

  function closeEditor() {
    if (saving) return;
    setEditing(null);
    setEditForm(null);
    setSaveError("");
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!editing || !editForm) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await api<{ evaluation: EvalRow }>(`/api/admin/evaluations/${editing.id}`, {
        method: "PATCH",
        body: editForm
      });
      setEvaluations((old) => old.map((item) => item.id === editing.id ? result.evaluation : item));
      setEditing(null);
      setEditForm(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const patchEditForm = (next: Partial<EvalForm>) => {
    setEditForm((current) => current ? { ...current, ...next } : current);
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-black text-ink">评价管理</h2>
        <ColumnSelector columns={evaluationColumns} visible={visibleColumns} onChange={setVisibleColumns} />
      </div>

      <div className="mb-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-10 pl-4 pr-24"
            placeholder="搜索评价者、汤标题、内容..."
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setSubmittedKeyword(keyword.trim()); } }}
          />
          <button className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={() => { setPage(1); setSubmittedKeyword(keyword.trim()); }}>
            <Search size={18} />
            <span>搜索</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1180px]">
          <div className="mb-2 grid items-center justify-items-center gap-2 px-3 text-center text-xs font-bold text-muted" style={{ gridTemplateColumns: template }}>
            {evaluationColumns.filter((column) => visibleColumns.has(column.key)).map((column) => <span key={column.key}>{column.label}</span>)}
          </div>
          <div className="space-y-1">
            {evaluations.map((evaluation) => (
              <div key={evaluation.id} className="grid items-center justify-items-center gap-2 rounded-lg border border-line p-3 text-center text-sm" style={{ gridTemplateColumns: template }}>
                {visibleColumns.has("reviewer") && <strong className="max-w-full truncate">{evaluation.reviewer}</strong>}
                {visibleColumns.has("total") && <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-primary"><Star className="fill-amber-400 text-amber-400" size={12} />{evaluation.total}</span>}
                {visibleColumns.has("soup") && <button className="max-w-full truncate font-semibold text-ink hover:text-primary" onClick={() => navigate(`/soup/${evaluation.soupId}`)}>{evaluation.soupTitle || "查看汤品"}</button>}
                {visibleColumns.has("content") && <p className="line-clamp-2 max-w-full text-xs text-muted">{evaluation.content || "—"}</p>}
                {visibleColumns.has("dimensions") && (
                  <div className="flex flex-wrap justify-center gap-1 text-[11px] text-muted">
                    {dimensionLabels.map(({ key, label }) => evaluation[key] != null ? <span key={key} className="rounded bg-slate-100 px-1.5 py-0.5">{label} {evaluation[key]}</span> : null)}
                  </div>
                )}
                {visibleColumns.has("createdAt") && <span className="text-xs text-muted whitespace-nowrap">{new Date(evaluation.createdAt).toLocaleDateString()}</span>}
                {visibleColumns.has("actions") && (
                  <div className="flex items-center justify-center gap-1">
                    <button className="btn btn-secondary h-8 px-3 text-xs whitespace-nowrap" onClick={() => openEditor(evaluation)}><Pencil size={14} />编辑</button>
                    <button className="btn btn-danger h-8 px-3 text-xs whitespace-nowrap" onClick={() => handleDelete(evaluation.id, evaluation.reviewer)}><Trash2 size={14} />删除</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {loading && <ListSkeleton rows={6} />}
      {evaluations.length === 0 && !loading && <p className="py-8 text-center text-sm text-muted">暂无可管理的评价</p>}
      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPage(1); setPageSize(size); }}
      />
      {editing && editForm && (
        <Modal onClose={closeEditor}>
          <form className="space-y-4" onSubmit={handleSave}>
            <div>
              <h2 className="text-xl font-black text-ink">编辑评价</h2>
              <p className="mt-1 text-sm text-muted">{editing.reviewer} · 《{editing.soupTitle}》</p>
            </div>
            <ScoreInput label="总评分" value={editForm.total} onChange={(total) => patchEditForm({ total })} required />
            <div className="grid gap-3 sm:grid-cols-2">
              {dimensionLabels.map(({ key, label }) => (
                <ScoreInput key={key} label={label} value={editForm[key]} onChange={(value) => patchEditForm({ [key]: value })} />
              ))}
            </div>
            <label className="space-y-1">
              <span className="label">评价内容</span>
              <textarea
                className="field min-h-24"
                maxLength={500}
                placeholder="评价内容（选填，最多 500 字）"
                value={editForm.content}
                onChange={(event) => patchEditForm({ content: event.target.value })}
              />
              <span className="block text-right text-xs text-muted">剩余 {500 - editForm.content.length} 字</span>
            </label>
            {saveError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{saveError}</p>}
            <button className="btn btn-primary w-full" disabled={saving}>{saving ? "保存中..." : "保存评价"}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
