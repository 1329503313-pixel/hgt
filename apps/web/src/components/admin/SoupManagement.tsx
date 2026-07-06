import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Trash2, ThumbsUp, Star, ExternalLink, ArrowUpDown } from "lucide-react";
import type { SoupSummary } from "../../shared/types";
import { api, SoupsResponse } from "../../api";
import { soupTypes } from "../../context/AppContext";

export function SoupManagement() {
  const navigate = useNavigate();
  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);

  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [submittedType, setSubmittedType] = useState("");
  const [order, setOrder] = useState<"desc" | "asc">("desc");

  const loadSoups = useCallback(
    async (append = false) => {
      if (loadingRef.current) return;
      if (append && !hasMore) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (submittedKeyword) params.set("keyword", submittedKeyword);
        if (submittedType) params.set("type", submittedType);
        params.set("order", order);
        params.set("limit", "50");
        params.set("offset", String(append ? offsetRef.current : 0));
        const data = await api<SoupsResponse>(`/api/soups?${params.toString()}`);
        if (append) {
          setSoups((old) => {
            const seen = new Set(old.map((s) => s.id));
            const next = data.soups.filter((s) => !seen.has(s.id));
            offsetRef.current += next.length;
            return [...old, ...next];
          });
        } else {
          setSoups(data.soups);
          offsetRef.current = data.soups.length;
        }
        setHasMore(data.hasMore);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [submittedKeyword, submittedType, order, hasMore]
  );

  useEffect(() => {
    loadSoups(false);
  }, [submittedKeyword, submittedType, order]);

  function handleSearch() {
    setSubmittedKeyword(keyword.trim());
    setSubmittedType(typeFilter);
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`确定删除《${title}》吗？相关评价也会删除。`)) return;
    await api(`/api/soups/${id}`, { method: "DELETE" });
    setSoups((old) => old.filter((s) => s.id !== id));
  }

  return (
    <div className="card p-4">
      <h2 className="mb-3 font-black text-ink">汤品管理</h2>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-10 pl-4 pr-10"
            placeholder="搜索标题、作者..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
          <button className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-primary" onClick={handleSearch}>
            <Search size={18} />
          </button>
        </div>
        <select className="field h-10 sm:w-36" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); }}>
          <option value="">全部类型</option>
          {soupTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          className="btn btn-secondary h-10 px-3 text-xs whitespace-nowrap"
          onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
          title={order === "desc" ? "发布时间：最新在前" : "发布时间：最早在前"}
        >
          <ArrowUpDown size={15} />
          {order === "desc" ? "最新在前" : "最早在前"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          <div className="mb-2 grid grid-cols-[1fr_60px_70px_70px_70px_70px_90px_90px_90px] gap-2 px-3 text-xs font-bold text-muted">
            <span>标题</span>
            <span>原创</span>
            <span>点赞</span>
            <span>收藏</span>
            <span>评价</span>
            <span>创建者</span>
            <span>发布时间</span>
            <span></span>
          </div>
          <div className="space-y-1">
            {soups.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_60px_70px_70px_70px_70px_90px_90px_90px] items-center gap-2 rounded-lg border border-line p-3 text-sm"
              >
                <div className="min-w-0">
                  <button className="truncate font-semibold text-ink hover:text-primary text-left" onClick={() => navigate(`/soup/${s.id}`)}>
                    {s.title}
                  </button>
                  <div className="text-xs text-muted">{s.type}</div>
                </div>
                <span className={`text-xs font-semibold ${s.isOriginal ? "text-emerald-600" : "text-muted"}`}>
                  {s.isOriginal ? "原创" : "非原创"}
                </span>
                <span className="inline-flex items-center gap-1 text-muted"><ThumbsUp size={13} /> {s.likeCount}</span>
                <span className="inline-flex items-center gap-1 text-muted"><Star size={13} /> {s.favoriteCount}</span>
                <span className="text-muted">{s.evaluationCount}</span>
                <span className="truncate text-muted">{s.creatorName}</span>
                <span className="text-xs text-muted whitespace-nowrap">{new Date(s.createdAt).toLocaleDateString()}</span>
                <div className="flex items-center gap-1">
                  <button className="btn btn-secondary h-8 w-8 p-0 grid place-items-center" onClick={() => navigate(`/soup/${s.id}`)} title="查看">
                    <ExternalLink size={14} />
                  </button>
                  <button className="btn btn-danger h-8 w-8 p-0 grid place-items-center" onClick={() => handleDelete(s.id, s.title)} title="删除">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {soups.length === 0 && !loading && (
        <p className="py-8 text-center text-sm text-muted">暂无可管理的汤品</p>
      )}
      {hasMore && (
        <button className="btn btn-secondary mt-4 w-full" onClick={() => loadSoups(true)} disabled={loading}>
          {loading ? "加载中……" : "加载更多"}
        </button>
      )}
    </div>
  );
}
