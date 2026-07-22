import { useEffect, useState } from "react";
import { MessageCircle, UserCheck, UserPlus } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { SocialProfile, SoupSummary } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ProfileHero, SoupCoverGrid } from "../components/ProfileViews";
import { ProfileSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";
import { useOnlineSoupExitGuard } from "../shared/onlineSoupExitGuard";
import { CardCabinetSection } from "../components/CardCabinetSection";
import { UnifiedBackButton } from "../components/UnifiedBackButton";

type ProfileResponse = { profile: SocialProfile; soups: SoupSummary[] };
const profileCacheKey = (viewerId: string, targetId: string) => `hgt:user-profile:${viewerId}:${targetId}`;

export default function UserProfilePage() {
  const { id = "" } = useParams();
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const onlineSoupOrigin = location.state as { onlineSoupRoomId?: string; onlineSoupMember?: boolean; circleId?: string } | null;
  const onlineSoupRoomId = onlineSoupOrigin?.onlineSoupRoomId ?? "";
  const circleId = onlineSoupOrigin?.circleId ?? "";
  const backTarget = onlineSoupRoomId ? `/online-soup/rooms/${onlineSoupRoomId}` : circleId ? `/circles/${circleId}` : "/";
  useOnlineSoupExitGuard(onlineSoupRoomId, Boolean(onlineSoupOrigin?.onlineSoupMember), "detail");
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [soups, setSoups] = useState<SoupSummary[]>([]);

  async function loadProfile(cacheKey: string) {
    const data = await api<ProfileResponse>(`/api/users/${id}/profile`);
    setProfile(data.profile); setSoups(data.soups);
    writeSessionCache(cacheKey, data);
  }

  useEffect(() => {
    if (loadingUser || !user || !id) return;
    const cacheKey = profileCacheKey(user.id, id);
    const cached = readSessionCache<ProfileResponse>(cacheKey, 2 * 60_000);
    if (cached) { setProfile(cached.profile); setSoups(cached.soups); }
    else { setProfile(null); setSoups([]); }
    void loadProfile(cacheKey).catch((error) => { if (!cached) showToast((error as Error).message); });
  }, [id, user?.id, loadingUser]);

  if (!profile) return <section className="user-profile-page min-h-screen bg-page pt-[72px]"><PageTopBar title="用户主页" backTo={backTarget} /><div className="user-profile-content mx-auto max-w-3xl px-4"><div className="user-profile-desktop-back mb-4 hidden lg:flex"><UnifiedBackButton to={backTarget} /></div><ProfileSkeleton /></div></section>;

  async function toggleFollow() {
    try {
      const data = await api<{ isFollowing: boolean }>(`/api/users/${id}/follow`, { method: "POST" });
      setProfile((current) => {
        if (!current || !user) return current;
        const next = { ...current, isFollowing: data.isFollowing, followerCount: Math.max(0, current.followerCount + (data.isFollowing ? 1 : -1)) };
        writeSessionCache(profileCacheKey(user.id, id), { profile: next, soups } satisfies ProfileResponse);
        return next;
      });
    } catch (error) { showToast((error as Error).message); }
  }

  async function messageUser() {
    try {
      const data = await api<{ id: string }>("/api/conversations", { method: "POST", body: { userId: id } });
      navigate(`/messages/chat/${data.id}`);
    } catch (error) { showToast((error as Error).message); }
  }

  return (
    <section className="user-profile-page min-h-screen bg-page pt-[72px]">
      <PageTopBar title="用户主页" backTo={backTarget} />
      <div className="user-profile-content mx-auto max-w-3xl space-y-3 px-4 pb-10">
        <div className="user-profile-desktop-back hidden lg:flex"><UnifiedBackButton to={backTarget} /></div>
        <ProfileHero profile={profile} onFollowing={() => navigate(`/users/${profile.id}/following`)} onFollowers={() => navigate(`/users/${profile.id}/followers`)} actions={!profile.isSelf ? (
          <div className="flex gap-2">
            <button className={`grid h-10 w-10 place-items-center rounded-full border border-white/70 ${profile.isFollowing ? "bg-white text-primary" : "bg-white/20 text-white"}`} onClick={() => void toggleFollow()} title={profile.isFollowing ? "取消关注" : "关注"}>{profile.isFollowing ? <UserCheck size={19} /> : <UserPlus size={19} />}</button>
            <button className="grid h-10 w-10 place-items-center rounded-full border border-white/70 bg-white/20 text-white disabled:opacity-45" onClick={() => void messageUser()} disabled={!profile.isFollowing} title={profile.isFollowing ? "私信" : "关注后可私信"}><MessageCircle size={19} /></button>
          </div>
        ) : undefined} />
        <div className="user-profile-collection"><CardCabinetSection userId={profile.id} compact onError={showToast} /></div>
        <div className="user-profile-soups overflow-hidden rounded-2xl bg-white shadow-soft">
          <div className="border-b border-line px-4 py-3 text-sm font-black text-ink">发布 {soups.length}</div>
          <SoupCoverGrid soups={soups} emptyHint="还没有公开作品" />
        </div>
      </div>
    </section>
  );
}
