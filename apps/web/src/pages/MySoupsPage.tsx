import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SoupSummary } from "../shared/types";
import { api, SoupsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { SubListPage } from "../components/SoupLinkList";
import { ListSkeleton } from "../components/Skeletons";
import { readSessionCache, writeSessionCache } from "../shared/sessionCache";

function useWaitForUser() {
  const { user, loadingUser } = useApp();
  return { user, loading: loadingUser };
}

function MyListPage({ title, endpoint, emptyHint, showHeatValue = false }: { title: string; endpoint: string; emptyHint: string; showHeatValue?: boolean }) {
  const navigate = useNavigate();
  const { user, loading: loadingUser } = useWaitForUser();
  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser || !user) return;
    const cacheKey = `hgt:mine:legacy-list:${user.id}:${endpoint}`;
    const cached = readSessionCache<SoupSummary[]>(cacheKey, 2 * 60_000);
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

  return <SubListPage title={title} soups={soups} emptyHint={emptyHint} onBack={() => navigate("/mine")} showHeatValue={showHeatValue} />;
}

export default function MySoupsPage() {
  return <MyListPage title="我发布的" endpoint="/api/me/soups" emptyHint="还没有发布海龟汤。" showHeatValue />;
}
