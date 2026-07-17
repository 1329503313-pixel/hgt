import { useEffect, useRef, useState } from "react";
import { Copy, Share2, Soup } from "lucide-react";
import { api } from "../api";
import { Modal } from "./Modal";

type Props = {
  roomId: string;
  roomName: string;
  roomCode: string;
  onClose: () => void;
  showToast: (message: string) => void;
};

export function OnlineSoupInviteModal({ roomId, roomName, roomCode, onClose, showToast }: Props) {
  const posterRef = useRef<HTMLDivElement>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [posterDataUrl, setPosterDataUrl] = useState("");
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ token: string }>(`/api/online-soup/rooms/${roomId}/invite`, { bypassCache: true, dedupe: false })
      .then(async ({ token }) => {
        const url = `${window.location.origin}/online-soup/rooms/${encodeURIComponent(roomId)}?invite=${encodeURIComponent(token)}`;
        const { default: QRCode } = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(url, {
          width: 420,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#102A56", light: "#FFFFFF" }
        });
        if (!cancelled) {
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
    return toPng(posterRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#EAF2FF"
    });
  }

  useEffect(() => {
    if (!qrCode) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void renderPoster()
        .then(async (dataUrl) => {
          const blob = await (await fetch(dataUrl)).blob();
          if (cancelled) return;
          setPosterDataUrl(dataUrl);
          setPosterFile(new File([blob], `玩汤邀请-${roomCode}.png`, { type: "image/png" }));
        })
        .catch((error) => {
          if (!cancelled) showToast(error instanceof Error ? error.message : "邀请图片生成失败");
        });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [qrCode, roomCode, showToast]);

  function sharePoster() {
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
          text: `房间号 ${roomCode}，扫码进入房间`,
          files: [posterFile]
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            downloadPoster();
            showToast("系统分享不可用，邀请图片已生成");
          }
        })
        .finally(() => setSharing(false));
      return;
    }
    downloadPoster();
    showToast("邀请图片已生成，可发送给微信好友");
  }

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast("邀请链接已复制");
    } catch {
      showToast("复制失败，请使用分享图片");
    }
  }

  return <Modal onClose={onClose}>
    <div className="space-y-4">
      <div className="pr-10">
        <div><h2 className="text-xl font-black text-ink">邀请好友来玩汤</h2><p className="mt-1 text-sm text-muted">分享邀请图片，好友扫码即可进入</p></div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-slate-100">
        <div ref={posterRef} data-invite-poster className="relative mx-auto h-[540px] w-full max-w-[320px] overflow-hidden rounded-[28px] bg-[#eaf2ff] p-5 text-[#102a56]">
          <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#5b8def]/20" />
          <div className="absolute -bottom-24 -left-20 h-56 w-56 rounded-full bg-[#7bd6c5]/20" />
          <div className="relative flex h-full flex-col rounded-[24px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(30,64,120,0.16)]">
            <div className="flex items-center gap-2 text-sm font-black tracking-[.12em] text-[#3970d4]"><span className="grid h-9 w-9 place-items-center rounded-full bg-[#3970d4] text-white"><Soup size={20} /></span>在线玩汤</div>
            <p className="mt-6 text-xs font-bold tracking-[.18em] text-[#6b7c99]">好友邀请你加入房间</p>
            <h3 className="mt-2 line-clamp-2 min-h-[58px] text-[25px] font-black leading-[1.2] text-[#102a56]">{roomName}</h3>
            <div className="mt-4 rounded-2xl bg-[#edf4ff] px-4 py-3">
              <p className="text-[11px] font-bold tracking-[.16em] text-[#71819d]">房间号</p>
              <p className="mt-1 font-mono text-[24px] font-black tracking-[.22em] text-[#3970d4]">{roomCode}</p>
            </div>
            <div className="mt-4 flex flex-1 items-center justify-center">
              {qrCode ? <img className="h-[160px] w-[160px] rounded-2xl bg-white p-2 shadow-[0_10px_28px_rgba(25,55,105,0.12)]" src={qrCode} alt="房间邀请二维码" /> : <div className="grid h-[160px] w-[160px] place-items-center rounded-2xl bg-slate-100 text-sm font-bold text-muted">{preparing ? "二维码生成中…" : "生成失败"}</div>}
            </div>
            <p className="text-center text-sm font-black text-[#102a56]">微信扫码，一起推理</p>
            <p className="mt-1 text-center text-[11px] font-medium text-[#8290a7]">邀请链接进入密码房无需输入密码</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button className="btn btn-secondary px-4" disabled={!inviteUrl} onClick={() => void copyLink()}><Copy size={16} /> 复制链接</button>
        <button className="btn btn-primary" disabled={!posterFile || sharing} onClick={sharePoster}><Share2 size={17} /> {!posterFile ? "图片生成中…" : sharing ? "分享中…" : "分享邀请图片"}</button>
      </div>
    </div>
  </Modal>;
}
