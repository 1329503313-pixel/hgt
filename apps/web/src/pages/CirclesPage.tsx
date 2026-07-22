import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Compass, MessageCircle, Radio, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import type { CircleSummary } from "../shared/types";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { Modal } from "../components/Modal";
import { subscribeServerEvent } from "../shared/serverEvents";

function messageTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function latestMessage(circle: CircleSummary) {
  if (circle.unreadMention) return `有人@你 [${circle.unreadMention.content}]`;
  if (circle.latestMessage) return `${circle.latestMessage.senderName}：${circle.latestMessage.content}`;
  return "还没有消息，来聊第一句吧";
}

function CircleAvatar({ circle, size = "h-14 w-14" }: { circle: CircleSummary; size?: string }) {
  return (
    <span className={`relative shrink-0 ${size}`}>
      <img className="h-full w-full rounded-2xl object-cover" src={circle.avatar} alt={`${circle.name}头像`} loading="lazy" decoding="async" />
      {circle.onlineCount > 0 && <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />}
      {circle.isJoined && circle.unreadCount > 0 && (
        <span className="absolute -right-2 -top-2 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-black leading-none text-white">
          {circle.unreadCount > 99 ? "99+" : circle.unreadCount}
        </span>
      )}
    </span>
  );
}

export default function CirclesPage() {
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<CircleSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ circles: CircleSummary[] }>("/api/circles", { bypassCache: true, dedupe: false });
    setCircles(data.circles);
  }, []);

  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
      navigate("/", { replace: true });
      return;
    }
    setLoading(true);
    void load().catch((error) => showToast((error as Error).message)).finally(() => setLoading(false));
  }, [user?.id, loadingUser, load]);

  useEffect(() => {
    if (!user) return;
    let timer: number | null = null;
    const refreshSoon = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load().catch(() => {}), 250);
    };
    const unsubscribePresence = subscribeServerEvent("circle_presence_changed", (event) => {
      try {
        const payload = JSON.parse(event.data) as { circleId?: string; onlineCount?: number };
        if (!payload.circleId || !Number.isFinite(payload.onlineCount)) return;
        setCircles((current) => current.map((circle) => (
          circle.id === payload.circleId
            ? { ...circle, onlineCount: Math.max(0, Number(payload.onlineCount)) }
            : circle
        )));
      } catch {
        refreshSoon();
      }
    });
    const unsubscribeUnread = subscribeServerEvent("circle_unread_changed", refreshSoon);
    return () => {
      unsubscribePresence();
      unsubscribeUnread();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [user?.id, load]);

  function openCircle(circle: CircleSummary) {
    if (circle.isJoined) navigate(`/circles/${circle.id}`);
    else setJoining(circle);
  }

  async function join() {
    if (!joining || saving) return;
    setSaving(true);
    try {
      await api(`/api/circles/${joining.id}/join`, { method: "POST" });
      navigate(`/circles/${joining.id}`);
      setJoining(null);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const joinedCircles = useMemo(() => circles.filter((circle) => circle.isJoined), [circles]);
  const discoveryCircles = useMemo(() => circles.filter((circle) => !circle.isJoined), [circles]);
  const onlineTotal = circles.reduce((total, circle) => total + circle.onlineCount, 0);
  const unreadTotal = joinedCircles.reduce((total, circle) => total + circle.unreadCount, 0);

  return (
    <section className="min-h-screen bg-page">
      <PageTopBar title="圈子" backTo="/" />
      {(loadingUser || loading) ? <div className="rounded-2xl bg-white"><ListSkeleton rows={6} /></div> : (
        <>
          <div className="space-y-4 lg:hidden">
            <div className="rounded-2xl bg-gradient-to-r from-blue-50 to-amber-50 p-4 shadow-soft"><h1 className="text-lg font-black text-ink">找到同好，一起聊汤</h1></div>
            <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
              {circles.map((circle) => (
                <button key={circle.id} type="button" className="flex w-full items-center gap-3 border-b border-line px-4 py-4 text-left transition last:border-b-0 hover:bg-slate-50 active:bg-slate-100" onClick={() => openCircle(circle)}>
                  <CircleAvatar circle={circle} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="truncate text-base font-black text-ink">{circle.name}</span>{!circle.isJoined && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">未加入</span>}</span>
                    <span className={`mt-1 block truncate text-sm ${circle.unreadMention ? "font-bold text-primary" : "text-muted"}`}>{latestMessage(circle)}</span>
                    <span className="mt-1.5 flex items-center gap-3 text-xs text-muted"><span className="inline-flex items-center gap-1"><Users size={13} />{circle.memberCount} 位成员</span><span className="inline-flex items-center gap-1 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />{circle.onlineCount} 人在线</span></span>
                  </span>
                  <span className="shrink-0 self-start pt-1 text-xs text-muted">{circle.latestMessage ? messageTime(circle.latestMessage.createdAt) : <MessageCircle size={17} />}</span>
                </button>
              ))}
              {!circles.length && <p className="py-20 text-center text-sm text-muted">暂无圈子</p>}
            </div>
          </div>

          <div className="hidden space-y-7 lg:block">
            <div className="grid grid-cols-3 gap-5">
              <div className="card flex items-center gap-4 p-5"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-primary"><Users size={23} /></span><div><p className="text-2xl font-black text-ink">{joinedCircles.length}</p><p className="mt-0.5 text-xs font-bold text-muted">已加入圈子</p></div></div>
              <div className="card flex items-center gap-4 p-5"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Radio size={23} /></span><div><p className="text-2xl font-black text-ink">{onlineTotal}</p><p className="mt-0.5 text-xs font-bold text-muted">当前在线成员</p></div></div>
              <div className="card flex items-center gap-4 p-5"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-500"><MessageCircle size={23} /></span><div><p className="text-2xl font-black text-ink">{unreadTotal > 99 ? "99+" : unreadTotal}</p><p className="mt-0.5 text-xs font-bold text-muted">未读圈子消息</p></div></div>
            </div>

            <section>
              <div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary">MY CIRCLES</p><h2 className="mt-1 text-2xl font-black text-ink">我的圈子</h2></div><p className="text-sm text-muted">最近消息与在线状态会实时更新</p></div>
              {joinedCircles.length ? (
                <div className="grid grid-cols-2 gap-5">
                  {joinedCircles.map((circle) => (
                    <button key={circle.id} type="button" className="card group flex min-h-44 flex-col p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg" onClick={() => openCircle(circle)}>
                      <div className="flex items-start gap-4"><CircleAvatar circle={circle} size="h-16 w-16" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-lg font-black text-ink">{circle.name}</span>{circle.unreadMention && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-primary">@我</span>}</span><span className={`mt-2 block truncate text-sm ${circle.unreadMention ? "font-bold text-primary" : "text-muted"}`}>{latestMessage(circle)}</span></span><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-50 text-muted transition group-hover:bg-primary group-hover:text-white"><ArrowUpRight size={18} /></span></div>
                      <div className="mt-auto flex items-center gap-5 border-t border-line pt-4 text-xs font-bold text-muted"><span className="inline-flex items-center gap-1.5"><Users size={14} />{circle.memberCount} 位成员</span><span className="inline-flex items-center gap-1.5 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />{circle.onlineCount} 人在线</span>{circle.latestMessage && <span className="ml-auto font-normal">{messageTime(circle.latestMessage.createdAt)}</span>}</div>
                    </button>
                  ))}
                </div>
              ) : <div className="card py-16 text-center text-sm text-muted">你还没有加入圈子，可以从下方发现感兴趣的同好。</div>}
            </section>

            {discoveryCircles.length > 0 && (
              <section>
                <div className="mb-4"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-600">DISCOVER</p><h2 className="mt-1 text-2xl font-black text-ink">发现更多圈子</h2></div>
                <div className="grid grid-cols-3 gap-5">
                  {discoveryCircles.map((circle) => (
                    <button key={circle.id} type="button" className="card group flex items-center gap-4 p-5 text-left transition hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-lg" onClick={() => openCircle(circle)}>
                      <CircleAvatar circle={circle} size="h-14 w-14" /><span className="min-w-0 flex-1"><span className="block truncate font-black text-ink">{circle.name}</span><span className="mt-1.5 flex items-center gap-3 text-xs text-muted"><span>{circle.memberCount} 位成员</span><span className="text-emerald-600">{circle.onlineCount} 在线</span></span></span><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 transition group-hover:bg-amber-500 group-hover:text-white"><Compass size={18} /></span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {!circles.length && <div className="card py-24 text-center text-sm text-muted">暂无圈子</div>}
          </div>
        </>
      )}

      {joining && (
        <Modal onClose={() => !saving && setJoining(null)}>
          <div className="space-y-4 text-center">
            <img className="mx-auto h-20 w-20 rounded-3xl object-cover shadow-soft" src={joining.avatar} alt="" />
            <div><h2 className="text-xl font-black text-ink">是否加入圈子？</h2><p className="mt-1 text-sm text-muted">加入「{joining.name}」后即可进入聊天。</p></div>
            <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={saving} onClick={() => setJoining(null)}>取消</button><button className="btn btn-primary" disabled={saving} onClick={() => void join()}>{saving ? "加入中…" : "加入"}</button></div>
          </div>
        </Modal>
      )}
    </section>
  );
}
