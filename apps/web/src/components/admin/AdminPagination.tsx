import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type AdminPageSize = 10 | 20 | 50;
export type AdminPaginationState = {
  page: number;
  pageSize: AdminPageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: AdminPageSize) => void;
};

export function useAdminPagination(total: number, initialPageSize: AdminPageSize = 10): AdminPaginationState {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(initialPageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return {
    page,
    pageSize,
    total,
    onPageChange: setPage,
    onPageSizeChange: (nextPageSize) => {
      setPageSize(nextPageSize);
      setPage(1);
    }
  };
}

export function paginateAdminItems<T>(items: T[], pagination: Pick<AdminPaginationState, "page" | "pageSize">) {
  const start = (pagination.page - 1) * pagination.pageSize;
  return items.slice(start, start + pagination.pageSize);
}

export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange
}: Omit<AdminPaginationState, "onPageSizeChange"> & { onPageSizeChange?: AdminPaginationState["onPageSizeChange"] }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mt-4 flex min-w-0 flex-col items-center justify-between gap-3 border-t border-line pt-4 text-sm sm:flex-row">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted sm:justify-start">
        <span className="whitespace-nowrap">共 {total} 条</span>
        {onPageSizeChange && <label className="flex items-center gap-2 whitespace-nowrap">
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
        </label>}
      </div>
      <div className="flex w-full min-w-0 items-center justify-between gap-1 sm:w-auto sm:gap-2">
        <button type="button" className="btn btn-secondary h-11 w-11 shrink-0 p-0 text-xs sm:w-auto sm:px-3" aria-label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={15} /><span className="hidden sm:inline">上一页</span>
        </button>
        <span className="min-w-0 whitespace-nowrap text-center text-muted">第 {page} / {totalPages} 页</span>
        <button type="button" className="btn btn-secondary h-11 w-11 shrink-0 p-0 text-xs sm:w-auto sm:px-3" aria-label="下一页" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          <span className="hidden sm:inline">下一页</span><ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
