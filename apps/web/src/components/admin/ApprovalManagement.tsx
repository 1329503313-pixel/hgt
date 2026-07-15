import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ExcellentAuthorApplicationDetail, ExcellentAuthorApplicationItem, RequestStatus, ViewRequestItem } from "../../shared/types";
import {
  api,
  type ExcellentAuthorApplicationDetailResponse,
  type ExcellentAuthorApplicationsResponse,
  type RequestsResponse
} from "../../api";
import { Modal } from "../Modal";
import { SoupCard } from "../SoupCard";
import { useApp } from "../../context/AppContext";
import { AdminColumn, ColumnSelector, gridTemplate } from "./ColumnSelector";
import { AdminPageSize, AdminPagination } from "./AdminPagination";

type ApprovalTab = "bottom" | "excellent-author";
type BottomColumn = "applicationType" | "soup" | "requester" | "status" | "createdAt" | "handledAt" | "actions";

const bottomColumns: readonly AdminColumn<BottomColumn>[] = [
  { key: "applicationType", label: "申请类型", width: "140px" },
  { key: "soup", label: "汤品", width: "minmax(200px, 1fr)" },
  { key: "requester", label: "申请人", width: "120px" },
  { key: "status", label: "状态", width: "90px" },
  { key: "createdAt", label: "申请时间", width: "155px" },
  { key: "handledAt", label: "处理时间", width: "155px" },
  { key: "actions", label: "操作", width: "230px" }
];

function statusLabel(status: RequestStatus) {
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已驳回";
  return "待处理";
}

function StatusPill({ status }: { status: RequestStatus }) {
  return <span className={`rounded-full px-2 py-1 text-xs font-bold ${status === "pending" ? "bg-amber-50 text-amber-700" : status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"}`}>{statusLabel(status)}</span>;
}

export function ApprovalManagement() {
  const [activeTab, setActiveTab] = useState<ApprovalTab>("bottom");

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-2 p-2">
        <button className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === "bottom" ? "bg-primary text-white" : "text-muted hover:bg-blue-50"}`} onClick={() => setActiveTab("bottom")}>申请汤底</button>
        <button className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === "excellent-author" ? "bg-primary text-white" : "text-muted hover:bg-blue-50"}`} onClick={() => setActiveTab("excellent-author")}>申请认证优秀作者</button>
      </div>
      {activeTab === "bottom" ? <BottomApprovalList /> : <ExcellentAuthorApprovalList />}
    </div>
  );
}

function BottomApprovalList() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ViewRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [visibleColumns, setVisibleColumns] = useState<Set<BottomColumn>>(() => new Set(bottomColumns.map((column) => column.key)));
  const template = useMemo(() => gridTemplate(bottomColumns, visibleColumns), [visibleColumns]);

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
        <div><h2 className="font-black text-ink">汤底查看申请</h2><p className="mt-1 text-sm text-muted">{total} 条申请</p></div>
        <ColumnSelector columns={bottomColumns} visible={visibleColumns} onChange={setVisibleColumns} />
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1120px]">
          <div className="mb-2 grid items-center justify-items-center gap-2 px-3 text-center text-xs font-bold text-muted" style={{ gridTemplateColumns: template }}>
            {bottomColumns.filter((column) => visibleColumns.has(column.key)).map((column) => <span key={column.key}>{column.label}</span>)}
          </div>
          <div className="space-y-1">
            {requests.map((request) => (
              <div key={request.id} className="grid items-center justify-items-center gap-2 rounded-lg border border-line p-3 text-center text-sm" style={{ gridTemplateColumns: template }}>
                {visibleColumns.has("applicationType") && <span className="text-xs font-bold text-primary">{request.applicationType}</span>}
                {visibleColumns.has("soup") && <button className="max-w-full truncate font-semibold text-ink hover:text-primary" onClick={() => navigate(`/soup/${request.soupId}`)}>{request.soupTitle}</button>}
                {visibleColumns.has("requester") && <span>{request.requesterName}</span>}
                {visibleColumns.has("status") && <StatusPill status={request.status} />}
                {visibleColumns.has("createdAt") && <span className="text-xs text-muted">{new Date(request.createdAt).toLocaleString()}</span>}
                {visibleColumns.has("handledAt") && <span className="text-xs text-muted">{request.handledAt ? new Date(request.handledAt).toLocaleString() : "—"}</span>}
                {visibleColumns.has("actions") && <ActionButtons status={request.status} onView={() => navigate(`/soup/${request.soupId}`)} onApprove={() => decideRequest(request.id, "approved")} onReject={() => decideRequest(request.id, "rejected")} />}
              </div>
            ))}
          </div>
        </div>
      </div>
      {requests.length === 0 && <p className="py-8 text-center text-sm text-muted">暂无申请</p>}
      <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} />
    </div>
  );
}

function ExcellentAuthorApprovalList() {
  const { showToast } = useApp();
  const navigate = useNavigate();
  const [applications, setApplications] = useState<ExcellentAuthorApplicationItem[]>([]);
  const [detail, setDetail] = useState<ExcellentAuthorApplicationDetail | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);

  const loadApplications = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
    const data = await api<ExcellentAuthorApplicationsResponse>(`/api/admin/excellent-author-applications?${params.toString()}`);
    setApplications(data.applications);
    setTotal(data.total);
  }, [page, pageSize]);

  useEffect(() => { loadApplications().catch(() => {}); }, [loadApplications]);

  async function openDetail(id: string) {
    try {
      const data = await api<ExcellentAuthorApplicationDetailResponse>(`/api/admin/excellent-author-applications/${id}`);
      setDetail(data.application);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "申请详情加载失败");
    }
  }

  async function decide(id: string, decision: "approved" | "rejected") {
    try {
      await api(`/api/admin/excellent-author-applications/${id}/decision`, { method: "POST", body: { decision } });
      showToast(decision === "approved" ? "优秀作者认证已通过" : "优秀作者认证已驳回");
      setDetail(null);
      await loadApplications();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "审批失败");
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-4"><h2 className="font-black text-ink">优秀作者认证申请</h2><p className="mt-1 text-sm text-muted">{total} 条申请</p></div>
      <div className="overflow-x-auto">
        <div className="min-w-[1160px]">
          <div className="mb-2 grid grid-cols-[150px_120px_minmax(220px,1fr)_110px_100px_160px_90px_240px] items-center justify-items-center gap-2 px-3 text-center text-xs font-bold text-muted">
            <span>申请类型</span><span>申请人</span><span>主申请汤名</span><span>热力值</span><span>综合评分</span><span>申请时间</span><span>状态</span><span>操作</span>
          </div>
          <div className="space-y-1">
            {applications.map((application) => (
              <div key={application.id} className="grid grid-cols-[150px_120px_minmax(220px,1fr)_110px_100px_160px_90px_240px] items-center justify-items-center gap-2 rounded-lg border border-line p-3 text-center text-sm">
                <span className="text-xs font-bold text-primary">{application.applicationType}</span>
                <span>{application.applicantName}</span>
                <button className="max-w-full truncate font-semibold text-ink hover:text-primary" disabled={!application.primarySoupId} onClick={() => application.primarySoupId && navigate(`/soup/${application.primarySoupId}`)}>{application.primarySoupTitle}</button>
                <span className="font-black text-red-500">{application.heatValue.toLocaleString()}</span>
                <span className="font-black text-amber-600">{application.averageTotal?.toFixed(1) ?? "—"}</span>
                <span className="text-xs text-muted">{new Date(application.createdAt).toLocaleString()}</span>
                <StatusPill status={application.status} />
                <ActionButtons status={application.status} onView={() => openDetail(application.id)} onApprove={() => decide(application.id, "approved")} onReject={() => decide(application.id, "rejected")} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {applications.length === 0 && <p className="py-8 text-center text-sm text-muted">暂无优秀作者认证申请</p>}
      <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} />

      {detail && (
        <Modal full onClose={() => setDetail(null)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-ink">优秀作者认证申请详情</h2>
              <p className="mt-1 text-sm text-muted">申请人：{detail.applicantName} · 申请时间：{new Date(detail.createdAt).toLocaleString()}</p>
            </div>
            <button className="btn btn-secondary px-3" onClick={() => setDetail(null)}><X size={18} /></button>
          </div>
          <div className="mt-5 space-y-6 pb-6">
            <section>
              <h3 className="mb-3 font-black text-ink">主申请汤</h3>
              {detail.primarySoup ? <div className="max-w-sm"><SoupCard soup={detail.primarySoup} onOpen={(id) => navigate(`/soup/${id}`)} /></div> : <p className="text-sm text-muted">主申请汤已不存在</p>}
            </section>
            <section>
              <h3 className="mb-3 font-black text-ink">五篇资格汤</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {detail.qualificationSoups.map((soup) => <SoupCard key={soup.id} soup={soup} onOpen={(id) => navigate(`/soup/${id}`)} />)}
              </div>
            </section>
            {detail.status === "pending" && <div className="flex gap-3 border-t border-line pt-4"><button className="btn btn-primary flex-1" onClick={() => decide(detail.id, "approved")}><Check size={16} />通过</button><button className="btn btn-secondary flex-1" onClick={() => decide(detail.id, "rejected")}><X size={16} />驳回</button></div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ActionButtons({ status, onView, onApprove, onReject }: { status: RequestStatus; onView: () => void; onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
      <button className="btn btn-secondary h-8 px-2 text-xs" onClick={onView}><ExternalLink size={14} />查看</button>
      {status === "pending" && <><button className="btn btn-primary h-8 px-2 text-xs" onClick={onApprove}><Check size={14} />通过</button><button className="btn btn-secondary h-8 px-2 text-xs" onClick={onReject}><X size={14} />驳回</button></>}
    </div>
  );
}
