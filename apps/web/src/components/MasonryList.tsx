import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import type { SoupSummary } from "../shared/types";
import { SoupCard } from "./SoupCard";

function getColumnCount() {
  if (typeof window === "undefined") return 2;
  if (window.innerWidth >= 1120) return 4;
  if (window.innerWidth >= 760) return 3;
  return 2;
}

function estimateHeight(soup: SoupSummary) {
  const coverHeight = soup.coverImage ? 128 : 92;
  const titleRows = soup.title.length > 12 ? 2 : 1;
  const summaryRows = Math.min(3, Math.max(1, Math.ceil((soup.summary || "").length / 18)));
  return coverHeight + 108 + titleRows * 20 + summaryRows * 20;
}

export function MasonryList({
  soups,
  onOpen,
  hasMore,
  loading,
  onLoadMore
}: {
  soups: SoupSummary[];
  onOpen: (id: string) => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const [colCount, setColCount] = useState(getColumnCount);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const handleHeight = useCallback((id: string, height: number) => {
    setHeights((old) => (
      Math.abs((old[id] ?? 0) - height) < 1
        ? old
        : { ...old, [id]: height }
    ));
  }, []);

  useEffect(() => {
    const update = () => setColCount(getColumnCount());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loading) onLoadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  const columns = useMemo(() => {
    const count = Math.max(1, Math.min(colCount, Math.max(soups.length, 1)));
    const cols: SoupSummary[][] = Array.from({ length: count }, () => []);
    const colHeights = Array.from({ length: count }, () => 0);

    soups.forEach((soup) => {
      let target = 0;
      for (let i = 1; i < count; i += 1) {
        if (colHeights[i] < colHeights[target]) target = i;
      }
      cols[target].push(soup);
      colHeights[target] += heights[soup.id] ?? estimateHeight(soup);
    });

    return cols;
  }, [colCount, heights, soups]);

  return (
    <>
      <div className="home-masonry">
        {columns.map((column, idx) => (
          <div className="home-masonry-column" key={idx}>
            {column.map((soup) => (
              <MeasuredSoupCard
                key={soup.id}
                soup={soup}
                onOpen={onOpen}
                onHeight={handleHeight}
              />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinelRef} className="h-1 w-full" />
    </>
  );
}

function MeasuredSoupCard({
  soup,
  onOpen,
  onHeight
}: {
  soup: SoupSummary;
  onOpen: (id: string) => void;
  onHeight: (id: string, height: number) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => onHeight(soup.id, node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeight, soup.id]);

  return <SoupCard refTarget={ref} soup={soup} onOpen={onOpen} />;
}
