import { ChevronLeft, ChevronRight } from "lucide-react";

export type AdminPageSize = 10 | 20 | 50;

export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange
}: {
  page: number;
  pageSize: AdminPageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: AdminPageSize) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-line pt-4 text-sm sm:flex-row">
      <div className="flex items-center gap-2 text-muted">
        <span>共 {total} 条</span>
        <label className="flex items-center gap-2">
          <span>每页</span>
          <select
            className="field h-9 w-20 px-2 text-sm"
            aria-label="每页条数"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value) as AdminPageSize)}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <span>条</span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-secondary h-9 px-3 text-xs" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={15} />上一页
        </button>
        <span className="min-w-20 text-center text-muted">第 {page} / {totalPages} 页</span>
        <button className="btn btn-secondary h-9 px-3 text-xs" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          下一页<ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
