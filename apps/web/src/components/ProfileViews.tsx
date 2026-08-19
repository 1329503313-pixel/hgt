import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { SocialProfile, SoupSummary } from "../shared/types";
import { EquippedBadgeIcon } from "./BadgeVisuals";
import { LevelBadge } from "./LevelBadge";
import { VipIdentity } from "./VipIdentity";
import { defaultCoverUrl } from "../shared/staticAssets";
import { AssetMotionMedia } from "./AssetCardVisual";

type ProfileBackgroundState = "expanded" | "collapsing" | "collapsed" | "expanding";

function mediaQueryMatches(query: string) {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => mediaQueryMatches(query));
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, [query]);
  return matches;
}

export function ProfileHero({
  profile,
  onFollowing,
  onFollowers,
  onCharm,
  actions,
  meta,
  onAvatar,
  showBadge = true,
  collapsibleBackground = false,
  inactiveNicknameClassName = "text-ink",
  className = ""
}: {
  profile: SocialProfile;
  onFollowing: () => void;
  onFollowers: () => void;
  onCharm?: () => void;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  onAvatar?: () => void;
  showBadge?: boolean;
  collapsibleBackground?: boolean;
  inactiveNicknameClassName?: string;
  className?: string;
}) {
  const heroRef = useRef<HTMLDivElement>(null);
  const hasBackground = Boolean(profile.profileBackgroundUrl);
  const backgroundCrop = profile.profileBackgroundCrop ?? { x: 50, y: 50, zoom: 1 };
  const isMobileProfile = useMediaQuery("(max-width: 1023px)");
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [fullSourceFailed, setFullSourceFailed] = useState(false);
  const [finalBackgroundFailed, setFinalBackgroundFailed] = useState(false);
  const [finalBackgroundReady, setFinalBackgroundReady] = useState(false);
  const canExpandBackground = collapsibleBackground
    && isMobileProfile
    && hasBackground
    && Boolean(profile.profileBackgroundSourceUrl)
    && !fullSourceFailed;
  const initiallyExpanded = canExpandBackground;
  const [backgroundState, setBackgroundState] = useState<ProfileBackgroundState>(() => initiallyExpanded ? "expanded" : "collapsed");
  const [mediaReady, setMediaReady] = useState(false);
  const [autoCollapseDone, setAutoCollapseDone] = useState(false);
  const [expandControlReady, setExpandControlReady] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(152);
  const [transitionReady, setTransitionReady] = useState(false);
  const [backgroundDragging, setBackgroundDragging] = useState(false);
  const backgroundDragRef = useRef<{ pointerId: number; startY: number; currentY: number } | null>(null);
  const suppressToggleClickRef = useRef(false);
  const previousExpandable = useRef(canExpandBackground);
  const hasMotionBackground = Boolean(profile.profileBackgroundMotionMp4Url && profile.profileBackgroundUrl);
  const backgroundSourceUrl = canExpandBackground && profile.profileBackgroundSourceUrl
    ? profile.profileBackgroundSourceUrl
    : profile.profileBackgroundUrl;
  const backgroundRegionId = `profile-background-${profile.id}`;

  useLayoutEffect(() => {
    if (!collapsibleBackground || !heroRef.current) return;
    const hero = heroRef.current;
    const updateHeight = () => {
      const height = Math.round(hero.getBoundingClientRect().width * 7 / 5);
      setExpandedHeight((current) => current === height ? current : height);
    };
    updateHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(hero);
    window.addEventListener("resize", updateHeight);
    const frame = window.requestAnimationFrame(() => setTransitionReady(true));
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [collapsibleBackground]);

  useLayoutEffect(() => {
    if (previousExpandable.current === canExpandBackground) return;
    previousExpandable.current = canExpandBackground;
    setBackgroundState(canExpandBackground ? "expanded" : "collapsed");
    setMediaReady(false);
    setAutoCollapseDone(false);
    setExpandControlReady(false);
  }, [canExpandBackground]);

  useEffect(() => {
    if (!canExpandBackground || !mediaReady || autoCollapseDone || backgroundState !== "expanded" || backgroundDragging) return;
    const timeout = window.setTimeout(() => {
      setAutoCollapseDone(true);
      setBackgroundState(reduceMotion || !transitionReady ? "collapsed" : "collapsing");
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [autoCollapseDone, backgroundDragging, backgroundState, canExpandBackground, mediaReady, reduceMotion, transitionReady]);

  useEffect(() => {
    if (backgroundState !== "collapsing" && backgroundState !== "expanding") return;
    const timeout = window.setTimeout(() => {
      setBackgroundState((current) => current === "collapsing" ? "collapsed" : current === "expanding" ? "expanded" : current);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [backgroundState]);

  useEffect(() => {
    if (!canExpandBackground || backgroundState !== "collapsed") {
      setExpandControlReady(false);
      return;
    }
    const timeout = window.setTimeout(() => setExpandControlReady(true), 500);
    return () => window.clearTimeout(timeout);
  }, [backgroundState, canExpandBackground]);

  function finishBackgroundTransition(event: React.TransitionEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target || event.propertyName !== "height") return;
    setBackgroundState((current) => current === "collapsing" ? "collapsed" : current === "expanding" ? "expanded" : current);
  }

  function collapseBackground() {
    if (backgroundState !== "expanded") return;
    setAutoCollapseDone(true);
    setBackgroundState(reduceMotion || !transitionReady ? "collapsed" : "collapsing");
  }

  function expandBackground() {
    if (backgroundState !== "collapsed") return;
    setAutoCollapseDone(true);
    setExpandControlReady(false);
    setBackgroundState(reduceMotion || !transitionReady ? "expanded" : "expanding");
  }

  function handleFullSourceFailure() {
    setFullSourceFailed(true);
    setAutoCollapseDone(true);
    setMediaReady(false);
    setBackgroundState("collapsed");
  }

  function beginBackgroundDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!toggleVisible) return;
    backgroundDragRef.current = { pointerId: event.pointerId, startY: event.clientY, currentY: event.clientY };
    suppressToggleClickRef.current = false;
    setBackgroundDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveBackgroundDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = backgroundDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.currentY = event.clientY;
    if (Math.abs(drag.currentY - drag.startY) > 8) suppressToggleClickRef.current = true;
  }

  function finishBackgroundDrag(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = backgroundDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientY - drag.startY;
    backgroundDragRef.current = null;
    setBackgroundDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) return;
    if (distance >= 28 && toggleIsCollapsed) expandBackground();
    if (distance <= -28 && !toggleIsCollapsed) collapseBackground();
  }

  function toggleBackground() {
    if (suppressToggleClickRef.current) {
      suppressToggleClickRef.current = false;
      return;
    }
    if (toggleIsCollapsed) expandBackground();
    else collapseBackground();
  }

  const toggleIsCollapsed = backgroundState === "collapsed";
  const toggleVisible = canExpandBackground
    && (backgroundState === "expanded" || (toggleIsCollapsed && expandControlReady));
  const controlsVisible = !canExpandBackground || toggleVisible;
  const heroStateClass = canExpandBackground ? `profile-hero-background-${backgroundState}` : "";
  const heroStyle = {
    "--profile-background-x": `${backgroundCrop.x}%`,
    "--profile-background-y": `${backgroundCrop.y}%`,
    "--profile-background-zoom": backgroundCrop.zoom,
    "--profile-background-expanded-height": `${expandedHeight}px`
  } as React.CSSProperties;

  return (
    <div
      ref={heroRef}
      className={`profile-hero relative isolate overflow-hidden rounded-2xl bg-white shadow-soft ${canExpandBackground ? "profile-hero-collapsible" : ""} ${canExpandBackground && transitionReady ? "profile-hero-collapsible-ready" : ""} ${heroStateClass} ${className}`}
      style={heroStyle}
    >
      {hasBackground && (
        <div id={backgroundRegionId} className="profile-hero-background absolute inset-x-0 top-0 z-0 h-[118px] overflow-hidden">
          {hasMotionBackground && backgroundSourceUrl
            ? <AssetMotionMedia
                card={{
                  name: `${profile.nickname}的主页背景`,
                  imageUrl: backgroundSourceUrl,
                  thumbnailUrl: backgroundSourceUrl,
                  motionMp4Url: profile.profileBackgroundMotionMp4Url,
                  motionWebmUrl: profile.profileBackgroundMotionWebmUrl,
                  motionPosterUrl: canExpandBackground
                    ? (profile.profileBackgroundMotionPosterUrl ?? profile.profileBackgroundSourceUrl)
                    : profile.profileBackgroundUrl
                }}
                className="profile-hero-background-media profile-hero-background-motion absolute inset-0 h-full w-full object-cover"
                eager
                onReady={() => setMediaReady(true)}
                onFailure={canExpandBackground ? handleFullSourceFailure : undefined}
              />
            : backgroundSourceUrl && <img
                className="profile-hero-background-media absolute inset-0 h-full w-full object-cover"
                src={backgroundSourceUrl}
                alt=""
                loading="eager"
                decoding="async"
                draggable={false}
                onLoad={() => setMediaReady(true)}
                onError={canExpandBackground ? handleFullSourceFailure : undefined}
              />}
          {canExpandBackground && !hasMotionBackground && !finalBackgroundFailed && profile.profileBackgroundUrl && (
            <img
              className={`profile-hero-background-final absolute inset-0 h-full w-full object-cover ${finalBackgroundReady ? "is-ready" : ""}`}
              src={profile.profileBackgroundUrl}
              alt=""
              loading="eager"
              decoding="async"
              draggable={false}
              onLoad={() => setFinalBackgroundReady(true)}
              onError={() => setFinalBackgroundFailed(true)}
            />
          )}
        </div>
      )}
      <div className={`profile-hero-main relative z-[1] h-[118px] px-4 pt-4 text-white ${hasBackground ? "bg-slate-950/30" : "profile-gradient"}`} onTransitionEnd={finishBackgroundTransition}>
        <div className="profile-hero-identity flex items-center gap-3">
          <button className="profile-hero-avatar h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-white/90 bg-white/20 text-2xl font-black shadow-md" onClick={onAvatar} disabled={!onAvatar}>
            {profile.avatar ? <img className="h-full w-full object-cover" src={profile.avatar} alt="" /> : profile.nickname.slice(0, 1)}
          </button>
          <div className="profile-hero-copy min-w-0 flex-1">
            <div className="profile-hero-name-row flex min-w-0 items-center gap-2">
              <VipIdentity nickname={profile.nickname} userLevel={profile.level} vipLevel={profile.vipLevel} vipActive={profile.vipActive} equippedBadge={showBadge ? profile.equippedBadge : null} inactiveNicknameClassName={inactiveNicknameClassName} className="min-w-0 text-xl font-black" badgeClassName="h-8 w-8 rounded-lg" />
            </div>
            {profile.bio && <p className="mt-1 line-clamp-2 break-words text-[11px] font-medium leading-4 text-white/80 [text-shadow:0_1px_2px_rgb(15_23_42_/_85%)]" title={profile.bio}>{profile.bio}</p>}
            {meta && <div className="mt-1">{meta}</div>}
          </div>
          {actions && <div className={`profile-hero-actions shrink-0 ${controlsVisible ? "is-visible" : ""}`}>{actions}</div>}
        </div>
        {canExpandBackground && (
          <button
            type="button"
            className={`profile-hero-background-toggle ${toggleIsCollapsed ? "is-collapsed" : "is-expanded"} ${toggleVisible ? "is-visible" : ""} ${backgroundDragging ? "is-dragging" : ""}`}
            onClick={toggleBackground}
            onPointerDown={beginBackgroundDrag}
            onPointerMove={moveBackgroundDrag}
            onPointerUp={(event) => finishBackgroundDrag(event)}
            onPointerCancel={(event) => finishBackgroundDrag(event, true)}
            disabled={!toggleVisible}
            aria-label={toggleIsCollapsed ? "下拉或点击展开完整主页卡面背景" : "上划或点击收起主页卡面背景"}
            aria-controls={backgroundRegionId}
            aria-expanded={!toggleIsCollapsed}
            title={toggleIsCollapsed ? "下拉展开完整卡面" : "上划收起卡面"}
          />
        )}
      </div>
      <div className={`profile-hero-stats relative z-[1] grid grid-cols-5 divide-x divide-line px-1 py-3 ${hasBackground ? "bg-white/85 backdrop-blur-sm" : "bg-white"}`}>
        <button className="text-center disabled:cursor-default" onClick={onCharm} disabled={!onCharm}><p className="text-lg font-black text-rose-600">{profile.charmValue ?? 0}</p><p className="text-xs text-muted">魅力</p></button>
        <div className="text-center"><p className="text-lg font-black text-amber-600">{profile.generosityValue ?? 0}</p><p className="text-xs text-muted">慷慨</p></div>
        <div className="text-center"><p className="text-lg font-black text-ink">{profile.receivedLikeCount}</p><p className="text-xs text-muted">获赞</p></div>
        <button className="text-center" onClick={onFollowing}><p className="text-lg font-black text-ink">{profile.followingCount}</p><p className="text-xs text-muted">关注</p></button>
        <button className="text-center" onClick={onFollowers}><p className="text-lg font-black text-ink">{profile.followerCount}</p><p className="text-xs text-muted">粉丝</p></button>
      </div>
    </div>
  );
}

export function SoupCoverGrid({
  soups,
  emptyHint,
  className = "",
  returnTo
}: {
  soups: SoupSummary[];
  emptyHint: string;
  className?: string;
  returnTo?: string;
}) {
  const navigate = useNavigate();
  if (!soups.length) return <div className="py-16 text-center text-sm text-muted">{emptyHint}</div>;
  return (
    <div className={`grid grid-cols-2 gap-2 p-2 sm:gap-3 sm:p-3 ${className}`}>
      {soups.map((soup) => (
        <button
          key={soup.id}
          className="group relative aspect-video overflow-hidden rounded-xl bg-slate-200 text-left"
          onClick={() => navigate(`/soup/${soup.id}`, { state: returnTo ? { soupReturnTo: returnTo } : undefined })}
        >
          <img
            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
            src={soup.coverImage ?? defaultCoverUrl}
            alt={`${soup.title} 封面`}
            loading="lazy"
          />
          <span className="absolute inset-x-0 bottom-0 bg-white/85 px-2 py-1.5 text-ink">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-bold">{soup.title}</span>
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-red-500"><Flame size={11} className="fill-red-500" />{soup.heatValue.toLocaleString()}</span>
            </span>
          </span>
          {soup.reviewStatus !== "approved" && (
            <span className={`absolute left-2 top-2 rounded-md px-2 py-1 text-[11px] font-bold ${soup.reviewStatus === "pending" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>
              {soup.reviewStatus === "pending" ? "审核中" : "审核未通过"}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
