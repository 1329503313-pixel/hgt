import { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  Bold,
  Edit3,
  Eye,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Plus,
  Search,
  Trash2,
  Underline,
  Users,
  X
} from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";
import { AdminPageSize, AdminPagination } from "./AdminPagination";
import { ListSkeleton } from "../Skeletons";

type NoticeSummary = {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  updatedAt: string;
  expiresAt: string | null;
  validDurationMinutes: number;
  status: "published" | "expired";
  readCount: number;
};

type NoticeDetail = NoticeSummary & { content: string };
type NoticeReader = { id: string; nickname: string; username: string; readAt: string };

const emptyForm = { title: "", author: "", content: "", validDays: 7, validHours: 0 };

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(totalMinutes: number) {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return `${days > 0 ? `${days}天` : ""}${hours > 0 ? `${hours}小时` : ""}` || "不足1小时";
}

function currentNoticeStatus(notice: Pick<NoticeSummary, "expiresAt" | "status">) {
  return notice.expiresAt && new Date(notice.expiresAt).getTime() <= Date.now() ? "expired" : notice.status;
}

function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value;
  }, [value]);

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current.contains(range.commonAncestorContainer)) rangeRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const selection = window.getSelection();
    if (!selection || !rangeRef.current) return;
    selection.removeAllRanges();
    selection.addRange(rangeRef.current);
  }

  function command(name: string, argument?: string) {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(name, false, argument);
    rememberSelection();
    onChange(editorRef.current?.innerHTML ?? "");
  }

  async function uploadImage(file?: File) {
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("仅支持 JPG、PNG、GIF 或 WebP 图片");
    if (file.size > 2 * 1024 * 1024) throw new Error("单张图片不能超过 2MB");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand("insertImage", false, dataUrl);
    onChange(editorRef.current?.innerHTML ?? "");
    if (fileRef.current) fileRef.current.value = "";
  }

  const tools = [
    { title: "加粗", icon: <Bold size={16} />, action: () => command("bold") },
    { title: "斜体", icon: <Italic size={16} />, action: () => command("italic") },
    { title: "下划线", icon: <Underline size={16} />, action: () => command("underline") },
    { title: "无序列表", icon: <List size={16} />, action: () => command("insertUnorderedList") },
    { title: "有序列表", icon: <ListOrdered size={16} />, action: () => command("insertOrderedList") }
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-blue-100">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-slate-50 p-2">
        {tools.map((tool) => (
          <button
            key={tool.title}
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-blue-100 hover:text-primary"
            title={tool.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={tool.action}
          >
            {tool.icon}
          </button>
        ))}
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ink hover:bg-blue-100 hover:text-primary"
          onMouseDown={() => rememberSelection()}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={16} /> 上传图片
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(event) => void uploadImage(event.target.files?.[0]).catch((error) => alert(error.message))}
        />
      </div>
      <div
        ref={editorRef}
        className="notice-rich-editor min-h-[300px] px-4 py-3 text-sm leading-7 text-ink outline-none"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder="请输入通知正文……"
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onBlur={rememberSelection}
      />
    </div>
  );
}

export function NoticeManagement() {
  const { user, showToast } = useApp();
  const [notices, setNotices] = useState<NoticeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [viewing, setViewing] = useState<NoticeDetail | null>(null);
  const [readerTitle, setReaderTitle] = useState("");
  const [readers, setReaders] = useState<NoticeReader[] | null>(null);
  const [, setClock] = useState(() => Date.now());

  const loadNotices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (submittedKeyword) params.set("keyword", submittedKeyword);
      const data = await api<{ notices: NoticeSummary[]; total: number }>(`/api/admin/notices?${params}`);
      setNotices(data.notices);
      setTotal(data.total);
      setSelected(new Set());
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, submittedKeyword, showToast]);

  useEffect(() => { void loadNotices(); }, [loadNotices]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, author: user?.nickname ?? "" });
  }

  async function openEdit(id: string) {
    try {
      const data = await api<{ notice: NoticeDetail }>(`/api/admin/notices/${id}?trackRead=false`);
      setEditingId(id);
      setForm({
        title: data.notice.title,
        author: data.notice.author,
        content: data.notice.content,
        validDays: Math.floor(data.notice.validDurationMinutes / 1440),
        validHours: Math.floor((data.notice.validDurationMinutes % 1440) / 60)
      });
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  async function openView(id: string) {
    try {
      const data = await api<{ notice: NoticeDetail }>(`/api/admin/notices/${id}`);
      setViewing(data.notice);
      setNotices((current) => current.map((item) => item.id === id ? { ...item, readCount: data.notice.readCount } : item));
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  async function openReaders(notice: NoticeSummary) {
    try {
      const data = await api<{ title: string; readers: NoticeReader[] }>(`/api/admin/notices/${notice.id}/readers`);
      setReaderTitle(data.title);
      setReaders(data.readers);
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  async function saveNotice() {
    const content = DOMPurify.sanitize(form.content, { USE_PROFILES: { html: true } });
    const plainText = new DOMParser().parseFromString(content, "text/html").body.textContent?.trim() ?? "";
    const hasImage = /<img\b/i.test(content);
    if (!form.title.trim()) return showToast("请输入标题");
    if (!form.author.trim()) return showToast("请输入作者");
    if (!plainText && !hasImage) return showToast("请输入正文内容");
    if (form.validDays < 0 || form.validHours < 0 || form.validHours > 23 || (form.validDays === 0 && form.validHours === 0)) return showToast("有效时间至少为1小时");
    setSaving(true);
    try {
      await api(editingId ? `/api/admin/notices/${editingId}` : "/api/admin/notices", {
        method: editingId ? "PUT" : "POST",
        body: {
          title: form.title.trim(),
          author: form.author.trim(),
          content,
          validDays: form.validDays,
          validHours: form.validHours
        }
      });
      showToast(editingId ? "通知已更新" : "通知已发布");
      setEditingId(null);
      setForm(emptyForm);
      setPage(1);
      await loadNotices();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteNotices(ids: string[]) {
    if (!ids.length || !confirm(`确定删除选中的 ${ids.length} 篇通知吗？此操作不可恢复。`)) return;
    try {
      if (ids.length === 1) await api(`/api/admin/notices/${ids[0]}`, { method: "DELETE" });
      else await api("/api/admin/notices/bulk-delete", { method: "POST", body: { ids } });
      showToast("通知已删除");
      await loadNotices();
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  const allChecked = notices.length > 0 && notices.every((notice) => selected.has(notice.id));

  return (
    <div className="card p-4">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-black text-ink">通知管理</h2>
          <p className="mt-1 text-xs text-muted">已发布通知会在有效期内展示到前台，过期后自动失效。</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary h-10 px-4" onClick={openCreate}><Plus size={17} />增加</button>
          <button className="btn btn-danger h-10 px-4" disabled={!selected.size} onClick={() => void deleteNotices([...selected])}>
            <Trash2 size={17} />删除{selected.size ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <input
          className="field h-10 pl-4 pr-24"
          placeholder="搜索标题、作者"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setSubmittedKeyword(keyword.trim()); } }}
        />
        <button className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={() => { setPage(1); setSubmittedKeyword(keyword.trim()); }}>
          <Search size={18} />搜索
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1180px]">
          <div className="grid grid-cols-[42px_minmax(180px,1fr)_110px_160px_110px_90px_70px_360px] items-center gap-2 border-b border-line px-3 pb-2 text-center text-xs font-bold text-muted">
            <input type="checkbox" aria-label="全选" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(notices.map((notice) => notice.id)))} />
            <span>标题</span><span>作者</span><span>发布时间</span><span>有效时间</span><span>状态</span><span>阅读量</span><span>操作</span>
          </div>
          <div className="space-y-1 pt-2">
            {notices.map((notice) => (
              <div key={notice.id} className="grid grid-cols-[42px_minmax(180px,1fr)_110px_160px_110px_90px_70px_360px] items-center gap-2 rounded-xl border border-line px-3 py-3 text-center text-sm">
                <input
                  type="checkbox"
                  aria-label={`选择${notice.title}`}
                  checked={selected.has(notice.id)}
                  onChange={() => setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(notice.id)) next.delete(notice.id); else next.add(notice.id);
                    return next;
                  })}
                />
                <button className="min-w-0 truncate text-left font-bold text-ink hover:text-primary" title={notice.title} onClick={() => void openView(notice.id)}>{notice.title}</button>
                <span className="truncate text-muted" title={notice.author}>{notice.author}</span>
                <span className="text-xs text-muted">{formatDate(notice.publishedAt)}</span>
                <span className="text-xs text-muted" title={notice.expiresAt ? `失效时间：${formatDate(notice.expiresAt)}` : ""}>{formatDuration(notice.validDurationMinutes)}</span>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${currentNoticeStatus(notice) === "published" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                  {currentNoticeStatus(notice) === "published" ? "已发布" : "已失效"}
                </span>
                <span className="font-semibold text-ink">{notice.readCount}</span>
                <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                  <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => void openEdit(notice.id)}><Edit3 size={14} />编辑</button>
                  <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => void openView(notice.id)}><Eye size={14} />查看</button>
                  <button className="btn btn-danger h-8 px-2 text-xs" onClick={() => void deleteNotices([notice.id])}><Trash2 size={14} />删除</button>
                  <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => void openReaders(notice)}><Users size={14} />阅读用户</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!notices.length && !loading && <p className="py-10 text-center text-sm text-muted">暂无通知</p>}
      {loading && <ListSkeleton rows={6} />}
      <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} />

      {(editingId !== null || form.author || form.title || form.content) && (
        <Modal full onClose={() => { setEditingId(null); setForm(emptyForm); }}>
          <div className="flex h-full flex-col">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div><h3 className="text-xl font-black text-ink">{editingId ? "编辑通知" : "新增通知"}</h3><p className="mt-1 text-xs text-muted">支持富文本排版和正文图片上传</p></div>
              <button className="btn btn-secondary h-10 w-10 p-0" onClick={() => { setEditingId(null); setForm(emptyForm); }}><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-3">
              <label className="block"><span className="label mb-1.5 block">标题</span><input className="field" maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="请输入通知标题" /></label>
              <label className="block"><span className="label mb-1.5 block">作者</span><input className="field" maxLength={100} value={form.author} onChange={(event) => setForm((current) => ({ ...current, author: event.target.value }))} placeholder="请输入作者" /></label>
              <div>
                <span className="label mb-1.5 block">有效时间</span>
                <div className="grid grid-cols-2 gap-3">
                  <label className="relative"><input className="field pr-12" type="number" min={0} max={3650} value={form.validDays} onChange={(event) => setForm((current) => ({ ...current, validDays: Math.max(0, Number(event.target.value) || 0) }))} /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">天</span></label>
                  <label className="relative"><input className="field pr-16" type="number" min={0} max={23} value={form.validHours} onChange={(event) => setForm((current) => ({ ...current, validHours: Math.min(23, Math.max(0, Number(event.target.value) || 0)) }))} /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">小时</span></label>
                </div>
                <p className="mt-1.5 text-xs text-muted">从发布时间开始计算，最短 1 小时；到期后前台自动隐藏。</p>
              </div>
              <div><span className="label mb-1.5 block">正文</span><RichTextEditor value={form.content} onChange={(content) => setForm((current) => ({ ...current, content }))} /></div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button className="btn btn-secondary" onClick={() => { setEditingId(null); setForm(emptyForm); }}>取消</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => void saveNotice()}>{saving ? "保存中……" : editingId ? "保存修改" : "发布通知"}</button>
            </div>
          </div>
        </Modal>
      )}

      {viewing && (
        <Modal full onClose={() => setViewing(null)}>
          <article className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-4">
              <div><h3 className="text-2xl font-black leading-tight text-ink">{viewing.title}</h3><p className="mt-2 text-sm text-muted">作者：{viewing.author}　 发布时间：{formatDate(viewing.publishedAt)}　 有效时间：{formatDuration(viewing.validDurationMinutes)}　 状态：{currentNoticeStatus(viewing) === "published" ? "已发布" : "已失效"}　 阅读：{viewing.readCount}</p></div>
              <button className="btn btn-secondary h-10 w-10 shrink-0 p-0" onClick={() => setViewing(null)}><X size={18} /></button>
            </div>
            <div className="notice-rich-content text-ink" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewing.content, { USE_PROFILES: { html: true } }) }} />
          </article>
        </Modal>
      )}

      {readers && (
        <Modal onClose={() => setReaders(null)}>
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black text-ink">阅读用户</h3><p className="mt-1 line-clamp-1 text-xs text-muted">{readerTitle}</p></div><button className="btn btn-secondary h-9 w-9 p-0" onClick={() => setReaders(null)}><X size={16} /></button></div>
          <div className="mt-4 max-h-[55vh] overflow-y-auto">
            <div className="grid grid-cols-[1fr_1fr_150px] gap-2 border-b border-line px-2 pb-2 text-center text-xs font-bold text-muted"><span>昵称</span><span>账号</span><span>阅读时间</span></div>
            {readers.map((reader) => <div key={reader.id} className="grid grid-cols-[1fr_1fr_150px] gap-2 border-b border-line/60 px-2 py-3 text-center text-sm"><span className="truncate font-semibold text-ink">{reader.nickname}</span><span className="truncate text-muted">{reader.username}</span><span className="text-xs text-muted">{formatDate(reader.readAt)}</span></div>)}
            {!readers.length && <p className="py-8 text-center text-sm text-muted">暂无阅读用户</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
