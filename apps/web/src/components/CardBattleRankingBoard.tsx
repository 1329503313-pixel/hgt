import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Crown, Layers, ShieldQuestion, Sparkles, Swords, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { OnlineCardBattleCard, OnlineCardBattleDeck } from "../shared/types";
import { Modal } from "./Modal";
import { VipIdentity } from "./VipIdentity";

type RankingEntry = { rank: number; occupied: false } | {
  rank: number;
  occupied: true;
  user: { id: string; nickname: string; avatar: string | null; vipLevel: number; vipActive: boolean };
  starTotal: number;
  totalPower: number;
  achievedAt: string;
};

type RankingResponse = { entries: RankingEntry[]; ownRank: number | null; limit: 10 | 100 };
type DetailCard = ({ slot: number; unavailable?: false } & OnlineCardBattleCard) | { slot: number; id: string; unavailable: true };
type RankingDetail = {
  rank: number;
  user: { id: string; nickname: string; avatar: string | null; vipLevel: number; vipActive: boolean };
  cards: DetailCard[];
  starTotal: number;
  totalPower: number;
  available: boolean;
  achievedAt: string;
};
type DeckAction = { kind: "claim" | "challenge"; rank: number };

const number = new Intl.NumberFormat("zh-CN");

export function CardBattleRankingBoard({ currentUserId, showToast }: { currentUserId: string; showToast: (message: string) => void }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<RankingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deckAction, setDeckAction] = useState<DeckAction | null>(null);
  const [decks, setDecks] = useState<OnlineCardBattleDeck[]>([]);
  const [cards, setCards] = useState<OnlineCardBattleCard[]>([]);
  const [decksLoading, setDecksLoading] = useState(false);
  const [savingDeckId, setSavingDeckId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<RankingResponse>(`/api/online-soup/card-battle-rankings?limit=${expanded ? 100 : 10}`, { bypassCache: true, dedupe: false });
      setData(result);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "卡牌对战榜加载失败");
    } finally { setLoading(false); }
  }, [expanded]);

  useEffect(() => { void load(); }, [load]);

  async function openDetail(rank: number) {
    setDetailLoading(true);
    try {
      const response = await api<{ entry: RankingDetail }>(`/api/online-soup/card-battle-rankings/${rank}`, { bypassCache: true, dedupe: false });
      setDetail(response.entry);
    } catch (reason) { showToast(reason instanceof Error ? reason.message : "卡组详情加载失败"); }
    finally { setDetailLoading(false); }
  }

  async function openDecks(action: DeckAction) {
    setDeckAction(action);
    setDecksLoading(true);
    try {
      const [deckResponse, cardResponse] = await Promise.all([
        api<{ decks: OnlineCardBattleDeck[] }>("/api/online-soup/card-battle/decks", { bypassCache: true }),
        api<{ cards: OnlineCardBattleCard[] }>("/api/online-soup/card-battle/eligible-cards", { bypassCache: true }),
      ]);
      setDecks(deckResponse.decks);
      setCards(cardResponse.cards);
    } catch (reason) {
      setDeckAction(null);
      showToast(reason instanceof Error ? reason.message : "卡组加载失败");
    } finally { setDecksLoading(false); }
  }

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  async function useDeck(deck: OnlineCardBattleDeck) {
    if (!deckAction || savingDeckId) return;
    setSavingDeckId(deck.id);
    try {
      if (deckAction.kind === "claim") {
        await api(`/api/online-soup/card-battle-rankings/${deckAction.rank}/claim`, { method: "POST", body: { deckId: deck.id } });
        showToast(data?.ownRank ? `已更新至卡牌对战榜第 ${deckAction.rank} 名` : `已占据卡牌对战榜第 ${deckAction.rank} 名`);
        setDeckAction(null);
        await load();
      } else {
        const result = await api<{ roomId: string }>(`/api/online-soup/card-battle-rankings/${deckAction.rank}/challenge`, { method: "POST", body: { deckId: deck.id } });
        navigate(`/online-soup/rooms/${result.roomId}`);
      }
    } catch (reason) { showToast(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setSavingDeckId(null); }
  }

  const canChallengeDetail = detail && detail.user.id !== currentUserId && (data?.ownRank == null || detail.rank < data.ownRank);

  return <div className="rankings-workspace">
    <aside className="rankings-spotlight is-card-battle hidden lg:flex">
      <div className="rankings-spotlight-heading"><span><Crown size={19} /></span><div><p>RANKED DUEL</p><h2>卡牌对战榜</h2></div></div>
      <div className="rankings-rule-card"><Swords size={17} /><div><strong>当前榜位</strong><p>榜单固定 100 个位置。空位可使用已保存的五张卡组直接占据；已有人时可查看守榜卡组并发起私密 1v1 挑战。</p></div></div>
      <div className="rankings-rule-card"><Sparkles size={17} /><div><strong>奖励结算</strong><p>复用排行榜礼物奖励：每周一 00:00 和每月首日 00:00 按当时榜位结算；月结算第一额外获得史诗限时徽章“游戏王”。</p></div></div>
      <div className="rankings-own-summary"><span>我的当前排名</span><strong>{data?.ownRank ? `第 ${data.ownRank} 名` : "暂未上榜"}</strong></div>
    </aside>

    <section className="rankings-table-card card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600"><Swords size={22} /></span>
        <div className="min-w-0"><p className="hidden text-[11px] font-black tracking-[0.14em] text-primary lg:block">GAME RANKING</p><h2 className="font-black text-ink lg:text-lg">卡牌对战榜 · Top {expanded ? 100 : 10}</h2><p className="mt-0.5 text-xs text-muted">点击空位占榜，点击用户查看守榜卡组并打榜</p></div>
      </div>
      <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-2 text-xs font-bold leading-5 text-amber-800">排行榜奖励：周、月结算复用成就榜礼物档位；月榜第一同时获得“游戏王”限时史诗成就徽章</div>
      <div className="grid grid-cols-[54px_minmax(0,1fr)_70px_92px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-bold text-muted sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]"><span>排名</span><span>守榜用户</span><span className="text-right">总星级</span><span className="text-right">总战力</span></div>
      {loading ? <div className="p-10 text-center text-sm text-muted" role="status">榜单加载中…</div> : error ? <div className="p-10 text-center"><p className="text-sm text-danger">{error}</p><button type="button" className="btn btn-secondary mt-4 min-h-11" onClick={() => void load()}>重新加载</button></div> : <div>{(data?.entries ?? []).map((entry) => entry.occupied
        ? <button key={entry.rank} type="button" className={`ranking-table-row grid min-h-14 w-full grid-cols-[54px_minmax(0,1fr)_70px_92px] items-center gap-2 border-b border-line/70 px-3 py-3 text-left hover:bg-violet-50/60 sm:grid-cols-[80px_minmax(0,1fr)_110px_150px] ${entry.user.id === currentUserId ? "bg-violet-50" : ""}`} onClick={() => void openDetail(entry.rank)}>
            <strong className="text-sm text-violet-700">第 {entry.rank} 名</strong><VipIdentity nickname={entry.user.nickname} vipLevel={entry.user.vipLevel} vipActive={entry.user.vipActive} className="max-w-full text-sm font-bold text-ink" /><span className="text-right text-xs font-bold text-muted">{entry.starTotal} 星</span><span className="text-right text-sm font-black text-amber-600">{number.format(entry.totalPower)}</span>
          </button>
        : <button key={entry.rank} type="button" className="ranking-table-row grid min-h-14 w-full grid-cols-[54px_minmax(0,1fr)_70px_92px] items-center gap-2 border-b border-dashed border-line/70 px-3 py-3 text-left hover:bg-cyan-50/60 sm:grid-cols-[80px_minmax(0,1fr)_110px_150px]" onClick={() => data?.ownRank && entry.rank >= data.ownRank ? showToast(`你当前为第 ${data.ownRank} 名，只能更新到更靠前的空位`) : void openDecks({ kind: "claim", rank: entry.rank })}>
            <strong className="text-sm text-slate-500">第 {entry.rank} 名</strong><span className="inline-flex items-center gap-2 text-sm font-bold text-cyan-700"><ShieldQuestion size={17} />{data?.ownRank && entry.rank < data.ownRank ? "空位，点击更新占榜" : "空位，点击占据"}</span><span className="text-right text-xs text-slate-300">—</span><span className="text-right text-xs text-slate-300">—</span>
          </button>)}</div>}
      {!loading && !error && !expanded && <div className="p-3"><button type="button" className="btn btn-secondary min-h-11 w-full" onClick={() => setExpanded(true)}><ChevronDown size={17} />查看更多（展示前 100 名）</button></div>}
    </section>

    {(detail || detailLoading) && <Modal full onClose={() => { if (!detailLoading) setDetail(null); }}>
      {detailLoading && !detail ? <p className="py-16 text-center text-sm text-muted">卡组详情加载中…</p> : detail && <>
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-violet-600">卡牌对战榜第 {detail.rank} 名</p><div className="mt-1"><VipIdentity nickname={detail.user.nickname} vipLevel={detail.user.vipLevel} vipActive={detail.user.vipActive} className="text-xl font-black text-ink" /></div></div><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100" onClick={() => setDetail(null)} aria-label="关闭卡组详情"><X size={18} /></button></div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-center"><div><p className="text-[11px] font-bold text-muted">卡组总星级</p><strong className="text-lg text-violet-700">{detail.starTotal} 星</strong></div><div><p className="text-[11px] font-bold text-muted">卡组总战力</p><strong className="text-lg text-amber-600">{number.format(detail.totalPower)}</strong></div></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">{detail.cards.map((card) => <article key={`${card.id}-${card.slot}`} className="min-w-0"><div className="relative aspect-[5/7] overflow-hidden rounded-xl border border-line bg-slate-100">{"unavailable" in card && card.unavailable ? <span className="grid h-full place-items-center p-2 text-center text-xs font-bold text-muted">卡牌当前不可用</span> : <><img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover" loading="lazy" /><span className="absolute bottom-1 right-1 rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-black text-slate-950">战力 {number.format(card.combatPower)}</span></>}<span className="absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-slate-950/80 text-[10px] font-black text-white">{card.slot}</span></div>{!("unavailable" in card && card.unavailable) && <><p className="mt-1 truncate text-xs font-black text-ink">{card.name}</p><p className="text-[10px] font-bold text-violet-600">{card.starLevel} 星</p></>}</article>)}</div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2"><button type="button" className="btn btn-secondary" onClick={() => navigate(`/users/${detail.user.id}`)}>查看用户主页</button>{detail.user.id === currentUserId ? <button type="button" className="btn btn-secondary" disabled>这是我的榜位</button> : canChallengeDetail ? <button type="button" className="btn btn-primary" disabled={!detail.available} onClick={() => { const rank = detail.rank; setDetail(null); void openDecks({ kind: "challenge", rank }); }}><Swords size={17} />打榜</button> : <button type="button" className="btn btn-secondary" disabled>{data?.ownRank ? "只能挑战更高排名" : "当前不可挑战"}</button>}</div>
        {!detail.available && <p className="mt-2 text-center text-xs font-bold text-red-600">该守榜卡组含有不可用卡牌，暂时不能发起挑战</p>}
      </>}
    </Modal>}

    {deckAction && <Modal full onClose={() => { if (!savingDeckId) setDeckAction(null); }}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-ink">{deckAction.kind === "claim" ? `${data?.ownRank ? "更新占榜至" : "占据"}第 ${deckAction.rank} 名` : `挑战第 ${deckAction.rank} 名`}</h2><p className="mt-1 text-xs text-muted">选择一个已保存的五张卡组；卡牌位置会按保存顺序带入。</p></div><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100" onClick={() => setDeckAction(null)} aria-label="关闭卡组选择"><X size={18} /></button></div>
      {decksLoading ? <p className="py-16 text-center text-sm text-muted">卡组加载中…</p> : <div className="mt-5 space-y-3">{decks.map((deck) => {
        const deckCards = deck.cardIds.map((cardId) => cardsById.get(cardId) ?? null);
        const available = deck.cardIds.length === 5 && deckCards.every(Boolean);
        const totalPower = deckCards.reduce((sum, card) => sum + (card?.combatPower ?? 0), 0);
        return <article key={deck.id} className="rounded-2xl border border-line bg-white p-3 shadow-sm"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-black text-ink">{deck.name}</h3><p className={`mt-1 text-xs font-bold ${available ? "text-amber-600" : "text-red-600"}`}>{available ? `总战力 ${number.format(totalPower)}` : "含有当前不可用卡牌"}</p></div><button type="button" className="btn btn-primary min-h-11 shrink-0" disabled={!available || Boolean(savingDeckId)} onClick={() => void useDeck(deck)}>{savingDeckId === deck.id ? "处理中…" : deckAction.kind === "claim" ? "使用并占榜" : "使用并打榜"}</button></div><div className="mt-3 grid grid-cols-5 gap-2">{deckCards.map((card, index) => <div key={`${deck.cardIds[index]}-${index}`} className="min-w-0"><div className="relative aspect-[5/7] overflow-hidden rounded-lg bg-slate-100">{card ? <img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full place-items-center text-[9px] text-muted">不可用</span>}<span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-950/75 text-[9px] font-black text-white">{index + 1}</span></div><p className="mt-1 truncate text-[9px] font-bold text-muted">{card?.name ?? "未知卡牌"}</p></div>)}</div></article>;
      })}{decks.length === 0 && <div className="py-12 text-center"><Layers className="mx-auto text-slate-300" size={36} /><p className="mt-3 font-black text-ink">还没有已保存卡组</p><p className="mt-1 text-sm text-muted">请先进入普通卡牌对战房，选满五张卡牌并保存卡组。</p></div>}</div>}
    </Modal>}
  </div>;
}
