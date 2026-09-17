import { Mic, MicOff, Radio, Volume2, UserRound, Crown } from "lucide-react";
import { useRef } from "react";
import { useOnlineSoupVoice } from "../context/OnlineSoupVoiceContext";
import type { OnlineSoupSnapshot } from "../shared/types";
import { VipIdentity } from "./VipIdentity";

export function OnlineSoupVoiceControls({ roomId }: { roomId: string }) {
  const voice = useOnlineSoupVoice();
  const pointer = useRef<number | null>(null);
  const connected = voice.roomId === roomId && voice.status === "connected";
  const busy = voice.roomId === roomId && ["connecting", "reconnecting"].includes(voice.status);
  const release = () => { pointer.current = null; voice.release(); };
  return <div className="voice-controls">
    <div className="voice-status" role="status" aria-live="polite">
      {voice.transmitting && connected ? <><span className="voice-equalizer" aria-hidden="true"><i /><i /><i /><i /></span>正在发言中</> : busy ? "正在连接语音…" : connected ? voice.canPublish ? "语音已连接 · 支持多人同时发言" : "主持人已禁麦 · 可以继续收听" : "连接语音后即可收听"}
    </div>
    {voice.roomId === roomId && voice.error && <p className="text-center text-xs text-red-600" role="alert">{voice.error}</p>}
    {connected && voice.poorNetwork && <p className="text-center text-xs text-amber-700">网络较弱，请靠近 Wi-Fi 或切换网络</p>}
    {connected && voice.autoplayBlocked && <button type="button" className="btn-secondary w-full" onClick={voice.resumeAudio}><Volume2 size={16} />点击恢复收听</button>}
    <div className="flex items-center justify-center gap-2">
      {!connected ? <button type="button" className="btn btn-primary min-h-12 flex-1" disabled={busy} onClick={() => void voice.connect(roomId)}><Radio size={18} />{busy ? "连接中…" : "连接语音"}</button> : <>
        {!voice.always && <button type="button" className={`voice-ptt ${voice.transmitting ? "is-speaking" : ""}`} disabled={!voice.canPublish} aria-pressed={voice.transmitting}
          onContextMenu={event => event.preventDefault()}
          onPointerDown={event => { if (event.button !== 0 || pointer.current !== null) return; event.preventDefault(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); voice.press(); }}
          onPointerUp={event => { if (pointer.current === event.pointerId) release(); }} onPointerCancel={release} onLostPointerCapture={release}
          onKeyDown={event => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); if (!event.repeat) voice.press(); } }}
          onKeyUp={event => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); voice.release(); } }} onBlur={release}>
          {voice.transmitting ? <Mic size={20} /> : <MicOff size={20} />}{voice.transmitting ? "松开结束发言" : "按住发言"}
        </button>}
        {voice.always && <div className="flex min-h-12 flex-1 items-center justify-center gap-2 text-primary"><Mic size={20} />麦克风常开</div>}
        <button type="button" className="voice-mode-toggle" disabled={!voice.canPublish} onClick={voice.toggle}>{voice.always ? "切换为按住发言" : "切换为麦克风常开"}</button>
        <button type="button" className="voice-mode-toggle" onClick={voice.disconnect} aria-label="断开语音并关闭麦克风">断开</button>
      </>}
    </div>
  </div>;
}

export function OnlineSoupVoiceStage({ snapshot, onOpenUser }: { snapshot: OnlineSoupSnapshot; onOpenUser: (id: string) => void }) {
  const voice = useOnlineSoupVoice();
  const host = snapshot.members.find(member => member.role === "host");
  const players = snapshot.members.filter(member => member.role === "player");
  function seat(member: typeof host, label: string) {
    const speaking = member && voice.roomId === snapshot.room.id && voice.speakers.includes(member.id);
    return <button type="button" className={`voice-seat ${speaking ? "is-speaking" : ""}`} disabled={!member} onClick={() => member && onOpenUser(member.id)} aria-label={`${member?.nickname ?? label}${speaking ? "，正在发言" : ""}`}>
      <span className="voice-avatar">{member?.avatar ? <img src={member.avatar} alt="" /> : <UserRound size={24} />}{member?.mutedUntil && <MicOff className="voice-mute" size={16} />}</span>
      <strong>{member ? <VipIdentity nickname={member.nickname} vipLevel={member.vipLevel} vipActive={member.vipActive} equippedBadge={member.equippedBadge} showUserLevel={false} className="max-w-full justify-center" iconClassName="h-3 w-3" badgeClassName="h-3 w-3" /> : label}</strong><small>{speaking ? "正在发言" : member ? label : "等待加入"}</small>
    </button>;
  }
  return <section className="voice-stage" aria-label="语音玩汤席位">
    <div className="voice-seat-column">{Array.from({ length: 5 }, (_, i) => <div key={i}>{seat(players.find(m => m.voiceSeat === i + 1), `${i + 1} 号位`)}</div>)}</div>
    <div className="voice-host"><Crown size={20} className="text-amber-600" />{seat(host, "主持人")}<p>语音玩汤</p><small>10 个玩家席位<br />自由讨论 · 无观战席</small></div>
    <div className="voice-seat-column">{Array.from({ length: 5 }, (_, i) => <div key={i}>{seat(players.find(m => m.voiceSeat === i + 6), `${i + 6} 号位`)}</div>)}</div>
  </section>;
}
