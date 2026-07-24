import { useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import type { AssetCard, OwnedAssetCard } from "../shared/digitalAssets";
import { ASSET_RARITY_LABELS, warmAssetImage } from "../shared/digitalAssets";

let legendVisibilityObserver: IntersectionObserver | null = null;

function observeLegendCard(element: HTMLElement) {
  if (typeof IntersectionObserver === "undefined") {
    element.classList.add("asset-card-in-view");
    return () => element.classList.remove("asset-card-in-view");
  }
  legendVisibilityObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle("asset-card-in-view", entry.isIntersecting);
  }, { rootMargin: "120px 0px", threshold: 0.01 });
  legendVisibilityObserver.observe(element);
  return () => {
    legendVisibilityObserver?.unobserve(element);
    element.classList.remove("asset-card-in-view");
  };
}

export function AssetCardVisual({
  card,
  owned,
  animated = false,
  motion = false,
  forceMotion = false,
  highDetail = false,
  historyCompact = false,
  compactBadges = false,
  selected = false,
  onClick,
  ariaLabel,
  className = ""
}: {
  card: AssetCard | OwnedAssetCard;
  owned?: boolean;
  animated?: boolean;
  motion?: boolean;
  forceMotion?: boolean;
  highDetail?: boolean;
  historyCompact?: boolean;
  compactBadges?: boolean;
  selected?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  ariaLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const starLevel = "starLevel" in card ? card.starLevel : 0;
  const drawStarLevel = "starAfter" in card && typeof card.starAfter === "number" ? card.starAfter : 0;
  const motionAllowed = forceMotion || Math.max(starLevel, drawStarLevel) >= 2;
  const showMotion = motion
    && card.rarity === "legend"
    && Boolean(card.motionMp4Url)
    && motionAllowed;

  useEffect(() => {
    if (card.rarity !== "legend" || !motionAllowed || !ref.current) return;
    return observeLegendCard(ref.current);
  }, [card.rarity, motionAllowed]);

  function move(event: React.PointerEvent<HTMLButtonElement>) {
    if (!animated || !ref.current || event.pointerType === "touch") return;
    const rect = ref.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    ref.current.style.setProperty("--card-rx", `${(0.5 - y) * 12}deg`);
    ref.current.style.setProperty("--card-ry", `${(x - 0.5) * 14}deg`);
  }

  function reset() {
    ref.current?.style.removeProperty("--card-rx");
    ref.current?.style.removeProperty("--card-ry");
  }

  function warmHighDetail() {
    if (!highDetail && card.imageUrl !== card.thumbnailUrl) warmAssetImage(card.imageUrl);
  }

  return (
    <button
      ref={ref}
      type="button"
      className={`asset-card asset-card-${card.rarity} ${motionAllowed ? "asset-card-motion-allowed" : "asset-card-motion-disabled"} ${animated ? "asset-card-animated" : ""} ${highDetail ? "asset-card-high-detail" : ""} ${historyCompact ? "asset-card-history-compact" : ""} ${compactBadges ? "asset-card-compact-badges" : ""} ${selected ? "asset-card-selected" : ""} ${owned === false ? "asset-card-locked" : ""} ${className}`}
      onPointerMove={move}
      onPointerEnter={warmHighDetail}
      onFocus={warmHighDetail}
      onTouchStart={warmHighDetail}
      onPointerLeave={reset}
      onClick={onClick}
      style={card.rarity === "legend" ? ({ "--legend-breathe-delay": `${-((Number.parseInt(card.cardNo, 10) || card.cardNo.length) % 7)}s` } as React.CSSProperties) : undefined}
      aria-label={ariaLabel ?? `${card.name}，${ASSET_RARITY_LABELS[card.rarity]}${"starLevel" in card ? `，${starLevel}星` : ""}${owned === false ? "，未获得" : ""}`}
    >
      <span className="asset-card-frame">
        {showMotion
          ? <AssetMotionMedia card={card} className="asset-card-image" eager={highDetail || forceMotion} />
          : <img src={highDetail ? card.imageUrl : (card.thumbnailUrl || card.imageUrl)} alt="" className="asset-card-image" loading={highDetail ? "eager" : "lazy"} decoding="async" draggable={false} />}
        {!historyCompact && <span className="asset-card-number" aria-hidden="true">NO.{card.cardNo}</span>}
        <span className="asset-card-rarity" aria-hidden="true"><span className="asset-card-rarity-text">{ASSET_RARITY_LABELS[card.rarity]}</span></span>
        <span className="asset-card-caption">
          <span className="min-w-0 flex-1">
            {"starLevel" in card && (
              <span className="asset-card-stars" aria-label={`${starLevel}星`}>
                {[1, 2, 3].map((star) => <Star key={star} size={11} fill={star <= starLevel ? "currentColor" : "none"} className={star <= starLevel ? "text-amber-300" : "text-white/55"} />)}
              </span>
            )}
            <span className={`mt-0.5 block min-w-0 text-[11px] font-black sm:text-xs ${historyCompact ? "line-clamp-2 leading-tight" : "truncate"}`}>{card.name}</span>
            {!historyCompact && card.story && <span className="asset-card-story mt-0.5 block line-clamp-2 text-[8px] font-medium leading-tight opacity-80 sm:text-[9px]">{card.story}</span>}
          </span>
        </span>
      </span>
    </button>
  );
}

export function AssetMotionMedia({
  card,
  className = "",
  eager = false,
  style
}: {
  card: Pick<AssetCard, "name" | "imageUrl" | "thumbnailUrl" | "motionMp4Url" | "motionWebmUrl" | "motionPosterUrl">;
  className?: string;
  eager?: boolean;
  style?: React.CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nearViewport, setNearViewport] = useState(eager);
  const [failed, setFailed] = useState(false);
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduceMotion) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      void video.play().catch(() => undefined);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting) {
        setNearViewport(true);
        if (document.visibilityState === "visible") void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }, { rootMargin: "320px 0px", threshold: 0.01 });
    observer.observe(video);
    const visibility = () => {
      if (document.visibilityState === "hidden") video.pause();
      else if (video.getBoundingClientRect().bottom >= -320 && video.getBoundingClientRect().top <= window.innerHeight + 320) {
        void video.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      video.pause();
    };
  }, [reduceMotion]);

  const fallback = card.motionPosterUrl || card.thumbnailUrl || card.imageUrl;
  if (failed || reduceMotion || !card.motionMp4Url) {
    return <img src={fallback} alt="" className={className} style={style} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />;
  }
  return (
    <video
      ref={videoRef}
      className={className}
      style={style}
      muted
      loop
      playsInline
      autoPlay={eager}
      preload={nearViewport ? "auto" : "metadata"}
      poster={fallback}
      aria-label={`${card.name}动态卡面`}
      onError={() => setFailed(true)}
    >
      {card.motionWebmUrl && <source src={card.motionWebmUrl} type="video/webm" />}
      <source src={card.motionMp4Url} type="video/mp4" />
    </video>
  );
}
