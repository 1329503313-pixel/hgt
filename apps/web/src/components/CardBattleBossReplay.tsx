import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { Modal } from "./Modal";
import { HalfArena } from "./CardBattleRoomView";
import { CardBattleSettlementTable } from "./CardBattleSettlementTable";
import { seekCardBattleAnimations } from "../shared/cardBattlePlayback";
import type { BossReplay } from "../shared/cardBattleBoss";

export function CardBattleBossReplay({ replay, onClose }: { replay: BossReplay; onClose: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const arenaRef = useRef<HTMLDivElement>(null);
  const timeline = useMemo(() => { let time = 0; return replay.result.events.map((event) => { const start = time; time += event.durationMs; return { event, start, end: time }; }); }, [replay]);
  const duration = timeline.at(-1)?.end ?? 0;
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
  const boss = replay.lineups.find((lineup) => lineup.seat === 2)!;
  return <Modal full onClose={onClose}><button className="float-right grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100 text-ink" onClick={onClose} aria-label="关闭回放"><X size={18} /></button><h2 className="pr-10 text-xl font-black text-ink">{replay.name} · 第 {replay.gameNumber} 局回放</h2><p className="mt-1 text-sm text-muted">{replay.result.winnerSeat === 1 ? "通关成功" : "挑战失败"} · {replay.result.rounds} 回合</p>
    <div className="my-3 flex flex-wrap items-center gap-2"><button className="btn btn-primary" onClick={() => { if (elapsed >= duration) setElapsed(0); setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? "暂停" : "播放"}</button><button className="btn btn-secondary" onClick={() => { setElapsed(0); setPlaying(false); }}><RotateCcw size={16} />重播</button><label className="min-w-32 flex-1 text-xs text-muted">回放进度 {Math.floor(elapsed / 1000)} / {Math.ceil(duration / 1000)} 秒<input aria-label="回放进度" className="mt-1 min-h-8 w-full" type="range" min={0} max={duration} step={50} value={elapsed} onChange={(e) => setElapsed(Number(e.target.value))} /></label></div>
    <div ref={arenaRef} className="overflow-hidden rounded-xl bg-[#071426] text-white">
      <HalfArena seat={2} battleSeat={seat(boss)} states={states} activeEvent={active?.event ?? null} showPower={false} isOwn={false} position="top" canSelect={false} onPick={() => {}} onReorder={async () => false} />
      <p className="relative z-30 min-h-10 border-y border-white/10 bg-slate-950 px-3 py-2 text-center text-xs text-cyan-100">{active?.event.text ?? "回放结束"}</p>
      <div className="flex min-h-[244px] divide-x divide-white/10">{replay.lineups.filter((lineup) => lineup.seat === 1).map((lineup) => <HalfArena key={lineup.userId} teamMember seat={1} battleSeat={seat(lineup)} states={states} activeEvent={active?.event ?? null} showPower={false} isOwn={false} position="bottom" canSelect={false} onPick={() => {}} onReorder={async () => false} />)}</div>
    </div>
    <div className="mt-4 space-y-3 rounded-xl bg-slate-900 p-3 text-white">{replay.result.players.map((player) => <CardBattleSettlementTable key={player.userId} player={player} winnerSeat={replay.result.winnerSeat} />)}</div>
  </Modal>;
}
