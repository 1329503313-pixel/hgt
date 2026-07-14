import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ViewRequestItem } from "../../shared/types";
import { api, RequestsResponse } from "../../api";
import { AdminColumn, ColumnSelector, gridTemplate } from "./ColumnSelector";
import { AdminPageSize, AdminPagination } from "./AdminPagination";

type ApprovalColumn = "soup" | "requester" | "status" | "createdAt" | "handledAt" | "actions";

const approvalColumns: readonly AdminColumn<ApprovalColumn>[] = [
  { key: "soup", label: "汤品", width: "minmax(220px, 1fr)" },
  { key: "requester", label: "申请人", width: "140px" },
  { key: "status", label: "状态", width: "100px" },
  { key: "createdAt", label: "申请时间", width: "160px" },
  { key: "handledAt", label: "处理时间", width: "160px" },
  { key: "actions", label: "操作", width: "250px" }
];

function statusLabel(status: ViewRequestItem["status"]) {
  if (status === "approved") return "已同意";
  if (status === "rejected") return "已拒绝";
  return "待处理";
}

export function ApprovalManagement() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [visibleColumns, setVisibleColumns] = useState<Set<ApprovalColumn>>(() => new Set(approvalColumns.map((column) => column.key)));
  const template = useMemo(() => gridTemplate(approvalColumns, visibleColumns), [visibleColumns]);

  const loadRequests = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
    const data = await api<RequestsResponse>(`/api/access-requests?${params.toString()}`);
    setRequests(data.requests);
    setTotal(data.total);
  }, [page, pageSize]);

  useEffect(() => { loadRequests().catch(() => {}); }, [loadRequests]);

  async function decideRequest(id: string, decision: "approved" | "rejected") {
    await api(`/api/access-requests/${id}/decision`, { method: "POST", body: { decision } });
    await loadRequests();
  }

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-black text-ink">申请审批</h2>
          <p className="mt-1 text-sm text-muted">{total} 条申请</p>
        </div>
        <ColumnSelector columns={approvalColumns} visible={visibleColumns} onChange={setVisibleColumns} />
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1030px]">
          <div className="mb-2 grid items-center justify-items-center gap-2 px-3 text-center text-xs font-bold text-muted" style={{ gridTemplateColumns: template }}>
            {approvalColumns.filter((column) => visibleColumns.has(column.key)).map((column) => <span key={column.key}>{column.label}</span>)}
          </div>
          <div className="space-y-1">
            {requests.map((request) => (
              <div key={request.id} className="grid items-center justify-items-center gap-2 rounded-lg border border-line p-3 text-center text-sm" style={{ gridTemplateColumns: template }}>
                {visibleColumns.has("soup") && <button className="max-w-full truncate font-semibold text-ink hover:text-primary" onClick={() => navigate(`/soup/${request.soupId}`)}>{request.soupTitle}</button>}
                {visibleColumns.has("requester") && <span>{request.requesterName}</span>}
                {visibleColumns.has("status") && <span className={`rounded-full px-2 py-1 text-xs font-bold ${request.status === "pending" ? "bg-amber-50 text-amber-700" : request.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"}`}>{statusLabel(request.status)}</span>}
                {visibleColumns.has("createdAt") && <span className="text-xs text-muted">{new Date(request.createdAt).toLocaleString()}</span>}
                {visibleColumns.has("handledAt") && <span className="text-xs text-muted">{request.handledAt ? new Date(request.handledAt).toLocaleString() : "—"}</span>}
                {visibleColumns.has("actions") && (
                  <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                    <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => navigate(`/soup/${request.soupId}`)}><ExternalLink size={14} />查看</button>
                    {request.status === "pending" && <>
                      <button className="btn btn-primary h-8 px-2 text-xs" onClick={() => decideRequest(request.id, "approved")}><Check size={14} />同意</button>
                      <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => decideRequest(request.id, "rejected")}><X size={14} />拒绝</button>
                    </>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {requests.length === 0 && <p className="py-8 text-center text-sm text-muted">暂无申请</p>}
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
