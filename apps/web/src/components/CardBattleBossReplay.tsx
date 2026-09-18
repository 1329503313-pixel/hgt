import { CardBattleFxProvider, CardBattleFxQualityControl } from "./CardBattleFxContext";
import { CardBattleArenaFx } from "./CardBattleArenaFx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { Modal } from "./Modal";
import { HalfArena } from "./CardBattleRoomView";
import { CardBattleSettlementTable } from "./CardBattleSettlementTable";
import { readableCardBattleEvent, seekCardBattleAnimations } from "../shared/cardBattlePlayback";
import type { BossReplay } from "../shared/cardBattleBoss";

export function CardBattleBossReplay({ replay, onClose, userReplay = false, settlementOnly = false, viewerId }: { replay: BossReplay; onClose: () => void; userReplay?: boolean; settlementOnly?: boolean; viewerId?: string }) {
  const [playing, setPlaying] = useState(userReplay && !settlementOnly);
  const [elapsed, setElapsed] = useState(0);
  const arenaRef = useRef<HTMLDivElement>(null);
  const timeline = useMemo(() => { let time = 0; return replay.result.events.map(readableCardBattleEvent).map((event) => { const start = time; time += event.durationMs; return { event, start, end: time }; }); }, [replay]);
  const duration = timeline.at(-1)?.end ?? 0;
  const finished = settlementOnly || elapsed >= duration;
  const activeIndex = timeline.findIndex((entry) => elapsed < entry.end);
  const active = timeline[activeIndex];
  const offset = active ? Math.max(0, elapsed - active.start) : 0;
  const states = !active ? replay.result.finalStates : offset >= Math.max(120, Math.round(active.event.durationMs * .55)) ? active.event.states : timeline[activeIndex - 1]?.event.states ?? replay.result.initialStates;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => { const now = performance.now(); const delta = now - last; last = now; setElapsed((current) => Math.min(duration, current + delta)); }, 50);
    return () => window.clearInterval(timer);
  }, [playing, duration]);
  useEffect(() => { if (elapsed >= duration) setPlaying(false); }, [elapsed, duration]);
  useLayoutEffect(() => {
    if (!arenaRef.current) return;
    seekCardBattleAnimations(arenaRef.current, offset);
    if (!playing) for (const animation of arenaRef.current.getAnimations({ subtree: true })) animation.pause();
  }, [activeIndex, offset, playing]);
  const seat = (lineup: BossReplay["lineups"][number]) => ({ seat: lineup.playerSeat ?? lineup.seat, user: { id: lineup.userId, nickname: lineup.nickname, avatar: null }, ready: false, lineup: lineup.cards.map((card, i) => ({ slot: i + 1, card, cardBack: false })) });
  const ownSeat = replay.lineups.find(lineup=>lineup.userId===viewerId)?.seat ?? 1;
  const opponent = replay.lineups.find(lineup=>lineup.seat!==ownSeat)!;
  const ownTeam = replay.lineups.filter(lineup=>lineup.seat===ownSeat);
  return <CardBattleFxProvider gameId={replay.gameId} event={active?.event ?? null} elapsedMs={offset} playing={playing}><Modal full onClose={onClose}><div className="sticky top-0 z-[70] mb-3 flex items-center justify-between gap-2 bg-white py-2"><h2 className="min-w-0 text-lg font-black text-ink">{replay.name} · {userReplay && finished?'结算结果':`第 ${replay.gameNumber} 局回放`}</h2><div className="flex shrink-0 items-center gap-2">{userReplay && !finished && <button className="btn btn-secondary min-h-11" onClick={()=>{setElapsed(duration);setPlaying(false);}}>跳过动画</button>}<button className="grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100 text-ink" onClick={onClose} aria-label="关闭回放"><X size={18} /></button></div></div><CardBattleFxQualityControl /><p className="mb-3 text-sm text-muted">{replay.result.rounds} 回合</p>
    {!userReplay && <div className="my-3 flex flex-wrap items-center gap-2"><button className="btn btn-primary" onClick={() => { if (elapsed >= duration) setElapsed(0); setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? "暂停" : "播放"}</button><button className="btn btn-secondary" onClick={() => { setElapsed(0); setPlaying(false); }}><RotateCcw size={16} />重播</button><label className="min-w-32 flex-1 text-xs text-muted">回放进度 {Math.floor(elapsed / 1000)} / {Math.ceil(duration / 1000)} 秒<input aria-label="回放进度" className="mt-1 min-h-8 w-full" type="range" min={0} max={duration} step={50} value={elapsed} onChange={(e) => setElapsed(Number(e.target.value))} /></label></div>}
    {(!userReplay || !finished) && <div ref={arenaRef} data-battle-arena className="relative overflow-hidden rounded-xl bg-[#071426] text-white">
      <HalfArena seat={opponent.seat} battleSeat={seat(opponent)} states={states} activeEvent={active?.event ?? null} showPower={false} isOwn={false} position="top" canSelect={false} onPick={() => {}} onReorder={async () => false} />
      <div className="card-battle-event-notice" role="status">{active?.event.skillName && <strong>{active.event.skillName}</strong>}<span>{active?.event.text ?? "回放结束"}</span></div>
      <div className="grid min-h-[244px] divide-x divide-white/10" style={{gridTemplateColumns:`repeat(${ownTeam.length},minmax(0,1fr))`}}>{ownTeam.map((lineup) => <HalfArena key={lineup.userId} teamMember={ownTeam.length>1 || lineup.cards.length===3} seat={lineup.seat} battleSeat={seat(lineup)} states={states} activeEvent={active?.event ?? null} showPower={false} isOwn={false} position="bottom" canSelect={false} onPick={() => {}} onReorder={async () => false} />)}</div>
      <CardBattleArenaFx event={active?.event ?? null} />
    </div>}
    {(!userReplay || finished) && <div className="mt-4 space-y-3 rounded-xl bg-slate-900 p-3 text-white">{replay.result.players.map((player) => <CardBattleSettlementTable key={player.userId} player={player} winnerSeat={replay.result.winnerSeat} />)}</div>}
  </Modal></CardBattleFxProvider>;
}
