import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SoupSummary } from "../shared/types";
import { api, SoupsResponse } from "../api";
import { SubListPage } from "../components/SoupLinkList";

export default function MySoupsPage() {
  const navigate = useNavigate();
  const [soups, setSoups] = useState<SoupSummary[]>([]);

  useEffect(() => {
    api<SoupsResponse>("/api/me/soups").then((d) => setSoups(d.soups)).catch(() => {});
  }, []);

  return (
    <SubListPage title="我发布的" soups={soups} emptyHint="还没有发布海龟汤。" onBack={() => navigate("/mine")} />
  );
}
