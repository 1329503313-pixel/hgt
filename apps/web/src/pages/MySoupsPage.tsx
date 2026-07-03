import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SoupSummary } from "../shared/types";
import { api, SoupsResponse } from "../api";
import { useApp } from "../context/AppContext";
import { SubListPage } from "../components/SoupLinkList";

function useWaitForUser() {
  const { user, loadingUser } = useApp();
  return { user, loading: loadingUser };
}

function MyListPage({ title, endpoint, emptyHint }: { title: string; endpoint: string; emptyHint: string }) {
  const navigate = useNavigate();
  const { loading: loadingUser } = useWaitForUser();
  const [soups, setSoups] = useState<SoupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser) return;
    setLoading(true);
    api<SoupsResponse>(endpoint)
      .then((d) => setSoups(d.soups))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadingUser, endpoint]);

  if (loadingUser || loading) {
    return (
      <section className="space-y-3 pt-[72px]">
        <div className="card flex items-center justify-center p-8">
          <p className="text-sm text-muted"><img src="/loading.gif" alt="加载中" className="mx-auto w-20 h-20 object-contain" /></p>
        </div>
      </section>
    );
  }

  return <SubListPage title={title} soups={soups} emptyHint={emptyHint} onBack={() => navigate("/mine")} />;
}

export default function MySoupsPage() {
  return <MyListPage title="我发布的" endpoint="/api/me/soups" emptyHint="还没有发布海龟汤。" />;
}
