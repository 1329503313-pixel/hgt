import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Eye, Moon, Shield, ShieldCheck, ShieldOff, Sun, UserRoundSearch, Users, VenetianMask, Vote, XCircle } from "lucide-react";
import { api } from "../api";
import type { OnlineImpostorGame, OnlineSoupMessage, OnlineSoupSnapshot } from "../shared/types";
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
  day_ready: "白天准备",
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
  const [terminateOpen, setTerminateOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!game?.deadlineAt) return;
    const delay = Math.max(0, new Date(game.deadlineAt).getTime() - Date.now()) + 250;
    const timer = window.setTimeout(() => void onChanged(), delay);
    return () => window.clearTimeout(timer);
  }, [game?.deadlineAt, onChanged]);

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
      <p className="mt-4 rounded-xl bg-blue-50 px-3 py-2 text-center text-xs font-bold text-blue-800">开始游戏和切换身份已移至“更多”操作。</p>
    </section>;
  }

  const me = game.me;
  const missionMember = game.missionTeamUserIds.includes(currentUserId);
  const nomination = game.nomination;
  const accusation = game.accusation;
  const roleTone = me?.role === "impostor" ? "border-rose-200 bg-rose-50 text-rose-800" : me?.role === "detective" ? "border-blue-200 bg-blue-50 text-blue-800" : "border-emerald-200 bg-emerald-50 text-emerald-800";
  const roleIcon = me?.role === "impostor" ? <VenetianMask size={18} /> : me?.role === "detective" ? <Eye size={18} /> : <Shield size={18} />;

  return <section className="card flex min-h-0 flex-col overflow-hidden">
    <div className="shrink-0 border-b border-line bg-slate-950 px-4 py-3 text-white">
      <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10">{game.phase === "night" || game.phase === "clue" ? <Moon size={19} /> : <Sun size={19} />}</span><div><p className="text-[11px] font-bold text-slate-300">第 {game.day} 天 · 第 {game.gameNumber} 局</p><h2 className="font-black">{phaseLabel[game.phase]}</h2></div>{game.deadlineAt && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-mono text-xs font-black tabular-nums"><Clock3 size={13} />{formatRemaining(game.deadlineAt, now)}</span>}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black"><div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-emerald-300">任务成功 {game.successes}/3</div><div className="rounded-lg bg-rose-500/15 px-3 py-2 text-rose-300">任务失败 {game.failures}/3</div></div>
    </div>

    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
      {me ? <div className={`flex items-center gap-2 rounded-xl border p-3 ${roleTone}`}>{roleIcon}<div><p className="text-[11px] font-bold opacity-75">你的秘密身份 · {me.seat}号</p><p className="font-black">{me.roleLabel}</p></div></div> : <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-muted">你正在旁观，只能看到公开的对局信息。</div>}

      {game.phase === "day_ready" && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3" role="status" aria-label={`已有${game.readyUserIds.length}名玩家准备，共${game.playerSeats.length}名玩家`}>
        <div className="flex items-center justify-between gap-2"><p className="text-sm font-black text-blue-900">当前对局准备情况</p><strong className="text-xs tabular-nums text-blue-700">{game.readyUserIds.length}/{game.playerSeats.length}</strong></div>
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">{game.playerSeats.map(({ userId }) => { const ready = game.readyUserIds.includes(userId); return <div key={userId} className={`flex min-h-9 items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-bold ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}><span className="truncate">{playerName(userId)}</span><span className="ml-2 inline-flex shrink-0 items-center gap-1">{ready ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{ready ? "已准备" : "未准备"}</span></div>; })}</div>
      </div>}

      {game.isolatedUserIds.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p className="flex items-center gap-1.5 font-black"><ShieldOff size={16} />今日隔离</p><p className="mt-1 leading-6">{game.isolatedUserIds.map(playerName).join("、")}不可成为任务候选人。</p></div>}

      {me?.investigation && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><p className="font-black">第一夜调查结果</p><p className="mt-1 leading-6">{me.investigation.targetUserIds.map(playerName).join(" 与 ")}中{me.investigation.reportedHasImpostor ? "有" : "没有"}伪人。</p></div>}

      {game.phase === "night" && <>
        <p className="text-sm font-black text-ink">夜间行动</p>
        {!me ? <p className="text-sm text-muted">等待游戏者秘密行动，夜晚将在倒计时结束后统一结算。</p> : me.nightSubmitted ? <StatusNotice text="夜间行动已提交，夜晚将在倒计时结束后统一结算" /> : me.nightActionTypes.length === 0 ? <StatusNotice text="本夜没有可用技能，等待倒计时结束" /> : <StatusNotice text="请在聊天中的夜间行动卡选择技能" />}
      </>}

      {game.phase === "day_ready" && <StatusNotice text={me?.readySubmitted ? "你已准备，等待其他玩家；白天准备阶段不设倒计时" : me ? "天亮后请在“更多”模块点击准备" : "等待所有游戏者准备"} />}

      {game.phase === "clue" && <StatusNotice text={me?.clueSubmitted ? "线索已提交，等待统一公开" : me ? "请在聊天中的留言卡填写匿名线索" : "游戏者正在匿名提交线索"} />}

      {game.phase === "day_vote" && nomination && <StatusNotice text={me?.nominationSubmitted ? "任务人选投票已提交，请在聊天中等待其他玩家" : "请在聊天中的系统投票消息内选择任务人选"} />}

      {game.phase === "mission" && <><div><p className="text-sm font-black text-ink">本轮任务成员</p><p className="mt-1 text-sm leading-6 text-muted">{game.missionTeamUserIds.map(playerName).join("、")}</p></div>{missionMember && me ? me.missionChoiceSubmitted ? <StatusNotice text="任务选择已提交" /> : <div className="grid grid-cols-2 gap-2"><button className="btn min-h-12 border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" disabled={saving} onClick={() => void submit("impostor/mission", { choice: "protect" })}><ShieldCheck size={18} />守护任务</button><button className="btn min-h-12 border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100" disabled={saving} onClick={() => void submit("impostor/mission", { choice: "sabotage" })}><ShieldOff size={18} />破坏任务</button></div> : <StatusNotice text="等待任务成员秘密选择；超时将自动守护" />}<SubmissionProgress submitted={game.missionSubmittedUserIds.length} total={game.missionTeamUserIds.length} /></>}

      {game.phase === "assassination" && <StatusNotice text={me?.canAssassinate ? "请在聊天中的系统消息内选择刺杀目标" : "任务已三次成功，等待伪人刺杀"} />}

      {game.phase === "accusation" && accusation && <StatusNotice text={me?.accusationSubmitted ? "公投目标已提交，请在聊天中等待其他玩家" : me ? "请在聊天中的系统消息内选择公投目标" : "游戏者正在进行最终公投"} />}

      {game.phase === "ended" && <StatusNotice text="本局结算和全部身份已发布到聊天中" />}
      {game.history.length > 0 && <div><p className="mb-2 text-sm font-black text-ink">任务记录</p><div className="space-y-2">{game.history.map((item) => <div key={item.day} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>第 {item.day} 天 · {item.missionTeamUserIds.map((id) => `${seatById.get(id)}号`).join("、")}</span><strong className={item.result === "success" ? "text-emerald-700" : "text-rose-700"}>{item.result === "success" ? "成功" : "失败"}</strong></div>)}</div></div>}
    </div>

    {isHost && game.phase !== "ended" && <div className="shrink-0 border-t border-line p-3"><button className="btn min-h-11 w-full bg-red-50 text-red-700 hover:bg-red-100" onClick={() => setTerminateOpen(true)}>终止本局</button></div>}
    {terminateOpen && <Modal onClose={() => setTerminateOpen(false)}><div className="space-y-4 text-center"><h2 className="text-xl font-black text-ink">确认终止本局？</h2><p className="text-sm leading-6 text-muted">终止后不计算任何阵营胜利，并公开本局身份。</p><div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => setTerminateOpen(false)}>取消</button><button className="btn bg-red-600 text-white hover:bg-red-700" disabled={saving} onClick={() => { setTerminateOpen(false); void submit("impostor/terminate"); }}>确认终止</button></div></div></Modal>}
  </section>;
}

type ChatActionProps = Pick<Props, "roomId" | "game" | "members" | "currentUserId" | "onChanged" | "showToast">;

export function ImpostorSettlementCard({ event }: { event: Extract<NonNullable<OnlineSoupMessage["impostorEvent"]>, { kind: "settlement" }> }) {
  const winnerLabel = event.winner === "good" ? "好人阵营胜利" : event.winner === "impostor" ? "伪人阵营胜利" : "本局已终止";
  const tone = event.winner === "good" ? "border-emerald-200 from-emerald-50 to-white" : event.winner === "impostor" ? "border-rose-200 from-rose-50 to-white" : "border-slate-200 from-slate-50 to-white";
  const icon = event.winner === "good" ? <ShieldCheck size={24} className="text-emerald-600" /> : event.winner === "impostor" ? <VenetianMask size={24} className="text-rose-600" /> : <XCircle size={24} className="text-slate-500" />;
  return <article className={`mx-auto mt-2 w-full max-w-xl rounded-2xl border bg-gradient-to-br p-4 text-left shadow-sm ${tone}`} aria-label={`谁是伪人第${event.gameNumber}局结算`}>
    <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white shadow-sm">{icon}</span><div className="min-w-0"><p className="text-xs font-bold text-muted">谁是伪人 · 第 {event.gameNumber} 局结算</p><h3 className="text-lg font-black text-ink">{winnerLabel}</h3></div></div>
    <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm font-bold leading-6 text-slate-700">{event.endReason}</p>
    <div className="mt-3 space-y-2" aria-label="本局身份公开">{event.players.map((player) => <div key={player.userId} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white bg-white/90 px-3 py-2 text-sm shadow-sm"><span className="min-w-0 truncate font-black text-ink">{player.seat}号 {player.nickname}</span><strong className={`shrink-0 ${player.role === "impostor" ? "text-rose-700" : player.role === "detective" ? "text-blue-700" : "text-emerald-700"}`}>{player.roleLabel}</strong></div>)}</div>
  </article>;
}

export function ImpostorChatActionCard({ roomId, game, members, currentUserId, onChanged, showToast }: ChatActionProps) {
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [selectedAction, setSelectedAction] = useState<keyof typeof actionLabel | null>(null);
  const [clue, setClue] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const seatById = useMemo(() => new Map(game?.playerSeats.map((seat) => [seat.userId, seat.seat]) ?? []), [game?.playerSeats]);
  const playerName = (userId: string) => `${seatById.get(userId) ?? "?"}号 ${memberById.get(userId)?.nickname ?? "已离开玩家"}`;

  useEffect(() => {
    setSelectedTargets([]);
    setSelectedAction(null);
    setClue("");
  }, [game?.gameNumber, game?.phase, game?.day, game?.nomination?.attempt, game?.accusation?.attempt]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!game || !["night", "clue", "day_vote", "assassination", "accusation"].includes(game.phase)) return null;

  function toggleTarget(userId: string, limit: number) {
    setSelectedTargets((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : current.length < limit ? [...current, userId] : [...current.slice(1), userId]);
  }

  async function submit(path: string, body: object) {
    if (saving) return;
    setSaving(true);
    try {
      await api(`/api/online-soup/rooms/${roomId}/${path}`, { method: "POST", body });
      await onChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  const expired = Boolean(game.deadlineAt && new Date(game.deadlineAt).getTime() <= now);
  const deadlineBadge = game.deadlineAt && <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 font-mono text-xs font-black tabular-nums text-slate-700"><Clock3 size={13} />{formatRemaining(game.deadlineAt, now)}</span>;

  if (game.phase === "night") {
    const actionTargetLimit = selectedAction === "investigate" ? 2 : 1;
    const actionTargets = game.playerSeats.filter(({ userId }) => selectedAction === "guard" || userId !== currentUserId);
    return <article className="impostor-night-action-card mx-auto mt-2 w-full max-w-xl rounded-2xl border border-slate-600 bg-slate-800 p-3 text-left text-white shadow-sm" aria-label="夜间技能选择">
      <div className="flex items-center gap-2 text-sm font-black"><Moon size={17} />第 {game.day} 夜秘密行动{deadlineBadge}</div>
      {!game.me ? <NightStatusNotice text="旁观者不可进行夜间行动" /> : game.me.nightSubmitted ? <NightStatusNotice text="夜间行动已提交，等待统一结算" /> : game.me.nightActionTypes.length === 0 ? <NightStatusNotice text="本夜没有可用技能" /> : <>
        {game.me.role === "detective" && game.me.nightActionTypes.includes("investigate") && <p className="mt-2 text-xs leading-5 text-slate-300">侦探可选择是否查验；查验时请选择两名其他玩家。</p>}
        <div className="mt-2 grid grid-cols-2 gap-2">{game.me.nightActionTypes.map((action) => <button key={action} type="button" disabled={expired} aria-pressed={selectedAction === action} className={`btn segmented-choice min-h-11 ${selectedAction === action ? "border-violet-400 bg-violet-600 text-white" : "border-slate-500 bg-slate-700 text-white hover:bg-slate-600"}`} onClick={() => { setSelectedAction(action); setSelectedTargets([]); }}>{actionLabel[action]}</button>)}</div>
        {selectedAction && selectedAction !== "skip" && <TargetGrid dark items={actionTargets} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, actionTargetLimit)} />}
        {selectedAction && <button type="button" className="btn mt-2 min-h-11 w-full bg-violet-600 text-white hover:bg-violet-500" disabled={saving || expired || (selectedAction !== "skip" && selectedTargets.length !== actionTargetLimit)} onClick={() => void submit("impostor/night-action", { type: selectedAction, targetUserIds: selectedAction === "skip" ? [] : selectedTargets })}>{saving ? "提交中…" : selectedAction === "skip" ? "确认本夜不使用技能" : `确认使用${actionLabel[selectedAction]}`}</button>}
        {expired && <NightStatusNotice text="行动时间已结束，未提交视为跳过" />}
      </>}
    </article>;
  }

  if (game.phase === "clue") {
    return <article className="impostor-night-action-card mx-auto mt-2 w-full max-w-xl rounded-2xl border border-slate-600 bg-slate-800 p-3 text-left text-white shadow-sm" aria-label="匿名留言">
      <div className="flex items-center gap-2 text-sm font-black"><Moon size={17} />填写匿名身份留言{deadlineBadge}</div>
      {!game.me ? <NightStatusNotice text="旁观者不可填写留言" /> : game.me.clueSubmitted ? <NightStatusNotice text="留言已提交，等待统一公开" /> : <>
        <label htmlFor="impostor-chat-clue" className="mt-2 block text-xs font-bold text-slate-300">最多 10 个字，也可以跳过</label>
        <textarea id="impostor-chat-clue" className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-500 bg-slate-700 px-3 py-2 text-base text-white caret-white outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/30" value={clue} disabled={expired} onChange={(event) => setClue(Array.from(event.target.value).slice(0, 10).join(""))} placeholder="填写本局匿名留言…" />
        <div className="mt-2 grid grid-cols-2 gap-2"><button className="btn min-h-11 border border-slate-500 bg-slate-700 text-white hover:bg-slate-600" disabled={saving || expired} onClick={() => void submit("impostor/clue", { content: null })}>跳过</button><button className="btn min-h-11 bg-violet-600 text-white hover:bg-violet-500" disabled={saving || expired || !clue.trim()} onClick={() => void submit("impostor/clue", { content: clue })}>提交留言</button></div>
        {expired && <NightStatusNotice text="留言时间已结束，未提交视为跳过" />}
      </>}
    </article>;
  }

  if (game.phase === "day_vote" && game.nomination) {
    const nomination = game.nomination;
    const submitted = Boolean(game.me?.nominationSubmitted);
    return <article className="mx-auto mt-2 w-full max-w-xl rounded-2xl border border-violet-200 bg-violet-50 p-3 text-left shadow-sm" aria-label="任务人选投票">
      <div className="flex items-center gap-2 text-sm font-black text-violet-900"><Vote size={17} />{nomination.attempt > 1 ? `第 ${nomination.attempt} 次平票重投` : `选择 ${nomination.required} 名任务人选`}{deadlineBadge}</div>
      {nomination.lockedUserIds.length > 0 && <p className="mt-1 text-xs font-bold text-emerald-700">已确定：{nomination.lockedUserIds.map(playerName).join("、")}</p>}
      {!game.me ? <StatusNotice text="旁观者不可参与投票" /> : submitted ? <StatusNotice text="任务人选投票已提交" /> : <>
        <TargetGrid items={game.playerSeats.map(({ userId }) => ({
          userId,
          disabled: !nomination.candidateUserIds.includes(userId),
          suffix: game.isolatedUserIds.includes(userId) ? "（隔离）" : nomination.lockedUserIds.includes(userId) ? "（已确定）" : "",
        }))} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, nomination.required)} />
        <button className="btn btn-primary mt-2 min-h-11 w-full" disabled={saving || expired || selectedTargets.length !== nomination.required} onClick={() => void submit("impostor/nomination", { attempt: nomination.attempt, candidateUserIds: selectedTargets })}><Vote size={17} />{saving ? "提交中…" : expired ? "已超时，默认弃票" : "提交投票"}</button>
      </>}
      <SubmissionProgress submitted={nomination.submittedUserIds.length} total={game.playerSeats.length} />
    </article>;
  }

  if (game.phase === "assassination") {
    return <article className="mx-auto mt-2 w-full max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-3 text-left shadow-sm" aria-label="伪人刺杀">
      <div className="flex items-center gap-2 text-sm font-black text-rose-900"><UserRoundSearch size={17} />伪人选择刺杀目标{deadlineBadge}</div>
      {game.me?.canAssassinate ? <>
        <p className="mt-1 text-xs leading-5 text-muted">刺中侦探则伪人获胜，否则好人获胜。</p>
        <TargetGrid items={game.playerSeats.map(({ userId }) => ({ userId, disabled: userId === currentUserId, suffix: userId === currentUserId ? "（自己）" : "" }))} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, 1)} />
        <button className="btn mt-2 min-h-11 w-full bg-rose-600 text-white hover:bg-rose-700" disabled={saving || expired || selectedTargets.length !== 1} onClick={() => void submit("impostor/assassinate", { targetUserId: selectedTargets[0] })}><UserRoundSearch size={17} />{saving ? "提交中…" : expired ? "刺杀已超时" : "确认刺杀"}</button>
      </> : <StatusNotice text="等待伪人秘密选择刺杀目标" />}
    </article>;
  }

  const accusation = game.accusation!;
  const submitted = Boolean(game.me?.accusationSubmitted);
  return <article className="mx-auto mt-2 w-full max-w-xl rounded-2xl border border-blue-200 bg-blue-50 p-3 text-left shadow-sm" aria-label="最终公投">
    <div className="flex items-center gap-2 text-sm font-black text-blue-900"><Vote size={17} />{accusation.attempt === 2 ? "平票重投：再次选择公投目标" : "所有玩家选择公投目标"}{deadlineBadge}</div>
    {!game.me ? <StatusNotice text="旁观者不可参与公投" /> : submitted ? <StatusNotice text="公投目标已提交" /> : <>
      <TargetGrid items={game.playerSeats.map(({ userId }) => ({
        userId,
        disabled: userId === currentUserId || !accusation.candidateUserIds.includes(userId),
        suffix: userId === currentUserId ? "（自己）" : "",
      }))} selected={selectedTargets} playerName={playerName} onToggle={(id) => toggleTarget(id, 1)} />
      <div className="mt-2 grid grid-cols-2 gap-2"><button className="btn btn-secondary min-h-11" disabled={saving || expired} onClick={() => void submit("impostor/accuse", { attempt: accusation.attempt, targetUserId: null })}>弃权</button><button className="btn btn-primary min-h-11" disabled={saving || expired || selectedTargets.length !== 1} onClick={() => void submit("impostor/accuse", { attempt: accusation.attempt, targetUserId: selectedTargets[0] })}>{saving ? "提交中…" : expired ? "已超时，默认弃票" : "确认公投"}</button></div>
    </>}
    <SubmissionProgress submitted={accusation.submittedUserIds.length} total={game.playerSeats.length} />
  </article>;
}

function TargetGrid({ items, selected, playerName, onToggle, dark = false }: { items: Array<{ userId: string; disabled?: boolean; suffix?: string }>; selected: string[]; playerName: (id: string) => string; onToggle: (id: string) => void; dark?: boolean }) {
  return <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{items.map(({ userId, disabled = false, suffix = "" }) => <button key={userId} type="button" disabled={disabled} aria-pressed={selected.includes(userId)} className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${disabled ? dark ? "cursor-not-allowed border-slate-600 bg-slate-700 text-slate-400 opacity-70" : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-80" : selected.includes(userId) ? "border-violet-500 bg-violet-600 text-white" : dark ? "border-slate-500 bg-slate-700 text-white hover:border-violet-400 hover:bg-slate-600" : "border-line bg-white text-ink hover:border-violet-300 hover:bg-violet-50"}`} onClick={() => onToggle(userId)}>{playerName(userId)}{suffix}</button>)}</div>;
}

function SubmissionProgress({ submitted, total }: { submitted: number; total: number }) {
  return <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-muted" role="status"><Clock3 size={14} />已提交 {submitted}/{total}</p>;
}

function StatusNotice({ text }: { text: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800" role="status"><Clock3 size={16} className="shrink-0" />{text}</div>;
}

function NightStatusNotice({ text }: { text: string }) {
  return <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-700 px-3 py-2 text-sm font-bold text-slate-100" role="status"><Clock3 size={16} className="shrink-0" />{text}</div>;
}
