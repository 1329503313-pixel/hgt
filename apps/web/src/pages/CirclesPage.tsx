import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Users } from "lucide-react";
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

  return (
    <section className="min-h-screen bg-page">
      <PageTopBar title="圈子" backTo="/" />
      <div className="space-y-4">
        <div className="rounded-2xl bg-gradient-to-r from-blue-50 to-amber-50 p-4 shadow-soft">
          <h1 className="text-lg font-black text-ink">找到同好，一起聊汤</h1>
        </div>
        {(loadingUser || loading) ? <div className="rounded-2xl bg-white"><ListSkeleton rows={6} /></div> : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
            {circles.map((circle) => (
              <button
                key={circle.id}
                type="button"
                className="flex w-full items-center gap-3 border-b border-line px-4 py-4 text-left transition last:border-b-0 hover:bg-slate-50 active:bg-slate-100"
                onClick={() => openCircle(circle)}
              >
                <span className="relative h-14 w-14 shrink-0">
                  <img className="h-full w-full rounded-2xl object-cover" src={circle.avatar} alt={`${circle.name}头像`} loading="lazy" decoding="async" />
                  {circle.onlineCount > 0 && <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />}
                  {circle.isJoined && circle.unreadCount > 0 && (
                    <span className="absolute -right-2 -top-2 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-black leading-none text-white">
                      {circle.unreadCount > 99 ? "99+" : circle.unreadCount}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-base font-black text-ink">{circle.name}</span>
                    {!circle.isJoined && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">未加入</span>}
                  </span>
                  <span className={`mt-1 block truncate text-sm ${circle.unreadMention ? "font-bold text-primary" : "text-muted"}`}>
                    {circle.unreadMention
                      ? `有人@你 [${circle.unreadMention.content}]`
                      : circle.latestMessage
                        ? `${circle.latestMessage.senderName}：${circle.latestMessage.content}`
                        : "还没有消息，来聊第一句吧"}
                  </span>
                  <span className="mt-1.5 flex items-center gap-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1"><Users size={13} />{circle.memberCount} 位成员</span>
                    <span className="inline-flex items-center gap-1 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />{circle.onlineCount} 人在线</span>
                  </span>
                </span>
                <span className="shrink-0 self-start pt-1 text-xs text-muted">
                  {circle.latestMessage ? messageTime(circle.latestMessage.createdAt) : <MessageCircle size={17} />}
                </span>
              </button>
            ))}
            {!circles.length && <p className="py-20 text-center text-sm text-muted">暂无圈子</p>}
          </div>
        )}
      </div>

      {joining && (
        <Modal onClose={() => !saving && setJoining(null)}>
          <div className="space-y-4 text-center">
            <img className="mx-auto h-20 w-20 rounded-3xl object-cover shadow-soft" src={joining.avatar} alt="" />
            <div>
              <h2 className="text-xl font-black text-ink">是否加入圈子？</h2>
              <p className="mt-1 text-sm text-muted">加入「{joining.name}」后即可进入聊天。</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-secondary" disabled={saving} onClick={() => setJoining(null)}>取消</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => void join()}>{saving ? "加入中…" : "加入"}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
