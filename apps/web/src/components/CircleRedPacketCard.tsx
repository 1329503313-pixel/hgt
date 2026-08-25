import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Shell, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { CircleRedPacket, CircleRedPacketDetail } from "../shared/types";

export function CircleRedPacketCard({ circleId, packet, onStatusChange }: { circleId: string; packet: CircleRedPacket; onStatusChange?: (detail: CircleRedPacketDetail) => void }) {
  const { showToast, triggerRefresh } = useApp();
  const [detail, setDetail] = useState<CircleRedPacketDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"loading" | "envelope" | "opening" | "result">("loading");
  const closeRef = useRef<HTMLButtonElement>(null);
  const expired = new Date(packet.expiresAt).getTime() <= Date.now();
  const claimedByMe = (detail?.myAmount ?? packet.myAmount) !== null;
  const claimedCount = detail?.claimedCount ?? packet.claimedCount;
  const description = claimedByMe
    ? "红包已领取"
    : claimedCount >= packet.packetCount
      ? "红包已领完"
      : expired
        ? "红包已过期"
        : "领取红包，看看手气";

  async function showPacket() {
    setOpen(true);
    setPhase("loading");
    try {
      const data = await api<{ packet: CircleRedPacketDetail }>(`/api/circles/${circleId}/red-packets/${packet.id}`, { bypassCache: true, dedupe: false });
      setDetail(data.packet);
      setPhase(data.packet.canClaim ? "envelope" : "result");
      if (!data.packet.canClaim) onStatusChange?.(data.packet);
    } catch (error) { setOpen(false); showToast((error as Error).message); }
  }

  async function claim() {
    if (phase !== "envelope") return;
    setPhase("opening");
    try {
      await api<{ amount: number; balance: number }>(`/api/circles/${circleId}/red-packets/${packet.id}/claim`, { method: "POST" });
      triggerRefresh();
      const [data] = await Promise.all([
        api<{ packet: CircleRedPacketDetail }>(`/api/circles/${circleId}/red-packets/${packet.id}`, { bypassCache: true, dedupe: false }),
        new Promise((resolve) => window.setTimeout(resolve, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : 400))
      ]);
      setDetail(data.packet);
      setPhase("result");
      onStatusChange?.(data.packet);
    } catch (error) {
      try {
        const data = await api<{ packet: CircleRedPacketDetail }>(`/api/circles/${circleId}/red-packets/${packet.id}`, { bypassCache: true, dedupe: false });
        setDetail(data.packet);
        setPhase(data.packet.canClaim ? "envelope" : "result");
        if (!data.packet.canClaim) onStatusChange?.(data.packet);
      } catch { setPhase("envelope"); }
      showToast((error as Error).message);
    }
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && phase !== "opening") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [open, phase]);

  return <>
    <button type="button" onClick={() => void showPacket()} className={`w-full max-w-[330px] overflow-hidden rounded-xl text-left shadow-[0_8px_24px_rgba(125,45,28,0.18)] transition-transform active:scale-[0.98] ${expired ? "bg-[#c98972]" : "bg-[#e95d3f]"}`}>
      <span className="flex min-h-[88px] items-center gap-3 px-4 py-3 text-white"><span className="grid h-12 w-10 shrink-0 place-items-center rounded-md border-2 border-[#ffe1a6] bg-[#f8b84e] text-[#fff7df]"><Shell size={25} /></span><span><strong className="block text-[15px]">系统拼手气红包</strong><span className="mt-1 block text-xs text-white/80">{description}</span></span></span>
      <span className="block bg-white px-4 py-1.5 text-[10px] text-slate-500">海龟汤 · 系统红包</span>
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="系统红包">
      <div className={`relative w-full ${phase === "result" ? "max-w-[390px]" : "max-w-[330px]"}`}>
      <button ref={closeRef} className="absolute right-3 top-3 z-30 grid h-11 w-11 place-items-center rounded-full bg-black/15 text-white hover:bg-black/25" aria-label="关闭红包" disabled={phase === "opening"} onClick={() => setOpen(false)}><X size={22} /></button>
      {phase === "loading" ? <div className="grid min-h-32 place-items-center rounded-[28px] bg-[#d94b37] text-sm font-bold text-white shadow-2xl">红包加载中…</div> : phase === "envelope" || phase === "opening" ? <div className={`relative h-[440px] w-full overflow-hidden rounded-[28px] bg-[#d94b37] text-center text-[#ffe9bc] shadow-2xl ${phase === "opening" ? "animate-red-packet-open" : ""}`}>
        <div className="absolute inset-x-[-18%] top-[-205px] h-[390px] rounded-[50%] bg-[#e76045] shadow-[0_8px_18px_rgba(91,24,18,0.2)]" />
        <div className="relative z-10 px-8 pt-24"><p className="text-lg font-black">系统红包</p><p className="mt-5 text-sm text-[#ffd8a1]">祝你今天好手气</p></div>
        <button type="button" disabled={phase === "opening"} onClick={() => void claim()} className="absolute left-1/2 top-[168px] z-20 grid h-20 w-20 -translate-x-1/2 place-items-center rounded-full border-4 border-[#f7cb73] bg-[#ffd88a] text-3xl font-black text-[#9e5a20] shadow-lg disabled:cursor-wait" aria-label="打开红包"><span className={phase === "opening" ? "animate-red-packet-coin" : ""}>开</span></button>
        <p className="absolute inset-x-0 bottom-8 text-xs text-[#ffd8a1]">24 小时内有效 · 每人限领一次</p>
      </div> : detail && <div className="flex max-h-[min(620px,86dvh)] w-full flex-col overflow-hidden rounded-[28px] bg-[#fff9f2] shadow-2xl">
        <div className="shrink-0 bg-[#df543d] px-6 pb-8 pt-10 text-center text-white"><Shell className="mx-auto text-[#ffe0a0]" size={34} /><p className="mt-3 text-sm text-white/80">系统拼手气红包</p>{detail.myAmount !== null ? <><p className="mt-3 text-5xl font-black text-[#ffe0a0]">{detail.myAmount}<span className="ml-1 text-lg">贝壳</span></p><p className="mt-2 text-sm">已存入你的贝壳余额</p></> : <p className="mt-4 text-xl font-black">{detail.claimedCount >= detail.packetCount ? "手慢了，红包已领完" : new Date(detail.expiresAt).getTime() <= Date.now() ? "红包已过期" : "暂时无法领取"}</p>}</div>
        <div className="min-h-0 overflow-y-auto p-5"><div className="flex items-center justify-between border-b border-amber-100 pb-4 text-sm"><span className="font-bold text-ink">已领取 {detail.claimedCount}/{detail.packetCount} 个</span><span className="text-muted">{detail.claimedShells}/{detail.totalShells} 贝壳</span></div><div className="divide-y divide-amber-100">{detail.claims.map((claim) => <div key={claim.userId} className="flex min-h-14 items-center justify-between gap-3 py-2"><div className="min-w-0"><strong className="block truncate text-sm text-ink">{claim.nickname}</strong><span className="text-[11px] text-muted">{new Date(claim.claimedAt).toLocaleString("zh-CN", { hour12: false })}</span></div><span className="shrink-0 font-black text-[#b94732]">{claim.amount} 贝壳</span></div>)}</div>{detail.claims.length === 0 && <p className="py-8 text-center text-sm text-muted">还没有人领取</p>}</div>
      </div>}
      </div>
    </div>, document.body)}
  </>;
}
