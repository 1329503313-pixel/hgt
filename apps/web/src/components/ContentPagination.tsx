import { ChevronLeft, ChevronRight } from "lucide-react";

type ContentPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  ariaLabel: string;
  onPageChange: (page: number) => void;
};

function paginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function ContentPagination({ page, pageSize, total, loading = false, ariaLabel, onPageChange }: ContentPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5 border-t border-line p-3" aria-label={ariaLabel}>
      <button type="button" className="btn btn-secondary h-11 px-2.5 text-xs sm:h-9" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft size={15} />上一页
      </button>
      {paginationItems(page, totalPages).map((item, index) => item === "ellipsis" ? (
        <span key={`ellipsis-${index}`} className="grid h-11 w-7 place-items-center text-sm text-muted sm:h-9" aria-hidden="true">…</span>
      ) : (
        <button
          type="button"
          key={item}
          className={`grid h-11 min-w-11 place-items-center rounded-lg px-2 text-sm font-bold sm:h-9 sm:min-w-9 ${item === page ? "bg-primary text-white" : "border border-line bg-white text-ink"}`}
          disabled={loading}
          aria-current={item === page ? "page" : undefined}
          aria-label={`第 ${item} 页`}
          onClick={() => onPageChange(item)}
        >
          {item}
        </button>
      ))}
      <button type="button" className="btn btn-secondary h-11 px-2.5 text-xs sm:h-9" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>
        下一页<ChevronRight size={15} />
      </button>
    </nav>
  );
}
