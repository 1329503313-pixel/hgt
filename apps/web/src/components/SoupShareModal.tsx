import { useEffect, useRef, useState } from "react";
import { CircleEllipsis, MessageCircle, Share2, Users } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { CircleSummary, SocialUser, SoupDetail } from "../shared/types";
import { sanitizeHtml } from "../sanitizeHtml";
import { Modal } from "./Modal";

type Target = { kind: "circle" | "friend"; id: string; name: string };

export function SoupShareModal({ soup, onClose }: { soup: SoupDetail; onClose: () => void }) {
  const { user, openAuth, showToast } = useApp();
  const posterRef = useRef<HTMLDivElement>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterUrl, setPosterUrl] = useState("");
  const [panel, setPanel] = useState<"main" | "circles" | "friends">("main");
  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [friends, setFriends] = useState<SocialUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (!posterRef.current) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void import("html-to-image").then(({ toPng }) => toPng(posterRef.current!, { pixelRatio: 2, cacheBust: true, backgroundColor: "#F5F7FA" }))
        .then(async (url) => {
          const blob = await (await fetch(url)).blob();
          if (!cancelled) { setPosterUrl(url); setPosterFile(new File([blob], `${soup.title}-汤面.png`, { type: "image/png" })); }
        }).catch(() => { if (!cancelled) showToast("汤面分享图片生成失败"); });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [soup.id, soup.title, showToast]);

  function shareWechat() {
    if (!posterFile || sharing) return;
    const download = () => { const a = document.createElement("a"); a.href = posterUrl; a.download = posterFile.name; a.click(); };
    if (navigator.share && navigator.canShare?.({ files: [posterFile] })) {
      setSharing(true);
      void navigator.share({ title: `${soup.title}｜海龟汤汤面`, text: "分享一则海龟汤，来猜猜真相吧", files: [posterFile] })
        .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) { download(); showToast("系统分享不可用，汤面图片已下载"); } })
        .finally(() => setSharing(false));
    } else { download(); showToast("汤面图片已下载，可发送至微信好友或微信群"); }
  }

  async function openTargets(kind: "circles" | "friends") {
    if (!user) { openAuth(); return; }
    setPanel(kind); setLoading(true);
    try {
      if (kind === "circles") {
        const data = await api<{ circles: CircleSummary[] }>("/api/circles", { bypassCache: true, dedupe: false });
        setCircles(data.circles.filter((circle) => circle.isJoined));
      } else {
        const data = await api<{ users: SocialUser[] }>(`/api/users/${user.id}/follows?type=following`, { bypassCache: true, dedupe: false });
        setFriends([...data.users].sort((a, b) => Number(b.isMutual) - Number(a.isMutual) || Number(b.isOnline) - Number(a.isOnline)));
      }
    } catch (error) { showToast(error instanceof Error ? error.message : "分享对象加载失败"); }
    finally { setLoading(false); }
  }

  async function confirmShare() {
    if (!target || sharing) return;
    setSharing(true);
    try {
      const body = { soupShare: { soupId: soup.id } };
      if (target.kind === "circle") await api(`/api/circles/${target.id}/messages`, { method: "POST", body });
      else {
        const conversation = await api<{ id: string }>("/api/conversations", { method: "POST", body: { userId: target.id } });
        await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body });
      }
      showToast(`已分享至${target.kind === "circle" ? "圈子" : "好友"}「${target.name}」`); onClose();
    } catch (error) { showToast(error instanceof Error ? error.message : "分享失败"); }
    finally { setSharing(false); }
  }

  return <Modal onClose={onClose}>
    <div className="space-y-3">
      {panel === "main" ? <>
        <div className="pr-10"><h2 className="text-xl font-black text-ink">分享海龟汤</h2><p className="mt-1 text-sm text-muted">分享到微信、圈子或已关注的好友</p></div>
        <div className="max-h-[52dvh] overflow-auto rounded-2xl bg-slate-100 p-2">
          <div ref={posterRef} className="mx-auto w-[360px] max-w-full rounded-[24px] bg-[#f5f7fa] p-4 text-ink">
            <div className="rounded-[20px] bg-white p-5 shadow-soft">
              <p className="text-xs font-black tracking-[.18em] text-primary">海龟汤 · 汤面</p>
              <h3 className="mt-2 text-2xl font-black">{soup.title}</h3>
              <p className="mt-1 text-xs text-muted">{soup.author || "佚名"} · {soup.type} · {soup.difficulty}</p>
              <div className="content-block mt-5 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sanitizeHtml(soup.surface) }} />
              <p className="mt-5 border-t border-line pt-3 text-center text-xs font-bold text-muted">分享汤面，不剧透汤底</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button className="btn btn-primary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" disabled={!posterFile || sharing} onClick={shareWechat}><Share2 size={18} /><span>{posterFile ? "分享到微信" : "生成中…"}</span></button>
          <button className="btn btn-secondary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" onClick={() => void openTargets("circles")}><CircleEllipsis size={18} /><span>分享到圈子</span></button>
          <button className="btn btn-secondary h-auto min-h-14 flex-col gap-1 px-2 py-2 text-xs" onClick={() => void openTargets("friends")}><MessageCircle size={18} /><span>分享给好友</span></button>
        </div>
      </> : <>
        <div className="pr-10"><h3 className="font-black text-ink">{panel === "circles" ? "选择圈子" : "选择好友"}</h3></div>
        <div className="max-h-[58dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {loading ? <p className="py-12 text-center text-sm text-muted">加载中…</p> : panel === "circles" ? circles.map((circle) => <button key={circle.id} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50" onClick={() => setTarget({ kind: "circle", id: circle.id, name: circle.name })}><img className="h-11 w-11 rounded-xl object-cover" src={circle.avatar} alt="" /><span className="min-w-0 flex-1 truncate font-black">{circle.name}</span><Users size={17} className="text-muted" /></button>) : friends.map((friend) => <button key={friend.id} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50" onClick={() => setTarget({ kind: "friend", id: friend.id, name: friend.nickname })}><span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-primary">{friend.avatar ? <img className="h-full w-full object-cover" src={friend.avatar} alt="" /> : friend.nickname.slice(0, 1)}</span><span className="min-w-0 flex-1 truncate font-black">{friend.nickname}</span></button>)}
          {!loading && ((panel === "circles" && !circles.length) || (panel === "friends" && !friends.length)) && <p className="py-12 text-center text-sm text-muted">暂无可分享对象</p>}
        </div>
      </>}
    </div>
    {target && <Modal onClose={() => !sharing && setTarget(null)}><div className="space-y-4 text-center"><div><h2 className="text-xl font-black text-ink">是否分享至「{target.name}」？</h2><p className="mt-2 text-sm text-muted">将发送一张可点击进入详情页的海龟汤卡片。</p></div><div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={sharing} onClick={() => setTarget(null)}>取消</button><button className="btn btn-primary" disabled={sharing} onClick={() => void confirmShare()}>{sharing ? "分享中…" : "分享"}</button></div></div></Modal>}
  </Modal>;
}
