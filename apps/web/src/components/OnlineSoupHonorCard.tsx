import { Award, Sparkles } from "lucide-react";
import { useState } from "react";
import type { OnlineSoupAiHonors, OnlineSoupAnswer } from "../shared/types";

const answerLabels: Record<OnlineSoupAnswer, string> = {
  yes: "是",
  no: "不是",
  both: "是也不是",
  unknown: "不知道",
  irrelevant: "不重要",
};

function HonorAvatar({
  avatar,
  nickname,
  size = "large",
}: {
  avatar: string | null;
  nickname: string;
  size?: "large" | "small";
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const sizeClass = size === "large" ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm";
  return avatar && !avatarFailed
    ? <img className={`${sizeClass} shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm`} src={avatar} alt={`${nickname}头像`} loading="lazy" decoding="async" onError={() => setAvatarFailed(true)} />
    : <span className={`grid ${sizeClass} shrink-0 place-items-center rounded-full bg-blue-100 font-black text-primary ring-2 ring-white shadow-sm`} aria-label={`${nickname}头像`}>{nickname.slice(0, 1)}</span>;
}

function HonorUserRow({
  avatar,
  nickname,
  userId,
  size,
  onOpenUser,
  ariaLabel,
  gapClass,
  nameClass,
}: {
  avatar: string | null;
  nickname: string;
  userId: string;
  size: "large" | "small";
  onOpenUser?: (userId: string) => void;
  ariaLabel: string;
  gapClass: string;
  nameClass: string;
}) {
  const content = <><HonorAvatar avatar={avatar} nickname={nickname} size={size} /><strong className={nameClass}>{nickname}</strong></>;
  return onOpenUser
    ? <button type="button" className={`mt-2 flex min-h-11 max-w-full items-center ${gapClass} rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`} onClick={() => onOpenUser(userId)} aria-label={ariaLabel}>{content}</button>
    : <div className={`mt-2 flex min-h-11 max-w-full items-center ${gapClass}`}>{content}</div>;
}

export function OnlineSoupHonorCard({
  honors,
  compact = false,
  onOpenUser,
}: {
  honors: OnlineSoupAiHonors;
  compact?: boolean;
  onOpenUser?: (userId: string) => void;
}) {
  const best = honors.bestQuestion;
  const bestAnswer = answerLabels[best.answer] ?? best.answer;
  return (
    <article className={`overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-violet-50 shadow-sm ${compact ? "p-3" : "p-4"}`} aria-label="AI 本轮荣誉评选">
      <div className="flex items-center gap-2 text-amber-800">
        <Sparkles size={compact ? 15 : 18} className="shrink-0" />
        <h3 className={`${compact ? "text-xs" : "text-sm"} font-black`}>AI 本轮评选</h3>
      </div>

      <section className={`mt-3 rounded-xl border border-amber-100 bg-white/90 ${compact ? "p-2.5" : "p-3"}`}>
        <div className="flex items-center gap-1.5 text-[11px] font-black text-amber-700"><Award size={14} />本场 MVP</div>
        <HonorUserRow avatar={honors.mvp.avatar} nickname={honors.mvp.nickname} userId={honors.mvp.userId} size={compact ? "small" : "large"} onOpenUser={onOpenUser} ariaLabel={`查看本场MVP ${honors.mvp.nickname} 的主页`} gapClass="gap-3" nameClass={`${compact ? "text-sm" : "text-base"} truncate text-ink`} />
      </section>

      <section className={`mt-2 rounded-xl border border-violet-100 bg-white/90 ${compact ? "p-2.5" : "p-3"}`}>
        <div className="flex items-center gap-1.5 text-[11px] font-black text-violet-700"><Sparkles size={14} />最具价值提问</div>
        <HonorUserRow avatar={best.avatar} nickname={best.nickname} userId={best.userId} size="small" onOpenUser={onOpenUser} ariaLabel={`查看提问者 ${best.nickname} 的主页`} gapClass="gap-2.5" nameClass="truncate text-sm text-ink" />
        <blockquote className={`${compact ? "mt-2 text-xs leading-5" : "mt-3 text-sm leading-6"} whitespace-pre-wrap break-words rounded-xl bg-violet-50 px-3 py-2 font-bold text-slate-800`}>{best.question}</blockquote>
        <p className={`${compact ? "mt-1.5 text-[11px]" : "mt-2 text-xs"} font-bold text-violet-700`}>AI主持人回答：{bestAnswer}</p>
      </section>
    </article>
  );
}
