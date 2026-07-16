import { useEffect, useState } from "react";
import { MessageSquare, Star, ThumbsUp, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { Modal } from "../components/Modal";
import { defaultCoverUrl } from "../shared/staticAssets";
import { ListSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";

type InteractionSoup = { id: string; title: string; coverImage: string | null; likeCount: number; favoriteCount: number; evaluationCount: number };
type InteractionType = "likes" | "favorites" | "evaluations";
type InteractionItem = { userId: string; username: string; nickname: string; avatar: string | null; total: number | null; content: string | null; createdAt: string };

export default function MyInteractionsPage() {
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const [soups, setSoups] = useState<InteractionSoup[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ title: string; type: InteractionType; items: InteractionItem[] } | null>(null);

  useEffect(() => {
    if (loadingUser || !user) return;
    const cacheKey = `hgt:mine:interactions:${user.id}`;
    const cached = readSessionCache<InteractionSoup[]>(cacheKey, 60_000);
    if (cached) { setSoups(cached); setLoading(false); }
    else setLoading(true);
    api<{ soups: InteractionSoup[] }>("/api/me/received-interactions")
      .then((data) => { setSoups(data.soups); writeSessionCache(cacheKey, data.soups); })
      .catch((error) => { if (!cached) showToast((error as Error).message); })
      .finally(() => setLoading(false));
  }, [user?.id, loadingUser]);

  async function openDetail(soup: InteractionSoup, type: InteractionType) {
    try {
      const data = await api<{ title: string; interactions: InteractionItem[] }>(`/api/me/soups/${soup.id}/interactions?type=${type}`);
      setDetail({ title: data.title, type, items: data.interactions });
    } catch (error) { showToast((error as Error).message); }
  }

  return (
    <section className="min-h-screen bg-page pt-[72px]">
      <PageTopBar title="互动数据" backTo="/mine" />
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-soft">
        {loading ? <ListSkeleton rows={6} /> : soups.map((soup) => (
          <div key={soup.id} className="border-b border-line px-4 py-4">
            <div className="flex items-center gap-3">
              <button className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-200" onClick={() => navigate(`/soup/${soup.id}`)}><img className="h-full w-full object-cover" src={soup.coverImage ?? defaultCoverUrl} alt="" /></button>
              <button className="min-w-0 flex-1 truncate text-left text-sm font-black text-ink" onClick={() => navigate(`/soup/${soup.id}`)}>{soup.title}</button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 py-2 text-xs font-bold text-rose-600" onClick={() => void openDetail(soup, "likes")}><ThumbsUp size={15} />获赞 {soup.likeCount}</button>
              <button className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 py-2 text-xs font-bold text-amber-600" onClick={() => void openDetail(soup, "favorites")}><Star size={15} />收藏 {soup.favoriteCount}</button>
              <button className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 py-2 text-xs font-bold text-emerald-600" onClick={() => void openDetail(soup, "evaluations")}><MessageSquare size={15} />评价 {soup.evaluationCount}</button>
            </div>
          </div>
        ))}
        {!loading && !soups.length && <p className="py-20 text-center text-sm text-muted">还没有发布作品</p>}
      </div>

      {detail && <Modal full onClose={() => setDetail(null)}>
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-black text-ink">{detail.type === "likes" ? "点赞用户" : detail.type === "favorites" ? "收藏用户" : "评价明细"}</h2><p className="mt-1 text-xs text-muted">{detail.title}</p></div><button className="btn btn-secondary h-9 w-9 p-0" onClick={() => setDetail(null)}><X size={16} /></button></div>
        <div className="mt-4 divide-y divide-line">
          {detail.items.map((item) => (
            <div key={`${item.userId}-${item.createdAt}`} className="flex gap-3 py-3">
              <button className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-blue-100 font-black text-primary" onClick={() => navigate(`/users/${item.userId}`)}>{item.avatar ? <img className="h-full w-full object-cover" src={item.avatar} alt="" /> : item.nickname.slice(0, 1)}</button>
              <div className="min-w-0 flex-1"><button className="text-sm font-black text-ink" onClick={() => navigate(`/users/${item.userId}`)}>{item.nickname}</button><p className="text-xs text-muted">@{item.username} · {new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>{detail.type === "evaluations" && <><p className="mt-1 text-sm font-bold text-primary">评分 {item.total ?? "-"}</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink">{item.content || "未填写文字评价"}</p></>}</div>
            </div>
          ))}
          {!detail.items.length && <p className="py-16 text-center text-sm text-muted">暂无数据</p>}
        </div>
      </Modal>}
    </section>
  );
}
