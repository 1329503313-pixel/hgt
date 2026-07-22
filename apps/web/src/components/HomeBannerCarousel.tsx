import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { homeBannerUrl } from "../shared/staticAssets";

type HomeBanner = {
  id: string;
  name: string;
  imageUrl: string | null;
  desktopImageUrl: string | null;
  linkUrl: string | null;
};

const fallbackBanner: HomeBanner = {
  id: "default-home-banner",
  name: "首页 Banner",
  imageUrl: null,
  desktopImageUrl: null,
  linkUrl: null
};

export function HomeBannerCarousel({ variant = "mobile" }: { variant?: "desktop" | "mobile" }) {
  const [banners, setBanners] = useState<HomeBanner[]>([fallbackBanner]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedBannerIds, setLoadedBannerIds] = useState<Set<string>>(() => new Set());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragDistanceRef = useRef(0);
  const pointerStartRef = useRef(0);

  useEffect(() => {
    let active = true;
    void api<{ banners: HomeBanner[] }>("/api/banners", { cacheTtlMs: 60_000 })
      .then((result) => {
        if (active) setBanners(result.banners);
      })
      .catch(() => {
        if (active) setBanners([fallbackBanner]);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = window.setInterval(() => {
      const scroller = scrollerRef.current;
      if (!scroller || document.hidden) return;
      const next = (activeIndex + 1) % banners.length;
      scroller.scrollTo({
        left: next * scroller.clientWidth,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
      setActiveIndex(next);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeIndex, banners.length]);

  const nextIndex = banners.length > 1 ? (activeIndex + 1) % banners.length : activeIndex;

  useEffect(() => {
    const currentId = banners[activeIndex]?.id;
    const nextId = banners[nextIndex]?.id;
    if (!currentId && !nextId) return;
    setLoadedBannerIds((previous) => {
      const next = new Set(previous);
      if (currentId) next.add(currentId);
      if (nextId) next.add(nextId);
      return next.size === previous.size ? previous : next;
    });
  }, [activeIndex, banners, nextIndex]);

  if (!banners.length) return null;

  function goTo(index: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ left: index * scroller.clientWidth, behavior: "smooth" });
    setActiveIndex(index);
  }

  return (
    <div className="home-hero-banner relative" aria-roledescription="轮播图">
      <div
        ref={scrollerRef}
        className="home-banner-scroller"
        onScroll={(event) => {
          const width = event.currentTarget.clientWidth;
          if (width) setActiveIndex(Math.round(event.currentTarget.scrollLeft / width));
        }}
        onPointerDown={(event) => {
          pointerStartRef.current = event.clientX;
          dragDistanceRef.current = 0;
        }}
        onPointerMove={(event) => {
          dragDistanceRef.current = Math.max(dragDistanceRef.current, Math.abs(event.clientX - pointerStartRef.current));
        }}
      >
        {banners.map((banner, index) => {
          const image = (variant === "desktop" ? banner.desktopImageUrl || banner.imageUrl : banner.imageUrl) || homeBannerUrl;
          const shouldLoad = index === activeIndex || index === nextIndex || loadedBannerIds.has(banner.id);
          const content = shouldLoad
            ? <img src={image} alt={banner.name} draggable={false} loading="eager" decoding="async" />
            : <span className="block aspect-video w-full bg-slate-100" aria-hidden="true" />;
          return (
            <div className="home-banner-slide" key={banner.id} aria-hidden={banner.id !== banners[activeIndex]?.id}>
              {banner.linkUrl ? (
                <a
                  className="block"
                  href={banner.linkUrl}
                  onClick={(event) => {
                    if (dragDistanceRef.current > 8) event.preventDefault();
                  }}
                  {...(/^https?:\/\//i.test(banner.linkUrl) ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  {content}
                </a>
              ) : content}
            </div>
          );
        })}
      </div>
      {banners.length > 1 && (
        <div className="home-banner-dots" aria-label="Banner 分页">
          {banners.map((banner, index) => (
            <button
              key={banner.id}
              type="button"
              className={index === activeIndex ? "is-active" : ""}
              aria-label={`切换到第 ${index + 1} 张 Banner`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => goTo(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
