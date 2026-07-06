import { Eye, ChevronRight, ThumbsUp, Star, Sparkles } from "lucide-react";
import type { SoupSummary } from "../shared/types";
import { formatViews } from "../context/AppContext";

export function SoupLinkList({
  soups,
  onOpen,
  emptyHint
}: {
  soups: SoupSummary[];
  onOpen: (id: string) => void;
  emptyHint: string;
}) {
  if (soups.length === 0) {
    return <div className="card p-4 text-center text-sm text-muted">{emptyHint}</div>;
  }
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-muted">{soups.length} 条</span>
      </div>
      <div className="space-y-3">
        {soups.map((soup) => (
          <button
            key={soup.id}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-line bg-white p-3 text-left"
            onClick={() => onOpen(soup.id)}
          >
            {soup.coverImage ? (
              <img className="h-14 w-14 shrink-0 rounded-lg object-cover" src={soup.coverImage} alt="" />
            ) : (
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-muted">
                <Eye size={20} />
              </div>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate">
                <span className="truncate text-base font-semibold text-ink">{soup.title}</span>
                {soup.averageTotal != null && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-muted">
                    <Sparkles size={13} /> {Number(soup.averageTotal.toFixed(1))}
                  </span>
                )}
              </span>
              <span className="mt-1 flex items-center gap-1 truncate text-xs text-muted">
                {soup.isOriginal ? (
                  soup.creatorAvatar ? (
                    <img className="h-3.5 w-3.5 rounded-full object-cover" src={soup.creatorAvatar} alt="" />
                  ) : null
                ) : (
                  <img className="h-3.5 w-3.5 rounded-full object-cover" src="/turtle-avatar.png" alt="" />
                )}
                {soup.author || soup.creatorName} · <ThumbsUp size={12} /> {soup.likeCount} · <Star size={12} /> {soup.favoriteCount} · <Eye size={12} /> {formatViews(soup.viewCount)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { ArrowLeft } from "lucide-react";
import { PageTopBar } from "./PageTopBar";
import { useApp } from "../context/AppContext";
import { useNavigate } from "react-router-dom";

export function SubListPage({
  title,
  soups,
  emptyHint,
  onBack
}: {
  title: string;
  soups: SoupSummary[];
  emptyHint: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { openAuth } = useApp();

  // 计算 unread（简化：如果没有 user 则为 0）
  const unread = 0;

  return (
    <section className="space-y-3">
      <PageTopBar title="我的" unread={unread} />
      <div className="flex items-center gap-3">
        <button className="btn btn-secondary px-3" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-black text-ink">{title}</h1>
      </div>
      <SoupLinkList soups={soups} onOpen={(id) => navigate(`/soup/${id}`)} emptyHint={emptyHint} />
    </section>
  );
}
