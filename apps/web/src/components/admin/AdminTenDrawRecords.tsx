import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../../api";
import { AdminPagination, useAdminPagination } from "./AdminPagination";

type TenDrawRecord = {
  id: string;
  drawnAt: string;
  userId: string;
  nickname: string;
  packId: string;
  packName: string;
  rainbowCount: number;
  goldCount: number;
  purpleCount: number;
  blueCount: number;
  score: number;
};

const sortOptions = [
  ["time-desc", "按抽取时间倒序"], ["time-asc", "按抽取时间正序"],
  ["rainbow-desc", "按彩倒序"], ["rainbow-asc", "按彩正序"],
  ["gold-desc", "按金倒序"], ["gold-asc", "按金正序"],
  ["score-desc", "按得分倒序"], ["score-asc", "按得分正序"],
] as const;

export function AdminTenDrawRecords() {
  const [records, setRecords] = useState<TenDrawRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState("time-desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const pagination = useAdminPagination(total);
  const { page, pageSize } = pagination;

  useEffect(() => {
    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({
          limit: String(pageSize), offset: String((page - 1) * pageSize), sort,
        });
        if (keyword.trim()) query.set("keyword", keyword.trim());
        const data = await api<{ records: TenDrawRecord[]; total: number }>(
          `/api/admin/asset-ten-draw-records?${query}`, { bypassCache: true, dedupe: false },
        );
        if (requestId.current !== currentRequest) return;
        setRecords(data.records);
        setTotal(data.total);
      } catch (caught) {
        if (requestId.current !== currentRequest) return;
        setRecords([]);
        setError(caught instanceof Error ? caught.message : "十连记录加载失败");
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    }, 250);
    return () => { ++requestId.current; window.clearTimeout(timer); };
  }, [keyword, sort, page, pageSize]);

  return <div className="card overflow-hidden">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
      <div><h3 className="font-black text-ink">十连记录</h3><p className="mt-1 text-xs text-muted">每次十连计一条；彩 15 分、金 5 分、紫 2 分、蓝 1 分。彩或金数量相同时，按得分从高到低、抽取时间从近到远排序。</p></div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <label className="relative min-w-44 flex-1 sm:flex-none"><Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={16} /><input className="field h-11 w-full pr-9 text-sm" placeholder="搜索用户或卡包" aria-label="搜索十连记录" value={keyword} onChange={(event) => { setKeyword(event.target.value); pagination.onPageChange(1); }} /></label>
        <select className="field h-11 w-full min-w-44 flex-1 py-0 text-sm sm:w-auto sm:flex-none" aria-label="十连记录排序" value={sort} onChange={(event) => { setSort(event.target.value); pagination.onPageChange(1); }}>{sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
    </div>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-muted"><tr><th className="whitespace-nowrap px-3 py-2">时间</th><th className="px-3 py-2">用户</th><th className="px-3 py-2">卡包</th><th className="whitespace-nowrap px-3 py-2">彩色数量</th><th className="whitespace-nowrap px-3 py-2">金色数量</th><th className="whitespace-nowrap px-3 py-2">得分</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className="border-t border-line"><td className="whitespace-nowrap px-3 py-3 text-muted">{new Date(record.drawnAt).toLocaleString("zh-CN")}</td><td className="px-3 py-3 font-bold text-ink">{record.nickname}</td><td className="px-3 py-3 text-muted">{record.packName}</td><td className="px-3 py-3 font-black tabular-nums text-fuchsia-700">{record.rainbowCount}</td><td className="px-3 py-3 font-black tabular-nums text-amber-700">{record.goldCount}</td><td className="px-3 py-3"><span className="font-black tabular-nums text-ink">{record.score}</span><span className="mt-0.5 block whitespace-nowrap text-[11px] text-muted">紫 {record.purpleCount} · 蓝 {record.blueCount}</span></td></tr>)}</tbody></table></div>
    {loading && <div className="p-8 text-center text-sm text-muted" role="status">加载中…</div>}
    {error && <div className="p-6 text-center text-sm text-danger" role="alert">{error}</div>}
    {!loading && !error && records.length === 0 && <div className="p-10 text-center text-sm text-muted">{keyword.trim() ? "没有匹配的十连记录" : "暂无十连记录"}</div>}
    {!loading && !error && total > 0 && <div className="px-4 pb-4"><AdminPagination {...pagination} /></div>}
  </div>;
}
