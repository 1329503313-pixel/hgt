import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type TRTC from "trtc-sdk-v5";
import { useLocation } from "react-router-dom";
import { api, ApiError } from "../api";
import { useApp } from "./AppContext";
import { VoiceMicrophone } from "../shared/voiceMicrophone";
import type { OnlineSoupSnapshot } from "../shared/types";

type Status = "off" | "connecting" | "connected" | "reconnecting" | "error";
type Ticket = { sessionId: string; sdkAppId: number; userId: string; userSig: string; strRoomId: string; privateMapKey: string; canPublish: boolean };
type View = { roomId: string | null; status: Status; error: string; transmitting: boolean; always: boolean; canPublish: boolean; speakers: string[]; poorNetwork: boolean; autoplayBlocked: boolean };
const initial: View = { roomId: null, status: "off", error: "", transmitting: false, always: false, canPublish: false, speakers: [], poorNetwork: false, autoplayBlocked: false };
type VoiceValue = View & { connect: (roomId: string) => Promise<void>; disconnect: () => void; press: () => void; release: () => void; toggle: () => void; sync: (snapshot: OnlineSoupSnapshot) => void; resumeAudio: () => void };
const Context = createContext<VoiceValue | null>(null);
export function useOnlineSoupVoice() { const value = useContext(Context); if (!value) throw Error("Voice provider missing"); return value; }

export function OnlineSoupVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const location = useLocation();
  const [view, setView] = useState(initial);
  const viewRef = useRef(view);
  const rtcRef = useRef<TRTC | null>(null);
  const mic = useRef(new VoiceMicrophone());
  const epoch = useRef(0);
  const ticketRef = useRef<Ticket | null>(null);
  const heartbeat = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapping = useRef(new Map<string, string>());
  const resume = useRef(new Set<() => Promise<void>>());
  const micQueue = useRef(Promise.resolve());
  const micOperation = useRef(0);
  const disposed = useRef(false);
  function update(patch: Partial<View>) { viewRef.current = { ...viewRef.current, ...patch }; if (!disposed.current) setView(viewRef.current); }
  async function request<T>(roomId: string, action: string, body: object) {
    return api<T>(`/api/online-soup/rooms/${roomId}/voice/${action}`, { method: "POST", body, signal: AbortSignal.timeout(8000), dedupe: false, bypassCache: true });
  }
  function stopMic() {
    micOperation.current++;
    mic.current.stop();
    update({ transmitting: false, always: false });
    const rtc = rtcRef.current;
    micQueue.current = micQueue.current.catch(() => {}).then(async () => { if (rtc) await rtc.stopLocalAudio().catch(() => {}); });
  }
  function disconnect() {
    epoch.current++;
    stopMic();
    if (heartbeat.current) clearTimeout(heartbeat.current);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    const rtc = rtcRef.current; rtcRef.current = null;
    // A stalled operation from the previous instance must not hold a new connection.
    micQueue.current = Promise.resolve();
    const ticket = ticketRef.current; ticketRef.current = null;
    const roomId = viewRef.current.roomId;
    if (ticket && roomId) void request(roomId, "leave", { sessionId: ticket.sessionId }).catch(() => {});
    if (rtc) void rtc.exitRoom().catch(() => {}).finally(() => { rtc.destroy(); });
    mapping.current.clear(); resume.current.clear();
    update({ ...initial });
  }
  async function connect(roomId: string) {
    if (viewRef.current.roomId === roomId && ["connecting", "connected"].includes(viewRef.current.status)) return;
    const previousTicket = ticketRef.current;
    const previousRoom = viewRef.current.roomId;
    disconnect();
    const generation = epoch.current;
    update({ roomId, status: "connecting" });
    let rtc: TRTC | null = null;
    let ticket: Ticket | null = null;
    try {
      if (document.visibilityState !== "visible") throw Error("请返回前台后连接语音");
      if (previousTicket && previousRoom) await request(previousRoom, "leave", { sessionId: previousTicket.sessionId });
      const { default: SDK } = await import("trtc-sdk-v5");
      if (generation !== epoch.current) return;
      ticket = await request<Ticket>(roomId, "session", {});
      if (generation !== epoch.current) { void request(roomId, "leave", { sessionId: ticket.sessionId }).catch(() => {}); return; }
      ticketRef.current = ticket;
      rtc = SDK.create(); rtcRef.current = rtc;
      const current = () => generation === epoch.current && rtc === rtcRef.current;
      rtc.on(SDK.EVENT.AUDIO_VOLUME, ({ result }) => {
        if (!current()) return;
        const speakers = result.filter(item => item.volume >= 8).map(item => item.userId === ticket!.userId || item.userId === "" ? (mic.current.active ? user?.id : undefined) : mapping.current.get(item.userId)).filter((id): id is string => Boolean(id));
        update({ speakers: [...new Set(speakers)] });
      });
      rtc.on(SDK.EVENT.AUTOPLAY_FAILED, event => { if (current()) { resume.current.add(event.resume); update({ autoplayBlocked: true }); } });
      rtc.on(SDK.EVENT.NETWORK_QUALITY, quality => { if (current()) update({ poorNetwork: quality.uplinkNetworkQuality >= 4 || quality.downlinkNetworkQuality >= 4 }); });
      rtc.on(SDK.EVENT.CONNECTION_STATE_CHANGED, event => {
        if (!current()) return;
        if (event.state === "RECONNECTING" || event.state === "DISCONNECTED") {
          stopMic(); update({ status: "reconnecting", speakers: [] });
          if (!reconnectTimer.current) reconnectTimer.current = setTimeout(() => { reconnectTimer.current = null; if (current()) void connect(roomId); }, 12000);
        } else if (event.state === "CONNECTED" || event.state === "RECONNECTED") {
          if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
          update({ status: "connected" });
        }
      });
      rtc.on(SDK.EVENT.KICKED_OUT, () => { if (current()) { disconnect(); update({ roomId, status: "error", error: "语音权限已变更或连接已被移除，请重新连接" }); } });
      rtc.on(SDK.EVENT.ERROR, () => { if (current()) { stopMic(); update({ error: "语音设备或网络异常，请检查后重新连接" }); } });
      const entering = rtc.enterRoom({ ...ticket, scene: SDK.TYPE.SCENE_RTC, autoReceiveAudio: false });
      const timeout = setTimeout(() => { if (current()) { disconnect(); update({ roomId, status: "error", error: "语音连接超时，请重试" }); } }, 15000);
      try { await entering; } finally { clearTimeout(timeout); }
      if (!current()) { await rtc.exitRoom().catch(() => {}); rtc.destroy(); return; }
      rtc.enableAudioVolumeEvaluation(200);
      update({ status: "connected", canPublish: ticket.canPublish });
      let lastSuccess = Date.now();
      const tick = async () => {
        if (!current()) return;
        try {
          const response = await request<{ members: Array<{ rtcUserId: string; userId: string; canPublish: boolean }> }>(roomId, "heartbeat", { sessionId: ticket!.sessionId });
          if (!current()) return;
          lastSuccess = Date.now();
          const previous = mapping.current;
          const allowed = response.members.filter(m => m.canPublish);
          mapping.current = new Map(allowed.map(m => [m.rtcUserId, m.userId]));
          for (const id of previous.keys()) if (!mapping.current.has(id)) await rtc!.muteRemoteAudio(id, true).catch(() => {});
          for (const member of allowed) if (member.rtcUserId !== ticket!.userId) await rtc!.muteRemoteAudio(member.rtcUserId, false).catch(() => {});
        } catch (error) {
          if (!current()) return;
          stopMic();
          if (error instanceof ApiError && [401, 403, 404].includes(error.status) || Date.now() - lastSuccess > 18000) {
            disconnect(); update({ roomId, status: "error", error: "语音连接或权限已失效，请重新连接" }); return;
          }
          update({ error: "正在确认语音连接，麦克风已关闭" });
        }
        if (current()) heartbeat.current = setTimeout(() => void tick(), 2000);
      };
      void tick();
    } catch (error) {
      if (generation !== epoch.current) return;
      disconnect(); update({ roomId, status: "error", error: error instanceof Error ? error.message : "连接语音失败，请重试" });
    }
  }
  function press(always = false) {
    const rtc = rtcRef.current;
    if (!rtc || viewRef.current.status !== "connected" || !viewRef.current.canPublish || document.visibilityState !== "visible") return;
    const generation = epoch.current;
    stopMic();
    const operation = micOperation.current;
    update({ always, error: "" });
    // Capture is initiated in the user gesture; publication is serialized with stopLocalAudio.
    if (!navigator.mediaDevices?.getUserMedia) { update({ always: false, error: "当前环境不支持麦克风，请使用 HTTPS 或更新客户端" }); return; }
    const captured = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    void mic.current.start(() => captured, async track => {
      track.addEventListener?.("ended", () => {
        if (generation === epoch.current && operation === micOperation.current) { stopMic(); update({ error: "麦克风已断开，请检查设备后重新发言" }); }
      }, { once: true });
      const publishing = micQueue.current.catch(() => {}).then(async () => {
        if (generation !== epoch.current || track.readyState !== "live") return;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            rtc.startLocalAudio({ option: { audioTrack: track, profile: "standard" } }),
            new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => {
              if (generation === epoch.current) { const roomId = viewRef.current.roomId; disconnect(); update({ roomId, status: "error", error: "麦克风启动超时，请重新连接" }); }
              reject(new Error("Microphone start timed out"));
            }, 8000); }),
          ]);
        } finally { if (timeout) clearTimeout(timeout); }
      });
      micQueue.current = publishing.catch(() => {});
      await publishing;
    }, () => generation === epoch.current && operation === micOperation.current && document.visibilityState === "visible" && viewRef.current.status === "connected" && viewRef.current.canPublish).then(active => { if (generation === epoch.current && operation === micOperation.current) update({ transmitting: active, ...(active ? {} : { always: false }) }); }).catch(() => { if (generation === epoch.current && operation === micOperation.current) { stopMic(); update({ error: "无法使用麦克风，请检查系统权限、设备占用和安全连接" }); } });
  }
  function sync(snapshot: OnlineSoupSnapshot) {
    if (viewRef.current.roomId !== snapshot.room.id) return;
    const member = snapshot.members.find(m => m.id === user?.id);
    if (snapshot.room.communicationMode !== "voice" || snapshot.room.status === "closed" || !member || member.role === "spectator") { disconnect(); return; }
    for (const [rtcId, userId] of mapping.current) {
      const remote = snapshot.members.find(m => m.id === userId);
      if (!remote || remote.role === "spectator" || remote.mutedUntil && new Date(remote.mutedUntil).getTime() > Date.now()) {
        mapping.current.delete(rtcId); void rtcRef.current?.muteRemoteAudio(rtcId, true).catch(() => {});
      }
    }
    if (member.mutedUntil && new Date(member.mutedUntil).getTime() > Date.now()) { stopMic(); update({ canPublish: false }); }
  }
  useEffect(() => {
    const roomId = viewRef.current.roomId;
    if (!roomId || location.pathname === `/online-soup/rooms/${roomId}` || location.pathname.startsWith(`/online-soup/rooms/${roomId}/`)) return;
    let minimized = false;
    try { minimized = Boolean(user && localStorage.getItem(`hgt:online-soup:minimized:${user.id}`) === roomId); } catch { /* Storage may be unavailable. */ }
    if (!minimized) disconnect();
  }, [location.pathname]);
  useEffect(() => {
    disposed.current = false;
    const background = () => { if (document.visibilityState !== "visible") disconnect(); };
    const blur = () => { if (!viewRef.current.always) stopMic(); };
    const offline = () => { stopMic(); update({ error: "网络已断开，麦克风已关闭" }); };
    document.addEventListener("visibilitychange", background); window.addEventListener("hgt-native-background", disconnect); window.addEventListener("pagehide", disconnect); window.addEventListener("blur", blur); window.addEventListener("offline", offline);
    return () => { disconnect(); disposed.current = true; document.removeEventListener("visibilitychange", background); window.removeEventListener("hgt-native-background", disconnect); window.removeEventListener("pagehide", disconnect); window.removeEventListener("blur", blur); window.removeEventListener("offline", offline); };
  }, [user?.id]);
  return <Context.Provider value={{ ...view, connect, disconnect, press: () => press(), release: () => { if (!viewRef.current.always) stopMic(); }, toggle: () => { if (viewRef.current.always) stopMic(); else press(true); }, sync,
    resumeAudio: () => { void Promise.all([...resume.current].map(fn => fn())).then(() => { resume.current.clear(); update({ autoplayBlocked: false }); }).catch(() => {}); } }}>{children}</Context.Provider>;
}
