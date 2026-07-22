import type { SoupSummary } from "../shared/types";
import { Flame, Star, User, ThumbsUp, Sparkles } from "lucide-react";
import { formatViews } from "../context/AppContext";
import { EquippedBadgeIcon } from "./BadgeVisuals";
import { LevelBadge } from "./LevelBadge";
import { defaultCoverUrl } from "../shared/staticAssets";

export function SoupCard({
  soup,
  onOpen,
  refTarget
}: {
  soup: SoupSummary;
  onOpen: (id: string) => void;
  refTarget?: React.Ref<HTMLElement>;
}) {
  const tags = [
    { label: soup.type, className: "bg-blue-50 text-primary ring-blue-100" },
    soup.isOriginal ? { label: "原创汤", className: "bg-emerald-50 text-emerald-600 ring-emerald-100" } : null,
    soup.isBottomPublic
      ? { label: "汤底公开", className: "bg-teal-50 text-accent ring-teal-100" }
      : { label: "汤面公开", className: "bg-violet-50 text-violet-600 ring-violet-100" }
  ].filter(Boolean).slice(0, 3) as { label: string; className: string }[];

  return (
    <article ref={refTarget} className="soup-card" onClick={() => onOpen(soup.id)}>
      <div className="soup-card-cover-shell">
        {soup.coverImage ? (
          <CoverImage src={soup.coverImage} alt={`${soup.title} 封面`} />
        ) : (
          <CoverImage src={defaultCoverUrl} alt={`${soup.title} 封面`} />
        )}
        <div className="soup-card-cover-metrics" aria-label="评分、点赞、收藏和热度">
          <span title={soup.averageTotal ? `评分 ${soup.averageTotal}分` : "未评分"}><Sparkles size={13} />{soup.averageTotal ? `${soup.averageTotal}` : "-"}</span>
          <span title={`点赞 ${soup.likeCount}`}><ThumbsUp className={`soup-card-metric-icon ${soup.isLiked ? "is-liked fill-current" : ""}`} size={13} />{formatViews(soup.likeCount)}</span>
          <span title={`收藏 ${soup.favoriteCount}`}><Star className={`soup-card-metric-icon ${soup.isFavorited ? "is-favorited fill-current" : ""}`} size={13} />{formatViews(soup.favoriteCount)}</span>
          <span title={`热度 ${soup.heatValue}`}><Flame className="soup-card-metric-icon is-heat fill-current" size={13} />{formatViews(soup.heatValue)}</span>
        </div>
      </div>
      <div className="p-3">
        <h2 className="flex min-w-0 items-end text-[16px] font-black leading-snug text-ink" title={soup.title}>
          <span className="min-w-0 flex-1 line-clamp-2">{soup.title}</span>
          <span className="soup-card-title-heat ml-1 inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap pb-0.5 text-[12px] font-black leading-none text-red-500" title={`热力值 ${soup.heatValue}`}>
            <Flame size={14} className="fill-red-500" />
            {soup.heatValue.toLocaleString()}
          </span>
        </h2>
        <p className="avatar-name-gap mt-1 flex items-center truncate text-[13px] text-muted">
          {soup.isOriginal && soup.creatorAvatar ? (
            <img className="h-4 w-4 rounded-full object-cover" src={soup.creatorAvatar} alt="" />
          ) : (
            <User size={14} />
          )}
          {soup.isOriginal ? (soup.author || soup.creatorName) : "佚名"}
          {soup.isOriginal && <LevelBadge level={soup.creatorLevel} />}
          {soup.isOriginal && <EquippedBadgeIcon badge={soup.creatorEquippedBadge} className="h-[13px] w-[13px]" />}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag.label} className={`inline-flex h-[24px] items-center rounded-md px-2 text-[12px] font-semibold ring-1 ${tag.className}`}>
              {tag.label}
            </span>
          ))}
          <span className="soup-card-difficulty-tag h-[24px] items-center rounded-md bg-orange-50 px-2 text-[12px] font-semibold text-orange-600 ring-1 ring-orange-100">
            {soup.difficulty}
          </span>
        </div>
        <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-muted">{soup.summary || "暂无摘要，点开看看汤面留下的第一道线索。"}</p>
        <div className="soup-card-footer mt-3 flex items-center justify-between text-[13px] text-muted">
          <span className="soup-card-footer-score inline-flex items-center gap-1 font-semibold">
            <Sparkles size={14} />
            {soup.averageTotal ? `${soup.averageTotal}分` : "未评分"}
          </span>
          <span className="soup-card-footer-difficulty inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-600">
            {soup.difficulty}
          </span>
          <span className="soup-card-footer-like inline-flex items-center gap-1">
            <ThumbsUp className={soup.isLiked ? "fill-red-400 text-red-400" : ""} size={14} />
            {soup.likeCount}
          </span>
          <span className="soup-card-footer-favorite inline-flex items-center gap-1">
            <Star className={soup.isFavorited ? "fill-yellow-400 text-yellow-400" : ""} size={14} />
            {soup.favoriteCount}
          </span>
        </div>
      </div>
    </article>
  );
}

export function CoverImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="soup-card-cover-frame">
      <img className="soup-card-cover" src={src} alt={alt} loading="lazy" decoding="async" />
    </div>
  );
}
