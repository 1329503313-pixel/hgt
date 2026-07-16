import { useEffect, useState } from "react";
import { Bell, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";

export type NoticeItem = {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  updatedAt: string;
  expiresAt: string | null;
  isRead: boolean;
};

export default function NoticesPage() {
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (loadingUser || !user) return;
    setLoading(true);
    api<{ notices: NoticeItem[] }>("/api/notices")
      .then((data) => setNotices(data.notices))
      .catch((error) => showToast((error as Error).message))
      .finally(() => setLoading(false));
  }, [user, loadingUser, showToast]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeNotices = notices.filter((notice) => !notice.expiresAt || new Date(notice.expiresAt).getTime() > clock);

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title="通知" backTo="/messages" />
      <div className="mx-auto max-w-3xl px-4 pb-10">
        <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
          {loading ? <ListSkeleton rows={6} /> : activeNotices.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">暂无通知</p>
          ) : (
            <div className="divide-y divide-line">
              {activeNotices.map((notice) => (
                <button key={notice.id} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100" onClick={() => navigate(`/messages/notices/${notice.id}`)}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-600"><Bell size={21} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`truncate text-[15px] ${notice.isRead ? "font-semibold text-ink" : "font-black text-slate-950"}`}>{notice.title}</span>
                      {!notice.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted">{notice.author}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted/70">
                    {new Date(notice.publishedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                    <ChevronRight size={16} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
