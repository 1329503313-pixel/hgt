import type { BattleCollectibleBinding } from "@hgt/shared";
import { CardBattleDeckActions } from "./CardBattleDeckActions";
import { CardBattleDeckEditor } from "./CardBattleDeckEditor";
import { BattleCollectiblePicker } from "./BattleCollectiblePicker";
import { battleCardWithCollectible, battleDeckCollectible } from "../shared/battleCollectibles";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useServerCardBattlePlayback } from "../shared/useServerCardBattlePlayback";
import { cardBattleRoomExit } from "../shared/cardBattleNavigation";
import { seekCardBattleAnimations } from "../shared/cardBattlePlayback";
import { CardBattleSkillFx, CardBattleProcFx, CardBattleStatusIcons } from "./CardBattleEffects";
import { CardBattleSettlementTable } from "./CardBattleSettlementTable";
import { cardBattleFormationSize } from "../shared/cardBattleLayout";
import { ArrowUpDown, Gem, Check, ChevronDown, Eye, GripVertical, Layers, LogOut, Menu, Save, Search, Send, Share2, Smile, Sparkles, Swords, Users, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { reorderCardBattleLineup } from "../shared/cardBattleLineup";
import { filterCardBattleSelection, type CardBattleRoleFilter } from "../shared/cardBattleSelection";
import { CARD_BATTLE_ROLE_LABELS } from "../shared/digitalAssets";
import type { OnlineCardBattleCard, OnlineCardBattleCardState, OnlineCardBattleDeck, OnlineCardBattleEvent, OnlineSoupMessage, OnlineSoupSnapshot, StickerAsset, StickerSeries } from "../shared/types";
import { AssetMotionMedia } from "./AssetCardVisual";
import { Modal } from "./Modal";
import { BossLineupDetails } from "./BossLineupDetails";
import { StickerKeyboard } from "./StickerKeyboard";
import { UnifiedBackButton } from "./UnifiedBackButton";

type Props = {
  roomId: string;
  snapshot: OnlineSoupSnapshot;
  rankingInvalidated?: boolean;
  stickerSeries: StickerSeries[];
  stickersLoading: boolean;
  onReload: () => Promise<unknown>;
  onReloadMessages: () => Promise<unknown>;
  onOpenInvite: () => void;
  onOpenMembers: () => void;
  showToast: (message: string) => void;
};

type CardBattleChatMessage = Pick<OnlineSoupMessage, "id" | "senderId" | "senderName" | "type" | "content" | "stickerId" | "recalledAt">;

type ChatBubble = {
  message: CardBattleChatMessage;
  expiresAt: number;
};

type CardSort = "number" | "rarity" | "star" | "power";
type CardView = "stats" | "skill";
type DeckEditorState = { name: string; cardIds: string[]; collectibleBindings: BattleCollectibleBinding[] };

const combatPowerFormatter = new Intl.NumberFormat("zh-CN");
const cardRarityRank: Record<OnlineCardBattleCard["rarity"], number> = { epic: 0, legend: 1 };

function hpTone(hp: number, maxHp: number) {
  const ratio = hp / Math.max(1, maxHp);
  if (ratio >= .75) return "bg-emerald-500";
  if (ratio >= .5) return "bg-lime-500";
  if (ratio >= .25) return "bg-amber-400";
  return "bg-red-500";
}

function battleRoleTone(role: OnlineCardBattleCard["battleRole"]) {
  if (role === "tank") return "border-sky-200/70 bg-sky-700/90 text-sky-50";
  if (role === "support") return "border-emerald-200/70 bg-emerald-700/90 text-emerald-50";
  return "border-rose-200/70 bg-rose-700/90 text-rose-50";
}

export function BattleCard({ card, state, cardBack, seat, activeEvent, showPower, onClick, selectable, drag }: {
  card: OnlineCardBattleCard | null;
  state: OnlineCardBattleCardState | null;
  cardBack: boolean;
  seat: 1 | 2;
  activeEvent: OnlineCardBattleEvent | null;
  showPower: boolean;
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
  const damageAmount = activeEffect?.shieldDamage ? -(activeEffect.hpDamage ?? 0) : activeEffect?.amount;
  const effectClass = activeEffect
    ? activeEffect.dodged ? `card-battle-dodge card-battle-dodge-${seat}` : activeEvent?.visual === "heal" || activeEvent?.visual === "revive" ? "card-battle-fx-green"
      : activeEvent?.visual === "buff" || activeEvent?.visual === "extra_action" ? "card-battle-fx-yellow"
        : activeEvent?.visual === "energy" ? "card-battle-fx-blue" : activeEvent?.visual === "debuff" || activeEvent?.visual === "stun" ? "card-battle-fx-debuff" : "card-battle-hit"
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
    // Measure resting positions, not a previous event's transformed card position.
    seekCardBattleAnimations(actor, 0);
    seekCardBattleAnimations(target, 0);
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
    {state && !cardBack && <CardBattleSkillFx event={activeEvent} instanceId={state.instanceId} />}
    {state && !cardBack && <CardBattleProcFx event={activeEvent} instanceId={state.instanceId} />}
    {state && !cardBack && !showPower && <CardBattleStatusIcons statuses={state.statuses ?? []} />}
    {card && !cardBack && (activeEvent?.kind === "skill" || activeEvent?.bond) && isActiveActor && activeEvent.skillName && <span className="card-battle-skill-name pointer-events-none absolute inset-x-[-8px] -top-6 z-[85] truncate rounded-full border border-amber-200/70 bg-amber-400 px-2 py-1 text-center text-[9px] font-black text-slate-950 shadow-lg" title={activeEvent.skillName}>{activeEvent.skillName}</span>}
    <div className="absolute inset-x-1 top-1 z-20 h-1.5 overflow-hidden rounded-full bg-slate-950/40" aria-label={state ? `生命比例 ${Math.round(state.hp / Math.max(1, state.maxHp) * 100)}%` : undefined}>
      <span className={`block h-full transition-[width,background-color] duration-300 ${state ? hpTone(state.hp, state.maxHp) : "bg-emerald-500"}`} style={{ width: `${state ? Math.max(0, state.hp / Math.max(1, state.maxHp) * 100) : 100}%` }} />
      {state && !cardBack && (state.shield ?? 0) > 0 && <span className="absolute inset-y-0 left-0 bg-white transition-[width] duration-300" style={{ width: `${Math.min(100, (state.shield ?? 0) / Math.max(1, state.maxHp) * 100)}%` }} aria-label={`护盾覆盖比例 ${Math.min(100, Math.round((state.shield ?? 0) / Math.max(1, state.maxHp) * 100))}%`} />}
    </div>
    {state && <div className="absolute inset-x-1 top-3 z-20 h-1 overflow-hidden rounded-full bg-slate-950/40" aria-label={`能量比例 ${Math.round(state.energy / Math.max(1, state.energyRequired) * 100)}%`}><span className="block h-full bg-cyan-400 transition-[width] duration-300" style={{ width: `${Math.max(0, state.energy / Math.max(1, state.energyRequired) * 100)}%` }} /></div>}
    {state && (state.shield ?? 0) > 0 && !cardBack && <span className="absolute left-1 top-[38px] z-20 max-w-[calc(100%-8px)] truncate rounded bg-sky-950/90 px-1 text-[10px] font-black text-cyan-100" aria-label={`护盾值 ${state.shield}`}>盾 {state.shield}</span>}
    {cardBack ? <div className="card-battle-back absolute inset-0 grid place-items-center rounded-[inherit]"><Swords size={28} /><span>HGT</span></div> : card ? card.motionMp4Url
      ? <AssetMotionMedia card={{ ...card, thumbnailUrl: card.imageUrl }} className="h-full w-full rounded-[inherit] object-cover" />
      : <img src={card.imageUrl} alt={card.name} className="h-full w-full rounded-[inherit] object-cover" draggable={false} />
      : <div className="grid h-full place-items-center rounded-[inherit] border border-dashed border-white/25 bg-white/5 text-center text-[10px] font-bold text-white/45">选择<br />卡牌</div>}
    {card && !cardBack && <>{showPower && <span className="absolute right-1 top-4 z-20 whitespace-nowrap rounded bg-amber-400/95 px-1 py-0.5 text-[8px] font-black text-slate-950 shadow">战力 {combatPowerFormatter.format(card.combatPower)}</span>}<span className="absolute inset-x-1 bottom-1 z-10 rounded bg-slate-950/70 px-1 py-0.5 text-[9px] font-black text-white">{card.collectible && <span className="block truncate text-center text-[10px] text-amber-200" title={card.collectible.name}>{card.collectible.name}</span>}<span className="block truncate text-center" title={card.name}>{card.name}</span></span></>}
    {activeEffect?.dodged && <span className="card-battle-number absolute -top-6 left-1/2 z-[85] -translate-x-1/2 whitespace-nowrap rounded bg-cyan-950 px-2 text-sm font-black text-cyan-100">闪避</span>}
    {activeEffect && !activeEffect.dodged && (!activeEffect.shieldDamage || activeEffect.hpDamage || activeEffect.label) && activeEvent?.visual === "damage" && <span className={`card-battle-number absolute left-1/2 top-1/3 z-40 -translate-x-1/2 text-lg font-black ${activeEffect.blocked ? "text-slate-100" : "text-red-300"}`}>{activeEffect.critical ? "暴击 " : ""}{activeEffect.label ? `${activeEffect.label}${activeEffect.blocked ? "" : ` ${damageAmount}`}` : activeEffect.blocked ? "格挡" : damageAmount}</span>}
    {Boolean(activeEffect?.shieldDamage) && <span className="card-battle-number absolute left-1/2 top-2/3 z-40 -translate-x-1/2 whitespace-nowrap rounded bg-sky-950/90 px-1 text-xs font-bold text-cyan-100">护盾 -{activeEffect?.shieldDamage}</span>}
    {activeEffect && activeEvent?.visual === "heal" && <span className="card-battle-number absolute left-1/2 top-0 z-40 -translate-x-1/2 text-lg font-black text-emerald-300">{activeEffect.critical ? "暴击 " : ""}+{activeEffect.amount ?? 0}</span>}
    {isActiveActor && Boolean(activeEvent?.lifesteal) && <span className="card-battle-number absolute left-1/2 top-0 z-40 -translate-x-1/2 whitespace-nowrap rounded bg-rose-950/90 px-1 text-xs font-black text-rose-200">吸血 +{activeEvent?.lifesteal}</span>}
    {(activeEffect?.stunned || activeEffect?.stunResisted) && <span className="card-battle-number absolute left-1/2 top-2/3 z-40 -translate-x-1/2 whitespace-nowrap rounded bg-slate-950/90 px-1 text-xs font-black text-amber-200">{activeEffect.stunned ? "眩晕·本回合" : "抵抗击晕"}</span>}
    {activeEffect?.label && !["damage", "heal"].includes(activeEvent?.visual ?? "") && <span className={`card-battle-number absolute left-1/2 top-1/4 z-40 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-black ${activeEvent?.visual === "energy" ? "bg-cyan-500 text-white" : activeEvent?.visual === "revive" ? "bg-emerald-500 text-white" : activeEvent?.visual === "debuff" ? "bg-rose-700 text-white" : "bg-amber-400 text-slate-950"}`}>{activeEffect.label}</span>}
    {state && !state.alive && <div className="absolute inset-0 z-30 grid place-items-center rounded-[inherit] bg-slate-950/75 text-[10px] font-black text-slate-300">已下场</div>}
  </>;
  const classes = `card-battle-card relative aspect-[5/7] shrink-0 overflow-visible rounded-lg border border-white/20 bg-slate-900 shadow-lg ${isActor ? `card-battle-attacker card-battle-attacker-${seat}` : ""} ${effectClass} ${state && !state.alive ? "card-battle-defeated" : ""} ${selectable ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" : ""} ${drag?.draggable ? "touch-none select-none" : ""} ${drag?.dragging ? "z-50 scale-105 opacity-75 ring-2 ring-cyan-300" : ""} ${drag?.dropTarget ? "z-40 ring-2 ring-amber-300" : ""}`;
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
        {drag?.draggable && <span className="pointer-events-none absolute right-0.5 bottom-6 z-20 grid h-5 w-5 place-items-center rounded bg-slate-950/65 text-white/80" aria-hidden="true"><GripVertical size={13} /></span>}
      </button>
    : <div ref={setRoot} data-battle-instance={state?.instanceId} className={classes}>{content}</div>;
}

export function HalfArena({ seat, battleSeat, states, activeEvent, showPower, isOwn, position, canSelect, onPick, onReorder, teamMember = false }: {
  teamMember?: boolean;
  seat: 1 | 2;
  battleSeat: NonNullable<OnlineSoupSnapshot["room"]["cardBattle"]>["seats"][number];
  states: OnlineCardBattleCardState[];
  activeEvent: OnlineCardBattleEvent | null;
  showPower: boolean;
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
  const halfRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const half = halfRef.current;
    if (!half) return;
    const resize = () => {
      const { cardWidth, columnGap } = teamMember
        ? { cardWidth: Math.max(42, Math.min(130, Math.floor((half.clientWidth - 8) / 2), Math.floor((half.clientHeight - 76) / 2.8))), columnGap: 4 }
        : cardBattleFormationSize(half.clientWidth, half.clientHeight);
      half.style.setProperty("--battle-card-width", `${cardWidth}px`);
      half.style.setProperty("--battle-column-gap", `${columnGap}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(half);
    return () => observer.disconnect();
  }, [teamMember]);

  useEffect(() => {
    if (canSelect) return;
    pointerDragRef.current = null;
    dropSlotRef.current = null;
    setDragSlot(null);
    setDropSlot(null);
  }, [canSelect]);

  const slot = (slotNumber: number) => battleSeat.lineup.find((item) => item.slot === slotNumber) ?? { slot: slotNumber, card: null, cardBack: false };
  const state = (slotNumber: number) => states.find((item) => item.seat === seat && item.slot === slotNumber && (!teamMember || item.userId === battleSeat.user?.id)) ?? null;
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
    const validTarget = target && halfRef.current?.contains(target) && targetSlot && targetSlot >= 1 && targetSlot <= (teamMember ? 3 : 5) ? targetSlot : null;
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
    if (targetSlot < 1 || targetSlot > (teamMember ? 3 : 5)) return;
    event.preventDefault();
    void commitReorder(slotNumber, targetSlot);
  };
  const row = (slots: number[]) => <div className="card-battle-formation-row flex shrink-0 items-center justify-center" data-battle-row={slots[0]! <= (teamMember ? 1 : 2) ? "front" : "rear"}>{slots.map((slotNumber) => {
    const item = slot(slotNumber);
    const draggable = Boolean(item.card && isOwn && canSelect);
    return <BattleCard
      key={slotNumber}
      card={item.card}
      cardBack={item.cardBack}
      state={state(slotNumber)}
      seat={position === "bottom" ? 1 : 2}
      activeEvent={activeEvent}
      showPower={showPower}
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
  return <section ref={halfRef} className={`card-battle-half ${teamMember ? "card-battle-team-member min-w-0" : ""} relative flex flex-1 flex-col justify-center ${isOwn ? "bg-cyan-950/20" : "bg-violet-950/15"}`} aria-label={`${battleSeat.user?.nickname ?? `席位${battleSeat.seat}`}的半区`}>
    <div className={`absolute top-2 z-10 flex items-center rounded-full bg-slate-950/65 py-1 text-[10px] font-bold text-white backdrop-blur-sm ${teamMember ? "inset-x-1 flex-wrap justify-center gap-1 px-1" : "left-3 gap-2 px-2.5"}`}>
      {battleSeat.user?.avatar ? <img className="h-5 w-5 rounded-full object-cover" src={battleSeat.user.avatar} alt="" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-cyan-500 text-[9px]">{battleSeat.user?.nickname.slice(0, 1) ?? seat}</span>}
      <span className="max-w-full truncate">{battleSeat.user?.nickname ?? "等待玩家"}</span>{battleSeat.ready && <span className="text-emerald-300">已准备</span>}{isOwn && <span className="text-cyan-300">{teamMember ? "我" : "我的半区"}</span>}
    </div>
    {isOwn && canSelect && !teamMember && <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-1 rounded-full bg-slate-950/65 px-2.5 py-1 text-[10px] font-bold text-cyan-100 backdrop-blur-sm" aria-hidden="true"><GripVertical size={12} />拖动换位</div>}
    {teamMember ? <>{row([1])}{row([2, 3])}</> : position === "top" ? <>{row([3, 4, 5])}{row([1, 2])}</> : <>{row([1, 2])}{row([3, 4, 5])}</>}
    <span className="sr-only" aria-live="polite">{reorderAnnouncement}</span>
  </section>;
}

export function Settlement({ battle, onClose, onConfirmRankingWin, confirming }: {
  battle: NonNullable<OnlineSoupSnapshot["room"]["cardBattle"]>;
  onClose: () => void;
  onConfirmRankingWin: () => void;
  confirming: boolean;
}) {
  const settlement = battle.game?.settlement;
  if (!settlement) return null;
  const rankingWon = Boolean(battle.rankingChallenge && settlement.players.find((player) => player.seat === settlement.winnerSeat)?.userId === battle.me.userId);
  const bossWon = battle.mode === "boss" && settlement.winnerSeat === 1 && settlement.endReason === "elimination";
  return <div className="absolute inset-0 z-[90] grid place-items-center bg-slate-950/80 p-3 backdrop-blur-sm">
    <div className="relative max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-4 text-white shadow-2xl">
      {!rankingWon && <button type="button" className="absolute right-2 top-2 grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15" onClick={onClose} aria-label="关闭结算"><X size={18} /></button>}
      <div className="pr-10 text-center"><Sparkles className="mx-auto text-amber-300" /><h2 className="mt-1 text-2xl font-black">{battle.mode === "boss" ? (bossWon ? "挑战成功" : "挑战失败") : settlement.winnerSeat ? `${settlement.players.find((player) => player.seat === settlement.winnerSeat)?.nickname ?? "玩家"} 获胜` : "本局平局"}</h2><p className="mt-1 text-xs text-slate-300">共 {settlement.rounds} 回合 · {settlement.endReason === "surrender" ? "玩家退出认输" : settlement.endReason === "round_limit" ? "达到30回合上限" : settlement.endReason === "safety_limit" ? "连锁安全保护" : "卡牌全部下场"}</p></div>
      {battle.mode === "boss" && <p className="mt-3 rounded-xl bg-white/10 p-3 text-center text-sm text-amber-200">{!bossWon ? "本局未通关，无贝壳奖励" : battle.boss?.currentReward?.forfeited ? "你已主动退出本局，未获得奖励" : battle.boss?.currentReward?.granted ? `通关奖励 +${battle.boss.currentReward.amount} 贝壳，已到账` : battle.boss?.rewardClaimed ? "该房间奖励已领取，感谢协助通关" : "观战不参与通关奖励"}</p>}
      <div className="mt-4 space-y-4">{[...settlement.players].sort((left, right) => Number(right.seat === settlement.winnerSeat) - Number(left.seat === settlement.winnerSeat) || left.seat - right.seat).map((player) => <CardBattleSettlementTable key={player.userId} player={player} winnerSeat={settlement.winnerSeat} />)}</div>
      <p className="mt-3 text-[11px] leading-5 text-slate-400">评分 =（伤害 × 1.5 + 承伤 + 辅助 × 0.7）× 0.001，四舍五入保留 1 位小数。辅助按技能施放者累计有效治疗、增减益、复活及控制贡献，不计过量治疗与无效效果。</p>
      {battle.rankingChallenge && <div className="mt-4">
        {battle.rankingChallenge.fallbackRank && <p className="mb-3 rounded-xl bg-violet-400/15 p-3 text-sm font-bold text-violet-100">已使用本次对战卡组自动占据第 {battle.rankingChallenge.fallbackRank} 名，可继续调整卡组挑战更高排名。</p>}
        {battle.rankingChallenge.fallbackFull && <p className="mb-3 rounded-xl bg-white/10 p-3 text-sm text-slate-200">榜单 100 个位置已满，本次未自动占榜。</p>}
        {rankingWon
          ? <button type="button" className="min-h-12 w-full rounded-xl bg-amber-400 px-4 text-sm font-black text-slate-950 disabled:opacity-60" disabled={confirming} onClick={onConfirmRankingWin}>{confirming ? "确认中…" : `确认胜利并占据第 ${battle.rankingChallenge.targetRank} 名`}</button>
          : <button type="button" className="min-h-12 w-full rounded-xl bg-white/10 px-4 text-sm font-black text-white hover:bg-white/15" onClick={onClose}>返回调整卡组并重新准备</button>}
      </div>}
    </div>
  </div>;
}

export function CardBattleRoomView({ roomId, snapshot, rankingInvalidated: rankChangedByEvent = false, stickerSeries, stickersLoading, onReload, onReloadMessages, onOpenInvite, onOpenMembers, showToast }: Props) {
  const navigate = useNavigate();
  const battle = snapshot.room.cardBattle!;
  const [rankingChanged, setRankingChanged] = useState(false);
  const [rankingCloseError, setRankingCloseError] = useState("");
  const rankingInvalidated = rankChangedByEvent || rankingChanged || battle.rankingChallenge?.status === "stale";
  const isBoss = battle.mode === "boss";
  const lineupSize = isBoss ? 3 : 5;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [eligibleCards, setEligibleCards] = useState<OnlineCardBattleCard[]>([]);
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [cardQuery, setCardQuery] = useState("");
  const [cardRoleFilter, setCardRoleFilter] = useState<CardBattleRoleFilter>("all");
  const [cardSort, setCardSort] = useState<CardSort>("number");
  const [sortDescending, setSortDescending] = useState(false);
  const [cardView, setCardView] = useState<CardView>("stats");
  const [decksOpen, setDecksOpen] = useState(false);
  const [collectiblesOpen, setCollectiblesOpen] = useState(false);
  const [decks, setDecks] = useState<OnlineCardBattleDeck[]>([]);
  const [decksLoading, setDecksLoading] = useState(false);
  const [deckEditor, setDeckEditor] = useState<DeckEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const deckSavingRef = useRef(saving);
  deckSavingRef.current = saving;
  const closeDecks = useCallback(() => {
    if (!deckSavingRef.current) { setDecksOpen(false); setDeckEditor(null); }
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [content, setContent] = useState("");
  const [stickersOpen, setStickersOpen] = useState(false);
  const [chatBubbles, setChatBubbles] = useState<ChatBubble[]>([]);
  const [optimisticOwnIds, setOptimisticOwnIds] = useState<Array<string | null> | null>(null);
  const { playback, cardStates, activeEvent, animationDelayMs, syncing } = useServerCardBattlePlayback(roomId, rankingInvalidated ? null : battle.game, onReload);
  const arenaRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (arenaRef.current && activeEvent) seekCardBattleAnimations(arenaRef.current, animationDelayMs);
  }, [activeEvent, animationDelayMs, playback?.serverNow]);
  const [settlementDismissedGameId, setSettlementDismissedGameId] = useState<string | null>(null);
  const [watchedGameId, setWatchedGameId] = useState<string | null>(null);
  const [confirmingRankingWin, setConfirmingRankingWin] = useState(false);
  const onReloadRef = useRef(onReload);
  const bubbleRoomIdRef = useRef(roomId);
  const seenBubbleIdsRef = useRef(new Set(snapshot.messages.map((message) => message.id)));
  const allStickers = useMemo(() => stickerSeries.flatMap((series) => series.stickers), [stickerSeries]);
  const stickersById = useMemo(() => new Map(allStickers.map((sticker) => [sticker.id, sticker])), [allStickers]);
  const visibleEligibleCards = useMemo(() => {
    const filtered = filterCardBattleSelection(eligibleCards, cardQuery, cardRoleFilter);
    const direction = sortDescending ? -1 : 1;
    return [...filtered].sort((left, right) => {
      const compared = cardSort === "star"
        ? left.starLevel - right.starLevel
        : cardSort === "power"
          ? left.combatPower - right.combatPower
          : cardSort === "rarity"
            ? cardRarityRank[left.rarity] - cardRarityRank[right.rarity]
            : left.cardNo.localeCompare(right.cardNo, "zh-CN", { numeric: true });
      return compared * direction || left.name.localeCompare(right.name, "zh-CN");
    });
  }, [cardQuery, cardRoleFilter, cardSort, eligibleCards, sortDescending]);
  const enqueueChatBubbles = useCallback((messages: CardBattleChatMessage[]) => {
    const incoming = messages.filter((message) => {
      if (seenBubbleIdsRef.current.has(message.id)) return false;
      seenBubbleIdsRef.current.add(message.id);
      return !message.recalledAt && (message.type === "discussion" || message.type === "sticker");
    });
    if (!incoming.length) return;
    const expiresAt = Date.now() + 8000;
    setChatBubbles((current) => [...current, ...incoming.map((message) => ({ message, expiresAt }))].slice(-6));
  }, []);

  useEffect(() => { onReloadRef.current = onReload; }, [onReload]);

  useEffect(() => {
    if (bubbleRoomIdRef.current !== roomId) {
      bubbleRoomIdRef.current = roomId;
      seenBubbleIdsRef.current = new Set(snapshot.messages.map((message) => message.id));
      setChatBubbles([]);
      return;
    }
    enqueueChatBubbles(snapshot.messages);
  }, [enqueueChatBubbles, roomId, snapshot.messages]);
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
    if (!battle.me.seat) return;
    void api<{ cards: OnlineCardBattleCard[] }>(`/api/online-soup/rooms/${roomId}/card-battle/eligible-cards`, { bypassCache: true })
      .then((data) => setEligibleCards(data.cards)).catch((error) => showToast(error instanceof Error ? error.message : "可参战卡牌加载失败"));
  }, [battle.me.seat, roomId, showToast]);
  useEffect(() => {
    if (!decksOpen || !battle.me.seat) return;
    let cancelled = false;
    setDecksLoading(true);
    void api<{ decks: OnlineCardBattleDeck[] }>(`/api/online-soup/rooms/${roomId}/card-battle/decks`, { bypassCache: true })
      .then((data) => { if (!cancelled) setDecks(data.decks); })
      .catch((error) => { if (!cancelled) showToast(error instanceof Error ? error.message : "卡组加载失败"); })
      .finally(() => { if (!cancelled) setDecksLoading(false); });
    return () => { cancelled = true; };
  }, [battle.me.seat, decksOpen, roomId, showToast]);

  // A saved result on entry is history. Only a game observed in progress during
  // this room visit may open a settlement when its server timeline finishes.
  useEffect(() => {
    if (battle.phase === "playing" && battle.game?.status === "playing" && !battle.game.playback.complete) {
      setWatchedGameId(battle.game.id);
    }
  }, [battle.phase, battle.game?.id, battle.game?.status, battle.game?.playback.complete]);

  const currentSeat = battle.seats.find((seat) => seat.seat === battle.me.seat) ?? null;
  const serverOwnIds = currentSeat?.lineup.map((slot) => slot.card?.id ?? null) ?? [];
  const serverOwnIdsKey = serverOwnIds.map((cardId) => cardId ?? "").join("|");
  const ownIds = optimisticOwnIds ?? serverOwnIds;
  const ownBindings = battle.me.collectibleBindings ?? [];
  const animationComplete = Boolean(battle.game && playback?.complete);
  useEffect(() => {
    if (!optimisticOwnIds) return;
    const optimisticKey = optimisticOwnIds.map((cardId) => cardId ?? "").join("|");
    if (!battle.me.seat || optimisticKey === serverOwnIdsKey) setOptimisticOwnIds(null);
  }, [battle.me.seat, optimisticOwnIds, serverOwnIdsKey]);
  const ownCardsById = new Map<string, OnlineCardBattleCard>();
  for (const card of eligibleCards) ownCardsById.set(card.id, card);
  for (const item of currentSeat?.lineup ?? []) if (item.card) ownCardsById.set(item.card.id, item.card);
  const displaySeat = (seatNumber: 1 | 2 | 3) => {
    const current = battle.seats.find((seat) => seat.seat === seatNumber)!;
    const frozen = battle.game?.lineups.find((lineup) => isBoss ? lineup.playerSeat === seatNumber : lineup.seat === seatNumber);
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
  const bottomSeatNumber: 1 | 2 = !isBoss && battle.me.seat === 2 ? 2 : 1;
  const frozenBoss = battle.game?.lineups.find((lineup) => lineup.seat === 2);
  const bossSeat = { seat: 2 as const, user: { id: `boss:${roomId}`, nickname: "BOSS", avatar: null }, ready: false, lineup: !animationComplete && frozenBoss ? frozenBoss.cards.map((card, i) => ({ slot: i + 1, card, cardBack: false })) : battle.boss?.lineup.map((card, i) => ({ slot: i + 1, card, cardBack: false })) ?? [] };
  const topSeat = isBoss ? bossSeat : displaySeat(topSeatNumber);
  const bottomSeat = displaySeat(bottomSeatNumber);
  // The server can finish a game while a reconnecting/hidden client is still
  // replaying it. Keep that client locked until every mandatory animation has
  // completed, otherwise changing the lineup would effectively skip playback.
  const canConfigure = battle.phase !== "playing" && (!battle.game || animationComplete);
  useEffect(() => {
    if (!canConfigure || !battle.me.seat || currentSeat?.ready) setCollectiblesOpen(false);
  }, [canConfigure, battle.me.seat, currentSeat?.ready]);
  const bothPlayersReady = battle.seats.length === 2 && battle.seats.every((seat) => Boolean(seat.user && seat.ready));
  const showBattleControls = canConfigure && (Boolean(battle.me.seat) || snapshot.me.isHost);

  async function mutation(path: string, body?: unknown) {
    if (saving) return false;
    setSaving(true);
    try { await api(`/api/online-soup/rooms/${roomId}/${path}`, { method: path === "card-battle/lineup" ? "PUT" : "POST", ...(body === undefined ? {} : { body }) }); await onReload(); return true; }
    catch (error) { if (error instanceof ApiError && error.code === "RANK_CHANGED") setRankingChanged(true); else showToast(error instanceof Error ? error.message : "操作失败"); return false; }
    finally { setSaving(false); }
  }
  async function chooseCard(cardId: string) {
    if (pickSlot == null) return;
    const next = Array.from({ length: lineupSize }, (_, index) => ownIds[index] ?? null);
    const duplicate = next.findIndex((id) => id === cardId);
    if (duplicate >= 0) next[duplicate] = null;
    next[pickSlot - 1] = cardId;
    setPickSlot(null);
    setOptimisticOwnIds(next);
    if (!await mutation("card-battle/lineup", { cardIds: next })) setOptimisticOwnIds(null);
  }
  async function applyDeck(deck: OnlineCardBattleDeck) {
    if (saving || deck.collectiblesAvailable === false || deck.cardIds.length !== lineupSize || deck.cardIds.some((cardId) => !eligibleCards.some((card) => card.id === cardId))) {
      showToast("该卡组中有卡牌或收藏品已不可用，请编辑卡组后重试");
      return;
    }
    const next = [...deck.cardIds];
    setOptimisticOwnIds(next);
    const saved = await mutation("card-battle/lineup", { cardIds: next, collectibleBindings: deck.collectibleBindings ?? [] });
    if (!saved) setOptimisticOwnIds(null);
    else {
      setDecksOpen(false);
      setDeckEditor(null);
      showToast(`已选择卡组“${deck.name}”`);
    }
  }
  async function saveDeck(name: string, cardIds: string[], collectibleBindings: BattleCollectibleBinding[]) {
    if (saving) return;
    setSaving(true);
    try {
      const { deck } = await api<{ deck: OnlineCardBattleDeck }>(
        "/api/online-soup/rooms/" + roomId + "/card-battle/decks",
        { method: "POST", body: { name, cardIds, collectibleBindings } },
      );
      setDecks((current) => [deck, ...current]);
      setDeckEditor(null);
      showToast("当前卡组已保存");
    } finally { setSaving(false); }
  }
  async function reorderCards(fromSlot: number, toSlot: number) {
    if (!canConfigure || !battle.me.seat || currentSeat?.ready || saving) return false;
    const next = reorderCardBattleLineup(ownIds, fromSlot, toSlot, lineupSize);
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
    try {
      const result = await api<{ id: string }>(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: "discussion", content: value } });
      enqueueChatBubbles([{ id: result.id, senderId: battle.me.userId, senderName: snapshot.members.find((member) => member.id === battle.me.userId)?.nickname ?? "我", type: "discussion", content: value, stickerId: null, recalledAt: null }]);
      setContent("");
      await onReloadMessages().catch(() => undefined);
    }
    catch (error) { showToast(error instanceof Error ? error.message : "消息发送失败"); }
    finally { setSaving(false); }
  }
  async function sendSticker(sticker: StickerAsset) {
    setSaving(true);
    try {
      const result = await api<{ id: string }>(`/api/online-soup/rooms/${roomId}/messages`, { method: "POST", body: { type: "sticker", stickerId: sticker.id } });
      enqueueChatBubbles([{ id: result.id, senderId: battle.me.userId, senderName: snapshot.members.find((member) => member.id === battle.me.userId)?.nickname ?? "我", type: "sticker", content: "", stickerId: sticker.id, recalledAt: null }]);
      setStickersOpen(false);
      await onReloadMessages().catch(() => undefined);
    }
    catch (error) { showToast(error instanceof Error ? error.message : "表情发送失败"); }
    finally { setSaving(false); }
  }
  async function leaveRoom(close = false) {
    setSaving(true);
    try { await api(`/api/online-soup/rooms/${roomId}/${close ? "close" : "leave"}`, { method: "POST" }); const exit = cardBattleRoomExit(battle.rankingChallenge); navigate(exit.to, exit.options); }
    catch (error) { showToast(error instanceof Error ? error.message : "退出失败"); setSaving(false); }
  }
  async function confirmRankingWin() {
    if (!battle.rankingChallenge || confirmingRankingWin) return;
    setConfirmingRankingWin(true);
    try {
      await api(`/api/online-soup/rooms/${roomId}/card-battle/ranking/confirm-win`, { method: "POST" });
      showToast(`打榜成功，已占据第 ${battle.rankingChallenge.targetRank} 名`);
      const exit = cardBattleRoomExit(battle.rankingChallenge);
      navigate(exit.to, exit.options);
    } catch (error) {
      if (error instanceof ApiError && error.code === "RANK_CHANGED") {
        setRankingChanged(true);
        setConfirmingRankingWin(false);
        return;
      }
      showToast(error instanceof Error ? error.message : "胜利确认失败");
      setConfirmingRankingWin(false);
    }
  }

  async function acknowledgeRankingChange() {
    if (saving) return;
    setSaving(true); setRankingCloseError("");
    try {
      await api(`/api/online-soup/rooms/${roomId}/card-battle/ranking/acknowledge-change`, { method: "POST" });
      const exit = cardBattleRoomExit(true);
      navigate(exit.to, exit.options);
    } catch (error) {
      setRankingCloseError(error instanceof Error ? error.message : "关闭房间失败，请重试");
      setSaving(false);
    }
  }

  if (rankingInvalidated) return <div className="min-h-[100dvh] bg-[#071426]">
    <Modal hideClose onClose={() => undefined}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="ranking-changed-title" aria-describedby="ranking-changed-description" className="space-y-4 text-center">
        <h2 id="ranking-changed-title" className="text-xl font-black text-ink">打榜已结束</h2>
        <p id="ranking-changed-description" className="text-sm leading-6 text-muted">对方排名已发生变化，请重新打榜。</p>
        {rankingCloseError && <p role="alert" className="text-sm text-red-600">{rankingCloseError}</p>}
        <button type="button" autoFocus className="btn btn-primary min-h-12 w-full" disabled={saving} onClick={() => void acknowledgeRankingChange()}>{saving ? "关闭中…" : "确认"}</button>
      </div>
    </Modal>
  </div>;

  return <div className="card-battle-room flex h-[100dvh] flex-col overflow-hidden bg-[#071426] text-white">
    <header className="relative z-[100] flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-slate-950/90 px-3 backdrop-blur-xl">
      <UnifiedBackButton compactOnMobile onClick={() => setLeaveOpen(true)} />
      <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-black">{snapshot.room.name}</h1><p className="truncate text-[10px] text-slate-400">{battle.rankingChallenge ? `私密打榜 · 目标第 ${battle.rankingChallenge.targetRank} 名` : `房间号 ${snapshot.room.code} · ${isBoss ? "协作挑战 BOSS" : "卡牌对战 · 1v1"}`} · {!animationComplete && battle.game ? `第 ${activeEvent?.round ?? playback?.activeEvent?.round ?? 1} 回合` : battle.phase === "ended" ? "本局结束" : "准备中"}</p></div>
      <span className="hidden rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-slate-200 sm:inline">{battle.me.seat ? `对战席 ${battle.me.seat}` : "观战"}</span>
      {!battle.rankingChallenge && <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 text-cyan-100 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" aria-label="分享房间" title="分享房间" onClick={() => { setMenuOpen(false); onOpenInvite(); }}><Share2 size={19} /></button>}
      <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 text-cyan-100 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" aria-label={`房间成员，共 ${snapshot.members.length} 人`} title={`房间成员 · ${snapshot.members.length} 人`} onClick={() => { setMenuOpen(false); onOpenMembers(); }}><span className="relative grid h-7 w-7 place-items-center"><Users size={19} /><span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-cyan-500 px-1 text-[10px] font-black leading-4 text-slate-950 ring-2 ring-slate-950">{snapshot.members.length}</span></span></button>
      <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15" aria-label="更多操作" onClick={() => setMenuOpen((open) => !open)}><Menu size={19} /></button>
      {menuOpen && <div className="absolute right-3 top-[calc(100%+8px)] z-[110] w-48 overflow-hidden rounded-xl border border-white/10 bg-slate-900 p-1.5 shadow-2xl">
        {snapshot.me.isHost && !battle.rankingChallenge && <button className="card-battle-menu-item" onClick={() => { setMenuOpen(false); setModeOpen(true); }}><ChevronDown size={16} />选择玩法</button>}
        {canConfigure && !battle.rankingChallenge && <button className="card-battle-menu-item" disabled={saving || (!battle.me.seat && battle.seats.every((seat) => seat.user !== null))} onClick={() => { setMenuOpen(false); void mutation("card-battle/member-role", { role: battle.me.seat ? "spectator" : "player" }); }}>{battle.me.seat ? <Eye size={16} /> : <Swords size={16} />}{battle.me.seat ? "切换观战" : "切换对战"}</button>}
        {snapshot.me.isHost && <button className="card-battle-menu-item text-red-300" onClick={() => { setMenuOpen(false); battle.rankingChallenge ? setLeaveOpen(true) : setCloseOpen(true); }}>{battle.rankingChallenge ? <LogOut size={16} /> : <X size={16} />}{battle.rankingChallenge ? "退出打榜" : "关闭房间"}</button>}
        {!snapshot.me.isHost && <button className="card-battle-menu-item text-red-300" onClick={() => { setMenuOpen(false); setLeaveOpen(true); }}><LogOut size={16} />退出房间</button>}
      </div>}
    </header>

    <main className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={arenaRef} className={`card-battle-arena-scroll flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden ${showBattleControls ? "pb-[176px] sm:pb-[124px]" : "pb-[68px]"}`}>
        {isBoss && <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-slate-900 px-3 py-2 text-xs"><p className="flex-1 leading-5 text-slate-200">{battle.boss?.available ? `首次通关 +${battle.boss.rewardShells} 贝壳${battle.boss.rewardClaimed ? " · 你已领取" : ""} · 在席玩家全部准备即开战` : "房间已下架或不在开放时间内，进行中的对局正常结算"}</p><button type="button" className="min-h-11 shrink-0 rounded-xl bg-white/10 px-3 font-bold text-cyan-100" onClick={() => setDetailsOpen(true)}>查看阵容</button></div>}
        <HalfArena seat={isBoss ? 2 : topSeatNumber} battleSeat={topSeat} states={isBoss && canConfigure ? [] : cardStates} activeEvent={activeEvent} showPower={canConfigure} isOwn={false} position="top" canSelect={false} onPick={() => undefined} onReorder={async () => false} />
        <div className="relative z-30 flex h-8 shrink-0 items-center justify-center border-y border-cyan-300/30 bg-slate-950/90 text-[10px] font-black uppercase tracking-[.2em] text-cyan-200"><span>{syncing ? "正在同步服务器战斗进度…" : activeEvent?.text ?? (battle.phase === "playing" ? "自动战斗中 · 与服务器同步" : isBoss ? "每人前排 1 张 · 后排 2 张 · 全队共享前排保护" : "前排 2 张 · 后排 3 张")}</span></div>
        {isBoss ? <div className="card-battle-team-arena flex min-h-[244px] flex-1 divide-x divide-cyan-200/15" aria-label="玩家共同阵营，前排三张、后排六张">{([1, 2, 3] as const).map((personalSeat) => <HalfArena key={personalSeat} teamMember seat={1} battleSeat={displaySeat(personalSeat)} states={canConfigure ? [] : cardStates} activeEvent={activeEvent} showPower={canConfigure} isOwn={battle.me.seat === personalSeat} position="bottom" canSelect={canConfigure && battle.me.seat === personalSeat && !currentSeat?.ready && !saving} onPick={setPickSlot} onReorder={reorderCards} />)}</div> : <HalfArena seat={bottomSeatNumber} battleSeat={bottomSeat} states={cardStates} activeEvent={activeEvent} showPower={canConfigure} isOwn={Boolean(battle.me.seat)} position="bottom" canSelect={canConfigure && Boolean(battle.me.seat) && !currentSeat?.ready && !saving} onPick={setPickSlot} onReorder={reorderCards} />}
      </div>

      <div
        className="[--battle-controls-bottom:176px] sm:[--battle-controls-bottom:124px] pointer-events-none absolute inset-x-0 z-[60] flex h-[25%] max-h-60 flex-col justify-end gap-1.5 overflow-hidden px-3 pb-2 transition-[bottom] duration-200"
        style={{ bottom: `calc(${showBattleControls ? "var(--battle-controls-bottom, 176px)" : "68px"} + ${stickersOpen ? "15.5rem" : "0px"})` }}
        aria-live="polite"
        aria-label="实时聊天气泡"
      >
        {chatBubbles.map(({ message }) => {
          const mine = message.senderId === battle.me.userId;
          return <div key={message.id} className={`card-battle-chat-bubble max-w-[82%] rounded-2xl px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md ${mine ? "self-end bg-cyan-700/85" : "self-start bg-slate-950/80"}`}><strong className={`mr-1 ${mine ? "text-cyan-50" : "text-cyan-300"}`}>{message.senderName ?? "系统"}</strong>{message.type === "sticker" ? (() => { const sticker = message.stickerId ? stickersById.get(message.stickerId) : null; return sticker ? <img className="mt-1 h-14 w-14 object-contain" src={sticker.animatedUrl || sticker.staticUrl} alt={sticker.name} /> : "[表情]"; })() : message.content}</div>;
        })}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-[80] border-t border-white/10 bg-slate-950/90 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        {showBattleControls && <div className="mb-2 grid grid-cols-2 items-center gap-2 sm:flex">
          {battle.me.seat && <button type="button" className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-cyan-300/25 bg-white/10 px-2 text-xs font-black text-cyan-100 transition hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40" disabled={saving || currentSeat?.ready} onClick={() => setCollectiblesOpen(true)}><Gem size={16} />装配收藏品</button>}
          {battle.me.seat && <button type="button" className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-cyan-300/25 bg-white/10 px-2 text-xs font-black text-cyan-100 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40" disabled={saving || currentSeat?.ready} onClick={() => { setDeckEditor(null); setDecksOpen(true); }}><Layers size={16} />选择卡组</button>}
          {battle.me.seat && <button type="button" className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-black ${currentSeat?.ready ? "bg-amber-400 text-slate-950" : "bg-emerald-500 text-white"}`} disabled={saving || ownIds.filter(Boolean).length !== lineupSize || (isBoss && !battle.boss?.available)} onClick={() => void mutation("card-battle/ready", { ready: !currentSeat?.ready })}>{currentSeat?.ready ? "取消准备" : ownIds.filter(Boolean).length === lineupSize ? "准备" : `还需选择 ${lineupSize - ownIds.filter(Boolean).length} 张`}</button>}
          {snapshot.me.isHost && !isBoss && <button type="button" className="min-h-11 flex-1 rounded-xl bg-cyan-400 px-4 text-sm font-black text-slate-950 transition enabled:hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" disabled={saving || !bothPlayersReady} title={bothPlayersReady ? "双方已准备，可以开始战斗" : "双方均准备后才能开始战斗"} onClick={() => void mutation("start")}><Swords className="mr-1.5 inline" size={16} />开始战斗</button>}
        </div>}
        <div className="flex items-end gap-2"><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-white/10 text-cyan-200" onClick={() => setStickersOpen((open) => !open)} aria-label="发送表情"><Smile size={20} /></button><textarea rows={1} maxLength={1000} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} className="min-h-11 max-h-24 flex-1 resize-none rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 text-base sm:text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400" placeholder="聊天或发表情…" /><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40" disabled={!content.trim() || saving} onClick={() => void sendMessage()} aria-label="发送消息"><Send size={18} /></button></div>
        {stickersOpen && <StickerKeyboard series={stickerSeries} loading={stickersLoading} sending={saving} onClose={() => setStickersOpen(false)} onSend={sendSticker} className="mt-2 max-h-60 overflow-y-auto rounded-xl p-2 text-slate-900" />}
      </div>

      {battle.phase === "ended" && animationComplete && battle.game?.settlement && watchedGameId === battle.game.id && settlementDismissedGameId !== battle.game.id && <Settlement battle={battle} onClose={() => setSettlementDismissedGameId(battle.game!.id)} onConfirmRankingWin={() => void confirmRankingWin()} confirming={confirmingRankingWin} />}
    </main>

    {detailsOpen && <BossLineupDetails groups={[{ name: "BOSS", cards: topSeat.lineup.flatMap((item) => item.card ? [item.card] : []) }, ...([1, 2, 3] as const).map((seat) => { const member = displaySeat(seat); return { name: member.user?.nickname ?? `空席 ${seat}`, cards: member.lineup.flatMap((item) => item.card ? [item.card] : []) }; })]} onClose={() => setDetailsOpen(false)} />}
    {collectiblesOpen && canConfigure && battle.me.seat && !currentSeat?.ready && <BattleCollectiblePicker
      cards={ownIds.map((id) => id ? ownCardsById.get(id) ?? null : null)} bindings={ownBindings} disabled={saving}
      onSave={(collectibleBindings) => mutation("card-battle/lineup", { cardIds: ownIds, collectibleBindings })}
      onClose={() => setCollectiblesOpen(false)} />}
    {decksOpen && <Modal full onClose={closeDecks}>
      {deckEditor ? <>
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-ink">保存当前卡组</h2><button type="button" className="btn btn-secondary min-h-11 min-w-11" disabled={saving} onClick={() => setDeckEditor(null)} aria-label="返回卡组列表"><X size={18} /></button></div>
        <CardBattleDeckEditor cards={eligibleCards} initialDeck={deckEditor} lineupSize={lineupSize} actionLabel="保存卡组" onSave={saveDeck} />
      </> : <>
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">选择卡组</h2><p className="mt-1 text-xs text-muted">使用卡组会恢复保存的 {lineupSize} 个卡位及收藏品绑定。</p></div><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100" disabled={saving} onClick={() => setDecksOpen(false)} aria-label="关闭"><X size={18} /></button></div>
        <button type="button" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-black text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" disabled={saving || ownIds.filter(Boolean).length !== lineupSize} onClick={() => setDeckEditor({ name: `我的卡组 ${decks.length + 1}`, cardIds: ownIds.filter((cardId): cardId is string => Boolean(cardId)), collectibleBindings: [...ownBindings] })}><Save size={17} />保存当前卡组</button>
        {ownIds.filter(Boolean).length !== lineupSize && <p className="mt-2 text-center text-xs text-muted">选满 {lineupSize} 张卡牌后即可保存当前卡组</p>}
        <div className="mt-5 space-y-3">{decks.map((deck) => {
          const availableCards = deck.cardIds.map((cardId) => { const card = eligibleCards.find((c) => c.id === cardId); return card ? battleCardWithCollectible(card, battleDeckCollectible(deck, cardId)) : null; });
          const available = deck.collectiblesAvailable !== false && deck.cardIds.length === lineupSize && availableCards.every(Boolean);
          const totalPower = availableCards.reduce((sum, card) => sum + (card?.combatPower ?? 0), 0);
          return <article key={deck.id} className="rounded-2xl border border-line bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-black text-ink">{deck.name}</h3><p className={`mt-1 text-[11px] font-bold ${available ? "text-amber-600" : "text-red-600"}`}>{available ? `总战力 ${combatPowerFormatter.format(totalPower)}` : "含有当前不可用的卡牌或收藏品"}</p></div></div>
            <div className={`mt-3 grid ${isBoss ? "grid-cols-3" : "grid-cols-5"} gap-2`}>{availableCards.map((card, index) => <div key={`${deck.cardIds[index] ?? "empty"}-${index}`} className="min-w-0 text-center"><div className="relative aspect-[5/7] overflow-hidden rounded-lg border border-line bg-slate-100">{card ? <img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full place-items-center text-[9px] font-bold text-slate-400">不可用</span>}<span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-950/75 text-[9px] font-black text-white">{index + 1}</span></div><p className="mt-1 truncate text-[10px] font-bold text-amber-700" title={card?.collectible?.name}>{card?.collectible?.name}</p><p className="mt-1 truncate text-[9px] font-bold text-muted">{card?.name ?? "未知卡牌"}</p></div>)}</div>
            <CardBattleDeckActions deck={deck} cards={eligibleCards} lineupSize={lineupSize} apiPath={"/api/online-soup/rooms/" + roomId + "/card-battle/decks"} disabled={saving}
              currentLineup={{ cardIds: ownIds.filter((id): id is string => Boolean(id)), collectibleBindings: ownBindings }}
              onChanged={(updated) => setDecks((current) => current.map((item) => item.id === updated.id ? updated : item))}
              onDeleted={(id) => setDecks((current) => current.filter((item) => item.id !== id))} onBusyChange={setSaving} showToast={showToast} />
            <button type="button" className="mt-3 min-h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" disabled={saving || !available} onClick={() => void applyDeck(deck)}>使用此卡组</button>
          </article>;
        })}</div>
        {decksLoading && <p className="py-10 text-center text-sm text-muted" role="status">卡组加载中…</p>}
        {!decksLoading && decks.length === 0 && <div className="py-10 text-center"><Layers className="mx-auto text-slate-300" size={36} /><p className="mt-3 text-sm font-bold text-muted">还没有保存的卡组</p></div>}
      </>}
    </Modal>}
    {pickSlot != null && <Modal full onClose={() => setPickSlot(null)}>
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">选择第 {pickSlot} 张卡牌</h2><p className="mt-1 text-xs text-muted">只展示你拥有且当前启用的史诗或传说卡；支持搜索、排序和视角切换。</p></div><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100" onClick={() => setPickSlot(null)} aria-label="关闭"><X size={18} /></button></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_44px]">
        <label className="relative block"><span className="sr-only">搜索卡牌</span><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input type="search" value={cardQuery} onChange={(event) => setCardQuery(event.target.value)} className="field min-h-11 w-full pl-10" placeholder="搜索卡牌名称、序号或定位" autoFocus /></label>
        <label><span className="sr-only">卡牌排序方式</span><select value={cardSort} onChange={(event) => { const next = event.target.value as CardSort; setCardSort(next); setSortDescending(next !== "number"); }} className="field min-h-11 w-full"><option value="number">按序号排序</option><option value="rarity">按品质排序</option><option value="star">按星级排序</option><option value="power">按战力排序</option></select></label>
        <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-line bg-white text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" onClick={() => setSortDescending((value) => !value)} aria-label={sortDescending ? "当前降序，点击切换为升序" : "当前升序，点击切换为降序"} title={sortDescending ? "降序" : "升序"}><ArrowUpDown size={18} /></button>
      </div>
      <label className="mt-3 flex items-center gap-3 text-sm font-bold text-ink"><span className="shrink-0">卡牌定位</span><select value={cardRoleFilter} onChange={(event) => setCardRoleFilter(event.target.value as CardBattleRoleFilter)} className="field min-h-11 min-w-0 flex-1"><option value="all">全部</option><option value="damage">输出</option><option value="tank">坦克</option><option value="support">辅助</option></select></label>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-muted" aria-live="polite">共 {visibleEligibleCards.length} 张卡牌</p>
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="卡牌信息视角">
          <button type="button" aria-pressed={cardView === "stats"} onClick={() => setCardView("stats")} className={`min-h-11 min-w-16 rounded-lg px-3 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${cardView === "stats" ? "bg-white text-cyan-700 shadow-sm" : "text-muted hover:text-ink"}`}>数值</button>
          <button type="button" aria-pressed={cardView === "skill"} onClick={() => setCardView("skill")} className={`min-h-11 min-w-16 rounded-lg px-3 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${cardView === "skill" ? "bg-white text-cyan-700 shadow-sm" : "text-muted hover:text-ink"}`}>技能</button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{visibleEligibleCards.map((card) => {
        const selected = ownIds.includes(card.id);
        const viewLabel = cardView === "stats"
          ? `生命${card.stats.maxHp}，攻击${card.stats.attack}，防御${card.stats.defense}，速度${card.stats.speed}，能量${card.stats.energyRequired}，暴击率${card.stats.critRate ?? 25}%，暴击伤害${card.stats.critDamage ?? 150}%，吸血比例${card.stats.lifestealRate ?? 0}%，击晕概率${card.stats.stunRate ?? 0}%，再动概率${card.stats.extraActionRate ?? 0}%，闪避率${card.stats.dodgeRate ?? 0}%，命中率${card.stats.hitRate ?? 0}%`
          : `技能${card.skillName || "未配置技能"}，技能描述${card.skillDescription || "暂无技能说明"}`;
        return <button key={card.id} type="button" aria-pressed={selected} aria-label={`${card.name}，${card.starLevel}星，战力${card.combatPower}，${CARD_BATTLE_ROLE_LABELS[card.battleRole]}，${viewLabel}${selected ? "，已上场" : ""}`} className={`relative overflow-hidden rounded-xl border-2 bg-white text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${selected ? "border-cyan-500 ring-2 ring-cyan-200" : "border-line hover:border-cyan-300"}`} onClick={() => void chooseCard(card.id)}>
          <div className="relative aspect-[5/7] overflow-hidden bg-slate-100"><img className="h-full w-full object-cover" src={card.imageUrl} alt={card.name} loading="lazy" decoding="async" /><span className={`absolute left-2 top-2 rounded-full border px-2 py-1 text-[10px] font-black shadow-md backdrop-blur-sm ${battleRoleTone(card.battleRole)}`}>{CARD_BATTLE_ROLE_LABELS[card.battleRole]}</span><span className="absolute bottom-2 right-2 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-black text-slate-950 shadow-md">战力 {combatPowerFormatter.format(card.combatPower)}</span></div>
          <div className="min-h-[128px] p-2"><p className="truncate text-xs font-black text-ink">{card.name} · {card.starLevel}★</p><p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">序号 {card.cardNo}</p>{cardView === "skill"
            ? <div className="mt-2"><p className="text-xs font-black leading-5 text-cyan-700">{card.skillName || "未配置技能"}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{card.skillDescription || "暂无技能说明"}</p></div>
            : <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs leading-5 text-muted"><div className="flex justify-between gap-1"><dt>生命</dt><dd className="font-bold text-ink">{card.stats.maxHp}</dd></div><div className="flex justify-between gap-1"><dt>攻击</dt><dd className="font-bold text-ink">{card.stats.attack}</dd></div><div className="flex justify-between gap-1"><dt>防御</dt><dd className="font-bold text-ink">{card.stats.defense}</dd></div><div className="flex justify-between gap-1"><dt>速度</dt><dd className="font-bold text-ink">{card.stats.speed}</dd></div><div className="col-span-2 flex justify-between gap-1"><dt>能量</dt><dd className="font-bold text-ink">{card.stats.energyRequired}</dd></div><div className="flex justify-between gap-1"><dt>暴击率</dt><dd className="font-bold text-ink">{card.stats.critRate ?? 25}%</dd></div><div className="flex justify-between gap-1"><dt>暴击伤害</dt><dd className="font-bold text-ink">{card.stats.critDamage ?? 150}%</dd></div><div className="flex justify-between gap-1"><dt>吸血比例</dt><dd className="font-bold text-ink">{card.stats.lifestealRate ?? 0}%</dd></div><div className="flex justify-between gap-1"><dt>击晕概率</dt><dd className="font-bold text-ink">{card.stats.stunRate ?? 0}%</dd></div><div className="flex justify-between gap-1"><dt>再动概率</dt><dd className="font-bold text-ink">{card.stats.extraActionRate ?? 0}%</dd></div><div className="flex justify-between gap-1"><dt>闪避率</dt><dd className="font-bold text-ink">{card.stats.dodgeRate ?? 0}%</dd></div><div className="flex justify-between gap-1"><dt>命中率</dt><dd className="font-bold text-ink">{card.stats.hitRate ?? 0}%</dd></div></dl>}
          </div>{selected && <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-cyan-500 text-white shadow-md" aria-hidden="true"><Check size={15} /></span>}
        </button>;
      })}</div>
      {visibleEligibleCards.length === 0 && <p className="py-10 text-center text-sm text-muted">{eligibleCards.length ? "没有找到匹配的卡牌" : "当前没有可参战的史诗或传说卡"}</p>}
    </Modal>}
    {modeOpen && <Modal onClose={() => setModeOpen(false)}><div><h2 className="text-xl font-black text-ink">选择玩法</h2><button type="button" className="mt-4 flex min-h-14 w-full items-center justify-between rounded-xl border-2 border-primary bg-blue-50 px-4 text-left text-primary"><span><strong className="block">1v1</strong><span className="text-xs">双方各选择五张卡牌自动战斗</span></span><Check /></button><p className="mt-3 text-xs text-muted">暂时只开放 1v1，后续玩法不会影响本局规则。</p></div></Modal>}
    {leaveOpen && <Modal onClose={() => setLeaveOpen(false)}><div><h2 className="text-xl font-black text-ink">{battle.rankingChallenge ? "退出打榜？" : "退出房间？"}</h2><p className="mt-2 text-sm leading-6 text-muted">{isBoss ? "主动退出会放弃你本局的通关奖励；你的卡牌会继续为团队战斗。断线或关闭页面不视为主动退出。观战者退出不影响对局。" : battle.rankingChallenge ? "对局中退出视为认输；临时打榜房间会立即解散，本次挑战不会改变榜单。" : "对局中对战者退出即认输，对手获胜；重新进入不会继续播放本局动画。观战者退出不影响对局。"}</p><div className="mt-5 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setLeaveOpen(false)}>取消</button><button className="btn bg-red-600 text-white" disabled={saving} onClick={() => void leaveRoom(false)}>确认退出</button></div></div></Modal>}
    {closeOpen && <Modal onClose={() => setCloseOpen(false)}><div><h2 className="text-xl font-black text-ink">关闭房间？</h2><p className="mt-2 text-sm leading-6 text-muted">房间关闭后所有成员退出；进行中的对局会标记为中止，不生成胜负结算。</p><div className="mt-5 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setCloseOpen(false)}>取消</button><button className="btn bg-red-600 text-white" disabled={saving} onClick={() => void leaveRoom(true)}>关闭房间</button></div></div></Modal>}
  </div>;
}
