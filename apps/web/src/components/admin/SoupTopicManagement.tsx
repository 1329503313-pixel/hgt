import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, LoaderCircle, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";

type SoupTopic = {
  id: string;
  name: string;
  isActive: boolean;
  soupCount: number;
  createdAt: string;
  updatedAt: string;
};

type TopicForm = {
  id: string | null;
  name: string;
  isActive: boolean;
};

const emptyForm: TopicForm = { id: null, name: "", isActive: true };

function topicNameLength(value: string) {
  return Array.from(value).length;
}

export function SoupTopicManagement() {
  const { showToast } = useApp();
  const [topics, setTopics] = useState<SoupTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<TopicForm | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTopics = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api<{ topics: SoupTopic[] }>("/api/admin/soup-topics", { bypassCache: true });
      setTopics(data.topics);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "话题加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTopics(); }, [loadTopics]);

  const activeCount = useMemo(() => topics.filter((topic) => topic.isActive).length, [topics]);

  async function saveTopic() {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) { setFormError("请输入话题名称"); return; }
    if (topicNameLength(name) > 16) { setFormError("话题名称最多 16 个字"); return; }
    setFormError("");
    setSaving(true);
    try {
      const path = form.id ? `/api/admin/soup-topics/${form.id}` : "/api/admin/soup-topics";
      const data = await api<{ topic: SoupTopic }>(path, {
        method: form.id ? "PUT" : "POST",
        body: { name, isActive: form.isActive }
      });
      setTopics((current) => {
        const next = form.id
          ? current.map((topic) => topic.id === data.topic.id ? data.topic : topic)
          : [data.topic, ...current];
        return [...next].sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.updatedAt.localeCompare(a.updatedAt));
      });
      setForm(null);
      showToast(form.id ? "话题已更新" : "话题已新增");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存话题失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTopic(topic: SoupTopic) {
    if (busyId) return;
    if (topic.isActive && !window.confirm(`下架“${topic.name}”后，新建和编辑汤品时将不能再选择，但已有绑定会保留。确认下架？`)) return;
    setBusyId(topic.id);
    try {
      await api(`/api/admin/soup-topics/${topic.id}/status`, {
        method: "PATCH",
        body: { isActive: !topic.isActive }
      });
      setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, isActive: !item.isActive, updatedAt: new Date().toISOString() } : item));
      showToast(topic.isActive ? "话题已下架，已有绑定保持不变" : "话题已上架");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "话题状态更新失败");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTopic(topic: SoupTopic) {
    if (busyId) return;
    const bindingText = topic.soupCount > 0 ? `，并解除 ${topic.soupCount} 个汤品的绑定` : "";
    if (!window.confirm(`确认删除“${topic.name}”吗？删除后将不可搜索${bindingText}。此操作不可撤销。`)) return;
    setBusyId(topic.id);
    try {
      await api(`/api/admin/soup-topics/${topic.id}`, { method: "DELETE" });
      setTopics((current) => current.filter((item) => item.id !== topic.id));
      showToast("话题已删除，相关汤品已解除绑定");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除话题失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-black text-ink">话题管理</h2>
          <p className="mt-1 text-sm leading-6 text-muted">共 {topics.length} 个话题，{activeCount} 个已上架。下架保留已有绑定，删除会自动解除绑定。</p>
        </div>
        <button className="btn btn-primary min-h-11 shrink-0" type="button" onClick={() => { setFormError(""); setForm(emptyForm); }}>
          <Plus size={17} />新增话题
        </button>
      </div>

      {loadError && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p className="font-bold">{loadError}</p>
          <button className="mt-2 min-h-11 font-bold text-primary underline underline-offset-4" type="button" onClick={() => void loadTopics()}>重新加载</button>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-40 place-items-center text-sm font-bold text-muted" role="status">
          <span className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={19} />正在加载话题…</span>
        </div>
      ) : !loadError && topics.length === 0 ? (
        <div className="mt-4 grid min-h-44 place-items-center rounded-2xl border border-dashed border-line bg-slate-50 px-4 text-center">
          <div><Tags className="mx-auto text-slate-400" size={28} /><p className="mt-3 font-bold text-ink">还没有话题</p><p className="mt-1 text-sm text-muted">新增并上架后，用户发布或编辑海龟汤时即可选择。</p></div>
        </div>
      ) : !loadError && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {topics.map((topic) => {
            const busy = busyId === topic.id;
            return (
              <article className="rounded-2xl border border-line bg-white p-4" key={topic.id}>
                <div className="flex items-start gap-3">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${topic.isActive ? "bg-blue-50 text-primary" : "bg-slate-100 text-slate-500"}`}><Tags size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-all font-black text-ink">{topic.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${topic.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{topic.isActive ? "已上架" : "已下架"}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">已绑定 {topic.soupCount} 个汤品</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button className="btn btn-secondary min-h-11 px-2 text-xs" type="button" disabled={Boolean(busyId)} onClick={() => { setFormError(""); setForm({ id: topic.id, name: topic.name, isActive: topic.isActive }); }}><Pencil size={15} />编辑</button>
                  <button className={`btn min-h-11 px-2 text-xs ${topic.isActive ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`} type="button" disabled={Boolean(busyId)} onClick={() => void toggleTopic(topic)}>{busy ? <LoaderCircle className="animate-spin" size={15} /> : topic.isActive ? <EyeOff size={15} /> : <Eye size={15} />}{topic.isActive ? "下架" : "上架"}</button>
                  <button className="btn min-h-11 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100" type="button" disabled={Boolean(busyId)} onClick={() => void deleteTopic(topic)}><Trash2 size={15} />删除</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {form && (
        <Modal onClose={() => { if (!saving) setForm(null); }}>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void saveTopic(); }}>
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-black text-ink">{form.id ? "编辑话题" : "新增话题"}</h2><p className="mt-1 text-sm text-muted">话题名称不可重复，最多 16 个字。</p></div>
              <button className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-muted" type="button" aria-label="关闭话题编辑窗口" disabled={saving} onClick={() => setForm(null)}><X size={19} /></button>
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-bold text-ink">话题名称 <span className="text-danger">*</span></span>
              <div className="relative">
                <input className="field pr-16" autoFocus value={form.name} maxLength={32} aria-invalid={Boolean(formError)} onChange={(event) => { setFormError(""); setForm({ ...form, name: event.target.value }); }} placeholder="请输入话题名称" />
                <span className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs ${topicNameLength(form.name.trim()) > 16 ? "font-bold text-danger" : "text-muted"}`}>{topicNameLength(form.name.trim())}/16</span>
              </div>
              {formError && <span className="block text-sm font-semibold text-danger" role="alert">{formError}</span>}
            </label>
            <label className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-slate-50 px-3 py-2">
              <span><strong className="block text-sm text-ink">是否上架</strong><span className="mt-0.5 block text-xs leading-5 text-muted">上架后可在汤品发布和编辑表单中选择</span></span>
              <input className="h-5 w-5 shrink-0 accent-blue-600" type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn btn-secondary min-h-11" type="button" disabled={saving} onClick={() => setForm(null)}>取消</button>
              <button className="btn btn-primary min-h-11" type="submit" disabled={saving || !form.name.trim() || topicNameLength(form.name.trim()) > 16}>{saving && <LoaderCircle className="animate-spin" size={16} />}{saving ? "保存中…" : "保存"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
