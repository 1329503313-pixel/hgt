import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Trash2, ThumbsUp, Star, ExternalLink, ArrowUpDown } from "lucide-react";
import type { SoupSummary } from "../../shared/types";
import { api, SoupsResponse } from "../../api";
import { soupTypes } from "../../context/AppContext";
import { AdminColumn, ColumnSelector, gridTemplate } from "./ColumnSelector";
import { AdminPageSize, AdminPagination } from "./AdminPagination";

type SoupColumn = "title" | "original" | "likes" | "favorites" | "evaluations" | "creator" | "createdAt" | "actions";

const soupColumns: readonly AdminColumn<SoupColumn>[] = [
  { key: "title", label: "标题", width: "minmax(180px, 1fr)" },
  { key: "original", label: "原创", width: "70px" },
  { key: "likes", label: "点赞", width: "70px" },
  { key: "favorites", label: "收藏", width: "70px" },
  { key: "evaluations", label: "评价", width: "70px" },
  { key: "creator", label: "创建者", width: "90px" },
  { key: "createdAt", label: "发布时间", width: "100px" },
  { key: "actions", label: "操作", width: "164px" }
];

export function SoupManagement() {
  const navigate = useNavigate();
  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [submittedType, setSubmittedType] = useState("");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [visibleColumns, setVisibleColumns] = useState<Set<SoupColumn>>(() => new Set(soupColumns.map((column) => column.key)));
  const template = useMemo(() => gridTemplate(soupColumns, visibleColumns), [visibleColumns]);

  const loadSoups = useCallback(
    async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (submittedKeyword) params.set("keyword", submittedKeyword);
        if (submittedType) params.set("type", submittedType);
        params.set("order", order);
        params.set("limit", String(pageSize));
        params.set("offset", String((page - 1) * pageSize));
        const data = await api<SoupsResponse>(`/api/soups?${params.toString()}`);
        setSoups(data.soups);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    },
    [submittedKeyword, submittedType, order, page, pageSize]
  );

  useEffect(() => {
    loadSoups();
  }, [loadSoups]);

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(keyword.trim());
    setSubmittedType(typeFilter);
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`确定删除《${title}》吗？相关评价也会删除。`)) return;
    await api(`/api/soups/${id}`, { method: "DELETE" });
    setSoups((old) => old.filter((s) => s.id !== id));
    setTotal((old) => Math.max(0, old - 1));
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-black text-ink">汤品管理</h2>
        <ColumnSelector columns={soupColumns} visible={visibleColumns} onChange={setVisibleColumns} />
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <input
            className="field h-10 pl-4 pr-24"
            placeholder="搜索标题、作者..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
          <button className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={handleSearch}>
            <Search size={18} />
            <span>搜索</span>
          </button>
        </div>
        <select className="field h-10 sm:w-36" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); }}>
          <option value="">全部类型</option>
          {soupTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          className="btn btn-secondary h-10 px-3 text-xs whitespace-nowrap"
          onClick={() => { setPage(1); setOrder((o) => (o === "desc" ? "asc" : "desc")); }}
          title={order === "desc" ? "发布时间：最新在前" : "发布时间：最早在前"}
        >
          <ArrowUpDown size={15} />
          {order === "desc" ? "最新在前" : "最早在前"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[880px]">
          <div className="mb-2 grid items-center justify-items-center gap-2 px-3 text-center text-xs font-bold text-muted" style={{ gridTemplateColumns: template }}>
            {soupColumns.filter((column) => visibleColumns.has(column.key)).map((column) => <span key={column.key}>{column.label}</span>)}
          </div>
          <div className="space-y-1">
            {soups.map((s) => (
              <div
                key={s.id}
                className="grid items-center justify-items-center gap-2 rounded-lg border border-line p-3 text-center text-sm"
                style={{ gridTemplateColumns: template }}
              >
                {visibleColumns.has("title") && <div className="min-w-0 max-w-full text-center">
                  <button className="max-w-full truncate font-semibold text-ink hover:text-primary" onClick={() => navigate(`/soup/${s.id}`)}>
                    {s.title}
                  </button>
                  <div className="text-xs text-muted">{s.type}</div>
                </div>}
                {visibleColumns.has("original") && <span className={`text-xs font-semibold ${s.isOriginal ? "text-emerald-600" : "text-muted"}`}>
                  {s.isOriginal ? "原创" : "非原创"}
                </span>}
                {visibleColumns.has("likes") && <span className="inline-flex items-center justify-center gap-1 text-muted"><ThumbsUp size={13} /> {s.likeCount}</span>}
                {visibleColumns.has("favorites") && <span className="inline-flex items-center justify-center gap-1 text-muted"><Star size={13} /> {s.favoriteCount}</span>}
                {visibleColumns.has("evaluations") && <span className="text-muted">{s.evaluationCount}</span>}
                {visibleColumns.has("creator") && <span className="max-w-full truncate text-muted">{s.creatorName}</span>}
                {visibleColumns.has("createdAt") && <span className="text-xs text-muted whitespace-nowrap">{new Date(s.createdAt).toLocaleDateString()}</span>}
                {visibleColumns.has("actions") && <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                  <button className="btn btn-secondary h-8 w-[78px] flex-none px-2 text-xs whitespace-nowrap" onClick={() => navigate(`/soup/${s.id}`)} title="查看">
                    <ExternalLink size={14} />
                    <span>查看</span>
                  </button>
                  <button className="btn btn-danger h-8 w-[78px] flex-none px-2 text-xs whitespace-nowrap" onClick={() => handleDelete(s.id, s.title)} title="删除">
                    <Trash2 size={14} />
                    <span>删除</span>
                  </button>
                </div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {soups.length === 0 && !loading && (
        <p className="py-8 text-center text-sm text-muted">暂无可管理的汤品</p>
      )}
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
