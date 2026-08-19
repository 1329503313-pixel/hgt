import { useEffect, useState } from "react";
import { Gift, MessageCircle, UserCheck, UserPlus } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { SocialProfile, SoupSummary } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ProfileHero, SoupCoverGrid } from "../components/ProfileViews";
import { ProfileSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";
import { CardCabinetSection } from "../components/CardCabinetSection";
import { UnifiedBackButton } from "../components/UnifiedBackButton";
import { GiftDrawer, type GiftSource } from "../components/GiftDrawer";
import { RecentGiftsSection } from "../components/RecentGiftsSection";
import { ContentPagination } from "../components/ContentPagination";

type ProfileResponse = { profile: SocialProfile; soups: SoupSummary[]; total: number; hasMore: boolean };
const profileCacheKey = (viewerId: string, targetId: string) => `hgt:user-profile:${viewerId}:${targetId}`;
const pageSize = 10;

export default function UserProfilePage() {
  const { id = "" } = useParams();
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const onlineSoupOrigin = location.state as { onlineSoupRoomId?: string; onlineSoupMember?: boolean; circleId?: string; privateConversationId?: string } | null;
  const onlineSoupRoomId = onlineSoupOrigin?.onlineSoupRoomId ?? "";
  const circleId = onlineSoupOrigin?.circleId ?? "";
  const backTarget = onlineSoupRoomId ? `/online-soup/rooms/${onlineSoupRoomId}` : circleId ? `/circles/${circleId}` : "/";
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [soupTotal, setSoupTotal] = useState(0);
  const [soupPage, setSoupPage] = useState(1);
  const [soupsLoading, setSoupsLoading] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftRefreshKey, setGiftRefreshKey] = useState(0);

  async function loadProfile(cacheKey: string, page = 1) {
    const offset = (page - 1) * pageSize;
    setSoupsLoading(true);
    try {
      const data = await api<ProfileResponse>(`/api/users/${id}/profile?limit=${pageSize}&offset=${offset}`, { bypassCache: page > 1 });
      setProfile(data.profile);
      setSoups(data.soups);
      setSoupTotal(data.total);
      setSoupPage(page);
      if (page === 1) writeSessionCache(cacheKey, data);
    } finally {
      setSoupsLoading(false);
    }
  }

  useEffect(() => {
    if (loadingUser || !user || !id) return;
    const cacheKey = profileCacheKey(user.id, id);
    const cached = readSessionCache<ProfileResponse>(cacheKey, 2 * 60_000);
    setSoupPage(1);
    if (cached) { setProfile(cached.profile); setSoups(cached.soups); setSoupTotal(cached.total ?? cached.soups.length); }
    else { setProfile(null); setSoups([]); setSoupTotal(0); }
    void loadProfile(cacheKey, 1).catch((error) => { if (!cached) showToast((error as Error).message); });
  }, [id, user?.id, loadingUser]);

  if (!profile) return <section className="user-profile-page min-h-screen bg-page pt-[72px]"><PageTopBar title="用户主页" backTo={backTarget} /><div className="user-profile-content mx-auto max-w-3xl px-4 pt-3 lg:pt-0"><div className="user-profile-desktop-back mb-4 hidden lg:flex"><UnifiedBackButton to={backTarget} /></div><ProfileSkeleton /></div></section>;

  async function toggleFollow() {
    try {
      const data = await api<{ isFollowing: boolean }>(`/api/users/${id}/follow`, { method: "POST" });
      setProfile((current) => {
        if (!current || !user) return current;
        const next = { ...current, isFollowing: data.isFollowing, followerCount: Math.max(0, current.followerCount + (data.isFollowing ? 1 : -1)) };
        const cached = readSessionCache<ProfileResponse>(profileCacheKey(user.id, id), 2 * 60_000);
        if (cached) writeSessionCache(profileCacheKey(user.id, id), { ...cached, profile: next });
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

  function handleGiftSent(recipientCharmValue: number) {
    setGiftRefreshKey((value) => value + 1);
    setProfile((current) => {
      if (!current || !user) return current;
      const next = { ...current, charmValue: recipientCharmValue };
      const cached = readSessionCache<ProfileResponse>(profileCacheKey(user.id, id), 2 * 60_000);
      if (cached) writeSessionCache(profileCacheKey(user.id, id), { ...cached, profile: next });
      return next;
    });
  }

  const giftSource: GiftSource = onlineSoupRoomId
    ? { type: "online_soup", id: onlineSoupRoomId }
    : circleId
      ? { type: "circle", id: circleId }
      : onlineSoupOrigin?.privateConversationId
        ? { type: "private", id: onlineSoupOrigin.privateConversationId }
        : { type: "profile" };

  function changeSoupPage(page: number) {
    const totalPages = Math.max(1, Math.ceil(soupTotal / pageSize));
    const nextPage = Math.min(totalPages, Math.max(1, page));
    if (!user || nextPage === soupPage || soupsLoading) return;
    void loadProfile(profileCacheKey(user.id, id), nextPage).catch((error) => showToast((error as Error).message));
  }

  return (
    <section className="user-profile-page min-h-screen bg-page pt-[72px]">
      <PageTopBar title="用户主页" backTo={backTarget} />
      <div className="user-profile-content mx-auto max-w-3xl space-y-3 px-4 pb-10">
        <div className="user-profile-desktop-back hidden lg:flex"><UnifiedBackButton to={backTarget} /></div>
        <ProfileHero key={`${profile.id}:${profile.profileBackgroundSourceUrl ?? "default"}`} className="user-profile-hero" profile={profile} collapsibleBackground={!profile.isSelf} inactiveNicknameClassName="text-white" onFollowing={() => navigate(`/users/${profile.id}/following`)} onFollowers={() => navigate(`/users/${profile.id}/followers`)} onCharm={!profile.isSelf ? () => setGiftOpen(true) : undefined} actions={!profile.isSelf ? (
          <div className="flex gap-2">
            <button type="button" className="grid h-11 w-11 place-items-center rounded-full border border-white/70 bg-white/20 text-white disabled:opacity-45" onClick={() => setGiftOpen(true)} disabled={!profile.isFollowing} aria-label={profile.isFollowing ? "送礼物" : "关注后可送礼物"} title={profile.isFollowing ? "送礼物" : "关注后可送礼物"}><Gift size={19} /></button>
            <button type="button" className={`grid h-11 w-11 place-items-center rounded-full border border-white/70 ${profile.isFollowing ? "bg-white text-primary" : "bg-white/20 text-white"}`} onClick={() => void toggleFollow()} aria-label={profile.isFollowing ? "取消关注" : "关注"} title={profile.isFollowing ? "取消关注" : "关注"}>{profile.isFollowing ? <UserCheck size={19} /> : <UserPlus size={19} />}</button>
            <button type="button" className="grid h-11 w-11 place-items-center rounded-full border border-white/70 bg-white/20 text-white disabled:opacity-45" onClick={() => void messageUser()} disabled={!profile.isFollowing} aria-label={profile.isFollowing ? "发消息" : "关注后可发消息"} title={profile.isFollowing ? "发消息" : "关注后可发消息"}><MessageCircle size={19} /></button>
          </div>
        ) : undefined} />
        <div className="user-profile-collection"><CardCabinetSection userId={profile.id} compact onError={showToast} /></div>
        <div className="user-profile-gifts"><RecentGiftsSection userId={profile.id} refreshKey={giftRefreshKey} onError={showToast} onSendGift={!profile.isSelf ? () => setGiftOpen(true) : undefined} canSendGift={profile.isFollowing} /></div>
        <div className="user-profile-soups overflow-hidden rounded-2xl bg-white shadow-soft">
          <div className="border-b border-line px-4 py-3 text-sm font-black text-ink">发布 {soupTotal}</div>
          <SoupCoverGrid soups={soups} emptyHint="还没有公开作品" className="lg:grid-cols-4 lg:gap-4 lg:p-4" />
          <ContentPagination page={soupPage} pageSize={pageSize} total={soupTotal} loading={soupsLoading} ariaLabel={`${profile.nickname}发布的海龟汤分页`} onPageChange={changeSoupPage} />
        </div>
      </div>
      <GiftDrawer open={giftOpen} recipient={{ id: profile.id, nickname: profile.nickname }} isFollowing={profile.isFollowing} source={giftSource} onClose={() => setGiftOpen(false)} onSent={(_, recipientCharmValue) => handleGiftSent(recipientCharmValue)} />
    </section>
  );
}
