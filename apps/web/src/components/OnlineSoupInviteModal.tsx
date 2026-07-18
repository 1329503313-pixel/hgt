import { useEffect, useRef, useState } from "react";
import { CircleEllipsis, MessageCircle, Share2, Soup, Users } from "lucide-react";
import { api } from "../api";
import { Modal } from "./Modal";
import { useApp } from "../context/AppContext";
import type { CircleSummary, SocialUser } from "../shared/types";

type Props = {
  roomId: string;
  roomName: string;
  roomCode: string;
  onClose: () => void;
  showToast: (message: string) => void;
};

type Target = { kind: "circle" | "friend"; id: string; name: string };

export function OnlineSoupInviteModal({ roomId, roomName, roomCode, onClose, showToast }: Props) {
  const { user } = useApp();
  const posterRef = useRef<HTMLDivElement>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [posterDataUrl, setPosterDataUrl] = useState("");
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [panel, setPanel] = useState<"main" | "circles" | "friends">("main");
  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [friends, setFriends] = useState<SocialUser[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Target | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ token: string }>(`/api/online-soup/rooms/${roomId}/invite`, { bypassCache: true, dedupe: false })
      .then(async ({ token }) => {
        const url = `${window.location.origin}/online-soup/rooms/${encodeURIComponent(roomId)}?invite=${encodeURIComponent(token)}`;
        const { default: QRCode } = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(url, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#102A56", light: "#FFFFFF" }
        });
        if (!cancelled) {
          setInviteToken(token);
          setInviteUrl(url);
          setQrCode(dataUrl);
        }
      })
      .catch((error) => showToast(error instanceof Error ? error.message : "邀请信息生成失败"))
      .finally(() => { if (!cancelled) setPreparing(false); });
    return () => { cancelled = true; };
  }, [roomId, showToast]);

  async function renderPoster() {
    if (!posterRef.current || !qrCode) throw new Error("邀请海报尚未准备完成");
    await document.fonts?.ready;
    const { toPng } = await import("html-to-image");
    return toPng(posterRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#EAF2FF" });
  }

  useEffect(() => {
    if (!qrCode) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void renderPoster().then(async (dataUrl) => {
        const blob = await (await fetch(dataUrl)).blob();
        if (cancelled) return;
        setPosterDataUrl(dataUrl);
        setPosterFile(new File([blob], `玩汤邀请-${roomCode}.png`, { type: "image/png" }));
      }).catch((error) => { if (!cancelled) showToast(error instanceof Error ? error.message : "邀请图片生成失败"); });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [qrCode, roomCode, showToast]);

  function shareToWechat() {
    if (sharing || !posterFile || !posterDataUrl) return;
    const downloadPoster = () => {
      const anchor = document.createElement("a");
      anchor.href = posterDataUrl;
      anchor.download = posterFile.name;
      anchor.click();
    };
    if (navigator.share && navigator.canShare?.({ files: [posterFile] })) {
      setSharing(true);
      void navigator.share({
        title: `${roomName}｜在线玩汤邀请`,
        text: `房间号 ${roomCode}，点击或扫码加入房间`,
        files: [posterFile]
      }).catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          downloadPoster();
          showToast("系统分享不可用，邀请图片已下载，可发送至微信");
        }
      }).finally(() => setSharing(false));
      return;
    }
    downloadPoster();
    showToast("邀请图片已下载，可发送至微信好友或微信群");
  }

  async function openCircles() {
    setPanel("circles");
    setListLoading(true);
    try {
      const data = await api<{ circles: CircleSummary[] }>("/api/circles", { bypassCache: true, dedupe: false });
      setCircles(data.circles.filter((circle) => circle.isJoined));
    } catch (error) {
      showToast((error as Error).message);
    } finally { setListLoading(false); }
  }

  async function openFriends() {
    if (!user) return;
    setPanel("friends");
    setListLoading(true);
    try {
      const data = await api<{ users: SocialUser[] }>(`/api/users/${user.id}/follows?type=following`, { bypassCache: true, dedupe: false });
      setFriends([...data.users].sort((a, b) => Number(b.isMutual) - Number(a.isMutual) || Number(b.isOnline) - Number(a.isOnline)));
    } catch (error) {
      showToast((error as Error).message);
    } finally { setListLoading(false); }
  }

  async function confirmShare() {
    if (!confirmTarget || sharing || !inviteToken) return;
    setSharing(true);
    try {
      const roomInvite = { roomId, inviteToken };
      if (confirmTarget.kind === "circle") {
        await api(`/api/circles/${confirmTarget.id}/messages`, { method: "POST", body: { roomInvite } });
      } else {
        const conversation = await api<{ id: string }>("/api/conversations", { method: "POST", body: { userId: confirmTarget.id } });
        await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: { roomInvite } });
      }
      showToast(`已分享至${confirmTarget.kind === "circle" ? "圈子" : "好友"}「${confirmTarget.name}」`);
      setConfirmTarget(null);
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "分享失败");
    } finally { setSharing(false); }
  }

  return <Modal onClose={onClose}>
    <div className="space-y-3">
      {panel === "main" ? <>
        <div className="pr-10">
          <h2 className="text-xl font-black text-ink">邀请好友来玩汤</h2>
          <p className="mt-1 text-sm text-muted">分享到微信、圈子或已关注的好友</p>
        </div>
        <div className="overflow-hidden rounded-2xl bg-slate-100 py-2">
          <div ref={posterRef} data-invite-poster className="relative mx-auto h-[360px] w-full max-w-[260px] overflow-hidden rounded-[24px] bg-[#eaf2ff] p-3 text-[#102a56]">
            <div className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-[#5b8def]/20" />
            <div className="absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-[#7bd6c5]/20" />
            <div className="relative flex h-full flex-col items-center rounded-[20px] border border-white/80 bg-white/90 p-4 text-center shadow-[0_14px_38px_rgba(30,64,120,0.16)]">
              <div className="flex h-8 items-center justify-center gap-2 text-xs font-black tracking-[.1em] text-[#3970d4]"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#3970d4] text-white"><Soup size={17} /></span>在线玩汤</div>
              <p className="mt-2 text-[10px] font-bold tracking-[.14em] text-[#6b7c99]">好友邀请你加入房间</p>
              <h3 className="mt-1 line-clamp-2 flex min-h-[40px] w-full items-center justify-center text-[20px] font-black leading-[1.12] text-[#102a56]">{roomName}</h3>
              <div className="mt-2 inline-flex min-h-[34px] items-center justify-center gap-2 rounded-full bg-[#edf4ff] px-4 py-1.5">
                <span className="text-[10px] font-bold tracking-[.08em] text-[#71819d]">房间号</span>
                <span className="font-mono text-[17px] font-black tracking-[.14em] text-[#3970d4]">{roomCode}</span>
              </div>
              <div className="mt-3 grid h-[118px] w-[118px] place-items-center rounded-2xl bg-white shadow-[0_8px_20px_rgba(25,55,105,0.12)]">
                {qrCode ? <img className="h-[108px] w-[108px] rounded-xl p-1" src={qrCode} alt="房间邀请二维码" /> : <div className="grid h-[108px] w-[108px] place-items-center rounded-xl bg-slate-100 text-xs font-bold text-muted">{preparing ? "二维码生成中…" : "生成失败"}</div>}
              </div>
              <p className="mt-3 text-xs font-black tracking-[.04em] text-[#102a56]">微信扫码，一起推理</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button className="btn btn-primary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" disabled={!posterFile || sharing} onClick={shareToWechat}><Share2 size={18} /><span>{!posterFile ? "生成中…" : "分享到微信"}</span></button>
          <button className="btn btn-secondary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" disabled={!inviteToken} onClick={() => void openCircles()}><CircleEllipsis size={18} /><span>分享到圈子</span></button>
          <button className="btn btn-secondary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" disabled={!inviteToken} onClick={() => void openFriends()}><MessageCircle size={18} /><span>分享给好友</span></button>
        </div>
      </> : <>
        <div className="pr-10">
          <div><h3 className="font-black text-ink">{panel === "circles" ? "选择圈子" : "选择好友"}</h3><p className="text-xs text-muted">{panel === "circles" ? "仅展示自己已加入的圈子" : "互相关注用户优先展示"}</p></div>
        </div>
        <div className="max-h-[58dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {listLoading ? <p className="py-12 text-center text-sm text-muted">加载中…</p> : panel === "circles" ? circles.map((circle) => <button key={circle.id} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50" onClick={() => setConfirmTarget({ kind: "circle", id: circle.id, name: circle.name })}><img className="h-11 w-11 rounded-xl object-cover" src={circle.avatar} alt="" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-ink">{circle.name}</span><span className="mt-0.5 block text-xs text-muted">{circle.memberCount} 位成员 · {circle.onlineCount} 人在线</span></span><Users size={17} className="text-muted" /></button>) : friends.map((friend) => <button key={friend.id} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50" onClick={() => setConfirmTarget({ kind: "friend", id: friend.id, name: friend.nickname })}><span className="relative h-11 w-11 shrink-0"><span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-primary">{friend.avatar ? <img className="h-full w-full object-cover" src={friend.avatar} alt="" /> : friend.nickname.slice(0, 1)}</span>{friend.isOnline && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-black text-ink">{friend.nickname}</span>{friend.isMutual && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">互相关注</span>}</span><span className={`mt-0.5 block text-xs ${friend.isOnline ? "text-emerald-600" : "text-muted"}`}>{friend.isOnline ? "在线" : "离线"}</span></span></button>)}
          {!listLoading && ((panel === "circles" && !circles.length) || (panel === "friends" && !friends.length)) && <p className="py-12 text-center text-sm text-muted">{panel === "circles" ? "还没有加入圈子" : "还没有关注用户"}</p>}
        </div>
      </>}
    </div>

    {confirmTarget && <Modal onClose={() => !sharing && setConfirmTarget(null)}>
      <div className="space-y-4 text-center">
        <div><h2 className="text-xl font-black text-ink">是否分享至「{confirmTarget.name}」？</h2><p className="mt-2 text-sm text-muted">将发送一张可点击、可免密加入的玩汤房间邀请卡片。</p></div>
        <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={sharing} onClick={() => setConfirmTarget(null)}>取消</button><button className="btn btn-primary" disabled={sharing} onClick={() => void confirmShare()}>{sharing ? "分享中…" : "分享"}</button></div>
      </div>
    </Modal>}
  </Modal>;
}
