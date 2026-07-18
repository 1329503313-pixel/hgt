import { Flame, Sparkles, Star, ThumbsUp } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SoupShare } from "../shared/types";
import { defaultCoverUrl } from "../shared/staticAssets";

export function SoupShareCard({ soup }: { soup: SoupShare }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      className="flex w-full max-w-[390px] overflow-hidden rounded-2xl border border-line bg-white text-left shadow-[0_8px_24px_rgba(15,23,42,0.10)] transition hover:-translate-y-0.5 hover:border-blue-200 active:translate-y-0"
      onClick={() => navigate(`/soup/${encodeURIComponent(soup.id)}`, { state: { soupShareReturnTo: `${location.pathname}${location.search}` } })}
      aria-label={`查看海龟汤《${soup.title}》`}
    >
      <span className="w-[38%] shrink-0 bg-slate-100">
        <img className="aspect-[3/2] w-full object-cover" src={soup.coverImage || defaultCoverUrl} alt={`${soup.title}封面`} loading="lazy" decoding="async" />
      </span>
      <span className="min-w-0 flex-1 space-y-1.5 p-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <strong className="min-w-0 flex-1 truncate text-sm font-black text-ink">{soup.title}</strong>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-black text-red-500"><Flame size={12} className="fill-red-500" />{soup.heatValue}</span>
        </span>
        <span className="block truncate text-[11px] text-muted">作者 {soup.author || "佚名"}</span>
        <span className="flex flex-wrap gap-1">
          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-primary">{soup.type}</span>
          <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">{soup.difficulty}</span>
        </span>
        <span className="block line-clamp-2 text-[11px] leading-4 text-muted">{soup.summary || "暂无摘要"}</span>
        <span className="flex items-center justify-between text-[10px] font-semibold text-muted">
          <span className="inline-flex items-center gap-0.5"><Sparkles size={11} />{soup.averageTotal == null ? "未评分" : `${soup.averageTotal}分`}</span>
          <span className="inline-flex items-center gap-0.5"><ThumbsUp size={11} />{soup.likeCount}</span>
          <span className="inline-flex items-center gap-0.5"><Star size={11} />{soup.favoriteCount}</span>
        </span>
      </span>
    </button>
  );
}
