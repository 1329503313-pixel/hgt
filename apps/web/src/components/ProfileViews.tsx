import { Flame } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { SocialProfile, SoupSummary } from "../shared/types";
import { EquippedBadgeIcon } from "./BadgeVisuals";
import { defaultCoverUrl } from "../shared/staticAssets";

export function ProfileHero({
  profile,
  onFollowing,
  onFollowers,
  actions,
  meta,
  onAvatar,
  showBadge = true
}: {
  profile: SocialProfile;
  onFollowing: () => void;
  onFollowers: () => void;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  onAvatar?: () => void;
  showBadge?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
      <div className="profile-gradient relative h-[118px] px-4 pt-4 text-white">
        <div className="flex items-center gap-3">
          <button className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-white/90 bg-white/20 text-2xl font-black shadow-md" onClick={onAvatar} disabled={!onAvatar}>
            {profile.avatar ? <img className="h-full w-full object-cover" src={profile.avatar} alt="" /> : profile.nickname.slice(0, 1)}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-black">{profile.nickname}</h1>
              {showBadge && profile.equippedBadge && <EquippedBadgeIcon badge={profile.equippedBadge} className="h-8 w-8 rounded-lg" title={profile.equippedBadge.name} animated={false} showName={false} />}
            </div>
            {meta && <div className="mt-1">{meta}</div>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-line px-2 py-3">
        <div className="text-center"><p className="text-lg font-black text-ink">{profile.receivedLikeCount}</p><p className="text-xs text-muted">获赞</p></div>
        <button className="text-center" onClick={onFollowing}><p className="text-lg font-black text-ink">{profile.followingCount}</p><p className="text-xs text-muted">关注</p></button>
        <button className="text-center" onClick={onFollowers}><p className="text-lg font-black text-ink">{profile.followerCount}</p><p className="text-xs text-muted">粉丝</p></button>
      </div>
    </div>
  );
}

export function SoupCoverGrid({ soups, emptyHint }: { soups: SoupSummary[]; emptyHint: string }) {
  const navigate = useNavigate();
  if (!soups.length) return <div className="py-16 text-center text-sm text-muted">{emptyHint}</div>;
  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:gap-3 sm:p-3">
      {soups.map((soup) => (
        <button key={soup.id} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-200 text-left" onClick={() => navigate(`/soup/${soup.id}`)}>
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
