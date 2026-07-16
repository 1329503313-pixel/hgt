import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";

type NoticeDetail = {
  id: string;
  title: string;
  author: string;
  content: string;
  publishedAt: string;
  updatedAt: string;
};

export default function NoticeDetailPage() {
  const { id = "" } = useParams();
  const { user, loadingUser, showToast } = useApp();
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser || !user || !id) return;
    setLoading(true);
    api<{ notice: NoticeDetail }>(`/api/notices/${id}`)
      .then((data) => setNotice(data.notice))
      .catch((error) => showToast((error as Error).message))
      .finally(() => setLoading(false));
  }, [id, user, loadingUser, showToast]);

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title="通知详情" backTo="/messages/notices" />
      <div className="mx-auto max-w-3xl px-4 pb-10 pt-4">
        {loading ? <p className="py-16 text-center text-sm text-muted">正在加载……</p> : notice ? (
          <article className="rounded-2xl bg-white px-5 py-6 shadow-soft sm:px-8 sm:py-8">
            <header className="border-b border-line pb-5 text-center">
              <h1 className="text-2xl font-black leading-snug text-ink">{notice.title}</h1>
              <p className="mt-3 text-sm text-muted">{notice.author} · {new Date(notice.publishedAt).toLocaleString("zh-CN", { hour12: false })}</p>
            </header>
            <div className="notice-rich-content mt-6 text-ink" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(notice.content, { USE_PROFILES: { html: true } }) }} />
          </article>
        ) : <p className="py-16 text-center text-sm text-muted">通知不存在或已删除</p>}
      </div>
    </section>
  );
}
