import { cloneElement, isValidElement, useState, useEffect, useRef } from "react";
import { PageTopBar } from "../components/PageTopBar";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, StatsResponse } from "../api";
import { LegendaryBadge, LegendaryBadgeTile, versionBadgeAssetUrl } from "../components/BadgeVisuals";

// ============================================================
// 类型定义
// ============================================================

export type BadgeTier = "normal" | "rare" | "epic" | "legend";

export const TIER_LABEL: Record<BadgeTier, string> = {
  normal: "普通", rare: "稀有", epic: "史诗", legend: "传说",
};

export const TIER_COLORS_EARNED: Record<BadgeTier, { bg: string; text: string; ring: string; label: string }> = {
  normal: { bg: "bg-blue-50", text: "text-blue-600", ring: "ring-blue-300", label: "text-blue-600" },
  rare: { bg: "bg-purple-50", text: "text-purple-600", ring: "ring-purple-300", label: "text-purple-600" },
  epic: { bg: "bg-amber-50", text: "text-amber-600", ring: "ring-amber-300", label: "text-amber-600" },
  legend: { bg: "badge-legend-shimmer", text: "text-white", ring: "ring-white/70", label: "badge-legend-text" },
};

export const TIER_PROGRESS_COLORS: Record<BadgeTier, { background: string; glow: string }> = {
  normal: { background: "rgba(59,130,246,0.95)", glow: "rgba(96,165,250,0.8)" },
  rare: { background: "rgba(168,85,247,0.95)", glow: "rgba(192,132,252,0.8)" },
  epic: { background: "rgba(245,158,11,0.95)", glow: "rgba(251,191,36,0.8)" },
  legend: { background: "transparent", glow: "rgba(244,114,182,0.85)" },
};

export interface BadgeDef {
  series: string;
  tier: BadgeTier;
  tierIndex: number;
  label: string;
  description: string;
  icon: React.ReactNode;
  requirement: string;
  nextBadgeLabel?: string;
  progressCurrent: number;
  progressTarget: number;
  earned: boolean;
}

interface DisplayBadge {
  series: string;
  label: string;
  tier: BadgeTier;
  tierLabel: string;
  icon: React.ReactNode;
  colors: { bg: string; text: string; ring: string; label: string };
  earned: boolean;
  highestEarnedIndex: number;
  currentIndex: number;
}

// ============================================================
// 徽章定义：进度和解锁状态会根据用户真实统计更新
// ============================================================

function versionBadgeIcon(icon: React.ReactNode) {
  if (!isValidElement<{ src?: string }>(icon) || !icon.props.src?.startsWith("/badges/")) return icon;
  return cloneElement(icon, { src: versionBadgeAssetUrl(icon.props.src) });
}

const BADGE_DEFINITIONS: BadgeDef[] = [
  { series: "publish", tier: "normal", tierIndex: 1, label: "熬汤新秀", description: "你已经是一个合格的厨子了", icon: <img src="/badges/publish-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计发布一篇海龟汤", nextBadgeLabel: "熬汤达人", progressCurrent: 0, progressTarget: 1, earned: false },
  { series: "publish", tier: "rare", tierIndex: 2, label: "熬汤达人", description: "没有你该怎么办？", icon: <img src="/badges/publish-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计发布十篇海龟汤", nextBadgeLabel: "熬汤大师", progressCurrent: 0, progressTarget: 10, earned: false },
  { series: "publish", tier: "epic", tierIndex: 3, label: "熬汤大师", description: "再……再来一口汤……", icon: <img src="/badges/publish-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计发布五十篇海龟汤", progressCurrent: 0, progressTarget: 50, earned: false },
  { series: "insight", tier: "normal", tierIndex: 1, label: "灵光乍现", description: "灵感在你的脑子里爆发", icon: <img src="/badges/insight-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "在AI玩汤中累计命中10次关键点（同一个汤的同一个关键点只记一次）", nextBadgeLabel: "洞察之眼", progressCurrent: 0, progressTarget: 10, earned: false },
  { series: "insight", tier: "rare", tierIndex: 2, label: "洞察之眼", description: "你已经可以洞悉一切了", icon: <img src="/badges/insight-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "在AI玩汤中累计命中100次关键点（同一个汤的同一个关键点只记一次）", nextBadgeLabel: "全知全能", progressCurrent: 0, progressTarget: 100, earned: false },
  { series: "insight", tier: "epic", tierIndex: 3, label: "全知全能", description: "这就是神的境地吗……", icon: <img src="/badges/insight-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "在AI玩汤中累计命中1000次关键点（同一个汤的同一个关键点只记一次）", progressCurrent: 0, progressTarget: 1000, earned: false },
  { series: "favorite", tier: "normal", tierIndex: 1, label: "私藏一汤", description: "我要把这个汤藏起来……", icon: <img src="/badges/favorite-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计收藏3个海龟汤", nextBadgeLabel: "藏汤百味", progressCurrent: 0, progressTarget: 3, earned: false },
  { series: "favorite", tier: "rare", tierIndex: 2, label: "藏汤百味", description: "我要把这些汤全藏起来……", icon: <img src="/badges/favorite-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计收藏20个海龟汤", nextBadgeLabel: "万汤宝库", progressCurrent: 0, progressTarget: 20, earned: false },
  { series: "favorite", tier: "epic", tierIndex: 3, label: "万汤宝库", description: "藏不住了……太多了……", icon: <img src="/badges/favorite-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计收藏100个海龟汤", progressCurrent: 0, progressTarget: 100, earned: false },
  { series: "like", tier: "normal", tierIndex: 1, label: "一点心意", description: "这只是我的一点心意", icon: <img src="/badges/like-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计点赞3个海龟汤", nextBadgeLabel: "热情汤客", progressCurrent: 0, progressTarget: 3, earned: false },
  { series: "like", tier: "rare", tierIndex: 2, label: "热情汤客", description: "我只是有点热情", icon: <img src="/badges/like-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计点赞20个海龟汤", nextBadgeLabel: "点赞如潮", progressCurrent: 0, progressTarget: 20, earned: false },
  { series: "like", tier: "epic", tierIndex: 3, label: "点赞如潮", description: "停不下来，根本停不下来", icon: <img src="/badges/like-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计点赞100个海龟汤", progressCurrent: 0, progressTarget: 100, earned: false },
  { series: "login", tier: "normal", tierIndex: 1, label: "三日来客", description: "初来乍到，请多指教", icon: <img src="/badges/login-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计登录3天", nextBadgeLabel: "一月常客", progressCurrent: 0, progressTarget: 3, earned: false },
  { series: "login", tier: "rare", tierIndex: 2, label: "一月常客", description: "我已经习惯住在这里了", icon: <img src="/badges/login-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计登录20天", nextBadgeLabel: "百日不辍", progressCurrent: 0, progressTarget: 20, earned: false },
  { series: "login", tier: "epic", tierIndex: 3, label: "百日不辍", description: "你知道人生有多少个一百天吗？", icon: <img src="/badges/login-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计登录100天", progressCurrent: 0, progressTarget: 100, earned: false },
  { series: "creatorLike", tier: "normal", tierIndex: 1, label: "小有名气", description: "我只是默默无闻", icon: <img src="/badges/creator-like-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得10个点赞（同一用户取消点赞反复点赞只记录一次）", nextBadgeLabel: "我是明星", progressCurrent: 0, progressTarget: 10, earned: false },
  { series: "creatorLike", tier: "rare", tierIndex: 2, label: "我是明星", description: "我只是默默无闻…？", icon: <img src="/badges/creator-like-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得100个点赞（同一用户取消点赞反复点赞只记录一次）", nextBadgeLabel: "人气王", progressCurrent: 0, progressTarget: 100, earned: false },
  { series: "creatorLike", tier: "epic", tierIndex: 3, label: "人气王", description: "还有谁？", icon: <img src="/badges/creator-like-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得1000个点赞（同一用户取消点赞反复点赞只记录一次）", progressCurrent: 0, progressTarget: 1000, earned: false },
  { series: "creatorFavorite", tier: "normal", tierIndex: 1, label: "值得珍藏", description: "有人悄悄把我的汤藏起来了", icon: <img src="/badges/creator-favorite-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得10个收藏（同一用户取消收藏后反复收藏只记录一次）", nextBadgeLabel: "收藏达人", progressCurrent: 0, progressTarget: 10, earned: false },
  { series: "creatorFavorite", tier: "rare", tierIndex: 2, label: "收藏达人", description: "看来这碗汤值得反复回味", icon: <img src="/badges/creator-favorite-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得100个收藏（同一用户取消收藏后反复收藏只记录一次）", nextBadgeLabel: "镇馆之汤", progressCurrent: 0, progressTarget: 100, earned: false },
  { series: "creatorFavorite", tier: "epic", tierIndex: 3, label: "镇馆之汤", description: "这碗汤，值得永久珍藏", icon: <img src="/badges/creator-favorite-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得1000个收藏（同一用户取消收藏后反复收藏只记录一次）", progressCurrent: 0, progressTarget: 1000, earned: false },
  { series: "receivedComment", tier: "normal", tierIndex: 1, label: "初有回响", description: "终于有人来聊聊这碗汤了", icon: <img src="/badges/received-comment-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得5条有效评论（只评分不评论不计入）", nextBadgeLabel: "热议之汤", progressCurrent: 0, progressTarget: 5, earned: false },
  { series: "receivedComment", tier: "rare", tierIndex: 2, label: "热议之汤", description: "评论区好像越来越热闹了", icon: <img src="/badges/received-comment-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得50条有效评论（只评分不评论不计入）", nextBadgeLabel: "话题之王", progressCurrent: 0, progressTarget: 50, earned: false },
  { series: "receivedComment", tier: "epic", tierIndex: 3, label: "话题之王", description: "一碗汤，引出三百种猜想", icon: <img src="/badges/received-comment-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "发布的原创海龟汤累计获得300条有效评论（只评分不评论不计入）", progressCurrent: 0, progressTarget: 300, earned: false },
  { series: "commenter", tier: "normal", tierIndex: 1, label: "初次开麦", description: "这碗汤，我有话要说", icon: <img src="/badges/commenter-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计发布5条有效评论（只评分不评论不计入）", nextBadgeLabel: "评论达人", progressCurrent: 0, progressTarget: 5, earned: false },
  { series: "commenter", tier: "rare", tierIndex: 2, label: "评论达人", description: "每一碗汤都值得聊上两句", icon: <img src="/badges/commenter-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计发布50条有效评论（只评分不评论不计入）", nextBadgeLabel: "妙语连珠", progressCurrent: 0, progressTarget: 50, earned: false },
  { series: "commenter", tier: "epic", tierIndex: 3, label: "妙语连珠", description: "评论区不能没有我", icon: <img src="/badges/commenter-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计发布300条有效评论（只评分不评论不计入）", progressCurrent: 0, progressTarget: 300, earned: false },
  { series: "aiClear", tier: "normal", tierIndex: 1, label: "初识汤灵", description: "原来AI真的会带汤", icon: <img src="/badges/ai-clear-normal.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计通关1次AI玩汤（同一局游戏重复结算只记录一次）", nextBadgeLabel: "汤灵搭档", progressCurrent: 0, progressTarget: 1, earned: false },
  { series: "aiClear", tier: "rare", tierIndex: 2, label: "汤灵搭档", description: "你负责带汤，我负责找到真相", icon: <img src="/badges/ai-clear-rare.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计通关10次AI玩汤（同一局游戏重复结算只记录一次）", nextBadgeLabel: "AI破局王", progressCurrent: 0, progressTarget: 10, earned: false },
  { series: "aiClear", tier: "epic", tierIndex: 3, label: "AI破局王", description: "AI也藏不住最后的真相", icon: <img src="/badges/ai-clear-epic.png" alt="" className="h-full w-full object-cover" draggable={false} />, requirement: "累计通关50次AI玩汤（同一局游戏重复结算只记录一次）", progressCurrent: 0, progressTarget: 50, earned: false },
];

// 徽章文件名未包含内容哈希，版本号用于在图片更新时主动刷新浏览器长期缓存。
export const BADGES: BadgeDef[] = BADGE_DEFINITIONS.map((badge) => ({ ...badge, icon: versionBadgeIcon(badge.icon) }));

export function buildBadgesFromStats(stats: StatsResponse): BadgeDef[] {
  const progressBySeries: Record<string, number> = {
    publish: stats.soupCount,
    insight: stats.criticalHitCount,
    favorite: stats.favoriteCount,
    like: stats.likeCount,
    login: stats.loginDayCount,
    creatorLike: stats.receivedLikeCount,
    creatorFavorite: stats.receivedFavoriteCount,
    receivedComment: stats.receivedCommentCount,
    commenter: stats.writtenCommentCount,
    aiClear: stats.aiCompletionCount,
  };
  return BADGES.map((badge) => ({
    ...badge,
    progressCurrent: progressBySeries[badge.series] ?? 0,
    earned: (progressBySeries[badge.series] ?? 0) >= badge.progressTarget,
  }));
}

export function getBadgeKey(badge: BadgeDef) {
  return `${badge.series}:${badge.tier}`;
}

// ============================================================
// 工具函数
// ============================================================

function buildDisplayBadges(badges: BadgeDef[]): DisplayBadge[] {
  const groups = new Map<string, BadgeDef[]>();
  for (const b of badges) {
    const list = groups.get(b.series) ?? [];
    list.push(b);
    groups.set(b.series, list);
  }
  const result: DisplayBadge[] = [];
  for (const [, list] of groups) {
    list.sort((a, b) => a.tierIndex - b.tierIndex);
    const earnedBadges = list.filter(b => b.earned);
    const highestEarned = earnedBadges.length > 0
      ? earnedBadges.reduce((max, b) => b.tierIndex > max.tierIndex ? b : max)
      : null;
    if (highestEarned) {
      const tier = highestEarned.tier;
      result.push({
        series: highestEarned.series,
        label: highestEarned.label,
        tier, tierLabel: TIER_LABEL[tier],
        icon: highestEarned.icon,
        colors: TIER_COLORS_EARNED[tier],
        earned: true,
        highestEarnedIndex: highestEarned.tierIndex,
        currentIndex: highestEarned.tierIndex,
      });
    } else {
      const lowest = list[0];
      result.push({
        series: lowest.series,
        label: lowest.label,
        tier: lowest.tier,
        tierLabel: TIER_LABEL[lowest.tier],
        icon: lowest.icon,
        colors: { bg: "bg-slate-100", text: "text-slate-500", ring: "ring-slate-200", label: "text-slate-400" },
        earned: false,
        highestEarnedIndex: 0,
        currentIndex: lowest.tierIndex,
      });
    }
  }
  return result;
}

function getBadgeDef(badges: BadgeDef[], series: string, tierIndex: number): BadgeDef | undefined {
  return badges.find(b => b.series === series && b.tierIndex === tierIndex);
}

function getAllTiers(badges: BadgeDef[], series: string): BadgeDef[] {
  return badges.filter(b => b.series === series).sort((a, b) => a.tierIndex - b.tierIndex);
}

function getProgressText(badge: BadgeDef): string {
  if (badge.earned) return "已完成";
  return `${badge.progressCurrent}/${badge.progressTarget}`;
}

// ============================================================
// 动画参数
// ============================================================

const FLIP_DURATION = 800;
const FLIP_CURVE = "cubic-bezier(0.2, 0.65, 0.3, 1)";
const REVERSE_FLIP_CURVE = "cubic-bezier(0.7, 0, 0.8, 0.35)";
const BADGE_SIZE = 64; // px
const SCALE = 1.5;

// ============================================================
// BadgeIcon — 复用的徽章图标组件
// ============================================================

function BadgeIcon({ badge }: { badge: DisplayBadge }) {
  return (
    <div
      className={`grid h-full w-full place-items-center overflow-hidden rounded-2xl shadow-soft ring-1 ${
        badge.earned ? badge.colors.bg : "bg-slate-100"
      } ${badge.earned ? badge.colors.text : "text-slate-500"} ${
        badge.earned ? badge.colors.ring : "ring-slate-200"
      } ${badge.earned ? "" : "grayscale"}`}
    >
      {badge.icon}
    </div>
  );
}

// ============================================================
// AnimatingBadge — 会飞的徽章
// ============================================================

function AnimatingBadge({
  badge,
  startRect,
  targetRect,
  reverse = false,
  onDone,
  onClickBackdrop,
}: {
  badge: DisplayBadge;
  startRect: DOMRect;
  targetRect: DOMRect;
  reverse?: boolean;
  onDone: () => void;
  onClickBackdrop: () => void;
}) {
  const [phase, setPhase] = useState<"start" | "flying" | "pausing">("start");

  const fromX = startRect.left + startRect.width / 2 - window.innerWidth / 2;
  const fromY = startRect.top + startRect.height / 2 - window.innerHeight / 2;
  const toX = targetRect.left + targetRect.width / 2 - window.innerWidth / 2;
  const toY = targetRect.top + targetRect.height / 2 - window.innerHeight / 2;

  // start → flying（双 rAF 触发 CSS transition）
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("flying"));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // 正向飞行结束后短暂停留；反向抵达列表后立即结束。
  useEffect(() => {
    if (phase !== "flying") return;
    const t = setTimeout(() => {
      if (reverse) onDone();
      else setPhase("pausing");
    }, FLIP_DURATION);
    return () => clearTimeout(t);
  }, [phase, reverse, onDone]);

  // pausing → done
  useEffect(() => {
    if (phase !== "pausing") return;
    const t = setTimeout(onDone, 100);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  const isStart = phase === "start";
  const isPausing = phase === "pausing";
  const show3D = !isStart && !isPausing;
  const fromScale = reverse ? SCALE : 1;
  const toScale = reverse ? 1 : SCALE;
  const motionCurve = reverse ? REVERSE_FLIP_CURVE : FLIP_CURVE;

  // 3D 翻转需要独立的状态，挂载后下一帧才切到 rotateY(360deg)
  const [flip3D, setFlip3D] = useState(false);
  useEffect(() => {
    if (!show3D) { setFlip3D(false); return; }
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setFlip3D(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [show3D]);

  return (
    <div className="fixed inset-0 z-50 !mt-0" onClick={onClickBackdrop}>
      {/* 正向加深遮罩，反向淡出遮罩 */}
      <div
        className="absolute inset-0 bg-slate-900"
        style={{
          opacity: reverse ? (isStart ? 0.65 : 0) : (isStart ? 0 : 0.65),
          transition: isStart ? "none" : `opacity ${FLIP_DURATION}ms ${motionCurve}`,
        }}
      />

      {/* 外层：纯 2D 位移 + 缩放，不受 3D 影响 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          marginLeft: -BADGE_SIZE / 2,
          marginTop: -BADGE_SIZE / 2,
          transition: (isStart || isPausing) ? "none" : `transform ${FLIP_DURATION}ms ${motionCurve}`,
          transform: isStart
            ? `translate(${fromX}px, ${fromY}px) scale(${fromScale})`
            : `translate(${toX}px, ${toY}px) scale(${toScale})`,
        }}
      >
        {/* flying 阶段：3D 翻转，flip3D 控制从 0deg 过渡到 360deg */}
        {show3D && (
          <div
            className="absolute inset-0"
            style={{
              transition: `transform ${FLIP_DURATION}ms ${motionCurve}`,
              transform: flip3D
                ? `perspective(800px) rotateY(${reverse ? -360 : 360}deg)`
                : "perspective(800px) rotateY(0deg)",
              transformStyle: "preserve-3d",
            }}
          >
            <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
              <BadgeIcon badge={badge} />
            </div>
            <div
              className="absolute inset-0"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              {badge.earned ? (
                <div className="badge-metal-back h-full w-full rounded-2xl shadow-soft" aria-hidden="true" />
              ) : (
                <BadgeIcon badge={badge} />
              )}
            </div>
          </div>
        )}
        {/* start / pausing：2D 静态 */}
        {(isStart || isPausing) && (
          <div className="absolute inset-0">
            <BadgeIcon badge={badge} />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BadgeDetail — 详情覆盖层
// ============================================================

function BadgeDetail({
  badge,
  badges,
  series,
  badgeRef,
  visible,
  textVisible,
  onClickBackdrop,
}: {
  badge: DisplayBadge;
  badges: BadgeDef[];
  series: string | null;
  badgeRef?: (el: HTMLDivElement | null) => void;
  visible: boolean;
  textVisible: boolean;
  onClickBackdrop: () => void;
}) {
  const def = series ? getBadgeDef(badges, series, badge.currentIndex) : undefined;

  // 文字渐显 400ms
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    if (!textVisible) { setShowText(false); return; }
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setShowText(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [textVisible]);

  if (!def) return null;

  const allTiers = getAllTiers(badges, def.series);
  const nextUnearnedTier = allTiers.find((tier) => !tier.earned);
  const progressBadge = def.earned && nextUnearnedTier ? nextUnearnedTier : def;

  return (
    <div
      className={`fixed inset-0 z-50 !mt-0 flex items-center justify-center ${
        visible ? "visible" : "invisible pointer-events-none"
      }`}
      onClick={onClickBackdrop}
    >
      <div className="absolute inset-0 bg-slate-900/65" />

      <div
        className="relative z-10 flex flex-col items-center text-center"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 徽章 — ref 挂载点 */}
        <div ref={badgeRef}>
          <div
            style={{ width: BADGE_SIZE, height: BADGE_SIZE, transform: `scale(${SCALE})` }}
            className="grid place-items-center"
          >
            <BadgeIcon badge={badge} />
          </div>
        </div>

        {/* 文字 — 400ms 渐显 */}
        <div
          className={`flex flex-col items-center text-center transition-opacity ${
            showText ? "opacity-100" : "opacity-0"
          }`}
          style={{
            transitionDuration: textVisible ? "400ms" : "200ms",
            transitionTimingFunction: textVisible ? "ease-out" : "ease-in",
          }}
        >
          <h3 className="mt-5 text-lg font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7),0_0_8px_rgba(0,0,0,0.4)]">{def.label}</h3>
          <p className="mt-2 text-sm font-semibold leading-relaxed max-w-64 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7),0_0_8px_rgba(0,0,0,0.4)]">
            {def.description}
          </p>
          <p className="mt-1.5 text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7),0_0_8px_rgba(0,0,0,0.4)]">
            获取条件：{def.requirement}
          </p>
          {def.nextBadgeLabel && (
            <p className="mt-1 text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7),0_0_8px_rgba(0,0,0,0.4)]">
              下一等级：{def.nextBadgeLabel}
            </p>
          )}
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/20 backdrop-blur px-4 py-1.5 ring-1 ring-white/30">
            <span className="text-xs font-bold text-white/80">进度</span>
            <span className="text-sm font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">{getProgressText(progressBadge)}</span>
          </div>

          {/* 升级路径 */}
          {(() => {
            if (allTiers.length <= 1) return null;
            return (
              <div className="mt-4 flex items-center justify-center gap-1">
                {allTiers.map((t, i) => (
                  <div key={t.tier} className="flex items-center gap-1">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)] ${
                        t.earned && t.tier === "legend" ? "badge-legend-shimmer" : ""
                      }`}
                      style={{
                        background: t.earned
                          ? (t.tier === "legend" ? undefined : TIER_PROGRESS_COLORS[t.tier].background)
                          : "rgba(71,85,105,0.45)",
                        border: t.earned
                          ? "1px solid rgba(255,255,255,0.75)"
                          : "1px solid rgba(255,255,255,0.18)",
                        boxShadow: t.earned
                          ? `0 0 12px ${TIER_PROGRESS_COLORS[t.tier].glow}`
                          : "none",
                      }}
                    >
                      {TIER_LABEL[t.tier]}
                    </span>
                    {i < allTiers.length - 1 && (
                      <span className="text-white/60 text-[10px]">→</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 页面组件
// ============================================================

export default function MyAchievementsPage() {
  const navigate = useNavigate();
  const [badges, setBadges] = useState<BadgeDef[]>(BADGES);
  const [legendaryBadges, setLegendaryBadges] = useState<LegendaryBadge[]>([]);
  const displayBadges = buildDisplayBadges(badges);

  useEffect(() => {
    api<StatsResponse>("/api/me/stats")
      .then((stats) => setBadges(buildBadgesFromStats(stats)))
      .catch(() => {});
    api<{ badges: LegendaryBadge[] }>("/api/me/legendary-badges")
      .then((result) => setLegendaryBadges(result.badges))
      .catch(() => {});
  }, []);

  const [state, setState] = useState<{
    phase: "measuring" | "flying" | "done" | "closing" | "returning";
    badge: DisplayBadge;
    startRect: DOMRect;
    targetRect?: DOMRect;
  } | null>(null);

  const badgeDetailRef = useRef<HTMLDivElement | null>(null);

  // measuring → flying：拿到 BadgeDetail 中徽章的真实屏幕位置后开始动画
  useEffect(() => {
    if (!state || state.phase !== "measuring") return;
    const raf = requestAnimationFrame(() => {
      const el = badgeDetailRef.current;
      if (!el) return;
      const targetRect = el.getBoundingClientRect();
      setState(prev => prev ? { ...prev, phase: "flying", targetRect } : null);
    });
    return () => cancelAnimationFrame(raf);
  }, [state]);

  function handleBadgeClick(badge: DisplayBadge, e: React.MouseEvent) {
    if (state) return;
    const iconEl = (e.currentTarget as HTMLElement).firstElementChild as HTMLElement;
    if (!iconEl) return;
    const startRect = iconEl.getBoundingClientRect();
    setState({ phase: "measuring", badge, startRect });
  }

  function handleAnimDone() {
    setState(prev => prev ? { ...prev, phase: "done" } : null);
  }

  function dismiss() {
    setState(prev => {
      if (!prev) return null;
      if (prev.phase === "done") return { ...prev, phase: "closing" };
      if (prev.phase === "closing" || prev.phase === "returning") return prev;
      return null;
    });
  }

  // 关闭流程：文字快速淡出 200ms，随后立即反向飞行
  useEffect(() => {
    if (!state || state.phase !== "closing") return;
    const t = setTimeout(() => {
      const targetRect = badgeDetailRef.current?.getBoundingClientRect() ?? state.targetRect;
      setState(prev => prev?.phase === "closing"
        ? { ...prev, phase: "returning", targetRect }
        : prev);
    }, 200);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") dismiss(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  const isFlying = state?.phase === "flying";
  const isDone = state?.phase === "done";
  const isClosing = state?.phase === "closing";
  const isReturning = state?.phase === "returning";
  const detailMounted = state != null;
  const detailVisible = isDone || isClosing;
  const flippingSeries = state?.badge.series;

  return (
    <section className="space-y-3">
      <PageTopBar title="我的成就" />

      <button
        className="flex min-h-10 items-center gap-2 px-4 text-sm font-bold text-muted"
        onClick={() => navigate("/mine")}
      >
        <ArrowLeft size={18} />
        <span>返回</span>
      </button>

      {/* ======== 徽章网格 ======== */}
      <div className="px-4">
        <div className="grid grid-cols-4 gap-4">
          {displayBadges.map((badge) => {
            const isThis = state && flippingSeries === badge.series;
            return (
              <div
                key={badge.series}
                className={`flex flex-col items-center gap-1.5 cursor-pointer transition-opacity duration-300 ${
                  isThis ? "opacity-0" : "opacity-100"
                }`}
                onClick={(e) => handleBadgeClick(badge, e)}
              >
                <div
                  className={`grid h-16 w-16 place-items-center overflow-hidden rounded-2xl shadow-soft ring-1 select-none ${
                    badge.earned ? badge.colors.bg : "bg-slate-100"
                  } ${badge.earned ? badge.colors.text : "text-slate-500"} ${
                    badge.earned ? badge.colors.ring : "ring-slate-200"
                  } ${badge.earned ? "" : "grayscale"}`}
                  title={
                    badge.earned
                      ? `${badge.label} · ${badge.tierLabel} · 已获得`
                      : `${badge.label} · ${badge.tierLabel} · 未获得`
                  }
                >
                  {badge.icon}
                </div>
                <span
                  className={`text-xs font-semibold text-center leading-tight ${
                    badge.earned ? "text-ink" : "text-slate-500"
                  } ${isThis ? "opacity-0" : "opacity-100"} transition-opacity duration-200`}
                >
                  {badge.label}
                </span>
                <span
                  className={`text-[11px] font-bold ${
                    badge.earned ? badge.colors.label : "text-slate-400"
                  } ${isThis ? "opacity-0" : "opacity-100"} transition-opacity duration-200`}
                >
                  {badge.tierLabel}
                </span>
              </div>
            );
          })}
          {legendaryBadges.map((badge) => <LegendaryBadgeTile key={badge.key} badge={badge} />)}
        </div>
      </div>

      {/* ======== BadgeDetail — measuring 到 done 同一实例不卸载 ======== */}
      {detailMounted && state && (
        <BadgeDetail
          badge={state.badge}
          badges={badges}
          series={state.badge.series}
          badgeRef={(el) => { badgeDetailRef.current = el; }}
          visible={detailVisible}
          textVisible={isDone}
          onClickBackdrop={dismiss}
        />
      )}

      {/* ======== 动画浮层 — 仅 flying 阶段 ======== */}
      {isFlying && state.targetRect && (
        <AnimatingBadge
          badge={state.badge}
          startRect={state.startRect}
          targetRect={state.targetRect}
          onDone={handleAnimDone}
          onClickBackdrop={dismiss}
        />
      )}

      {/* ======== 反向动画：详情徽章飞回原列表位置 ======== */}
      {isReturning && state.targetRect && (
        <AnimatingBadge
          badge={state.badge}
          startRect={state.targetRect}
          targetRect={state.startRect}
          reverse
          onDone={() => setState(null)}
          onClickBackdrop={() => {}}
        />
      )}
    </section>
  );
}
