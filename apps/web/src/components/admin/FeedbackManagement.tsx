import { FormEvent, useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";
import { ListSkeleton } from "../Skeletons";

type FeedbackType = "bug" | "feature" | "activity";
type FeedbackSummary = {
  id: string;
  title: string;
  type: FeedbackType;
  content: string;
  publisher: { id: string | null; nickname: string; username: string };
  createdAt: string;
};
type FeedbackDetail = FeedbackSummary & { screenshot: string | null };

const typeLabels: Record<FeedbackType, string> = {
  bug: "BUG反馈",
  feature: "功能建议",
  activity: "活动建议"
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function FeedbackManagement() {
  const { showToast } = useApp();
  const [feedback, setFeedback] = useState<FeedbackSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [type, setType] = useState<FeedbackType | "all">("all");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<FeedbackDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(total / 10));

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        offset: String((page - 1) * 10),
        type,
        order
      });
      if (submittedKeyword) params.set("keyword", submittedKeyword);
      const data = await api<{ feedback: FeedbackSummary[]; total: number }>(`/api/admin/feedback?${params}`);
      setFeedback(data.feedback);
      setTotal(data.total);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, submittedKeyword, type, order, showToast]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSubmittedKeyword(keyword.trim());
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const data = await api<{ feedback: FeedbackDetail }>(`/api/admin/feedback/${id}`);
      setViewing(data.feedback);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className="card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black tracking-[0.16em] text-primary">FEEDBACK</p>
          <h2 className="mt-1 text-xl font-black text-ink">建议管理</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <form className="flex gap-2" onSubmit={search}>
            <label className="relative min-w-0 flex-1 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input className="field h-10 pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} maxLength={100} placeholder="搜索意见标题" aria-label="搜索意见标题" />
            </label>
            <button className="btn btn-primary h-10 shrink-0 px-4">搜索</button>
          </form>
          <select className="field h-10 sm:w-36" value={type} onChange={(event) => { setType(event.target.value as FeedbackType | "all"); setPage(1); }} aria-label="筛选意见类型">
            <option value="all">全部类型</option>
            <option value="bug">BUG反馈</option>
            <option value="feature">功能建议</option>
            <option value="activity">活动建议</option>
          </select>
          <select className="field h-10 sm:w-36" value={order} onChange={(event) => { setOrder(event.target.value as "asc" | "desc"); setPage(1); }} aria-label="发布时间排序">
            <option value="desc">时间倒序</option>
            <option value="asc">时间正序</option>
          </select>
        </div>
      </div>

      {loading ? <div className="mt-4"><ListSkeleton rows={10} /></div> : feedback.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-16 text-center text-sm text-muted">没有符合条件的建议</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[1.3fr_110px_2fr_150px_170px_90px] gap-3 border-b border-line bg-slate-50 px-3 py-3 text-xs font-black text-muted">
              <span>意见标题</span><span>意见类型</span><span>意见内容</span><span>发布人</span><span>发布时间</span><span>操作</span>
            </div>
            <div className="divide-y divide-line">
              {feedback.map((item) => (
                <div key={item.id} className="grid grid-cols-[1.3fr_110px_2fr_150px_170px_90px] items-center gap-3 px-3 py-3 text-sm">
                  <span className="line-clamp-2 font-bold text-ink" title={item.title}>{item.title}</span>
                  <span className="w-fit rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-primary">{typeLabels[item.type]}</span>
                  <span className="line-clamp-2 whitespace-pre-wrap text-muted" title={item.content}>{item.content}</span>
                  <span className="min-w-0"><span className="block truncate font-bold text-ink">{item.publisher.nickname}</span><span className="block truncate text-xs text-muted">@{item.publisher.username}</span></span>
                  <span className="text-xs text-muted">{formatDate(item.createdAt)}</span>
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-bold text-primary disabled:opacity-50" disabled={detailLoading} onClick={() => void openDetail(item.id)}><Eye size={15} />查看详情</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-line pt-4 text-sm sm:flex-row">
        <span className="text-muted">共 {total} 条，每页 10 条</span>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary h-9 px-3 text-xs" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} />上一页</button>
          <span className="min-w-20 text-center text-muted">第 {page} / {totalPages} 页</span>
          <button type="button" className="btn btn-secondary h-9 px-3 text-xs" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>下一页<ChevronRight size={15} /></button>
        </div>
      </div>

      {viewing && (
        <Modal onClose={() => setViewing(null)} contentClassName="max-w-2xl">
          <div className="space-y-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-primary">{typeLabels[viewing.type]}</span>
                <span className="text-xs text-muted">{formatDate(viewing.createdAt)}</span>
              </div>
              <h2 className="mt-3 text-xl font-black text-ink">{viewing.title}</h2>
              <p className="mt-2 text-sm text-muted">发布人：<span className="font-bold text-ink">{viewing.publisher.nickname}</span>（@{viewing.publisher.username}）</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <h3 className="text-sm font-black text-ink">意见内容</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-ink">{viewing.content}</p>
            </div>
            <div>
              <h3 className="text-sm font-black text-ink">上传截图</h3>
              {viewing.screenshot ? <img className="mt-2 max-h-[60vh] w-full rounded-xl border border-line bg-slate-50 object-contain" src={viewing.screenshot} alt="用户上传的意见截图" /> : <p className="mt-2 text-sm text-muted">未上传截图</p>}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
