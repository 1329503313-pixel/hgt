import { api } from "../api";
import type { OnlineSoupRoomInvite } from "./types";
import { connectOnlineSoupLobbySocket } from "./onlineSoupSocket";

type InviteListener = (invite: OnlineSoupRoomInvite) => void;
type InviteEntry = {
  invite: OnlineSoupRoomInvite;
  listeners: Set<InviteListener>;
};

const entries = new Map<string, InviteEntry>();
const inFlight = new Map<string, Promise<void>>();
let disconnectSocket: (() => void) | null = null;
let pollTimer: number | null = null;

function statusPath(invite: OnlineSoupRoomInvite) {
  return `/api/online-soup/rooms/${encodeURIComponent(invite.roomId)}/invite-status?inviteToken=${encodeURIComponent(invite.inviteToken)}`;
}

async function refreshRoom(roomId: string) {
  const entry = entries.get(roomId);
  if (!entry || inFlight.has(roomId)) return inFlight.get(roomId);
  const request = api<{ invite: OnlineSoupRoomInvite }>(statusPath(entry.invite), { bypassCache: true })
    .then(({ invite }) => {
      const current = entries.get(roomId);
      if (!current) return;
      current.invite = invite;
      current.listeners.forEach((listener) => listener(invite));
    })
    .catch(() => undefined)
    .finally(() => inFlight.delete(roomId));
  inFlight.set(roomId, request);
  return request;
}

function refreshAll() {
  entries.forEach((_entry, roomId) => void refreshRoom(roomId));
}

function stopTransportIfIdle() {
  if (entries.size > 0) return;
  disconnectSocket?.();
  disconnectSocket = null;
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener("visibilitychange", refreshWhenVisible);
}

function refreshWhenVisible() {
  if (document.visibilityState === "visible") refreshAll();
}

function startTransport() {
  if (disconnectSocket) return;
  disconnectSocket = connectOnlineSoupLobbySocket(
    () => refreshAll(),
    (connected) => { if (connected) refreshAll(); }
  );
  pollTimer = window.setInterval(refreshAll, 15_000);
  document.addEventListener("visibilitychange", refreshWhenVisible);
}

export function subscribeOnlineSoupInviteStatus(invite: OnlineSoupRoomInvite, listener: InviteListener) {
  let entry = entries.get(invite.roomId);
  if (!entry) {
    entry = { invite, listeners: new Set() };
    entries.set(invite.roomId, entry);
  } else if (entry.invite.inviteToken !== invite.inviteToken) {
    entry.invite = invite;
  }
  entry.listeners.add(listener);
  listener(entry.invite);
  startTransport();
  void refreshRoom(invite.roomId);

  return () => {
    const current = entries.get(invite.roomId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) entries.delete(invite.roomId);
    stopTransportIfIdle();
  };
}
