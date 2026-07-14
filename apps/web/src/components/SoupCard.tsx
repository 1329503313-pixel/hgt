import { useState } from "react";
import type { SoupSummary } from "../shared/types";
import { Flame, Star, User, ThumbsUp, Sparkles } from "lucide-react";
import { formatViews } from "../context/AppContext";
import { EquippedBadgeIcon } from "./BadgeVisuals";

export function SoupCard({
  soup,
  onOpen,
  refTarget
}: {
  soup: SoupSummary;
  onOpen: (id: string) => void;
  refTarget?: React.RefObject<HTMLElement | null>;
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
      {soup.coverImage ? (
        <CoverImage src={soup.coverImage} alt={`${soup.title} 封面`} />
      ) : (
        <CoverImage src="/default-cover.png" alt={`${soup.title} 封面`} />
      )}
      <div className="p-3">
        <h2 className="line-clamp-2 text-[16px] font-black leading-snug text-ink">
          {soup.title}
          <span className="ml-1 inline-flex items-center gap-0.5 whitespace-nowrap align-middle text-[12px] font-black text-red-500" title={`热力值 ${soup.heatValue}`}>
            <Flame size={14} className="fill-red-500" />
            {soup.heatValue.toLocaleString()}
          </span>
        </h2>
        <p className="avatar-name-gap mt-1 flex items-center truncate text-[13px] text-muted">
          {soup.creatorAvatar ? (
            <img className="h-4 w-4 rounded-full object-cover" src={soup.creatorAvatar} alt="" />
          ) : (
            <User size={14} />
          )}
          {soup.author || soup.creatorName}
          <EquippedBadgeIcon badge={soup.creatorEquippedBadge} className="h-[13px] w-[13px]" />
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag.label} className={`inline-flex h-[24px] items-center rounded-md px-2 text-[12px] font-semibold ring-1 ${tag.className}`}>
              {tag.label}
            </span>
          ))}
        </div>
        <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-muted">{soup.summary || "暂无摘要，点开看看汤面留下的第一道线索。"}</p>
        <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
          <span className="inline-flex items-center gap-1 font-semibold">
            <Sparkles size={14} />
            {soup.averageTotal ? `${soup.averageTotal}分` : "未评分"}
          </span>
          <span className="inline-flex items-center gap-1">
            <ThumbsUp className={soup.isLiked ? "fill-red-400 text-red-400" : ""} size={14} />
            {soup.likeCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Star className={soup.isFavorited ? "fill-yellow-400 text-yellow-400" : ""} size={14} />
            {soup.favoriteCount}
          </span>
        </div>
      </div>
    </article>
  );
}

export function CoverImage({ src, alt }: { src: string; alt: string }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const isTooWide = ratio != null && ratio > 2;
  const isTooTall = ratio != null && ratio < 0.5;

  if (isTooWide || isTooTall) {
    return (
      <div className="soup-card-cover-frame" style={{ aspectRatio: isTooWide ? "2 / 1" : "1 / 2" }}>
        <img
          className="soup-card-cover h-full object-cover"
          src={src}
          alt={alt}
          onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
        />
      </div>
    );
  }

  return (
    <img
      className="soup-card-cover"
      src={src}
      alt={alt}
      onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
    />
  );
}
