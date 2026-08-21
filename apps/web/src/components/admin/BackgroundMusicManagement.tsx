import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Music, Pencil, Plus, RefreshCw, Upload, Volume2, VolumeX } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";

type AdminBackgroundMusic = {
  id: string;
  name: string;
  audioUrl: string;
  audioRef: string;
  weight: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type MusicForm = {
  id: string | null;
  name: string;
  audioRef: string;
  audioUrl: string;
  weight: string;
  enabled: boolean;
  file: File | null;
};

const emptyForm: MusicForm = { id: null, name: "", audioRef: "", audioUrl: "", weight: "0", enabled: true, file: null };
const acceptedAudioTypes = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav"]);
const maxAudioBytes = 50 * 1024 * 1024;

export function BackgroundMusicManagement() {
  const { showToast } = useApp();
  const [tracks, setTracks] = useState<AdminBackgroundMusic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<MusicForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ tracks: AdminBackgroundMusic[] }>("/api/admin/background-music", { bypassCache: true, dedupe: false });
      setTracks(data.tracks);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "背景音乐加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function chooseFile(file: File | null) {
    if (!file || !form) return;
    if (!acceptedAudioTypes.has(file.type)) return showToast("音频仅支持 MP3、M4A 或 WAV");
    if (file.size > maxAudioBytes) return showToast("音频文件不能超过 50MB");
    setForm({ ...form, file });
  }

  async function save() {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) return showToast("请填写音乐名称");
    const weight = Number(form.weight);
    if (!Number.isInteger(weight) || weight < -1_000_000 || weight > 1_000_000) return showToast("权重必须是 -1000000 至 1000000 的整数");
    if (!form.file && !form.audioRef) return showToast("请上传音频");
    setSaving(true);
    try {
      let audioRef = form.audioRef;
      if (form.file) {
        const uploaded = await api<{ audioRef: string; audioUrl: string }>("/api/admin/background-music/audio", {
          method: "POST",
          headers: { "Content-Type": form.file.type },
          body: form.file,
        });
        audioRef = uploaded.audioRef;
      }
      const payload = { name, audioRef, weight, enabled: form.enabled };
      if (form.id) await api(`/api/admin/background-music/${form.id}`, { method: "PATCH", body: payload });
      else await api("/api/admin/background-music", { method: "POST", body: payload });
      showToast(form.id ? "背景音乐已更新" : "背景音乐已上传");
      setForm(null);
      await load();
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "背景音乐保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(track: AdminBackgroundMusic) {
    if (togglingId) return;
    setTogglingId(track.id);
    try {
      await api(`/api/admin/background-music/${track.id}`, {
        method: "PATCH",
        body: { name: track.name, audioRef: track.audioRef, weight: track.weight, enabled: !track.enabled },
      });
      showToast(track.enabled ? "背景音乐已下架，正在播放的房间不受影响" : "背景音乐已上架");
      await load();
    } catch (toggleError) {
      showToast(toggleError instanceof Error ? toggleError.message : "状态更新失败");
    } finally {
      setTogglingId("");
    }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">背景音乐</h2><p className="text-sm text-muted">管理房主可在玩汤房间选择的循环背景音乐</p></div><div className="flex gap-2"><button type="button" className="btn btn-secondary min-h-11" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />刷新</button><button type="button" className="btn btn-primary min-h-11" onClick={() => setForm({ ...emptyForm })}><Plus size={16} />上传背景音乐</button></div></div>
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-blue-800">下架后房主不能再选择该音乐；已经在房间播放的音乐会继续播放，直到房主停止或更换。</div>
    {error && <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">{error}</div>}
    {loading && <div className="card p-10 text-center text-muted" role="status"><LoaderCircle className="mx-auto mb-2 animate-spin" />加载中…</div>}
    {!loading && tracks.length === 0 && <div className="card p-12 text-center text-muted"><Music className="mx-auto mb-2" />暂无背景音乐</div>}
    {!loading && tracks.length > 0 && <div className="grid gap-3 lg:grid-cols-2">{tracks.map((track) => <article key={track.id} className="card space-y-3 p-4">
      <div className="flex items-start gap-3"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${track.enabled ? "bg-blue-50 text-primary" : "bg-slate-100 text-slate-500"}`}><Music size={21} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-black text-ink">{track.name}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${track.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{track.enabled ? "已上架" : "已下架"}</span></div><p className="mt-1 text-xs text-muted">权重 {track.weight} · 更新于 {new Date(track.updatedAt).toLocaleString("zh-CN")}</p></div></div>
      <audio className="h-10 w-full" controls preload="none" src={track.audioUrl}>当前浏览器不支持音频播放。</audio>
      <div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary min-h-11" onClick={() => setForm({ id: track.id, name: track.name, audioRef: track.audioRef, audioUrl: track.audioUrl, weight: String(track.weight), enabled: track.enabled, file: null })}><Pencil size={16} />编辑</button><button type="button" className={`btn min-h-11 ${track.enabled ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`} disabled={Boolean(togglingId)} onClick={() => void toggleEnabled(track)}>{togglingId === track.id ? <LoaderCircle size={16} className="animate-spin" /> : track.enabled ? <VolumeX size={16} /> : <Volume2 size={16} />}{track.enabled ? "下架" : "上架"}</button></div>
    </article>)}</div>}

    {form && <Modal onClose={() => { if (!saving) setForm(null); }}><div className="space-y-4">
      <div><h2 className="text-xl font-black text-ink">{form.id ? "编辑背景音乐" : "上传背景音乐"}</h2><p className="mt-1 text-sm text-muted">支持 MP3、M4A、WAV，最大 50MB；上传后统一转换为兼容格式。</p></div>
      <label className="block"><span className="mb-1.5 block text-sm font-bold text-ink">音乐名称</span><input className="field w-full" maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-bold text-ink">上传音频</span><span className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50 px-3 text-sm font-bold text-primary"><Upload size={17} /><span className="min-w-0 truncate">{form.file?.name ?? (form.audioRef ? "保留现有音频；点击可替换" : "选择音频文件")}</span><input className="sr-only" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,.mp3,.m4a,.wav" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} /></span></label>
      {(form.file || form.audioUrl) && <div className="rounded-xl bg-slate-50 p-3 text-xs text-muted">{form.file ? `待上传：${form.file.name}（${(form.file.size / 1024 / 1024).toFixed(1)}MB）` : <audio className="h-10 w-full" controls preload="none" src={form.audioUrl} />}</div>}
      <label className="block"><span className="mb-1.5 block text-sm font-bold text-ink">权重</span><input className="field w-full" type="number" step="1" min={-1_000_000} max={1_000_000} value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} /><span className="mt-1 block text-xs text-muted">权重越高，在房主选择列表中越靠前。</span></label>
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-slate-50 px-3"><span><span className="block text-sm font-bold text-ink">是否上架</span><span className="block text-xs text-muted">下架只禁止后续选择</span></span><input className="h-5 w-5 accent-blue-600" type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /></label>
      <div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary min-h-11" disabled={saving} onClick={() => setForm(null)}>取消</button><button type="button" className="btn btn-primary min-h-11" disabled={saving} onClick={() => void save()}>{saving ? <><LoaderCircle size={16} className="animate-spin" />上传并保存中…</> : "保存"}</button></div>
    </div></Modal>}
  </div>;
}
