import { useEffect, useState } from "react";
import { CircleEllipsis, MessageCircle, Share2, Users } from "lucide-react";
import { api } from "../api";
import { Modal } from "./Modal";
import { useApp } from "../context/AppContext";
import type { CircleSummary, SocialUser } from "../shared/types";
import { isShareCancelled, shareImageToWechat } from "../android/platform";
import { publicSiteEndpoint } from "../runtime";

type Props = {
  roomId: string;
  roomName: string;
  roomCode: string;
  onClose: () => void;
  showToast: (message: string) => void;
};

type Target = { kind: "circle" | "friend"; id: string; name: string };

const INVITE_POSTER_WIDTH = 520;
const INVITE_POSTER_HEIGHT = 720;

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("二维码加载失败"));
    image.src = source;
  });
}

function splitPosterTitle(context: CanvasRenderingContext2D, title: string, maxWidth: number) {
  const characters = Array.from(title.trim() || "在线玩汤房间");
  const lines: string[] = [];
  let current = "";

  for (const character of characters) {
    const candidate = current + character;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
      if (lines.length === 2) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < 2 && current) lines.push(current);

  const consumedLength = lines.join("").length;
  if (consumedLength < characters.length && lines.length) {
    let lastLine = lines[lines.length - 1];
    while (lastLine && context.measureText(`${lastLine}…`).width > maxWidth) {
      lastLine = Array.from(lastLine).slice(0, -1).join("");
    }
    lines[lines.length - 1] = `${lastLine}…`;
  }
  return lines.slice(0, 2);
}

async function createInvitePoster(roomName: string, roomCode: string, qrCode: string) {
  const canvas = document.createElement("canvas");
  canvas.width = INVITE_POSTER_WIDTH;
  canvas.height = INVITE_POSTER_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成邀请图片");

  context.save();
  roundedRect(context, 0, 0, INVITE_POSTER_WIDTH, INVITE_POSTER_HEIGHT, 48);
  context.clip();
  context.fillStyle = "#eaf2ff";
  context.fillRect(0, 0, INVITE_POSTER_WIDTH, INVITE_POSTER_HEIGHT);
  context.fillStyle = "rgba(91, 141, 239, 0.2)";
  context.beginPath();
  context.arc(480, -22, 176, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(123, 214, 197, 0.2)";
  context.beginPath();
  context.arc(40, 730, 176, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.shadowColor = "rgba(30, 64, 120, 0.16)";
  context.shadowBlur = 38;
  context.shadowOffsetY = 14;
  roundedRect(context, 24, 24, 472, 672, 40);
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.fill();
  context.restore();

  const uiFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";

  context.fillStyle = "#3970d4";
  context.beginPath();
  context.arc(177, 100, 32, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(161, 103);
  context.quadraticCurveTo(177, 116, 193, 103);
  context.moveTo(164, 94);
  context.lineTo(190, 94);
  context.stroke();
  context.lineWidth = 3;
  for (const x of [168, 177, 186]) {
    context.beginPath();
    context.moveTo(x, 88);
    context.quadraticCurveTo(x - 4, 83, x, 78);
    context.stroke();
  }

  context.fillStyle = "#3970d4";
  context.font = `900 27px ${uiFont}`;
  context.fillText("在线玩汤", 292, 100);
  context.fillStyle = "#6b7c99";
  context.font = `700 20px ${uiFont}`;
  context.fillText("好友邀请你加入房间", 260, 151);

  context.fillStyle = "#102a56";
  context.font = `900 40px ${uiFont}`;
  const titleLines = splitPosterTitle(context, roomName, 400);
  const firstTitleY = titleLines.length > 1 ? 197 : 218;
  titleLines.forEach((line, index) => context.fillText(line, 260, firstTitleY + index * 43));

  roundedRect(context, 118, 268, 284, 68, 34);
  context.fillStyle = "#edf4ff";
  context.fill();
  context.font = `700 20px ${uiFont}`;
  context.fillStyle = "#71819d";
  context.fillText("房间号", 180, 302);
  context.font = `900 34px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
  context.fillStyle = "#3970d4";
  context.fillText(roomCode, 303, 302);

  context.save();
  context.shadowColor = "rgba(25, 55, 105, 0.12)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 10;
  roundedRect(context, 136, 358, 248, 248, 32);
  context.fillStyle = "#ffffff";
  context.fill();
  context.restore();

  const qrImage = await loadImage(qrCode);
  context.drawImage(qrImage, 150, 372, 220, 220);
  context.fillStyle = "#102a56";
  context.font = `900 24px ${uiFont}`;
  context.fillText("微信扫码，一起推理", 260, 650);

  return canvas.toDataURL("image/png");
}

function dataUrlToPngFile(dataUrl: string, fileName: string) {
  const base64 = dataUrl.split(",", 2)[1];
  if (!base64) throw new Error("邀请图片生成失败");
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName, { type: "image/png" });
}

export function OnlineSoupInviteModal({ roomId, roomName, roomCode, onClose, showToast }: Props) {
  const { user } = useApp();
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
        const url = publicSiteEndpoint(`/online-soup/rooms/${encodeURIComponent(roomId)}?invite=${encodeURIComponent(token)}`);
        const { default: QRCode } = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(url, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#102A56", light: "#FFFFFF" }
        });
        if (!cancelled) {
          setInviteToken(token);
          setQrCode(dataUrl);
        }
      })
      .catch((error) => showToast(error instanceof Error ? error.message : "邀请信息生成失败"))
      .finally(() => { if (!cancelled) setPreparing(false); });
    return () => { cancelled = true; };
  }, [roomId, showToast]);

  useEffect(() => {
    if (!qrCode) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void document.fonts?.ready.then(() => createInvitePoster(roomName, roomCode, qrCode)).then((dataUrl) => {
        if (cancelled) return;
        setPosterDataUrl(dataUrl);
        setPosterFile(dataUrlToPngFile(dataUrl, `玩汤邀请-${roomCode}.png`));
      }).catch((error) => { if (!cancelled) showToast(error instanceof Error ? error.message : "邀请图片生成失败"); });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [qrCode, roomCode, roomName, showToast]);

  async function shareToWechat() {
    if (sharing || !posterFile || !posterDataUrl) return;
    setSharing(true);
    try {
      await shareImageToWechat({
        file: posterFile,
        title: `${roomName}｜在线玩汤邀请`,
        text: `房间号 ${roomCode}，点击或扫码加入房间`
      });
    } catch (error) {
      if (!isShareCancelled(error)) showToast(error instanceof Error ? error.message : "系统分享暂时不可用");
    } finally {
      setSharing(false);
    }
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
          {posterDataUrl
            ? <img className="mx-auto h-[360px] w-[260px] rounded-[24px]" src={posterDataUrl} alt={`${roomName}玩汤房间邀请海报`} />
            : <div className="mx-auto grid h-[360px] w-[260px] place-items-center rounded-[24px] bg-[#eaf2ff] text-sm font-bold text-muted">{preparing || qrCode ? "邀请图片生成中…" : "邀请图片生成失败"}</div>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button className="btn btn-secondary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" disabled={!posterFile || sharing} onClick={() => void shareToWechat()}><Share2 size={18} /><span className="text-xs">{sharing ? "分享中…" : !posterFile ? "生成中…" : "分享到微信"}</span></button>
          <button className="btn btn-secondary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" disabled={!inviteToken || sharing} onClick={() => void openCircles()}><CircleEllipsis size={18} /><span className="text-xs">分享到圈子</span></button>
          <button className="btn btn-secondary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" disabled={!inviteToken || sharing} onClick={() => void openFriends()}><MessageCircle size={18} /><span className="text-xs">分享给好友</span></button>
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
