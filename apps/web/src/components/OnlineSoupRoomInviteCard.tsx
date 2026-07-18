import { DoorOpen, Hash, Soup, Users } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { OnlineSoupRoomInvite } from "../shared/types";

const statusLabels = {
  preparing: "准备中",
  playing: "游戏中",
  ended: "本轮结束",
  closed: "已关闭"
} as const;

export function OnlineSoupRoomInviteCard({ invite }: { invite: OnlineSoupRoomInvite }) {
  const navigate = useNavigate();
  const location = useLocation();
  const closed = invite.status === "closed";
  return (
    <button
      type="button"
      className="w-full max-w-[310px] overflow-hidden rounded-2xl border border-blue-200 bg-white text-left shadow-[0_8px_24px_rgba(37,99,235,0.12)] transition hover:-translate-y-0.5 hover:border-blue-300 active:translate-y-0 disabled:opacity-60"
      disabled={closed}
      onClick={() => navigate(
        `/online-soup/rooms/${encodeURIComponent(invite.roomId)}?invite=${encodeURIComponent(invite.inviteToken)}`,
        { state: { onlineSoupInviteReturnTo: `${location.pathname}${location.search}` } }
      )}
    >
      <span className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-white">
        <span className="inline-flex min-w-0 items-center gap-2 font-black"><DoorOpen size={18} /><span className="truncate">玩汤房间邀请</span></span>
        <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">{statusLabels[invite.status]}</span>
      </span>
      <span className="block space-y-2.5 p-4">
        <span className="block truncate text-base font-black text-ink">{invite.roomName}</span>
        <span className="flex items-center gap-2 text-xs text-muted"><Hash size={14} className="text-primary" /><span>房间号</span><strong className="font-mono text-sm tracking-[.12em] text-primary">{invite.roomCode}</strong></span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted"><Soup size={14} className="shrink-0 text-amber-600" /><span className="shrink-0">当前汤品</span><strong className="truncate text-ink">{invite.soupTitle || "尚未选择"}</strong></span>
        <span className="flex items-center gap-2 text-xs text-muted"><Users size={14} className="text-emerald-600" /><span>房间人数</span><strong className="text-ink">{invite.playerCount}/{invite.playerCapacity}</strong></span>
        <span className="block rounded-xl bg-blue-50 px-3 py-2 text-center text-xs font-black text-primary">{closed ? "房间已关闭" : "点击免密加入房间"}</span>
      </span>
    </button>
  );
}
