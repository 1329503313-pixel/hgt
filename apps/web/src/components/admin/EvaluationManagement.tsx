import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Trash2, Star } from "lucide-react";
import type { Evaluation } from "../../shared/types";
import { api, EvaluationsResponse } from "../../api";

type EvalRow = Evaluation & { soupTitle: string };

export function EvaluationManagement() {
  const navigate = useNavigate();
  const [evaluations, setEvaluations] = useState<EvalRow[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);

  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");

  const loadEvaluations = useCallback(
    async (append = false) => {
      if (loadingRef.current) return;
      if (append && !hasMore) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (submittedKeyword) params.set("keyword", submittedKeyword);
        params.set("limit", "20");
        params.set("offset", String(append ? offsetRef.current : 0));
        const data = await api<EvaluationsResponse>(`/api/admin/evaluations?${params.toString()}`);
        if (append) {
          setEvaluations((old) => {
            const seen = new Set(old.map((e) => e.id));
            const next = data.evaluations.filter((e) => !seen.has(e.id));
            offsetRef.current += next.length;
            return [...old, ...next];
          });
        } else {
          setEvaluations(data.evaluations);
          offsetRef.current = data.evaluations.length;
        }
        setHasMore(data.hasMore);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [submittedKeyword, hasMore]
  );

  useEffect(() => {
    loadEvaluations(false);
  }, [submittedKeyword]);

  function handleSearch() {
    setSubmittedKeyword(keyword.trim());
  }

  async function handleDelete(id: string, reviewer: string) {
    if (!confirm(`确定删除 ${reviewer} 的评价吗？`)) return;
    await api(`/api/evaluations/${id}`, { method: "DELETE" });
    setEvaluations((old) => old.filter((e) => e.id !== id));
  }

  const dimLabels = ["writing", "logic", "share", "mechanism", "twist", "depth"] as const;

  return (
    <div className="card p-4">
      <h2 className="mb-3 font-black text-ink">评价管理</h2>

      <div className="mb-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-10 pl-4 pr-10"
            placeholder="搜索评价者、汤标题、内容..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
          <button className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-primary" onClick={handleSearch}>
            <Search size={18} />
          </button>
        </div>
      </div>

      <div className="grid gap-3">
        {evaluations.map((e) => (
          <div key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <strong className="text-sm">{e.reviewer}</strong>
                <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-bold text-primary">
                  <Star className="fill-amber-400 text-amber-400" size={12} /> {e.total}
                </span>
                <span className="text-xs text-muted">→</span>
                <button className="truncate text-sm font-semibold text-ink hover:text-primary" onClick={() => navigate(`/soup/${e.soupId}`)}>
                  {e.soupTitle}
                </button>
              </div>
              {e.content && <p className="mt-1 line-clamp-2 text-xs text-muted">{e.content}</p>}
              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted">
                {dimLabels.map((dim) => (e[dim] != null ? <span key={dim} className="rounded bg-slate-100 px-1 py-0.5">{e[dim]}</span> : null))}
                <span className="text-muted/60">{new Date(e.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <button className="btn btn-danger h-8 w-8 p-0 grid shrink-0 place-items-center" onClick={() => handleDelete(e.id, e.reviewer)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {evaluations.length === 0 && !loading && (
        <p className="py-8 text-center text-sm text-muted">暂无可管理的评价</p>
      )}
      {hasMore && (
        <button className="btn btn-secondary mt-4 w-full" onClick={() => loadEvaluations(true)} disabled={loading}>
          {loading ? "加载中……" : "加载更多"}
        </button>
      )}
    </div>
  );
}
