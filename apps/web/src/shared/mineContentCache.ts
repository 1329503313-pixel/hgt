import { api, type SoupsResponse } from "../api";
import type { SoupSummary } from "./types";
import { writeSessionCache } from "./sessionCache";

export type MineContentTab = "published" | "favorites" | "likes";
export type MineContentCounts = Record<MineContentTab, number>;
export type MineContentTabData = { soups: SoupSummary[]; total: number; hasMore: boolean; loaded: boolean; loading: boolean };

export const MINE_CONTENT_CACHE_MAX_AGE = Number.POSITIVE_INFINITY;
export const mineCountsCacheKey = (userId: string) => `hgt:mine:counts:${userId}`;
export const mineListCacheKey = (userId: string, tab: MineContentTab) => `hgt:mine:list:v2:${userId}:${tab}`;

const endpoints: Record<MineContentTab, string> = {
  published: "/api/me/soups",
  favorites: "/api/me/favorites",
  likes: "/api/me/likes"
};

export async function refreshMineContentCache(userId: string, tab: MineContentTab) {
  const [counts, list] = await Promise.all([
    api<MineContentCounts>("/api/me/content-counts"),
    api<SoupsResponse>(`${endpoints[tab]}?offset=0`)
  ]);
  const tabData: MineContentTabData = {
    soups: list.soups,
    total: list.total,
    hasMore: list.hasMore,
    loaded: true,
    loading: false
  };
  writeSessionCache(mineCountsCacheKey(userId), counts);
  writeSessionCache(mineListCacheKey(userId, tab), tabData);
  writeSessionCache(`hgt:mine:legacy-list:${userId}:${endpoints[tab]}`, list.soups);
  window.dispatchEvent(new CustomEvent("hgt:mine-content-cache-updated", {
    detail: { userId, tab, counts, tabData }
  }));
}
