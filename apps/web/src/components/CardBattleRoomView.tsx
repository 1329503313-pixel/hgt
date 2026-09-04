import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronDown, Eye, GripVertical, LogOut, Menu, Send, Share2, Shield, Smile, Sparkles, Swords, Users, X, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { reorderCardBattleLineup } from "../shared/cardBattleLineup";
import type { OnlineCardBattleCard, OnlineCardBattleCardState, OnlineCardBattleEvent, OnlineCardBattlePlayback, OnlineSoupMessage, OnlineSoupSnapshot, StickerAsset, StickerSeries } from "../shared/types";
import { Modal } from "./Modal";
import { StickerKeyboard } from "./StickerKeyboard";
import { UnifiedBackButton } from "./UnifiedBackButton";

type Props = {
  roomId: string;
  snapshot: OnlineSoupSnapshot;
  stickerSeries: StickerSeries[];
  stickersLoading: boolean;
  onReload: () => Promise<unknown>;
  onReloadMessages: () => Promise<unknown>;
  onOpenInvite: () => void;
  onOpenMembers: () => void;
  showToast: (message: string) => void;
};

type ChatBubble = {
  message: OnlineSoupMessage;
  expiresAt: number;
};

function hpTone(hp: number, maxHp: number) {
  const ratio = hp / Math.max(1, maxHp);
  if (ratio >= .75) return "bg-emerald-500";
  if (ratio >= .5) return "bg-lime-500";
  if (ratio >= .25) return "bg-amber-400";
  return "bg-red-500";
}

function BattleCard({ card, state, cardBack, seat, activeEvent, onClick, selectable, drag }: {
  card: OnlineCardBattleCard | null;
  state: OnlineCardBattleCardState | null;
  cardBack: boolean;
  seat: 1 | 2;
  activeEvent: OnlineCardBattleEvent | null;
  onClick?: () => void;
  selectable?: boolean;
  drag?: {
    slot: number;
    draggable: boolean;
    dragging: boolean;
    dropTarget: boolean;
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  };
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const isActiveActor = Boolean(state && activeEvent?.actorId === state.instanceId);
  const isActor = isActiveActor && activeEvent?.visual === "damage";
  const activeEffect = state ? activeEvent?.effects.find((effect) => effect.targetId === state.instanceId) : null;
  const effectClass = activeEffect
    ? activeEvent?.visual === "heal" || activeEvent?.visual === "revive" ? "card-battle-fx-green"
      : activeEvent?.visual === "buff" ? "card-battle-fx-yellow"
        : activeEvent?.visual === "energy" ? "card-battle-fx-blue" : "card-battle-hit"
    : isActiveActor && (activeEvent?.visual === "heal" || activeEvent?.visual === "revive") ? "card-battle-fx-green"
      : isActiveActor && activeEvent?.visual === "buff" ? "card-battle-fx-yellow"
        : isActiveActor && activeEvent?.visual === "energy" ? "card-battle-fx-blue" : "";
  useLayoutEffect(() => {
    const actor = rootRef.current;
    const targetId = activeEvent?.effects[0]?.targetId;
    if (!actor || !isActor || !targetId) return;
    const target = [...document.querySelectorAll<HTMLElement>("[data-battle-instance]")]
      .find((element) => element.dataset.battleInstance === targetId);
    if (!target || target === actor) return;
    const actorRect = actor.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const deltaX = targetRect.left + targetRect.width / 2 - actorRect.left - actorRect.width / 2;
    const deltaY = targetRect.top + targetRect.height / 2 - actorRect.top - actorRect.height / 2;
    const distance = Math.hypot(deltaX, deltaY);
    const stopDistance = Math.max(actorRect.height, targetRect.height) * .78;
    const ratio = distance > 0 ? Math.max(0, (distance - stopDistance) / distance) : 0;
    actor.style.setProperty("--card-battle-attack-x", `${Math.round(deltaX * ratio)}px`);
    actor.style.setProperty("--card-battle-attack-y", `${Math.round(deltaY * ratio)}px`);
    return () => {
      actor.style.removeProperty("--card-battle-attack-x");
      actor.style.removeProperty("--card-battle-attack-y");
    };
  }, [activeEvent?.sequence, isActor]);
  const content = <>
    <div className="absolute inset-x-1 top-1 z-20 h-1.5 overflow-hidden rounded-full bg-slate-950/40" aria-label={state ? `生命比例 ${Math.round(state.hp / Math.max(1, state.maxHp) * 100)}%` : undefined}>
      <span className={`block h-full transition-[width,background-color] duration-300 ${state ? hpTone(state.hp, state.maxHp) : "bg-emerald-500"}`} style={{ width: `${state ? Math.max(0, state.hp / Math.max(1, state.maxHp) * 100) : 100}%` }} />
    </div>
    {state && <div className="absolute inset-x-1 top-3 z-20 h-1 overflow-hidden rounded-full bg-slate-950/40" aria-label={`能量比例 ${Math.round(state.energy / Math.max(1, state.energyRequired) * 100)}%`}><span className="block h-full bg-cyan-400 transition-[width] duration-300" style={{ width: `${Math.max(0, state.energy / Math.max(1, state.energyRequired) * 100)}%` }} /></div>}
    {cardBack ? <div className="card-battle-back absolute inset-0 grid place-items-center rounded-[inherit]"><Swords size={28} /><span>HGT</span></div> : card ? <img src={card.imageUrl} alt={card.name} className="h-full w-full rounded-[inherit] object-cover" draggable={false} /> : <div className="grid h-full place-items-center rounded-[inherit] border border-dashed border-white/25 bg-white/5 text-center text-[10px] font-bold text-white/45">选择<br />卡牌</div>}
    {card && !cardBack && <><span className="absolute inset-x-1 bottom-1 z-10 truncate rounded bg-slate-950/70 px-1 py-0.5 text-center text-[9px] font-black text-white">{card.name} · {card.starLevel}★</span></>}
    {activeEffect && activeEvent?.visual === "damage" && <span className={`card-battle-number absolute left-1/2 top-1/3 z-40 -translate-x-1/2 text-lg font-black ${activeEffect.blocked ? "text-slate-100" : "text-red-300"}`}>{activeEffect.blocked ? "格挡" : activeEffect.amount}</span>}
    {activeEffect && activeEvent?.visual === "heal" && <span className="card-battle-number absolute left-1/2 top-0 z-40 -translate-x-1/2 text-lg font-black text-emerald-300">+{activeEffect.amount ?? 0}</span>}
    {activeEffect?.label && !["damage", "heal"].includes(activeEvent?.visual ?? "") && <span className={`card-battle-number absolute left-1/2 top-1/4 z-40 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-black ${activeEvent?.visual === "energy" ? "bg-cyan-500 text-white" : activeEvent?.visual === "revive" ? "bg-emerald-500 text-white" : "bg-amber-400 text-slate-950"}`}>{activeEffect.label}</span>}
    {state && !state.alive && <div className="absolute inset-0 z-30 grid place-items-center rounded-[inherit] bg-slate-950/75 text-[10px] font-black text-slate-300">已下场</div>}
  </>;
  const classes = `card-battle-card relative aspect-[5/7] w-[clamp(48px,min(15vw,8.5dvh),92px)] overflow-visible rounded-lg border border-white/20 bg-slate-900 shadow-lg ${isActor ? `card-battle-attacker card-battle-attacker-${seat}` : ""} ${effectClass} ${state && !state.alive ? "card-battle-defeated" : ""} ${selectable ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" : ""} ${drag?.draggable ? "touch-none select-none" : ""} ${drag?.dragging ? "z-50 scale-105 opacity-75 ring-2 ring-cyan-300" : ""} ${drag?.dropTarget ? "z-40 ring-2 ring-amber-300" : ""}`;
  const setRoot = (element: HTMLElement | null) => { rootRef.current = element; };
  return selectable
    ? <button
        ref={setRoot}
        data-battle-instance={state?.instanceId}
        data-card-battle-slot={drag?.slot}
        type="button"
        className={classes}
        onClick={onClick}
        onPointerDown={drag?.draggable ? drag.onPointerDown : undefined}
        onPointerMove={drag?.draggable ? drag.onPointerMove : undefined}
        onPointerUp={drag?.draggable ? drag.onPointerUp : undefined}
        onPointerCancel={drag?.draggable ? drag.onPointerCancel : undefined}
        onKeyDown={drag?.draggable ? drag.onKeyDown : undefined}
        aria-keyshortcuts={drag?.draggable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
        aria-label={card ? `更换${card.name}，按住拖动可交换位置` : "选择卡牌，也可作为换位目标"}
        title={drag?.draggable ? "拖动到其他卡位交换位置；也可按 Alt+左右方向键换位" : undefined}
      >
        {content}
        {drag?.draggable && <span className="pointer-events-none absolute right-0.5 top-4 z-20 grid h-5 w-5 place-items-center rounded bg-slate-950/65 text-white/80" aria-hidden="true"><GripVertical size={13} /></span>}
      </button>
    : <div ref={setRoot} data-battle-instance={state?.instanceId} className={classes}>{content}</div>;
}

function HalfArena({ seat, battleSeat, states, activeEvent, isOwn, position, canSelect, onPick, onReorder }: {
  seat: 1 | 2;
  battleSeat: NonNullable<OnlineSoupSnapshot["room"]["cardBattle"]>["seats"][number];
  states: OnlineCardBattleCardState[];
  activeEvent: OnlineCardBattleEvent | null;
  isOwn: boolean;
  position: "top" | "bottom";
  canSelect: boolean;
  onPick: (slot: number) => void;
  onReorder: (fromSlot: number, toSlot: number) => Promise<boolean>;
}) {
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const pointerDragRef = useRef<{ pointerId: number; sourceSlot: number; startX: number; startY: number; dragging: boolean } | null>(null);
  const dropSlotRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (canSelect) return;
    pointerDragRef.current = null;
    dropSlotRef.current = null;
    setDragSlot(null);
    setDropSlot(null);
  }, [canSelect]);

  const slot = (slotNumber: number) => battleSeat.lineup.find((item) => item.slot === slotNumber) ?? { slot: slotNumber, card: null, cardBack: false };
  const state = (slotNumber: number) => states.find((item) => item.seat === seat && item.slot === slotNumber) ?? null;
  const resetDrag = () => {
    pointerDragRef.current = null;
    dropSlotRef.current = null;
    setDragSlot(null);
    setDropSlot(null);
  };
  const commitReorder = async (fromSlot: number, toSlot: number) => {
    if (fromSlot === toSlot) return;
    if (await onReorder(fromSlot, toSlot)) setReorderAnnouncement(`已交换第 ${fromSlot} 和第 ${toSlot} 个卡位`);
  };
  const pointerDown = (slotNumber: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointerDragRef.current = { pointerId: event.pointerId, sourceSlot: slotNumber, startX: event.clientX, startY: event.clientY, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const interaction = pointerDragRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (!interaction.dragging && Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) < 10) return;
    if (!interaction.dragging) {
      interaction.dragging = true;
      setDragSlot(interaction.sourceSlot);
    }
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-card-battle-slot]");
    const targetSlot = target ? Number(target.dataset.cardBattleSlot) : null;
    const validTarget = targetSlot && targetSlot >= 1 && targetSlot <= 5 ? targetSlot : null;
    dropSlotRef.current = validTarget;
    setDropSlot(validTarget);
  };
  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const interaction = pointerDragRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const targetSlot = dropSlotRef.current;
    const dragged = interaction.dragging;
    const sourceSlot = interaction.sourceSlot;
    resetDrag();
    if (!dragged || cancelled) return;
    event.preventDefault();
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (targetSlot) void commitReorder(sourceSlot, targetSlot);
  };
  const keyboardReorder = (slotNumber: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const targetSlot = slotNumber + (event.key === "ArrowLeft" ? -1 : 1);
    if (targetSlot < 1 || targetSlot > 5) return;
    event.preventDefault();
    void commitReorder(slotNumber, targetSlot);
  };
  const row = (slots: number[]) => <div className="flex items-center justify-center gap-[clamp(6px,2vw,18px)]">{slots.map((slotNumber) => {
    const item = slot(slotNumber);
    const draggable = Boolean(item.card && isOwn && canSelect);
    return <BattleCard
      key={slotNumber}
      card={item.card}
      cardBack={item.cardBack}
      state={state(slotNumber)}
      seat={position === "bottom" ? 1 : 2}
      activeEvent={activeEvent}
      selectable={isOwn && canSelect}
      onClick={() => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        onPick(slotNumber);
      }}
      drag={isOwn && canSelect ? {
        slot: slotNumber,
        draggable,
        dragging: dragSlot === slotNumber,
        dropTarget: dropSlot === slotNumber && dragSlot !== slotNumber,
        onPointerDown: (event) => pointerDown(slotNumber, event),
        onPointerMove: pointerMove,
        onPointerUp: (event) => finishPointer(event),
        onPointerCancel: (event) => finishPointer(event, true),
        onKeyDown: (event) => keyboardReorder(slotNumber, event),
      } : undefined}
    />;
  })}</div>;
  return <section className={`relative flex min-h-0 flex-1 flex-col justify-center gap-2 px-2 py-2 ${isOwn ? "bg-cyan-950/20" : "bg-violet-950/15"}`} aria-label={`${battleSeat.user?.nickname ?? `席位${seat}`}的半区`}>
    <div className="absolute left-3 top-2 z-10 flex items-center gap-2 rounded-full bg-slate-950/65 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">
      {battleSeat.user?.avatar ? <img className="h-5 w-5 rounded-full object-cover" src={battleSeat.user.avatar} alt="" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-cyan-500 text-[9px]">{battleSeat.user?.nickname.slice(0, 1) ?? seat}</span>}
      <span>{battleSeat.user?.nickname ?? "等待玩家"}</span>{battleSeat.ready && <span className="text-emerald-300">已准备</span>}{isOwn && <span className="text-cyan-300">我的半区</span>}
    </div>
    {isOwn && canSelect && <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-1 rounded-full bg-slate-950/65 px-2.5 py-1 text-[10px] font-bold text-cyan-100 backdrop-blur-sm" aria-hidden="true"><GripVertical size={12} />拖动换位</div>}
    {position === "top" ? <>{row([3, 4, 5])}{row([1, 2])}</> : <>{row([1, 2])}{row([3, 4, 5])}</>}
    <span className="sr-only" aria-live="polite">{reorderAnnouncement}</span>
  </section>;
}

function Settlement({ battle, onClose }: { battle: NonNullable<OnlineSoupSnapshot["room"]["cardBattle"]>; onClose: () => void }) {
  const settlement = battle.game?.settlement;
  if (!settlement) return null;
  return <div className="absolute inset-0 z-[90] grid place-items-center bg-slate-950/80 p-3 backdrop-blur-sm">
    <div className="relative max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-4 text-white shadow-2xl">
      <button type="button" className="absolute right-2 top-2 grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15" onClick={onClose} aria-label="关闭结算"><X size={18} /></button>
      <div className="pr-10 text-center"><Sparkles className="mx-auto text-amber-300" /><h2 className="mt-1 text-2xl font-black">{settlement.winnerSeat ? `${settlement.players.find((player) => player.seat === settlement.winnerSeat)?.nickname ?? "玩家"} 获胜` : "本局平局"}</h2><p className="mt-1 text-xs text-slate-300">共 {settlement.rounds} 回合 · {settlement.endReason === "round_limit" ? "达到30回合上限" : settlement.endReason === "safety_limit" ? "连锁安全保护" : "卡牌全部下场"}</p></div>
      <div className="mt-4 space-y-4">{[...settlement.players].sort((left, right) => settlement.winnerSeat === left.seat ? -1 : settlement.winnerSeat === right.seat ? 1 : left.seat - right.seat).map((player) => <section key={player.userId} className={`rounded-xl border p-3 ${settlement.winnerSeat === player.seat ? "border-amber-300/50 bg-amber-400/10" : "border-white/10 bg-white/5"}`}><h3 className="font-black">{settlement.winnerSeat === player.seat ? "胜利玩家" : settlement.winnerSeat ? "失败玩家" : `玩家 ${player.seat}`}：{player.nickname}</h3><div className="mt-2 space-y-1">{player.cards.map((card) => <div key={card.slot} className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] gap-2 text-xs"><span className="text-slate-400">{card.slot}</span><span className="truncate font-bold">{card.name}</span><span className="text-red-300">造成 {card.damageDealt}</span><span className="text-amber-200">承受 {card.damageTaken}</span></div>)}</div></section>)}</div>
    </div>
  </div>;
}

export function CardBattleRoomView({ roomId, snapshot, stickerSeries, stickersLoading, onReload, onReloadMessages, onOpenInvite, onOpenMembers, showToast }: Props) {
  const navigate = useNavigate();
  const battle = snapshot.room.cardBattle!;
  const [eligibleCards, setEligibleCards] = useState<OnlineCardBattleCard[]>([]);
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [content, setContent] = useState("");
  const [stickersOpen, setStickersOpen] = useState(false);
  const [chatBubbles, setChatBubbles] = useState<ChatBubble[]>([]);
  const [optimisticOwnIds, setOptimisticOwnIds] = useState<Array<string | null> | null>(null);
  const [playback, setPlayback] = useState<OnlineCardBattlePlayback | null>(battle.game?.playback ?? null);
  const [cardStates, setCardStates] = useState<OnlineCardBattleCardState[]>(battle.game?.playback.states ?? []);
  const [activeEvent, setActiveEvent] = useState<OnlineCardBattleEvent | null>(null);
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);
  const [settlementDismissedGameId, setSettlementDismissedGameId] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const playbackRef = useRef<OnlineCardBattlePlayback | null>(playback);
  const onReloadRef = useRef(onReload);
  const showToastRef = useRef(showToast);
  const bubbleRoomIdRef = useRef(roomId);
  const seenBubbleIdsRef = useRef(new Set(snapshot.messages.map((message) => message.id)));
  const allStickers = useMemo(() => stickerSeries.flatMap((series) => series.stickers), [stickerSeries]);
  const stickersById = useMemo(() => new Map(allStickers.map((sticker) => [sticker.id, sticker])), [allStickers]);

  useEffect(() => { playbackRef.current = playback; }, [playback]);
  useEffect(() => { onReloadRef.current = onReload; }, [onReload]);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  useEffect(() => {
    if (bubbleRoomIdRef.current !== roomId) {
      bubbleRoomIdRef.current = roomId;
      seenBubbleIdsRef.current = new Set(snapshot.messages.map((message) => message.id));
      setChatBubbles([]);
      return;
    }
    const incoming = snapshot.messages.filter((message) => {
      if (seenBubbleIdsRef.current.has(message.id)) return false;
      seenBubbleIdsRef.current.add(message.id);
      return !message.recalledAt && (message.type === "discussion" || message.type === "sticker");
    });
    if (!incoming.length) return;
    const expiresAt = Date.now() + 8000;
    setChatBubbles((current) => [...current, ...incoming.map((message) => ({ message, expiresAt }))].slice(-6));
  }, [roomId, snapshot.messages]);
  useEffect(() => {
    if (!chatBubbles.length) return;
    const delay = Math.max(0, Math.min(...chatBubbles.map((bubble) => bubble.expiresAt)) - Date.now());
    const timer = window.setTimeout(() => {
      const currentTime = Date.now();
      setChatBubbles((current) => current.filter((bubble) => bubble.expiresAt > currentTime));
    }, delay + 20);
    return () => window.clearTimeout(timer);
  }, [chatBubbles]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && activeEvent) {
        setCardStates(playbackRef.current?.states ?? []);
        setActiveEvent(null);
      }
      setVisibilityEpoch((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [activeEvent]);
  useEffect(() => {
    if (!battle.me.seat) return;
    void api<{ cards: OnlineCardBattleCard[] }>(`/api/online-soup/rooms/${roomId}/card-battle/eligible-cards`, { bypassCache: true })
      .then((data) => setEligibleCards(data.cards)).catch((error) => showToast(error instanceof Error ? error.message : "可参战卡牌加载失败"));
  }, [battle.me.seat, roomId, showToast]);

  useEffect(() => {
    const game = battle.game;
    if (!game) {
      gameIdRef.current = null;
      setPlayback(null);
      setActiveEvent(null);
      setCardStates([]);
      return;
    }
    const gameChanged = gameIdRef.current !== game.id;
    const currentPlayback = playbackRef.current;
    if (!gameChanged && currentPlayback
      && currentPlayback.completedSequence >= game.playback.completedSequence
      && currentPlayback.complete === game.playback.complete) return;
    gameIdRef.current = game.id;
    if (gameChanged) setSettlementDismissedGameId(null);
    setPlayback(game.playback);
    setCardStates(game.playback.states);
    setActiveEvent(null);
  }, [battle.game?.id, battle.game?.playback.complete, battle.game?.playback.completedSequence]);

  useEffect(() => {
    const gameId = battle.game?.id;
    const event = playback?.activeEvent;
    if (!gameId || !playback || playback.complete || !event || document.visibilityState !== "visible") return;
    let cancelled = false;
    let retryTimer: number | null = null;
    setCardStates(playback.states);
    setActiveEvent(event);
    const stateTimer = window.setTimeout(() => setCardStates(event.states), Math.max(120, Math.round(event.durationMs * .55)));
    const finishTimer = window.setTimeout(() => {
      setCardStates(event.states);
      setActiveEvent(null);
      void api<{ playback: OnlineCardBattlePlayback }>(`/api/online-soup/rooms/${roomId}/card-battle/playback/ack`, {
        method: "POST",
        body: { sequence: event.sequence },
      }).then((data) => {
        if (cancelled) return;
        setPlayback(data.playback);
        setCardStates(data.playback.states);
        if (data.playback.complete) void onReloadRef.current();
      }).catch((error) => {
        if (cancelled) return;
        showToastRef.current(error instanceof Error ? error.message : "战斗动画同步失败，正在重播当前动作");
        retryTimer = window.setTimeout(() => setVisibilityEpoch((value) => value + 1), 600);
      });
    }, event.durationMs);
    return () => {
      cancelled = true;
      window.clearTimeout(stateTimer);
      window.clearTimeout(finishTimer);
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [battle.game?.id, playback?.activeEvent?.sequence, playback?.complete, playback?.completedSequence, roomId, visibilityEpoch]);

  const currentSeat = battle.seats.find((seat) => seat.seat === battle.me.seat) ?? null;
  const serverOwnIds = currentSeat?.lineup.map((slot) => slot.card?.id ?? null) ?? [];
  const serverOwnIdsKey = serverOwnIds.map((cardId) => cardId ?? "").join("|");
  const ownIds = optimisticOwnIds ?? serverOwnIds;
  const animationComplete = Boolean(battle.game && playback?.complete);
  useEffect(() => {
    if (!optimisticOwnIds) return;
    const optimisticKey = optimisticOwnIds.map((cardId) => cardId ?? "").join("|");
    if (!battle.me.seat || optimisticKey === serverOwnIdsKey) setOptimisticOwnIds(null);
  }, [battle.me.seat, optimisticOwnIds, serverOwnIdsKey]);
  const ownCardsById = new Map<string, OnlineCardBattleCard>();
  for (const card of eligibleCards) ownCardsById.set(card.id, card);
  for (const item of currentSeat?.lineup ?? []) if (item.card) ownCardsById.set(item.card.id, item.card);
  const displaySeat = (seatNumber: 1 | 2) => {
    const current = battle.seats.find((seat) => seat.seat === seatNumber)!;
    const frozen = battle.game?.lineups.find((lineup) => lineup.seat === seatNumber);
    if (!animationComplete && frozen) return {
      ...current,
      user: { id: frozen.userId, nickname: frozen.nickname, avatar: null },
      ready: true,
      lineup: frozen.cards.map((card, index) => ({ slot: index + 1, card, cardBack: false })),
    };
    if (seatNumber === battle.me.seat && optimisticOwnIds) return {
      ...current,
      lineup: optimisticOwnIds.map((cardId, index) => ({
        slot: index + 1,
        card: cardId ? ownCardsById.get(cardId) ?? null : null,
        cardBack: false,
      })),
    };
    return current;
  };
  const topSeatNumber: 1 | 2 = battle.me.seat === 2 ? 1 : 2;
  const bottomSeatNumber: 1 | 2 = battle.me.seat ?? 1;
  const topSeat = displaySeat(topSeatNumber);
  const bottomSeat = displaySeat(bottomSeatNumber);
  // The server can finish a game while a reconnecting/hidden client is still
  // replaying it. Keep that client locked until every mandatory animation has
  // completed, otherwise changing the lineup would effectively skip playback.
  const canConfigure = battle.phase !== "playing" && (!battle.game || animationComplete);

  async function mutation(path: string, body?: unknown) {
    if (saving) return false;
    setSaving(true);
    try { await api(`/api/online-soup/rooms/${roomId}/${path}`, { method: path === "card-battle/lineup" ? "PUT" : "POST", ...(body === undefined ? {} : { body }) }); await onReload(); return true; }
    catch (error) { showToast(error instanceof Error ? error.message : "操作失败"); return false; }
    finally { setSaving(false); }
  }
  async function chooseCard(cardId: string) {
    if (pickSlot == null) return;
    const next = Array.from({ length: 5 }, (_, index) => ownIds[index] ?? null);
    const duplicate = next.findIndex((id) => id === cardId);
    if (duplicate >= 0) next[duplicate] = null;
    next[pickSlot - 1] = cardId;
    setPickSlot(null);
    setOptimisticOwnIds(next);
    if (!await mutation("card-battle/lineup", { cardIds: next })) setOptimisticOwnIds(null);
  }
  async function reorderCards(fromSlot: number, toSlot: number) {
    if (!canConfigure || !battle.me.seat || currentSeat?.ready || saving) return false;
    const next = reorderCardBattleLineup(ownIds, fromSlot, toSlot);
    if (next.every((cardId, index) => cardId === (ownIds[index] ?? null))) return false;
    setOptimisticOwnIds(next);
    const saved = await mutation("card-battle/lineup", { cardIds: next });
    if (!saved) setOptimisticOwnIds(null);
    return saved;
  }
  async function sendMessage() {
    const value = content.trim();
    if (!value || saving) return;
    setSaving(true);
    try { await api(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: "discussion", content: value } }); setContent(""); await onReloadMessages(); }
    catch (error) { showToast(error instanceof Error ? error.message : "消息发送失败"); }
    finally { setSaving(false); }
  }
  async function sendSticker(sticker: StickerAsset) {
    setSaving(true);
    try { await api(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: "sticker", stickerId: sticker.id } }); setStickersOpen(false); await onReloadMessages(); }
    catch (error) { showToast(error instanceof Error ? error.message : "表情发送失败"); }
    finally { setSaving(false); }
  }
  async function leaveRoom(close = false) {
    setSaving(true);
    try { await api(`/api/online-soup/rooms/${roomId}/${close ? "close" : "leave"}`, { method: "POST" }); navigate("/online-soup", { replace: true }); }
    catch (error) { showToast(error instanceof Error ? error.message : "退出失败"); setSaving(false); }
  }

  return <div className="card-battle-room flex h-[100dvh] flex-col overflow-hidden bg-[#071426] text-white">
    <header className="relative z-[100] flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-slate-950/90 px-3 backdrop-blur-xl">
      <UnifiedBackButton compactOnMobile onClick={() => setLeaveOpen(true)} />
      <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-black">{snapshot.room.name}</h1><p className="truncate text-[10px] text-slate-400">房间号 {snapshot.room.code} · 卡牌对战 · 1v1 · {!animationComplete && battle.game ? `第 ${activeEvent?.round ?? playback?.activeEvent?.round ?? 1} 回合` : battle.phase === "ended" ? "本局结束" : "准备中"}</p></div>
      <span className="hidden rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-slate-200 sm:inline">{battle.me.seat ? `对战席 ${battle.me.seat}` : "观战"}</span>
      <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 text-cyan-100 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" aria-label="分享房间" title="分享房间" onClick={() => { setMenuOpen(false); onOpenInvite(); }}><Share2 size={19} /></button>
      <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 text-cyan-100 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" aria-label={`房间成员，共 ${snapshot.members.length} 人`} title={`房间成员 · ${snapshot.members.length} 人`} onClick={() => { setMenuOpen(false); onOpenMembers(); }}><span className="relative grid h-7 w-7 place-items-center"><Users size={19} /><span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-cyan-500 px-1 text-[10px] font-black leading-4 text-slate-950 ring-2 ring-slate-950">{snapshot.members.length}</span></span></button>
      <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15" aria-label="更多操作" onClick={() => setMenuOpen((open) => !open)}><Menu size={19} /></button>
      {menuOpen && <div className="absolute right-3 top-[calc(100%+8px)] z-[110] w-48 overflow-hidden rounded-xl border border-white/10 bg-slate-900 p-1.5 shadow-2xl">
        {snapshot.me.isHost && canConfigure && <button className="card-battle-menu-item text-cyan-300" disabled={saving || battle.seats.some((seat) => !seat.user || !seat.ready)} onClick={() => { setMenuOpen(false); void mutation("start"); }}><Swords size={16} />开始游戏</button>}
        {snapshot.me.isHost && <button className="card-battle-menu-item" onClick={() => { setMenuOpen(false); setModeOpen(true); }}><ChevronDown size={16} />选择玩法</button>}
        {canConfigure && <button className="card-battle-menu-item" disabled={saving || (!battle.me.seat && battle.seats.every((seat) => seat.user !== null))} onClick={() => { setMenuOpen(false); void mutation("card-battle/member-role", { role: battle.me.seat ? "spectator" : "player" }); }}>{battle.me.seat ? <Eye size={16} /> : <Swords size={16} />}{battle.me.seat ? "切换观战" : "切换对战"}</button>}
        {snapshot.me.isHost && <button className="card-battle-menu-item text-red-300" onClick={() => { setMenuOpen(false); setCloseOpen(true); }}><X size={16} />关闭房间</button>}
        {!snapshot.me.isHost && <button className="card-battle-menu-item text-red-300" onClick={() => { setMenuOpen(false); setLeaveOpen(true); }}><LogOut size={16} />退出房间</button>}
      </div>}
    </header>

    <main className="relative min-h-0 flex-1 overflow-hidden">
      <div className={`flex h-full min-h-0 flex-col ${battle.me.seat && canConfigure ? "pb-[124px]" : "pb-[68px]"}`}>
        <HalfArena seat={topSeatNumber} battleSeat={topSeat} states={cardStates} activeEvent={activeEvent} isOwn={false} position="top" canSelect={false} onPick={() => undefined} onReorder={async () => false} />
        <div className="relative z-30 flex h-8 shrink-0 items-center justify-center border-y border-cyan-300/30 bg-slate-950/90 text-[10px] font-black uppercase tracking-[.2em] text-cyan-200"><span>{activeEvent?.text ?? (battle.phase === "playing" ? "自动战斗中 · 动画不可跳过" : "前排 2 张 · 后排 3 张")}</span></div>
        <HalfArena seat={bottomSeatNumber} battleSeat={bottomSeat} states={cardStates} activeEvent={activeEvent} isOwn={Boolean(battle.me.seat)} position="bottom" canSelect={canConfigure && Boolean(battle.me.seat) && !currentSeat?.ready && !saving} onPick={setPickSlot} onReorder={reorderCards} />
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 z-[60] flex h-[25%] max-h-60 flex-col justify-end gap-1.5 overflow-hidden px-3 pb-2 transition-[bottom] duration-200"
        style={{ bottom: `calc(${battle.me.seat && canConfigure ? 124 : 68}px + ${stickersOpen ? "15.5rem" : "0px"})` }}
        aria-live="polite"
        aria-label="实时聊天气泡"
      >
        {chatBubbles.map(({ message }) => {
          const mine = message.senderId === battle.me.userId;
          return <div key={message.id} className={`card-battle-chat-bubble max-w-[82%] rounded-2xl px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md ${mine ? "self-end bg-cyan-700/85" : "self-start bg-slate-950/80"}`}><strong className={`mr-1 ${mine ? "text-cyan-50" : "text-cyan-300"}`}>{message.senderName ?? "系统"}</strong>{message.type === "sticker" ? (() => { const sticker = message.stickerId ? stickersById.get(message.stickerId) : null; return sticker ? <img className="mt-1 h-14 w-14 object-contain" src={sticker.animatedUrl || sticker.staticUrl} alt={sticker.name} /> : "[表情]"; })() : message.content}</div>;
        })}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-[80] border-t border-white/10 bg-slate-950/90 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        {battle.me.seat && canConfigure && <div className="mb-2 flex items-center gap-2"><button type="button" className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-black ${currentSeat?.ready ? "bg-amber-400 text-slate-950" : "bg-emerald-500 text-white"}`} disabled={saving || ownIds.filter(Boolean).length !== 5} onClick={() => void mutation("card-battle/ready", { ready: !currentSeat?.ready })}>{currentSeat?.ready ? "取消准备" : ownIds.filter(Boolean).length === 5 ? "准备" : `还需选择 ${5 - ownIds.filter(Boolean).length} 张`}</button></div>}
        <div className="flex items-end gap-2"><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-white/10 text-cyan-200" onClick={() => setStickersOpen((open) => !open)} aria-label="发送表情"><Smile size={20} /></button><textarea rows={1} maxLength={1000} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} className="min-h-11 max-h-24 flex-1 resize-none rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400" placeholder="聊天或发表情…" /><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40" disabled={!content.trim() || saving} onClick={() => void sendMessage()} aria-label="发送消息"><Send size={18} /></button></div>
        {stickersOpen && <StickerKeyboard series={stickerSeries} loading={stickersLoading} sending={saving} onClose={() => setStickersOpen(false)} onSend={sendSticker} className="mt-2 max-h-60 overflow-y-auto rounded-xl p-2 text-slate-900" />}
      </div>

      {animationComplete && battle.game?.settlement && settlementDismissedGameId !== battle.game.id && <Settlement battle={battle} onClose={() => setSettlementDismissedGameId(battle.game!.id)} />}
    </main>

    {pickSlot != null && <Modal full onClose={() => setPickSlot(null)}><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">选择第 {pickSlot} 张卡牌</h2><p className="mt-1 text-xs text-muted">只展示你拥有且当前启用的传说卡。</p></div><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100" onClick={() => setPickSlot(null)} aria-label="关闭"><X size={18} /></button></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{eligibleCards.map((card) => { const selected = ownIds.includes(card.id); return <button key={card.id} type="button" className={`relative overflow-hidden rounded-xl border-2 text-left ${selected ? "border-cyan-500 ring-2 ring-cyan-200" : "border-line"}`} onClick={() => void chooseCard(card.id)}><img className="aspect-[5/7] w-full object-cover" src={card.imageUrl} alt={card.name} /><div className="p-2"><p className="truncate text-xs font-black text-ink">{card.name} · {card.starLevel}★</p><p className="mt-1 flex gap-2 text-[10px] text-muted"><span>攻 {card.stats.attack}</span><span><Shield className="inline" size={10} /> {card.stats.defense}</span><span><Zap className="inline" size={10} /> {card.stats.speed}</span></p></div>{selected && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-cyan-500 text-white"><Check size={14} /></span>}</button>; })}</div>{eligibleCards.length === 0 && <p className="py-10 text-center text-sm text-muted">当前没有可参战的传说卡</p>}</Modal>}
    {modeOpen && <Modal onClose={() => setModeOpen(false)}><div><h2 className="text-xl font-black text-ink">选择玩法</h2><button type="button" className="mt-4 flex min-h-14 w-full items-center justify-between rounded-xl border-2 border-primary bg-blue-50 px-4 text-left text-primary"><span><strong className="block">1v1</strong><span className="text-xs">双方各选择五张卡牌自动战斗</span></span><Check /></button><p className="mt-3 text-xs text-muted">暂时只开放 1v1，后续玩法不会影响本局规则。</p></div></Modal>}
    {leaveOpen && <Modal onClose={() => setLeaveOpen(false)}><div><h2 className="text-xl font-black text-ink">退出房间？</h2><p className="mt-2 text-sm leading-6 text-muted">对局进行中退出不会中断服务端战斗；重新进入后会从尚未播放的动画继续。</p><div className="mt-5 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setLeaveOpen(false)}>取消</button><button className="btn bg-red-600 text-white" disabled={saving} onClick={() => void leaveRoom(false)}>确认退出</button></div></div></Modal>}
    {closeOpen && <Modal onClose={() => setCloseOpen(false)}><div><h2 className="text-xl font-black text-ink">关闭房间？</h2><p className="mt-2 text-sm leading-6 text-muted">房间关闭后所有成员退出；进行中的对局会标记为中止，不生成胜负结算。</p><div className="mt-5 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setCloseOpen(false)}>取消</button><button className="btn bg-red-600 text-white" disabled={saving} onClick={() => void leaveRoom(true)}>关闭房间</button></div></div></Modal>}
  </div>;
}
