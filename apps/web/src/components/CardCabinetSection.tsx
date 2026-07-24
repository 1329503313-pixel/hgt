import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown01, ChevronLeft, ChevronRight, GalleryVerticalEnd, Gem, Layers3, Star, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { CardCabinet, OwnedAssetCard } from "../shared/digitalAssets";
import { ASSET_RARITY_LABELS, warmAssetImage } from "../shared/digitalAssets";
import { AssetCardVisual } from "./AssetCardVisual";
import { ListSkeleton } from "./Skeletons";
import { Modal } from "./Modal";

const raritySortRank = { normal: 0, rare: 1, epic: 2, legend: 3 } as const;
const CARD_BACK_URL = "/card-back.webp?v=20260721";
const DETAIL_CARD_FLIP_MS = 1200;
const DETAIL_CHROME_FADE_MS = 200;

type CardDetailAnimation = {
  phase: "measuring" | "opening" | "revealing" | "open";
  sourceRect: DOMRect;
  targetRect?: DOMRect;
};

function getCardGridColumnCount() {
  if (window.matchMedia("(min-width: 768px)").matches) return 6;
  if (window.matchMedia("(min-width: 640px)").matches) return 5;
  return 3;
}

function paginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function CardCabinetSection({
  userId,
  compact = false,
  editable = false,
  onError
}: {
  userId: string;
  compact?: boolean;
  editable?: boolean;
  onError?: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [cabinet, setCabinet] = useState<CardCabinet | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<OwnedAssetCard | null>(null);
  const [detailAnimation, setDetailAnimation] = useState<CardDetailAnimation | null>(null);
  const detailCardRef = useRef<HTMLDivElement | null>(null);
  const [activePackId, setActivePackId] = useState("all");
  const [showcaseCollapsed, setShowcaseCollapsed] = useState(true);
  const [cardSort, setCardSort] = useState<"number" | "rarity">("number");
  const [cardGridColumns, setCardGridColumns] = useState(getCardGridColumnCount);
  const [cardPage, setCardPage] = useState(1);

  useEffect(() => {
    warmAssetImage(CARD_BACK_URL);
  }, []);

  useEffect(() => {
    const phoneQuery = window.matchMedia("(min-width: 640px)");
    const desktopQuery = window.matchMedia("(min-width: 768px)");
    const updateColumnCount = () => setCardGridColumns(getCardGridColumnCount());
    phoneQuery.addEventListener("change", updateColumnCount);
    desktopQuery.addEventListener("change", updateColumnCount);
    return () => {
      phoneQuery.removeEventListener("change", updateColumnCount);
      desktopQuery.removeEventListener("change", updateColumnCount);
    };
  }, []);

  useEffect(() => {
    const endpoint = `${editable ? "/api/me/card-cabinet" : `/api/users/${userId}/card-cabinet`}${compact ? "?compact=true" : ""}`;
    api<{ cabinet: CardCabinet }>(endpoint, { cacheTtlMs: 30_000 })
      .then(({ cabinet: next }) => { setCabinet(next); setSelected(next.showcase.map((card) => card.id)); })
      .catch((error) => onError?.((error as Error).message));
  }, [userId, editable]);

  const sortedCards = useMemo(() => [...(cabinet?.cards ?? [])].sort((a, b) => {
    if (cardSort === "rarity") {
      const rarityDifference = raritySortRank[b.rarity] - raritySortRank[a.rarity];
      if (rarityDifference !== 0) return rarityDifference;
    }
    return a.cardNo.localeCompare(b.cardNo, "zh-CN", { numeric: true, sensitivity: "base" });
  }), [cabinet, cardSort]);

  const packTabs = useMemo(() => {
    const map = new Map<string, { id: string; name: string; cards: OwnedAssetCard[] }>();
    for (const card of sortedCards) {
      for (const pack of card.packs) {
        const group = map.get(pack.id) ?? { id: pack.id, name: pack.name, cards: [] };
        if (!group.cards.some((candidate) => candidate.id === card.id)) group.cards.push(card);
        map.set(pack.id, group);
      }
    }
    return [...map.values()].filter((pack) => pack.cards.length > 0);
  }, [cabinet]);

  useEffect(() => {
    if (activePackId !== "all" && !packTabs.some((pack) => pack.id === activePackId)) setActivePackId("all");
  }, [activePackId, packTabs]);

  const filteredCards = activePackId === "all" ? sortedCards : (packTabs.find((pack) => pack.id === activePackId)?.cards ?? []);
  const cardsPerPage = cardGridColumns * 3;
  const cardPageCount = Math.max(1, Math.ceil(filteredCards.length / cardsPerPage));
  const visibleCards = filteredCards.slice((cardPage - 1) * cardsPerPage, cardPage * cardsPerPage);

  useEffect(() => {
    setCardPage(1);
  }, [activePackId, cardSort]);

  useEffect(() => {
    setCardPage((page) => Math.min(page, cardPageCount));
  }, [cardPageCount]);

  function toggle(card: OwnedAssetCard, source?: HTMLElement) {
    if (!editing) { openDetail(card, source); return; }
    setSelected((current) => {
      if (current.includes(card.id)) return current.filter((id) => id !== card.id);
      if (current.length >= 6) { onError?.("最多陈列 6 张卡片"); return current; }
      return [...current, card.id];
    });
  }

  function openDetail(card: OwnedAssetCard, source?: HTMLElement) {
    warmAssetImage(card.imageUrl);
    setDetail(card);
    if (source) setDetailAnimation({ phase: "measuring", sourceRect: source.getBoundingClientRect() });
    else setDetailAnimation(null);
  }

  function closeDetail() {
    setDetail(null);
    setDetailAnimation(null);
  }

  useLayoutEffect(() => {
    if (!detail || detailAnimation?.phase !== "measuring" || !detailCardRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDetailAnimation(null);
      return;
    }
    const targetRect = detailCardRef.current.getBoundingClientRect();
    setDetailAnimation((current) => current?.phase === "measuring" ? { ...current, phase: "opening", targetRect } : current);
  }, [detail, detailAnimation]);

  useEffect(() => {
    if (detailAnimation?.phase !== "opening") return;
    const timer = window.setTimeout(() => {
      setDetailAnimation((current) => current?.phase === "opening" ? { ...current, phase: "revealing" } : current);
    }, DETAIL_CARD_FLIP_MS);
    return () => window.clearTimeout(timer);
  }, [detailAnimation?.phase]);

  useEffect(() => {
    if (detailAnimation?.phase !== "revealing") return;
    const timer = window.setTimeout(() => {
      setDetailAnimation((current) => current?.phase === "revealing" ? { ...current, phase: "open" } : current);
    }, DETAIL_CHROME_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [detailAnimation?.phase]);

  useEffect(() => {
    if (!detail) return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [detail]);

  async function saveShowcase() {
    setSaving(true);
    try {
      const result = await api<{ cabinet: CardCabinet }>("/api/me/card-showcase", { method: "PATCH", body: { cardIds: selected } });
      setCabinet(result.cabinet); setEditing(false);
    } catch (error) { onError?.((error as Error).message); }
    finally { setSaving(false); }
  }

  if (!cabinet) return <div className="card"><ListSkeleton rows={compact ? 2 : 5} /></div>;
  const visibleShowcase = editing ? selected.map((id) => cabinet.cards.find((card) => card.id === id)).filter(Boolean) as OwnedAssetCard[] : cabinet.showcase;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 p-4 text-white shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-bold text-cyan-200">{editable ? "我的收藏柜" : `${cabinet.user.nickname}的收藏柜`}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-black"><span>{cabinet.user.totalCollectionValue.toLocaleString()} 收藏值</span><span>{cabinet.user.unlockedCardCount} 张卡</span><span>{cabinet.user.legendaryCardCount} 张传说</span></div></div>
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-cyan-200 transition hover:bg-white/10 active:scale-95" onClick={() => setShowcaseCollapsed((collapsed) => !collapsed)} aria-expanded={!showcaseCollapsed} aria-label={showcaseCollapsed ? "展开收藏柜" : "收起收藏柜"} title={showcaseCollapsed ? "展开收藏柜" : "收起收藏柜"}><GalleryVerticalEnd size={30} /></button>
        </div>
        {!showcaseCollapsed && <><div className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-3">
          {visibleShowcase.map((card) => <AssetCardVisual key={card.id} card={card} animated={!editing && card.rarity === "legend"} motion={!editing} compactBadges className="asset-card-cabinet" ariaLabel={editing ? `${card.name}，点击撤下陈列` : undefined} onClick={(event) => editing ? toggle(card, event.currentTarget) : openDetail(card, event.currentTarget)} />)}
          {Array.from({ length: Math.max(0, 6 - visibleShowcase.length) }, (_, index) => <div key={`empty-${index}`} className="aspect-[5/7] rounded-xl border border-dashed border-white/20 bg-white/5" />)}
        </div>
        {editing && <p className="mt-3 text-right text-xs font-bold text-cyan-200">点击已陈列卡片即可撤下</p>}
        {editable && !compact && <div className="mt-4 flex justify-end gap-2">{editing ? <><button className="rounded-full border border-white/25 px-4 py-2 text-xs font-bold" onClick={() => { setEditing(false); setSelected(cabinet.showcase.map((card) => card.id)); }}>取消</button><button className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-950" disabled={saving} onClick={() => void saveShowcase()}>{saving ? "保存中…" : `保存陈列 (${selected.length}/6)`}</button></> : <button className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-950" onClick={() => setEditing(true)}>调整陈列卡</button>}</div>}
        {compact && editable && <button className="mt-4 w-full rounded-xl bg-white/10 py-2.5 text-xs font-bold" onClick={() => navigate("/mine/cards")}>查看全部收藏并调整陈列</button>}
        </>}
      </div>

      {!compact && (cabinet.cards.length === 0 ? <div className="card p-8 text-center text-sm text-muted">还没有获得卡片，前往商城开启第一包吧。</div> : (
        <div className="card p-4">
          <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-4">
            <button type="button" className={`min-w-24 shrink-0 snap-start rounded-xl border px-4 py-2.5 text-center transition ${activePackId === "all" ? "border-primary bg-blue-50 text-primary" : "border-line bg-white text-ink"}`} onClick={() => setActivePackId("all")}><span className="block text-sm font-black">全部</span><span className="mt-1 block text-[11px] font-bold opacity-70">{sortedCards.length} 张</span></button>
            {packTabs.map((pack) => <button key={pack.id} type="button" className={`min-w-28 shrink-0 snap-start rounded-xl border px-4 py-2.5 text-center transition ${activePackId === pack.id ? "border-primary bg-blue-50 text-primary" : "border-line bg-white text-ink"}`} onClick={() => setActivePackId(pack.id)}><span className="block max-w-32 truncate text-sm font-black">{pack.name}</span><span className="mt-1 block text-[11px] font-bold opacity-70">收藏 {pack.cards.length} 张</span></button>)}
          </div>
          <div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-black text-ink">{activePackId === "all" ? "全部卡牌" : packTabs.find((pack) => pack.id === activePackId)?.name}</h3><div className="flex items-center gap-2">{editing && <span className="hidden text-xs font-bold text-primary sm:inline">按选择顺序陈列</span>}<button type="button" className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-black transition active:scale-95 ${cardSort === "rarity" ? "border-violet-200 bg-violet-50 text-violet-700" : "border-blue-200 bg-blue-50 text-blue-700"}`} onClick={() => setCardSort((sort) => sort === "number" ? "rarity" : "number")} aria-label={`当前${cardSort === "number" ? "按序号排序" : "按品质排序"}，点击切换`}><span className="relative grid h-4 w-4 place-items-center">{cardSort === "number" ? <ArrowDown01 size={16} /> : <Gem size={16} />}</span>{cardSort === "number" ? "按序号排序" : "按品质排序"}</button></div></div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
            {visibleCards.map((card) => <div key={card.id} className="min-w-0"><AssetCardVisual card={card} motion compactBadges className="asset-card-cabinet" selected={editing && selected.includes(card.id)} onClick={(event) => toggle(card, event.currentTarget)} /><div className="mt-2 flex items-center justify-between gap-1 text-[10px] font-bold"><span className="truncate text-muted">{ASSET_RARITY_LABELS[card.rarity]}</span><span className="text-ink">收藏值 {card.collectionValue}</span></div></div>)}
          </div>
          {cardPageCount > 1 && (
            <nav className="mt-5 flex flex-wrap items-center justify-center gap-1.5 border-t border-line pt-4" aria-label="收藏柜卡牌分页">
              <button type="button" className="btn btn-secondary h-9 px-2.5 text-xs" disabled={cardPage <= 1} onClick={() => setCardPage((page) => Math.max(1, page - 1))}><ChevronLeft size={15} />上一页</button>
              {paginationItems(cardPage, cardPageCount).map((item, index) => item === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="grid h-9 w-7 place-items-center text-sm text-muted">…</span>
              ) : (
                <button type="button" key={item} className={`grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold ${item === cardPage ? "bg-primary text-white" : "border border-line bg-white text-ink"}`} aria-current={item === cardPage ? "page" : undefined} onClick={() => setCardPage(item)}>{item}</button>
              ))}
              <button type="button" className="btn btn-secondary h-9 px-2.5 text-xs" disabled={cardPage >= cardPageCount} onClick={() => setCardPage((page) => Math.min(cardPageCount, page + 1))}>下一页<ChevronRight size={15} /></button>
            </nav>
          )}
        </div>
      ))}

      {detail && <Modal
        full
        bare
        onClose={closeDetail}
        contentClassName="scrollbar-hidden"
        overlayClassName={`transition-colors duration-[400ms] ${detailAnimation?.phase === "measuring" ? "bg-slate-950/0" : "bg-slate-950/80 backdrop-blur-sm"}`}
      >
        <div className="flex min-h-full items-center justify-center py-4">
          <div className="w-full max-w-md">
            <div className={`flex items-center justify-between gap-4 text-white transition-opacity duration-200 ${detailAnimation && detailAnimation.phase !== "revealing" && detailAnimation.phase !== "open" ? "pointer-events-none opacity-0" : "opacity-100"}`}><div><p className="flex items-baseline gap-1.5 font-bold text-cyan-200"><span className="text-sm">NO.{detail.cardNo}</span><span className="text-sm opacity-70">·</span><span className="text-base">{ASSET_RARITY_LABELS[detail.rarity]}</span></p><h2 className="mt-1.5 text-2xl font-black leading-tight">{detail.name}</h2></div><button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-slate-900 shadow-lg ring-1 ring-white/80 transition-transform hover:scale-105 active:scale-95" onClick={closeDetail} aria-label="关闭卡片详情"><X size={22} strokeWidth={2.4} /></button></div>
            <div ref={detailCardRef} className={`relative mx-auto mt-4 ${detailAnimation && detailAnimation.phase !== "revealing" && detailAnimation.phase !== "open" ? "invisible" : "visible"}`}><AssetCardVisual card={detail} animated={detail.rarity === "legend"} motion highDetail className="asset-card-cabinet" /></div>
            <div className={`mt-4 overflow-hidden rounded-2xl bg-white text-ink shadow-soft transition-opacity duration-200 ${detailAnimation && detailAnimation.phase !== "revealing" && detailAnimation.phase !== "open" ? "opacity-0" : "opacity-100"}`}>
              <div className="grid grid-cols-3 divide-x divide-line px-2 py-5 text-center text-sm">
                <div className="px-2"><Star className="mx-auto text-amber-500" size={24} /><p className="mt-2 font-black">{detail.starLevel} 星</p></div>
                <div className="px-2"><Gem className="mx-auto text-violet-500" size={24} /><p className="mt-2 font-black">{detail.collectionValue} 收藏值</p></div>
                <div className="px-2"><Layers3 className="mx-auto text-cyan-600" size={24} /><p className="mt-2 font-black">累计 {detail.totalObtained} 张</p></div>
              </div>
              <div className="border-t border-line px-5 py-4">
                {detail.starLevel < 3 ? <p className="text-base text-muted"><span className="font-black text-ink">升星进度</span><span className="float-right font-bold text-primary">{detail.duplicateProgress}/{detail.nextStarRequirement}</span></p> : <p className="text-base font-bold text-amber-600">已满星，后续重复卡将自动转化为贝壳。</p>}
              </div>
              {detail.story && <div className="border-t border-line px-5 py-5"><h3 className="text-base font-black">卡片故事</h3><p className="mt-2 whitespace-pre-wrap text-base leading-8 text-muted">{detail.story}</p></div>}
            </div>
          </div>
        </div>
        {detailAnimation?.phase === "opening" && detailAnimation.targetRect && (
          <div
            className="pointer-events-none fixed z-10 [perspective:1400px]"
            style={{
              left: detailAnimation.targetRect.left,
              top: detailAnimation.targetRect.top,
              width: detailAnimation.targetRect.width,
              height: detailAnimation.targetRect.height,
              "--cabinet-card-start-x": `${detailAnimation.sourceRect.left + detailAnimation.sourceRect.width / 2 - (detailAnimation.targetRect.left + detailAnimation.targetRect.width / 2)}px`,
              "--cabinet-card-start-y": `${detailAnimation.sourceRect.top + detailAnimation.sourceRect.height / 2 - (detailAnimation.targetRect.top + detailAnimation.targetRect.height / 2)}px`,
              "--cabinet-card-start-scale": detailAnimation.sourceRect.width / detailAnimation.targetRect.width,
            } as React.CSSProperties}
            aria-hidden="true"
          >
            <div className="card-cabinet-detail-flight absolute inset-0">
              <div className="card-cabinet-detail-flight-face">
                <AssetCardVisual card={detail} animated={false} highDetail className="asset-card-cabinet" />
              </div>
              <div className="card-cabinet-detail-flight-face card-cabinet-detail-flight-back">
                <img src={CARD_BACK_URL} alt="" className="h-full w-full object-cover" decoding="async" draggable={false} />
              </div>
            </div>
          </div>
        )}
      </Modal>}
    </div>
  );
}
