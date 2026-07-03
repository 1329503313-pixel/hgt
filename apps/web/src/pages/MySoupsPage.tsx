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
  const { loading } = useWaitForUser();
  const [soups, setSoups] = useState<SoupSummary[]>([]);

  useEffect(() => {
    if (loading) return;
    api<SoupsResponse>(endpoint).then((d) => setSoups(d.soups)).catch(() => {});
  }, [loading, endpoint]);

  if (loading) {
    return (
      <section className="space-y-3 pt-[72px]">
        <div className="card flex items-center justify-center p-8">
          <p className="text-sm text-muted">加载中...</p>
        </div>
      </section>
    );
  }

  return <SubListPage title={title} soups={soups} emptyHint={emptyHint} onBack={() => navigate("/mine")} />;
}

export default function MySoupsPage() {
  return <MyListPage title="我发布的" endpoint="/api/me/soups" emptyHint="还没有发布海龟汤。" />;
}
