import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { Edit3, Eye, ImagePlus, MessageCircle, Plus, RotateCcw, Trash2, Users, X } from "lucide-react";
import { api } from "../../api";
import type { CircleMessage } from "../../shared/types";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";
import { ListSkeleton } from "../Skeletons";
import { AdminPagination, paginateAdminItems, useAdminPagination } from "./AdminPagination";

type AdminCircle = {
  id: string;
  name: string;
  avatar: string;
  memberCount: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

const emptyForm = { name: "", avatar: "" };

export function CircleManagement() {
  const { showToast } = useApp();
  const [circles, setCircles] = useState<AdminCircle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AdminCircle | null | "new">(null);
  const [form, setForm] = useState(emptyForm);
  const [previewing, setPreviewing] = useState<AdminCircle | null>(null);
  const [messages, setMessages] = useState<CircleMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [messageHasMore, setMessageHasMore] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const pagination = useAdminPagination(circles.length);
  const visibleCircles = paginateAdminItems(circles, pagination);

  const load = useCallback(async () => {
    const data = await api<{ circles: AdminCircle[] }>("/api/admin/circles", { bypassCache: true, dedupe: false });
    setCircles(data.circles);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().catch((error) => showToast((error as Error).message)).finally(() => setLoading(false));
  }, [load]);

  function create() {
    setForm(emptyForm);
    setEditing("new");
  }

  function edit(circle: AdminCircle) {
    setForm({ name: circle.name, avatar: circle.avatar });
    setEditing(circle);
  }

  function readAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      showToast("仅支持 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      showToast("头像文件不能超过 4MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, avatar: String(reader.result) }));
    reader.onerror = () => showToast("头像读取失败");
    reader.readAsDataURL(file);
  }

  async function save() {
    const name = form.name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      if (editing === "new") {
        await api("/api/admin/circles", { method: "POST", body: { name, avatar: form.avatar || null } });
        showToast("圈子已创建");
      } else if (editing) {
        await api(`/api/admin/circles/${editing.id}`, { method: "PUT", body: { name, avatar: form.avatar || null } });
        showToast("圈子已更新");
      }
      setEditing(null);
      await load();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(circle: AdminCircle) {
    if (!window.confirm(`确认删除圈子「${circle.name}」？成员关系和全部聊天记录将同时删除，此操作不可恢复。`)) return;
    try {
      await api(`/api/admin/circles/${circle.id}`, { method: "DELETE" });
      setCircles((current) => current.filter((item) => item.id !== circle.id));
      showToast("圈子已删除");
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  async function loadMessages(circle: AdminCircle, before?: string) {
    setMessagesLoading(true);
    try {
      const params = before ? `?before=${encodeURIComponent(before)}` : "";
      const data = await api<{ messages: CircleMessage[]; hasMore: boolean; nextCursor: string | null }>(`/api/admin/circles/${circle.id}/messages${params}`, { bypassCache: true, dedupe: false });
      setMessages((current) => before ? [...data.messages, ...current] : data.messages);
      setMessageHasMore(data.hasMore);
      setMessageCursor(data.nextCursor);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setMessagesLoading(false);
    }
  }

  function preview(circle: AdminCircle) {
    setPreviewing(circle);
    setMessages([]);
    setMessageCursor(null);
    setMessageHasMore(false);
    void loadMessages(circle);
  }

  async function recall(message: CircleMessage) {
    if (!previewing || message.recalledAt || message.type === "gift") return;
    if (!window.confirm(`确认以管理员身份撤回 ${message.sender?.nickname || "已注销用户"} 的这条消息？`)) return;
    try {
      const result = await api<{ recalledAt: string }>(`/api/admin/circles/${previewing.id}/messages/${message.id}/recall`, { method: "PATCH" });
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, content: "", stickerId: null, mentions: [], recalledAt: result.recalledAt } : item));
      showToast("消息已撤回");
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft">
        <div><h2 className="text-xl font-black text-ink">圈子管理</h2><p className="mt-1 text-sm text-muted">仅管理员可创建、编辑和删除圈子。</p></div>
        <button className="btn btn-primary" onClick={create}><Plus size={17} />新建圈子</button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
        {loading ? <ListSkeleton rows={6} /> : circles.length ? (
          <div className="divide-y divide-line">
            {visibleCircles.map((circle) => (
              <div key={circle.id} className="flex flex-wrap items-center gap-3 px-4 py-4">
                <img className="h-14 w-14 shrink-0 rounded-2xl object-cover" src={circle.avatar} alt="" loading="lazy" decoding="async" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black text-ink">{circle.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1"><Users size={13} />{circle.memberCount} 位成员</span>
                    <span className="inline-flex items-center gap-1"><MessageCircle size={13} />{circle.messageCount} 条消息</span>
                    <span>创建于 {new Date(circle.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary px-3" onClick={() => preview(circle)}><Eye size={16} />预览</button>
                  <button className="btn btn-secondary px-3" onClick={() => edit(circle)}><Edit3 size={16} />编辑</button>
                  <button className="btn bg-red-50 px-3 text-red-600 hover:bg-red-100" onClick={() => void remove(circle)}><Trash2 size={16} />删除</button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="py-20 text-center text-sm text-muted">暂无圈子</p>}
        {!loading && circles.length > 0 && <div className="px-4 pb-4"><AdminPagination {...pagination} /></div>}
      </div>

      {editing && <Modal onClose={() => !saving && setEditing(null)}>
        <div className="space-y-4">
          <div><h2 className="text-xl font-black text-ink">{editing === "new" ? "新建圈子" : "编辑圈子"}</h2><p className="mt-1 text-sm text-muted">上传图片会自动裁切、压缩为 WebP 并使用版本化缓存。</p></div>
          <label className="space-y-1"><span className="label">圈名</span><input className="field" maxLength={50} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="请输入圈名" /></label>
          <div className="space-y-2">
            <span className="label">圈子头像</span>
            <div className="flex items-center gap-4">
              <img className="h-24 w-24 rounded-3xl border border-line bg-slate-100 object-cover" src={form.avatar || "/turtle-avatar.png?v=5272-20260716"} alt="头像预览" />
              <label className="btn btn-secondary cursor-pointer"><ImagePlus size={17} />选择图片<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={readAvatar} /></label>
              {form.avatar && <button className="text-sm font-bold text-red-500" onClick={() => setForm((current) => ({ ...current, avatar: "" }))}>使用默认头像</button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={saving} onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" disabled={saving || !form.name.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button></div>
        </div>
      </Modal>}
      {previewing && <Modal full onClose={() => setPreviewing(null)}>
        <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
          <div><h2 className="text-xl font-black text-ink">聊天记录 · {previewing.name}</h2><p className="mt-1 text-sm text-muted">管理员可撤回他人消息且不受时间限制；礼物消息不可撤回。</p></div>
          <button className="btn btn-secondary px-3" onClick={() => setPreviewing(null)}><X size={17} />关闭</button>
        </div>
        <div className="py-4">
          {messageHasMore && <button className="btn btn-secondary mx-auto mb-4 flex" disabled={messagesLoading || !messageCursor} onClick={() => messageCursor && void loadMessages(previewing, messageCursor)}>{messagesLoading ? "加载中…" : "加载更早记录"}</button>}
          <div className="space-y-2">
            {messages.map((message) => <div key={message.id} className="flex items-start gap-3 rounded-xl border border-line p-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-ink">{message.sender?.nickname || "已注销用户"}</strong><span className="text-xs text-muted">{new Date(message.createdAt).toLocaleString()}</span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-muted">{message.type}</span></div><p className={`mt-2 whitespace-pre-wrap break-words text-sm ${message.recalledAt ? "italic text-muted" : "text-ink"}`}>{adminMessageText(message)}</p></div>{!message.recalledAt && message.type !== "gift" && <button className="btn btn-danger h-8 shrink-0 px-2 text-xs" onClick={() => void recall(message)}><RotateCcw size={14} />撤回</button>}</div>)}
          </div>
          {!messagesLoading && messages.length === 0 && <p className="py-16 text-center text-sm text-muted">暂无聊天记录</p>}
          {messagesLoading && messages.length === 0 && <ListSkeleton rows={6} />}
        </div>
      </Modal>}
    </section>
  );
}

function adminMessageText(message: CircleMessage) {
  if (message.recalledAt) return "该消息已撤回";
  if (message.type === "sticker") return `[表情] ${message.stickerName || message.stickerId || ""}`.trim();
  if (message.type === "gift") return `[礼物] ${message.gift?.giftName || "礼物"} × ${message.gift?.quantity || 1}`;
  if (message.type === "soup_share") return `[汤品分享] ${message.soupShare?.title || ""}`.trim();
  if (message.type === "room_invite") return `[玩汤房间邀请] ${message.roomInvite?.roomName || ""}`.trim();
  return message.content || "—";
}
