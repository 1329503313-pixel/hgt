import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Star, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Evaluation } from "../../shared/types";
import { api, EvaluationsResponse } from "../../api";
import { AdminColumn, ColumnSelector, gridTemplate } from "./ColumnSelector";
import { AdminPageSize, AdminPagination } from "./AdminPagination";

type EvalRow = Evaluation & { soupTitle: string };
type EvaluationColumn = "reviewer" | "total" | "soup" | "content" | "dimensions" | "createdAt" | "actions";

const evaluationColumns: readonly AdminColumn<EvaluationColumn>[] = [
  { key: "reviewer", label: "评价者", width: "130px" },
  { key: "total", label: "总分", width: "90px" },
  { key: "soup", label: "汤品", width: "minmax(180px, 1fr)" },
  { key: "content", label: "评价内容", width: "minmax(220px, 1.2fr)" },
  { key: "dimensions", label: "维度评分", width: "260px" },
  { key: "createdAt", label: "评价时间", width: "110px" },
  { key: "actions", label: "操作", width: "90px" }
];

const dimensionLabels: Array<{ key: "writing" | "logic" | "share" | "mechanism" | "twist" | "depth"; label: string }> = [
  { key: "writing", label: "文笔" },
  { key: "logic", label: "逻辑" },
  { key: "share", label: "分享" },
  { key: "mechanism", label: "机制" },
  { key: "twist", label: "反转" },
  { key: "depth", label: "深度" }
];

export function EvaluationManagement() {
  const navigate = useNavigate();
  const [evaluations, setEvaluations] = useState<EvalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
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
                {visibleColumns.has("actions") && <button className="btn btn-danger h-8 px-3 text-xs whitespace-nowrap" onClick={() => handleDelete(evaluation.id, evaluation.reviewer)}><Trash2 size={15} />删除</button>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {evaluations.length === 0 && !loading && <p className="py-8 text-center text-sm text-muted">暂无可管理的评价</p>}
      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPage(1); setPageSize(size); }}
      />
    </div>
  );
}
