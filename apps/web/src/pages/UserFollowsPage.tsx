import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { SocialUser } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";

const followsCacheKey = (viewerId: string, targetId: string, type: "following" | "followers") => `hgt:user-follows:${viewerId}:${targetId}:${type}`;

export default function UserFollowsPage({ type }: { type: "following" | "followers" }) {
  const { id = "" } = useParams();
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const [users, setUsers] = useState<SocialUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser || !user) return;
    const cacheKey = followsCacheKey(user.id, id, type);
    const cached = readSessionCache<SocialUser[]>(cacheKey, 60_000);
    if (cached) { setUsers(cached); setLoading(false); }
    else setLoading(true);
    api<{ users: SocialUser[] }>(`/api/users/${id}/follows?type=${type}`)
      .then((data) => { setUsers(data.users); writeSessionCache(cacheKey, data.users); })
      .catch((error) => { if (!cached) showToast((error as Error).message); })
      .finally(() => setLoading(false));
  }, [id, type, user?.id, loadingUser]);

  async function toggleFollow(target: SocialUser) {
    try {
      const data = await api<{ isFollowing: boolean }>(`/api/users/${target.id}/follow`, { method: "POST" });
      setUsers((current) => {
        const next = current.map((item) => item.id === target.id ? { ...item, isFollowing: data.isFollowing } : item);
        if (user) writeSessionCache(followsCacheKey(user.id, id, type), next);
        return next;
      });
    } catch (error) { showToast((error as Error).message); }
  }

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title={type === "following" ? "关注" : "粉丝"} backTo={id === user?.id ? "/mine" : `/users/${id}`} />
      <div className="mx-auto max-w-3xl overflow-hidden bg-white sm:rounded-2xl sm:shadow-soft">
        {(loadingUser || loading) ? <ListSkeleton rows={7} /> : <>
        {users.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-line px-4 py-3">
            <button className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-blue-100 font-black text-primary" onClick={() => navigate(`/users/${item.id}`)}>{item.avatar ? <img className="h-full w-full object-cover" src={item.avatar} alt="" /> : item.nickname.slice(0, 1)}</button>
            <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/users/${item.id}`)}><p className="truncate text-sm font-black text-ink">{item.nickname}</p></button>
            {!item.isSelf && <button className={`rounded-lg px-3 py-2 text-xs font-bold ${item.isFollowing ? "bg-slate-100 text-ink" : "bg-primary text-white"}`} onClick={() => void toggleFollow(item)}>{item.isFollowing ? "已关注" : "关注"}</button>}
          </div>
        ))}
        {!users.length && <p className="py-20 text-center text-sm text-muted">暂无用户</p>}
        </>}
      </div>
    </section>
  );
}
