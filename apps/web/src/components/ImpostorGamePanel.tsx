import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Eye, LoaderCircle, Moon, Shield, ShieldCheck, ShieldOff, Sun, UserRoundSearch, Users, VenetianMask, Vote, XCircle } from "lucide-react";
import { api } from "../api";
import type { OnlineImpostorGame, OnlineSoupSnapshot } from "../shared/types";
import { Modal } from "./Modal";

type Member = OnlineSoupSnapshot["members"][number];

type Props = {
  roomId: string;
  game: OnlineImpostorGame | null;
  members: Member[];
  currentUserId: string;
  currentMemberRole: OnlineSoupSnapshot["me"]["role"];
  isHost: boolean;
  onChanged: () => void | Promise<void>;
  showToast: (message: string) => void;
};

const phaseLabel: Record<OnlineImpostorGame["phase"], string> = {
  night: "夜间行动",
  clue: "留下线索",
  day_vote: "任务人选投票",
  mission: "执行任务",
  assassination: "伪人刺杀",
  accusation: "最终指认",
  ended: "本局结束",
};

const actionLabel = {
  chaos: "混乱",
  isolate: "隔离",
  guard: "守护",
  investigate: "调查",
  skip: "跳过",
} as const;

function formatRemaining(deadlineAt: string | null, now: number) {
  if (!deadlineAt) return "--:--";
  const seconds = Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ImpostorGamePanel({ roomId, game, members, currentUserId, currentMemberRole, isHost, onChanged, showToast }: Props) {
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [selectedAction, setSelectedAction] = useState<keyof typeof actionLabel | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [clue, setClue] = useState("");
  const [terminateOpen, setTerminateOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSelectedAction(null);
    setSelectedTargets([]);
    setClue("");
  }, [game?.gameNumber, game?.phase, game?.day, game?.nomination?.attempt, game?.accusation?.attempt]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const playerMembers = members.filter((member) => member.role === "player");
  const seatById = useMemo(() => new Map(game?.playerSeats.map((seat) => [seat.userId, seat.seat]) ?? []), [game?.playerSeats]);
  const playerName = (userId: string) => `${seatById.get(userId) ?? "?"}号 ${memberById.get(userId)?.nickname ?? "已离开玩家"}`;

  async function submit(path: string, body?: unknown) {
    if (saving) return;
    setSaving(true);
    try {
      await api(`/api/online-soup/rooms/${roomId}/${path}`, { method: "POST", ...(body === undefined ? {} : { body }) });
      await onChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  function toggleTarget(userId: string, limit: number) {
    setSelectedTargets((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : current.length < limit ? [...current, userId] : [...current.slice(1), userId]);
  }

  if (!game) {
    const canStart = playerMembers.length >= 4 && playerMembers.length <= 6;
    return <section className="card flex min-h-0 flex-col overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700"><VenetianMask size={24} /></span>
        <div className="min-w-0"><h2 className="font-black text-ink">谁是伪人</h2><p className="mt-0.5 text-xs leading-5 text-muted">4–6 名游戏者，系统秘密发放身份</p></div>
      </div>
      <div className="mt-4 rounded-xl border border-line bg-slate-50 p-3">
        <div className="flex items-center justify-between text-sm"><span className="inline-flex items-center gap-1.5 font-bold text-muted"><Users size={16} />游戏者</span><strong className="tabular-nums text-ink">{playerMembers.length}/6</strong></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-violet-500 transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${playerMembers.length / 6 * 100}%` }} /></div>
        <p className={`mt-2 text-xs font-bold ${canStart ? "text-emerald-700" : "text-amber-700"}`}>{canStart ? "人数已满足，可以开始游戏" : `还需要 ${Math.max(0, 4 - playerMembers.length)} 名游戏者`}</p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-xl bg-blue-50 p-2 text-blue-700"><Eye className="mx-auto" size={18} /><strong className="mt-1 block">侦探 ×1</strong></div>
        <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Shield className="mx-auto" size={18} /><strong className="mt-1 block">平民</strong></div>
        <div className="rounded-xl bg-rose-50 p-2 text-rose-700"><VenetianMask className="mx-auto" size={18} /><strong className="mt-1 block">伪人 ×1</strong></div>
      </div>
      {currentMemberRole !== "admin" && <button type="button" className="btn btn-secondary mt-4 min-h-11 w-full" disabled={saving || (currentMemberRole === "spectator" && playerMembers.length >= 6)} onClick={() => void submit("impostor/member-role", { role: currentMemberRole === "player" ? "spectator" : "player" })}>{currentMemberRole === "player" ? "切换为旁观者" : playerMembers.length >= 6 ? "游戏者席位已满" : "切换为游戏者"}</button>}
      {isHost && <button type="button" className="btn btn-primary mt-2 min-h-11 w-full" disabled={saving || !canStart} onClick={() => void submit("start")}>{saving ? <LoaderCircle size={17} className="animate-spin" /> : <VenetianMask size={17} />}开始游戏</button>}
    </section>;
  }

  const me = game.me;
  const missionMember = game.missionTeamUserIds.includes(currentUserId);
  const nomination = game.nomination;
  const accusation = game.accusation;
  const roleTone = me?.role === "impostor" ? "border-rose-200 bg-rose-50 text-rose-800" : me?.role === "detective" ? "border-blue-200 bg-blue-50 text-blue-800" : "border-emerald-200 bg-emerald-50 text-emerald-800";
  const roleIcon = me?.role === "impostor" ? <VenetianMask size={18} /> : me?.role === "detective" ? <Eye size={18} /> : <Shield size={18} />;

  const actionTargetLimit = selectedAction === "investigate" ? 2 : 1;
  const actionTargets = game.playerSeats.filter(({ userId }) => {
    if (selectedAction === "guard") return true;
    return userId !== currentUserId;
  });

  return <section className="card flex min-h-0 flex-col overflow-hidden">
    <div className="shrink-0 border-b border-line bg-slate-950 px-4 py-3 text-white">
      <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10">{game.phase === "night" ? <Moon size={19} /> : <Sun size={19} />}</span><div><p className="text-[11px] font-bold text-slate-300">第 {game.day} 天 · 第 {game.gameNumber} 局</p><h2 className="font-black">{phaseLabel[game.phase]}</h2></div>{game.deadlineAt && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-mono text-xs font-black tabular-nums"><Clock3 size={13} />{formatRemaining(game.deadlineAt, now)}</span>}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black"><div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-emerald-300">任务成功 {game.successes}/3</div><div className="rounded-lg bg-rose-500/15 px-3 py-2 text-rose-300">任务失败 {game.failures}/3</div></div>
    </div>

    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
      {me ? <div className={`flex items-center gap-2 rounded-xl border p-3 ${roleTone}`}>{roleIcon}<div><p className="text-[11px] font-bold opacity-75">你的秘密身份 · {me.seat}号</p><p className="font-black">{me.roleLabel}</p></div></div> : <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-muted">你正在旁观，只能看到公开的对局信息。</div>}

      {game.isolatedUserIds.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p className="flex items-center gap-1.5 font-black"><ShieldOff size={16} />今日隔离</p><p className="mt-1 leading-6">{game.isolatedUserIds.map(playerName).join("、")}不可成为任务候选人。</p></div>}

      {me?.investigation && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><p className="font-black">第一夜调查结果</p><p className="mt-1 leading-6">{me.investigation.targetUserIds.map(playerName).join(" 与 ")}中{me.investigation.reportedHasImpostor ? "有" : "没有"}伪人。</p></div>}

      {game.phase === "night" && <>
        <p className="text-sm font-black text-ink">夜间行动</p>
        {!me ? <p className="text-sm text-muted">等待游戏者秘密行动。</p> : me.nightSubmitted ? <StatusNotice text="夜间行动已提交，等待其他玩家" /> : me.nightActionTypes.length === 0 ? <StatusNotice text="本夜没有行动资格" /> : <>
          <div className="grid grid-cols-2 gap-2">{me.nightActionTypes.map((action) => <button key={action} type="button" aria-pressed={selectedAction === action} className={`btn segmented-choice min-h-11 ${selectedAction === action ? "btn-primary" : "btn-secondary"}`} onClick={() => { setSelectedAction(action); setSelectedTargets([]); }}>{actionLabel[action]}</button>)}</div>
          {selectedAction && selectedAction !== "skip" && <TargetGrid items={actionTargets} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, actionTargetLimit)} />}
          {selectedAction && <button type="button" className="btn btn-primary min-h-11 w-full" disabled={saving || (selectedAction !== "skip" && selectedTargets.length !== actionTargetLimit)} onClick={() => void submit("impostor/night-action", { type: selectedAction, targetUserIds: selectedAction === "skip" ? [] : selectedTargets })}>{saving ? "提交中…" : selectedAction === "skip" ? "确认跳过" : `确认使用${actionLabel[selectedAction]}`}</button>}
        </>}
      </>}

      {game.phase === "clue" && <>{me ? me.clueSubmitted ? <StatusNotice text="线索已提交，等待统一公开" /> : <div><label htmlFor="impostor-clue" className="text-sm font-black text-ink">留下匿名身份线索</label><textarea id="impostor-clue" className="field mt-2 min-h-20 w-full resize-none text-base" value={clue} onChange={(event) => setClue(Array.from(event.target.value).slice(0, 10).join(""))} placeholder="最多10个字，也可以跳过" /><div className="mt-2 grid grid-cols-2 gap-2"><button className="btn btn-secondary min-h-11" disabled={saving} onClick={() => void submit("impostor/clue", { content: null })}>跳过</button><button className="btn btn-primary min-h-11" disabled={saving || !clue.trim()} onClick={() => void submit("impostor/clue", { content: clue })}>提交线索</button></div></div> : <StatusNotice text="游戏者正在匿名提交线索" />}</>}

      {game.publicClues.length > 0 && <div><p className="mb-2 text-sm font-black text-ink">第三天公开线索</p><div className="space-y-2">{game.publicClues.map((item, index) => <div key={`${item.role}-${index}-${item.content}`} className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-sm leading-6"><strong className="text-violet-800">{item.roleLabel}：</strong>{item.content}</div>)}</div></div>}

      {game.phase === "day_vote" && nomination && <>{!me ? <StatusNotice text="游戏者正在选择任务人选" /> : me.nominationSubmitted ? <StatusNotice text="任务人选投票已提交" /> : <div><p className="text-sm font-black text-ink">{nomination.attempt > 1 ? `第 ${nomination.attempt} 次平票重投` : `选择 ${nomination.required} 名任务人选`}</p>{nomination.lockedUserIds.length > 0 && <p className="mt-1 text-xs font-bold text-emerald-700">已确定：{nomination.lockedUserIds.map(playerName).join("、")}</p>}<TargetGrid items={nomination.candidateUserIds.map((userId) => ({ userId }))} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, nomination.required)} /><button className="btn btn-primary mt-2 min-h-11 w-full" disabled={saving || selectedTargets.length !== nomination.required} onClick={() => void submit("impostor/nomination", { candidateUserIds: selectedTargets })}><Vote size={17} />提交投票</button></div>}<SubmissionProgress submitted={nomination.submittedUserIds.length} total={game.playerSeats.length} /></>}

      {game.phase === "mission" && <><div><p className="text-sm font-black text-ink">本轮任务成员</p><p className="mt-1 text-sm leading-6 text-muted">{game.missionTeamUserIds.map(playerName).join("、")}</p></div>{missionMember && me ? me.missionChoiceSubmitted ? <StatusNotice text="任务选择已提交" /> : <div className="grid grid-cols-2 gap-2"><button className="btn min-h-12 border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" disabled={saving} onClick={() => void submit("impostor/mission", { choice: "protect" })}><ShieldCheck size={18} />守护任务</button><button className="btn min-h-12 border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100" disabled={saving} onClick={() => void submit("impostor/mission", { choice: "sabotage" })}><ShieldOff size={18} />破坏任务</button></div> : <StatusNotice text="等待任务成员秘密选择；超时将自动守护" />}<SubmissionProgress submitted={game.missionSubmittedUserIds.length} total={game.missionTeamUserIds.length} /></>}

      {game.phase === "assassination" && <>{me?.canAssassinate ? <div><p className="text-sm font-black text-rose-800">选择一名玩家刺杀</p><p className="mt-1 text-xs leading-5 text-muted">刺中侦探则伪人获胜，否则好人获胜。</p><TargetGrid items={game.playerSeats.filter((seat) => seat.userId !== currentUserId)} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, 1)} /><button className="btn mt-2 min-h-11 w-full bg-rose-600 text-white hover:bg-rose-700" disabled={saving || selectedTargets.length !== 1} onClick={() => void submit("impostor/assassinate", { targetUserId: selectedTargets[0] })}><UserRoundSearch size={17} />确认刺杀</button></div> : <StatusNotice text="任务已三次成功，等待伪人刺杀" />}</>}

      {game.phase === "accusation" && accusation && <>{!me ? <StatusNotice text="游戏者正在进行最终指认" /> : me.accusationSubmitted ? <StatusNotice text="最终指认已提交" /> : <div><p className="text-sm font-black text-ink">{accusation.attempt === 2 ? "平票重投：再次指认伪人" : "指认一名伪人"}</p><TargetGrid items={accusation.candidateUserIds.filter((id) => id !== currentUserId).map((userId) => ({ userId }))} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, 1)} /><div className="mt-2 grid grid-cols-2 gap-2"><button className="btn btn-secondary min-h-11" disabled={saving} onClick={() => void submit("impostor/accuse", { targetUserId: null })}>弃权</button><button className="btn btn-primary min-h-11" disabled={saving || selectedTargets.length !== 1} onClick={() => void submit("impostor/accuse", { targetUserId: selectedTargets[0] })}>确认指认</button></div></div>}<SubmissionProgress submitted={accusation.submittedUserIds.length} total={game.playerSeats.length} /></>}

      {game.phase === "ended" && <div className={`rounded-2xl border p-4 text-center ${game.winner === "good" ? "border-emerald-200 bg-emerald-50" : game.winner === "impostor" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>{game.winner === "good" ? <CheckCircle2 className="mx-auto text-emerald-600" size={30} /> : game.winner === "impostor" ? <VenetianMask className="mx-auto text-rose-600" size={30} /> : <XCircle className="mx-auto text-slate-500" size={30} />}<h3 className="mt-2 text-lg font-black text-ink">{game.winner === "good" ? "好人阵营胜利" : game.winner === "impostor" ? "伪人阵营胜利" : "本局已终止"}</h3><p className="mt-1 text-sm text-muted">{game.endReason}</p></div>}
      {game.phase === "ended" && game.roleReveal && <div><p className="mb-2 text-sm font-black text-ink">身份公开</p><div className="space-y-2">{game.roleReveal.map((player) => <div key={player.userId} className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-sm"><span className="font-bold text-ink">{playerName(player.userId)}</span><strong className={player.role === "impostor" ? "text-rose-700" : player.role === "detective" ? "text-blue-700" : "text-emerald-700"}>{player.roleLabel}</strong></div>)}</div></div>}
      {game.history.length > 0 && <div><p className="mb-2 text-sm font-black text-ink">任务记录</p><div className="space-y-2">{game.history.map((item) => <div key={item.day} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>第 {item.day} 天 · {item.missionTeamUserIds.map((id) => `${seatById.get(id)}号`).join("、")}</span><strong className={item.result === "success" ? "text-emerald-700" : "text-rose-700"}>{item.result === "success" ? "成功" : "失败"}</strong></div>)}</div></div>}
    </div>

    {game.phase === "ended" && <div className="shrink-0 space-y-2 border-t border-line p-3">{currentMemberRole !== "admin" && <button type="button" className="btn btn-secondary min-h-11 w-full" disabled={saving || (currentMemberRole === "spectator" && playerMembers.length >= 6)} onClick={() => void submit("impostor/member-role", { role: currentMemberRole === "player" ? "spectator" : "player" })}>{currentMemberRole === "player" ? "下一局改为旁观者" : playerMembers.length >= 6 ? "游戏者席位已满" : "下一局成为游戏者"}</button>}{isHost && <button type="button" className="btn btn-primary min-h-11 w-full" disabled={saving || playerMembers.length < 4 || playerMembers.length > 6} onClick={() => void submit("start")}>{saving ? <LoaderCircle size={17} className="animate-spin" /> : <VenetianMask size={17} />}开始下一局</button>}</div>}
    {isHost && game.phase !== "ended" && <div className="shrink-0 border-t border-line p-3"><button className="btn min-h-11 w-full bg-red-50 text-red-700 hover:bg-red-100" onClick={() => setTerminateOpen(true)}>终止本局</button></div>}
    {terminateOpen && <Modal onClose={() => setTerminateOpen(false)}><div className="space-y-4 text-center"><h2 className="text-xl font-black text-ink">确认终止本局？</h2><p className="text-sm leading-6 text-muted">终止后不计算任何阵营胜利，并公开本局身份。</p><div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setTerminateOpen(false)}>取消</button><button className="btn bg-red-600 text-white hover:bg-red-700" disabled={saving} onClick={() => { setTerminateOpen(false); void submit("impostor/terminate"); }}>确认终止</button></div></div></Modal>}
  </section>;
}

function TargetGrid({ items, selected, playerName, onToggle }: { items: Array<{ userId: string }>; selected: string[]; playerName: (id: string) => string; onToggle: (id: string) => void }) {
  return <div className="mt-2 grid grid-cols-2 gap-2">{items.map(({ userId }) => <button key={userId} type="button" aria-pressed={selected.includes(userId)} className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${selected.includes(userId) ? "border-violet-500 bg-violet-600 text-white" : "border-line bg-white text-ink hover:border-violet-300 hover:bg-violet-50"}`} onClick={() => onToggle(userId)}>{playerName(userId)}</button>)}</div>;
}

function SubmissionProgress({ submitted, total }: { submitted: number; total: number }) {
  return <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-muted" role="status"><Clock3 size={14} />已提交 {submitted}/{total}</p>;
}

function StatusNotice({ text }: { text: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800" role="status"><Clock3 size={16} className="shrink-0" />{text}</div>;
}
