import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import {
  buildBadgesFromStats,
  getBadgeKey,
  legendaryToBadgeDef,
  TIER_COLORS_EARNED,
  TIER_LABEL,
  TIER_PROGRESS_COLORS,
} from "../pages/MyAchievementsPage";

const MOTION_DURATION = 800;
const MOTION_CURVE = "cubic-bezier(0.2, 0.65, 0.3, 1)";
const REVERSE_CURVE = "cubic-bezier(0.7, 0, 0.8, 0.35)";

type Phase = "start" | "entering" | "pause" | "open" | "closing" | "exitStart" | "exiting";

export function AchievementUnlockOverlay() {
  const { badgeUnlock, dismissBadgeUnlock } = useApp();
  const [phase, setPhase] = useState<Phase>("start");
  const [exitOffset, setExitOffset] = useState({ x: 0, y: 0 });
  const badgeRef = useRef<HTMLDivElement | null>(null);

  const badges = useMemo(
    () => badgeUnlock ? buildBadgesFromStats(badgeUnlock.stats) : [],
    [badgeUnlock]
  );
  const badge = badgeUnlock?.specialBadge
    ? legendaryToBadgeDef(badgeUnlock.specialBadge)
    : badgeUnlock
      ? badges.find((item) => getBadgeKey(item) === badgeUnlock.key)
      : undefined;

  useEffect(() => {
    const first = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("entering"));
    });
    return () => cancelAnimationFrame(first);
  }, []);

  useEffect(() => {
    if (phase !== "entering") return;
    const timer = setTimeout(() => setPhase("pause"), MOTION_DURATION);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "pause") return;
    const timer = setTimeout(() => setPhase("open"), 400);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = setTimeout(() => {
      const rect = badgeRef.current?.getBoundingClientRect();
      if (rect) {
        setExitOffset({
          x: window.innerWidth - 36 - (rect.left + rect.width / 2),
          y: window.innerHeight - 36 - (rect.top + rect.height / 2),
        });
      }
      setPhase("exitStart");
    }, 200);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "exitStart") return;
    const first = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("exiting"));
    });
    return () => cancelAnimationFrame(first);
  }, [phase]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const timer = setTimeout(dismissBadgeUnlock, MOTION_DURATION);
    return () => clearTimeout(timer);
  }, [phase, dismissBadgeUnlock]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && phase === "open") setPhase("closing");
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [phase]);

  if (!badgeUnlock || !badge) return null;

  const allTiers = badgeUnlock.specialBadge
    ? [badge]
    : badges.filter((item) => item.series === badge.series).sort((a, b) => a.tierIndex - b.tierIndex);
  const nextUnearned = allTiers.find((item) => !item.earned);
  const progressBadge = nextUnearned ?? badge;
  const colors = TIER_COLORS_EARNED[badge.tier];
  const detailsVisible = phase === "open";
  const isExiting = phase === "exiting";
  const badgeTransform = phase === "start"
    ? "translate(0, 0) scale(1)"
    : isExiting
      ? `translate(${exitOffset.x}px, ${exitOffset.y}px) scale(0.55)`
      : "translate(0, 0) scale(1.5)";
  const rotation = isExiting ? -360 : phase === "start" || phase === "exitStart" ? 0 : 360;

  function requestClose() {
    if (phase === "open") setPhase("closing");
  }

  return (
    <div className="fixed inset-0 z-[80] !mt-0 flex items-center justify-center" onClick={requestClose}>
      <div
        className="absolute inset-0 bg-slate-900"
        style={{
          opacity: phase === "start" || isExiting ? 0 : 0.65,
          transition: phase === "start"
            ? "none"
            : `opacity ${MOTION_DURATION}ms ${isExiting ? REVERSE_CURVE : MOTION_CURVE}`,
        }}
      />

      <div
        className="relative z-10 flex flex-col items-center text-center"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={`mb-5 text-xl font-black text-white transition-opacity [text-shadow:0_1px_4px_rgba(0,0,0,0.75)] ${
            detailsVisible ? "opacity-100" : "opacity-0"
          }`}
          style={{ transitionDuration: phase === "closing" ? "200ms" : "400ms" }}
        >
          恭喜获得新徽章！
        </div>

        <div
          ref={badgeRef}
          className="relative h-16 w-16"
          style={{
            opacity: isExiting ? 0 : 1,
            transform: badgeTransform,
            transition: phase === "entering"
              ? `transform ${MOTION_DURATION}ms ${MOTION_CURVE}`
              : isExiting
                ? `transform ${MOTION_DURATION}ms ${REVERSE_CURVE}, opacity ${MOTION_DURATION}ms ${REVERSE_CURVE}`
                : "none",
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              transform: `perspective(800px) rotateY(${rotation}deg)`,
              transformStyle: "preserve-3d",
              transition: phase === "entering"
                ? `transform ${MOTION_DURATION}ms ${MOTION_CURVE}`
                : isExiting
                  ? `transform ${MOTION_DURATION}ms ${REVERSE_CURVE}`
                  : "none",
            }}
          >
            <div
              className={`absolute inset-0 grid place-items-center overflow-hidden rounded-2xl shadow-soft ring-1 ${colors.bg} ${colors.text} ${colors.ring}`}
              style={{ backfaceVisibility: "hidden" }}
            >
              {badge.icon}
            </div>
            <div
              className={`absolute inset-0 overflow-hidden rounded-2xl shadow-soft ${
                badge.earned
                  ? "badge-metal-back"
                  : "grid place-items-center bg-slate-100 text-slate-500 ring-1 ring-slate-200 grayscale"
              }`}
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              {!badge.earned && badge.icon}
            </div>
          </div>
        </div>

        <div
          className={`mt-5 flex flex-col items-center text-center transition-opacity ${
            detailsVisible ? "opacity-100" : "opacity-0"
          }`}
          style={{
            transitionDuration: phase === "closing" ? "200ms" : "400ms",
            transitionTimingFunction: phase === "closing" ? "ease-in" : "ease-out",
          }}
        >
          <h3 className="text-lg font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7),0_0_8px_rgba(0,0,0,0.4)]">{badge.label}</h3>
          <p className="mt-2 max-w-64 text-sm font-semibold leading-relaxed text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7),0_0_8px_rgba(0,0,0,0.4)]">{badge.description}</p>
          <p className="mt-1.5 text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">获取条件：{badge.requirement}</p>
          {badge.nextBadgeLabel && (
            <p className="mt-1 text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">下一等级：{badge.nextBadgeLabel}</p>
          )}
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 ring-1 ring-white/30 backdrop-blur">
            <span className="text-xs font-bold text-white/80">进度</span>
            <span className="text-sm font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
              {progressBadge.earned ? "已完成" : `${progressBadge.progressCurrent}/${progressBadge.progressTarget}`}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-1">
            {allTiers.map((tier, index) => (
              <div key={tier.tier} className="flex items-center gap-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)] ${
                    tier.earned && tier.tier === "legend" ? "badge-legend-shimmer" : ""
                  }`}
                  style={{
                    background: tier.earned
                      ? (tier.tier === "legend" ? undefined : TIER_PROGRESS_COLORS[tier.tier].background)
                      : "rgba(71,85,105,0.45)",
                    border: tier.earned ? "1px solid rgba(255,255,255,0.75)" : "1px solid rgba(255,255,255,0.18)",
                    boxShadow: tier.earned ? `0 0 12px ${TIER_PROGRESS_COLORS[tier.tier].glow}` : "none",
                  }}
                >
                  {TIER_LABEL[tier.tier]}
                </span>
                {index < allTiers.length - 1 && <span className="text-[10px] text-white/60">→</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
