import { Award, MessageCircleQuestion, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { OnlineSoupAiHonors, OnlineSoupAnswer } from "../shared/types";

const answerLabels: Record<OnlineSoupAnswer, string> = {
  yes: "是",
  no: "不是",
  both: "是也不是",
  unknown: "不知道",
  irrelevant: "不重要",
};

function HonorAvatar({ avatar, nickname, compact }: { avatar: string | null; nickname: string; compact: boolean }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const sizeClass = compact ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm";
  const frameClass = "ring-2 ring-indigo-300/70 shadow-[0_4px_16px_rgba(15,23,42,0.35)]";
  return avatar && !avatarFailed
    ? <img className={`${sizeClass} ${frameClass} shrink-0 rounded-full object-cover`} src={avatar} alt={`${nickname}头像`} loading="lazy" decoding="async" onError={() => setAvatarFailed(true)} />
    : <span className={`grid ${sizeClass} ${frameClass} shrink-0 place-items-center rounded-full bg-white/15 font-black text-white`} aria-label={`${nickname}头像`}>{nickname.slice(0, 1)}</span>;
}

function HonorUser({
  avatar,
  nickname,
  userId,
  compact,
  onOpenUser,
}: {
  avatar: string | null;
  nickname: string;
  userId: string;
  compact: boolean;
  onOpenUser?: (userId: string) => void;
}) {
  const content = <>
    <HonorAvatar avatar={avatar} nickname={nickname} compact={compact} />
    <strong className={`${compact ? "text-sm" : "text-base"} whitespace-nowrap font-black text-white`}>{nickname}</strong>
  </>;
  const className = "flex min-h-11 min-w-0 max-w-full items-center gap-2.5 rounded-xl text-left";
  return onOpenUser
    ? <button type="button" className={`${className} -m-1 cursor-pointer p-1 transition-colors hover:bg-white/[0.06] active:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200`} onClick={() => onOpenUser(userId)} aria-label={`查看 ${nickname} 的主页`}>{content}</button>
    : <div className={className}>{content}</div>;
}

function HonorSection({
  title,
  icon,
  compact,
  identity,
  children,
}: {
  title: string;
  icon: ReactNode;
  compact: boolean;
  identity: ReactNode;
  children?: ReactNode;
}) {
  return <section className={`rounded-2xl border border-indigo-300/30 bg-white/[0.06] ${compact ? "p-2.5" : "p-3"}`} aria-label={title}>
    <div className={`flex items-center gap-2 font-black text-white ${compact ? "text-xs" : "text-sm"}`}>
      <span className={`grid shrink-0 place-items-center rounded-full border border-amber-200/30 bg-amber-300/15 text-amber-200 ${compact ? "h-7 w-7" : "h-8 w-8"}`} aria-hidden="true">{icon}</span>
      <h4>{title}</h4>
    </div>
    <div className={compact ? "mt-1.5" : "mt-2"}>{identity}</div>
    {children && <div className={`${compact ? "mt-1.5 pt-1.5" : "mt-2 pt-2"} border-t border-white/10`}>{children}</div>}
  </section>;
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
    <article className={`overflow-hidden border border-indigo-400/40 bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-900 text-white shadow-soft ${compact ? "rounded-2xl p-3" : "rounded-3xl p-4 sm:p-5"}`} aria-label="本轮高光荣誉卡片">
      <header className={`flex items-center gap-2.5 border-b border-white/10 ${compact ? "pb-2.5" : "pb-3"}`}>
        <Sparkles size={compact ? 19 : 23} className="shrink-0 fill-amber-300 text-amber-200" aria-hidden="true" />
        <h3 className={`${compact ? "text-lg" : "text-xl"} font-black tracking-tight text-white`}>本轮高光</h3>
      </header>

      <div className={compact ? "mt-2.5 space-y-2" : "mt-3 space-y-2.5"}>
        <HonorSection
          title="本场 MVP"
          icon={<Award size={compact ? 14 : 16} strokeWidth={2.25} />}
          compact={compact}
          identity={<HonorUser avatar={honors.mvp.avatar} nickname={honors.mvp.nickname} userId={honors.mvp.userId} compact={compact} onOpenUser={onOpenUser} />}
        />

        <HonorSection
          title="最具价值提问"
          icon={<MessageCircleQuestion size={compact ? 14 : 16} strokeWidth={2.25} />}
          compact={compact}
          identity={<HonorUser avatar={best.avatar} nickname={best.nickname} userId={best.userId} compact={compact} onOpenUser={onOpenUser} />}
        >
          <blockquote className={`${compact ? "text-xs leading-5" : "text-sm leading-6"} whitespace-pre-wrap break-words font-bold text-blue-50`}>{best.question}</blockquote>
          <div className={`${compact ? "mt-1.5 text-[11px]" : "mt-2 text-xs"} flex items-center gap-2 font-bold text-blue-200`}>
            <span>答案</span>
            <strong className="rounded-full border border-blue-300/35 bg-blue-400/20 px-2.5 py-1 font-black text-white">{bestAnswer}</strong>
          </div>
        </HonorSection>
      </div>
    </article>
  );
}
