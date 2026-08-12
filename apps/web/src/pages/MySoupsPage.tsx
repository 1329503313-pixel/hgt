import { useEffect, useState } from "react";
import type { SoupSummary } from "../shared/types";
import { api, SoupsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { SubListPage } from "../components/SoupLinkList";
import { ListSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";
import { MINE_CONTENT_CACHE_MAX_AGE } from "../shared/mineContentCache";
import { Modal } from "../components/Modal";
import { Trash2 } from "lucide-react";

function useWaitForUser() {
  const { user, loadingUser } = useApp();
  return { user, loading: loadingUser };
}

function MyListPage({ title, endpoint, emptyHint, showHeatValue = false, allowLongPressDelete = false }: { title: string; endpoint: string; emptyHint: string; showHeatValue?: boolean; allowLongPressDelete?: boolean }) {
  const { user, loading: loadingUser } = useWaitForUser();
  const { showToast } = useApp();
  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SoupSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (loadingUser || !user) return;
    const cacheKey = `hgt:mine:legacy-list:${user.id}:${endpoint}`;
    const cached = readSessionCache<SoupSummary[]>(cacheKey, MINE_CONTENT_CACHE_MAX_AGE);
    if (cached) { setSoups(cached); setLoading(false); }
    else setLoading(true);
    api<SoupsResponse>(endpoint)
      .then((d) => { setSoups(d.soups); writeSessionCache(cacheKey, d.soups); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadingUser, endpoint, user?.id]);

  if (loadingUser || loading) {
    return (
      <section className="space-y-3"><ListSkeleton rows={6} /></section>
    );
  }

  async function deleteSoup() {
    if (!user || !deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api(`/api/soups/${deleteTarget.id}`, { method: "DELETE" });
      const nextSoups = soups.filter((soup) => soup.id !== deleteTarget.id);
      setSoups(nextSoups);
      writeSessionCache(`hgt:mine:legacy-list:${user.id}:${endpoint}`, nextSoups);
      setDeleteTarget(null);
      showToast("海龟汤已删除");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除失败，请稍后重试");
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <SubListPage title={title} soups={soups} emptyHint={emptyHint} showHeatValue={showHeatValue} onLongPress={allowLongPressDelete ? setDeleteTarget : undefined} />
    {deleteTarget && <Modal onClose={() => !deleting && setDeleteTarget(null)}>
      <div className="space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600"><Trash2 size={22} /></div>
        <div className="text-center"><h2 className="text-lg font-black text-ink">删除海龟汤？</h2><p className="mt-2 text-sm leading-6 text-muted">确定删除《{deleteTarget.title}》吗？相关评价也会一并删除，且无法恢复。</p></div>
        <div className="grid grid-cols-2 gap-3"><button className="btn btn-secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="btn btn-danger" disabled={deleting} onClick={() => void deleteSoup()}>{deleting ? "删除中…" : "确认删除"}</button></div>
      </div>
    </Modal>}
  </>;
}

export default function MySoupsPage() {
  return <MyListPage title="我发布的" endpoint="/api/me/soups" emptyHint="还没有发布海龟汤。" showHeatValue allowLongPressDelete />;
}
