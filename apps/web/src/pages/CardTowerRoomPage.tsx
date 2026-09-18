import { CardBattleFxProvider, CardBattleFxQualityControl } from "../components/CardBattleFxContext";
import { CardBattleArenaFx } from "../components/CardBattleArenaFx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Layers, Play, Shell, X } from "lucide-react";
import { cardTowerFormationError, type BattleCollectible, type CardTowerFormation } from "@hgt/shared";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { OnlineCardBattleCard, OnlineCardBattleDeck, OnlineCardBattlePlayback, OnlineSoupSnapshot } from "../shared/types";
import { useServerCardBattlePlayback } from "../shared/useServerCardBattlePlayback";
import { seekCardBattleAnimations } from "../shared/cardBattlePlayback";
import { battleCardWithCollectible } from "../shared/battleCollectibles";
import { HalfArena } from "../components/CardBattleRoomView";
import { CardBattleDeckEditor } from "../components/CardBattleDeckEditor";
import { CardBattleSettlementTable } from "../components/CardBattleSettlementTable";
import { Modal } from "../components/Modal";

type Battle = NonNullable<OnlineSoupSnapshot["room"]["cardBattle"]>;
type TowerState = {
  room: { id: string; name: string }; formations: CardTowerFormation[]; revision: number; clearedFloor: number; message: string | null;
  nextFloor: { id: string; floorNumber: number; rewardShells: number; lineup: OnlineCardBattleCard[] } | null;
  game: { id: string; status: string; floorNumber: number; totalPower: number; rewardShells: number; playback: OnlineCardBattlePlayback;
    lineups: Array<{ userId: string; nickname: string; seat: 1 | 2; cards: OnlineCardBattleCard[] }>; settlement: NonNullable<Battle["game"]>["settlement"] } | null;
};
type Resources = { cards: OnlineCardBattleCard[]; decks: OnlineCardBattleDeck[]; collectibles: BattleCollectible[] };
const resourcesEmpty: Resources = { cards: [], decks: [], collectibles: [] };

export default function CardTowerRoomPage() {
  const { roomId = "" } = useParams();
  const { user } = useApp();
  return <TowerRoom key={`${roomId}:${user?.id ?? "guest"}`} roomId={roomId} />;
}
function TowerRoom({ roomId }: { roomId: string }) {
  const navigate = useNavigate(), { user, loadingUser, openAuth, showToast } = useApp();
  const [data, setData] = useState<TowerState | null>(null), [resources, setResources] = useState(resourcesEmpty);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [resourceError, setResourceError] = useState("");
  const [selected, setSelected] = useState(0), [editor, setEditor] = useState(false), [deckPicker, setDeckPicker] = useState(false);
  const [leave, setLeave] = useState(false), [settlementOpen, setSettlementOpen] = useState(false);
  const dataRef = useRef(data), busyRef = useRef(false), requestRef = useRef(0), mountedRef = useRef(true);
  const seenPlaying = useRef<string | null>(null), settled = useRef<string | null>(null), arenaRef = useRef<HTMLDivElement>(null);
  dataRef.current = data;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; requestRef.current++; }; }, []);
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const result = await api<TowerState>(`/api/online-soup/card-tower/rooms/${roomId}`, { bypassCache: true, dedupe: false });
      if (mountedRef.current && request === requestRef.current) { setData(result); setError(""); }
    } catch (reason) { if (mountedRef.current && request === requestRef.current) setError(reason instanceof Error ? reason.message : "房间加载失败"); }
  }, [roomId]);
  const loadResources = useCallback(async () => {
    try { const result = await api<Resources>("/api/online-soup/card-tower/resources", { bypassCache: true, dedupe: false }); if (mountedRef.current) { setResources(result); setResourceError(""); } }
    catch (reason) { if (mountedRef.current) setResourceError(reason instanceof Error ? reason.message : "卡牌加载失败"); }
  }, []);
  useEffect(() => {
    if (!user) return;
    void load(); void loadResources();
    const timer = window.setInterval(() => { if (!busyRef.current && document.visibilityState === "visible") void load(); }, 5000);
    const resume = () => { if (!busyRef.current) { void load(); void loadResources(); } };
    window.addEventListener("focus", resume);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", resume); };
  }, [user?.id, load, loadResources]);
  const { cardStates, activeEvent, animationDelayMs, playback, syncing } = useServerCardBattlePlayback(roomId, data?.game ?? null, load, `/api/online-soup/card-tower/rooms/${roomId}/playback`);
  useLayoutEffect(() => { if (arenaRef.current && activeEvent) seekCardBattleAnimations(arenaRef.current, animationDelayMs); }, [activeEvent, animationDelayMs, playback?.serverNow]);
  useEffect(() => {
    if (data?.game?.status === "playing") { seenPlaying.current = data.game.id; setEditor(false); setDeckPicker(false); }
    if (data?.game?.settlement && seenPlaying.current === data.game.id && settled.current !== data.game.id) {
      settled.current = data.game.id; setSettlementOpen(true); void loadResources();
    }
  }, [data?.game?.id, data?.game?.status, data?.game?.settlement, loadResources]);
  async function saveFormation(formation: CardTowerFormation) {
    if (busyRef.current || !dataRef.current) throw new Error("操作处理中，请稍候");
    busyRef.current = true; setBusy(true); requestRef.current++;
    const before = dataRef.current;
    try {
      const result = await api<{ formations: CardTowerFormation[]; revision: number }>(`/api/online-soup/card-tower/rooms/${roomId}/formation`, { method: "PUT", body: { index: selected, formation, revision: before.revision } });
      if (!mountedRef.current) return;
      const removed = before.formations.some((previous, index) => index !== selected && JSON.stringify(previous) !== JSON.stringify(result.formations[index]));
      setData((current) => current ? { ...current, ...result } : current);
      dataRef.current = { ...before, ...result };
      if (removed) showToast("重复卡牌或收藏品已从原阵容卸下，请检查其余阵容");
    } catch (reason) { await load(); throw reason; }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(false); }
  }
  async function mutate(action: "start" | "close") {
    if (busyRef.current || !data) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await api(`/api/online-soup/card-tower/rooms/${roomId}/${action}`, { method: "POST", body: action === "start" ? { revision: data.revision, floorId: data.nextFloor?.id } : {} });
      if (action === "close") navigate("/online-soup", { replace: true }); else { setSettlementOpen(false); await load(); }
    } catch (reason) { showToast(reason instanceof Error ? reason.message : "操作失败"); await load(); }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(false); }
  }
  if (loadingUser) return <p className="p-8 text-center">加载中…</p>;
  if (!user) return <div className="p-8 text-center"><p>请登录后进入卡牌闯关</p><button className="btn btn-primary mt-4" onClick={() => openAuth()}>登录</button></div>;
  if (!data) return <div className="space-y-4 p-8 text-center"><p>{error || "房间加载中…"}</p>{error && <button className="btn btn-secondary" onClick={() => void load()}>重试</button>}<button className="btn btn-secondary" onClick={() => navigate("/online-soup")}>返回大厅</button></div>;
  const playing = data.game?.status === "playing", formation = data.formations[selected]!;
  const cardsById = new Map(resources.cards.map((card) => [card.id, card]));
  const otherFormationCardIds = new Set(data.formations.flatMap((value, index) => index === selected ? [] : value.cardIds.filter((id): id is string => Boolean(id))));
  const editorCards = resources.cards.filter((card) => !otherFormationCardIds.has(card.id));
  const preparedCards = (value: CardTowerFormation) => value.cardIds.map((id) => {
    const card = id ? cardsById.get(id) : null;
    const binding = value.collectibleBindings.find((item) => item.cardId === id);
    return card ? battleCardWithCollectible(card, resources.collectibles.find((item) => item.id === binding?.collectibleId) ?? null) : null;
  });
  // Arena cards and the formation indicator share the applied playback snapshot,
  // independently of the formation selected while preparing.
  const battleStates = cardStates.some((state) => state.seat === 1 && data.game?.lineups.some((lineup) => lineup.userId === state.userId))
    ? cardStates : data.game?.playback.states ?? [];
  const currentUserId = battleStates.find((state) => state.seat === 1)?.userId;
  const activeSquad = playing ? data.game?.lineups.find((lineup) => lineup.seat === 1 && lineup.userId === currentUserId) ?? data.game?.lineups.find((lineup) => lineup.seat === 1) : null;
  const displayedFormation = playing
    ? data.formations.findIndex((_, index) => activeSquad?.userId === `${user.id}:formation:${index + 1}`)
    : selected;
  const boss = playing ? data.game?.lineups.find((lineup) => lineup.seat === 2) : null;
  const ownCards = activeSquad?.cards ?? preparedCards(formation), bossCards = boss?.cards ?? data.nextFloor?.lineup ?? [];
  const seat = (side: 1 | 2, name: string, cards: Array<OnlineCardBattleCard | null>): Battle["seats"][number] => ({ seat: side, ready: false,
    user: { id: side === 1 ? activeSquad?.userId ?? user.id : boss?.userId ?? "tower-boss", nickname: name, avatar: null },
    lineup: Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, card: cards[i] ?? null, cardBack: false })) });
  const formationError = cardTowerFormationError(data.formations);
  const invalidAssets = data.formations.some((value) => value.cardIds.some((id) => id && !cardsById.has(id)) || value.collectibleBindings.some((binding) => !resources.collectibles.some((item) => item.id === binding.collectibleId)));
  const totalPower = data.formations.flatMap(preparedCards).reduce((sum, card) => sum + (card?.combatPower ?? 0), 0);
  const result = data.game?.settlement;
  return <CardBattleFxProvider gameId={data.game?.id} event={playing ? activeEvent : null} elapsedMs={animationDelayMs} playing={playing}><div className="card-battle-room flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-white">
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 px-3"><button className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10" aria-label="退出闯关房间" onClick={() => setLeave(true)}><ArrowLeft size={20} /></button><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-black">{data.room.name}</h1><p className="text-xs text-slate-300">卡牌闯关 · 已通关 {data.clearedFloor} 层 · {playing ? `第 ${activeEvent?.round ?? 1} / 50 回合` : "准备中"}</p></div><CardBattleFxQualityControl /><Layers size={20} className="hidden text-cyan-300 sm:block" /></header>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-white/10 px-3 py-2 text-xs"><strong>{playing ? `卡牌闯关第 ${data.game!.floorNumber} 层` : data.nextFloor ? `卡牌闯关第 ${data.nextFloor.floorNumber} 层` : data.message}</strong><span className="flex items-center gap-1 text-amber-200"><Shell size={14} />通关奖励 {playing ? data.game!.rewardShells : data.nextFloor?.rewardShells ?? 0} 贝壳</span></div>
    {error && <p role="alert" className="shrink-0 bg-red-950 px-3 py-2 text-sm text-red-100">{error}</p>}
    <main ref={arenaRef} data-battle-arena className="relative card-battle-arena-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      <HalfArena seat={2} battleSeat={seat(2, boss?.nickname ?? `第 ${data.nextFloor?.floorNumber ?? data.clearedFloor} 层 BOSS`, bossCards)} states={playing ? battleStates : []} activeEvent={playing ? activeEvent : null} showPower={!playing} isOwn={false} position="top" canSelect={false} onPick={() => {}} onReorder={async () => false} />
      <div className="card-battle-event-notice" role="status">{playing && activeEvent?.skillName && <strong>{activeEvent.skillName}</strong>}<span>{playing ? syncing ? "正在同步战斗进度…" : activeEvent?.text ?? "自动战斗中" : "三个阵容依次接力 · 每层共用 50 回合"}</span></div>
      <HalfArena seat={1} battleSeat={seat(1, activeSquad?.nickname ?? `阵容 ${selected + 1}`, ownCards)} states={playing ? battleStates : []} activeEvent={playing ? activeEvent : null} showPower={!playing} isOwn position="bottom" canSelect={!playing && !busy} onPick={() => { void loadResources(); setEditor(true); }} onReorder={async (from, to) => { const ids = [...formation.cardIds]; [ids[from - 1], ids[to - 1]] = [ids[to - 1]!, ids[from - 1]!]; try { await saveFormation({ ...formation, cardIds: ids }); return true; } catch (reason) { showToast(reason instanceof Error ? reason.message : "换位失败"); return false; } }} />
      <CardBattleArenaFx event={playing ? activeEvent : null} />
    </main>
    <footer className="shrink-0 space-y-2 border-t border-white/10 bg-slate-900 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="grid grid-cols-3 gap-2" aria-label="闯关阵容">{data.formations.map((value, i) => <button key={i} disabled={playing || busy} aria-pressed={displayedFormation === i} className={`min-h-11 rounded-xl border px-2 text-xs font-bold ${displayedFormation === i ? "border-cyan-300 bg-cyan-900 text-white" : "border-white/20 text-slate-200"}`} onClick={() => setSelected(i)}>阵容 {i + 1} · {value.cardIds.filter(Boolean).length}/5</button>)}</div>
      {!playing && <><div className="flex flex-wrap gap-2"><button className="min-h-11 flex-1 rounded-xl bg-white/10 px-3 text-sm font-bold" disabled={busy} onClick={() => { void loadResources(); setEditor(true); }}>配置阵容</button><button className="min-h-11 flex-1 rounded-xl bg-white/10 px-3 text-sm font-bold" disabled={busy} onClick={() => { void loadResources(); setDeckPicker(true); }}>调用卡组</button><button className="min-h-11 rounded-xl bg-white/10 px-3 text-sm" disabled={busy || !formation.cardIds.some(Boolean)} onClick={() => { void saveFormation({ cardIds: Array(5).fill(null), collectibleBindings: [] }).catch((reason) => showToast(reason.message)); }}>清空</button></div><p className="text-center text-xs text-slate-300">总战力 {totalPower.toLocaleString()} · 阵容自动保存</p>
      {resourceError && <button className="min-h-11 text-sm text-red-200" onClick={() => void loadResources()}>{resourceError} · 点击重试</button>}
      <p className="text-center text-xs text-amber-200">{data.message ?? (invalidAssets ? "阵容有失效卡牌或收藏品，请重新配置" : formationError)}</p>
      <button className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 font-black text-slate-950 disabled:opacity-50" disabled={busy || !data.nextFloor || Boolean(formationError) || invalidAssets || Boolean(resourceError)} onClick={() => void mutate("start")}><Play size={16} />{busy ? "处理中…" : `开始挑战第 ${data.nextFloor?.floorNumber ?? data.clearedFloor + 1} 层`}</button></>}
      {playing && <p className="text-center text-xs text-slate-300">{activeSquad?.nickname ?? "阵容 1"}正在战斗 · 所有阵容总战力 {data.game!.totalPower.toLocaleString()}</p>}
    </footer>
    {editor && <Modal full onClose={() => { if (!busyRef.current) setEditor(false); }}><button className="float-right grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100 text-ink" disabled={busy} aria-label="关闭阵容配置" onClick={() => setEditor(false)}><X size={20} /></button><h2 className="text-xl font-black text-ink">配置阵容 {selected + 1}</h2>{resourceError && <p role="alert" className="text-red-700">{resourceError}</p>}<CardBattleDeckEditor key={selected} cards={editorCards} actionLabel="" onSave={async () => {}} tower={{ formation, onChange: saveFormation }} /></Modal>}
    {deckPicker && <Modal onClose={() => { if (!busyRef.current) setDeckPicker(false); }}><h2 className="pr-8 text-xl font-black text-ink">调用卡组填充阵容 {selected + 1}</h2><p className="mt-2 text-sm text-muted">重复的卡牌和收藏品会从其他阵容卸下。</p>{resources.decks.map((deck) => <button key={deck.id} className="mt-3 flex min-h-12 w-full items-center justify-between rounded-xl border border-line p-3 text-left text-ink" disabled={busy} onClick={() => { void saveFormation({ cardIds: deck.cardIds, collectibleBindings: deck.collectibleBindings ?? [] }).then(() => setDeckPicker(false)).catch((reason) => showToast(reason.message)); }}><strong>{deck.name}</strong><span className="text-xs">{deck.cardIds.length} 张卡</span></button>)}{!resources.decks.length && <p className="py-8 text-center text-muted">暂无已保存卡组，可直接配置阵容。</p>}{resourceError && <p role="alert" className="text-red-700">{resourceError}</p>}</Modal>}
    {leave && <Modal onClose={() => { if (!busyRef.current) setLeave(false); }}><h2 className="text-lg font-black text-ink">退出闯关房间？</h2><p className="mt-3 text-sm leading-6 text-muted">{playing ? "正在进行的挑战将中止，不发放本局奖励。" : "本房间将关闭。"}已通关进度和三套阵容都会保留。</p><div className="mt-5 flex justify-end gap-2"><button className="btn btn-secondary" disabled={busy} onClick={() => setLeave(false)}>取消</button><button className="btn btn-primary" disabled={busy} onClick={() => void mutate("close")}>确认退出</button></div></Modal>}
    {settlementOpen && result && data.game && <Modal full overlayClassName="!z-[130]" onClose={() => setSettlementOpen(false)}><button className="float-right grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100 text-ink" aria-label="关闭通关结算" onClick={() => setSettlementOpen(false)}><X size={20} /></button><h2 className="text-xl font-black text-ink">第 {data.game.floorNumber} 层 · {result.winnerSeat === 1 ? "通关成功" : "挑战失败"}</h2><p className="mt-3 text-sm text-muted">共 {result.rounds} 回合{result.endReason === "round_limit" ? " · 达到 50 回合上限" : result.endReason === "safety_limit" ? " · 战斗连锁达到安全上限" : ""}</p>{result.winnerSeat === 1 && <p className="mt-3 font-bold text-amber-700">通关奖励 +{data.game.rewardShells} 贝壳，已到账</p>}<div className="mt-4 space-y-3 rounded-2xl bg-slate-900 p-3 text-white">{result.players.map((player) => <CardBattleSettlementTable key={player.userId} player={player} winnerSeat={result.winnerSeat} />)}</div><button className="btn btn-primary mt-5 w-full" onClick={() => setSettlementOpen(false)}>{data.message ?? (result.winnerSeat === 1 ? "返回准备下一层" : "返回调整阵容")}</button></Modal>}
  </div></CardBattleFxProvider>;
}
