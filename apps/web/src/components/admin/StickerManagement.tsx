import { useEffect, useMemo, useState } from "react";
import { Check, ImagePlus, LockKeyhole, Pencil, Plus, Save, Shell, Trash2, Video } from "lucide-react";
import { api } from "../../api";
import type { StickerAsset } from "../../shared/types";
import { Modal } from "../Modal";

type AdminSeries = { id: string; name: string; description: string; weight: number; systemLocked: boolean; stickerCount: number };
type AdminSticker = StickerAsset & { seriesId: string; seriesName: string; enabled: boolean; defaultOwned: boolean; hasAnimated: boolean; deleted: boolean; ownerCount: number; createdAt: string };
type StickerSort = "weight-desc" | "weight-asc" | "newest";

const blankSeries = { name: "", description: "", weight: 0 };
const blankSticker = { seriesId: "", name: "", description: "", staticImage: "", animatedImage: "" as string | null, price: 0, weight: 0, enabled: false };
const videoTypes = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]);
const videoExtensionTypes: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v"
};

function normalizedVideoType(file: File) {
  if (videoTypes.has(file.type)) return file.type;
  const extension = Object.keys(videoExtensionTypes).find((candidate) => file.name.toLowerCase().endsWith(candidate));
  return extension ? videoExtensionTypes[extension] : null;
}

function readStaticImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return reject(new Error("静态表情仅支持 PNG、JPG 或 WebP，不支持 GIF"));
    if (file.size > 2_200_000) return reject(new Error("静态表情不能超过 2MB，请压缩后重试"));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取静态表情失败"));
    reader.readAsDataURL(file);
  });
}

export function StickerManagement() {
  const [tab, setTab] = useState<"stickers" | "series">("stickers");
  const [series, setSeries] = useState<AdminSeries[]>([]);
  const [stickers, setStickers] = useState<AdminSticker[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingMotion, setUploadingMotion] = useState(false);
  const [seriesModal, setSeriesModal] = useState(false);
  const [stickerModal, setStickerModal] = useState(false);
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editingStickerId, setEditingStickerId] = useState<string | null>(null);
  const [stickerSort, setStickerSort] = useState<StickerSort>("weight-desc");
  const [seriesForm, setSeriesForm] = useState(blankSeries);
  const [stickerForm, setStickerForm] = useState(blankSticker);

  const activeSeries = useMemo(() => series.filter((item) => !item.systemLocked || item.id === "tangtang"), [series]);
  const latestUploadedSticker = useMemo(() => stickers
    .filter((item) => !item.defaultOwned)
    .reduce<AdminSticker | null>((latest, item) => !latest || Date.parse(item.createdAt) > Date.parse(latest.createdAt) ? item : latest, null), [stickers]);
  const sortedStickers = useMemo(() => [...stickers].sort((left, right) => {
    if (stickerSort === "newest") return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    const difference = left.weight - right.weight;
    return difference !== 0 ? (stickerSort === "weight-asc" ? difference : -difference) : Date.parse(right.createdAt) - Date.parse(left.createdAt);
  }), [stickerSort, stickers]);

  async function load() {
    const [seriesData, stickerData] = await Promise.all([
      api<{ series: AdminSeries[] }>("/api/admin/sticker-series", { bypassCache: true }),
      api<{ stickers: AdminSticker[] }>("/api/admin/stickers", { bypassCache: true })
    ]);
    setSeries(seriesData.series);
    setStickers(stickerData.stickers);
  }

  useEffect(() => { void load().catch((error) => setMessage((error as Error).message)); }, []);

  function openSeries(item?: AdminSeries) {
    setEditingSeriesId(item?.id ?? null);
    setSeriesForm(item ? { name: item.name, description: item.description, weight: item.weight } : blankSeries);
    setSeriesModal(true);
  }

  function openSticker(item?: AdminSticker) {
    setEditingStickerId(item?.id ?? null);
    setMessage("");
    setStickerForm(item
      ? { seriesId: item.seriesId, name: item.name, description: item.description, staticImage: item.staticUrl, animatedImage: item.hasAnimated ? item.animatedUrl : null, price: item.price, weight: item.weight, enabled: item.enabled }
      : { ...blankSticker, seriesId: latestUploadedSticker?.seriesId ?? activeSeries[0]?.id ?? "", price: latestUploadedSticker?.price ?? 0, weight: latestUploadedSticker ? latestUploadedSticker.weight - 1 : 0 });
    setStickerModal(true);
  }

  async function uploadAnimatedVideo(file: File) {
    const contentType = normalizedVideoType(file);
    if (!contentType) {
      setMessage("动态表情仅支持 MP4、WebM、MOV 或 M4V 视频，不支持 GIF");
      return;
    }
    if (!file.size || file.size > 20 * 1024 * 1024) {
      setMessage("动态表情视频不能为空且不能超过 20MB");
      return;
    }
    setUploadingMotion(true);
    setMessage("");
    try {
      const result = await api<{ animatedImage: string; size: number; format: "image/webp" }>("/api/admin/sticker-media/animated", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file
      });
      setStickerForm((current) => ({ ...current, animatedImage: result.animatedImage }));
      setMessage(`动态视频已转为 WebP（${Math.max(1, Math.round(result.size / 1024))}KB）`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setUploadingMotion(false);
    }
  }

  async function saveSeries() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      await api(editingSeriesId ? `/api/admin/sticker-series/${editingSeriesId}` : "/api/admin/sticker-series", { method: editingSeriesId ? "PATCH" : "POST", body: seriesForm });
      setSeriesModal(false);
      await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  }

  async function saveSticker() {
    if (saving || uploadingMotion) return;
    setSaving(true);
    setMessage("");
    try {
      const creating = !editingStickerId;
      await api(editingStickerId ? `/api/admin/stickers/${editingStickerId}` : "/api/admin/stickers", { method: editingStickerId ? "PATCH" : "POST", body: stickerForm });
      setStickerModal(false);
      if (creating) setStickerSort("newest");
      await load();
      setMessage(creating ? "表情包上传成功，已按最新上传置顶展示" : "表情包保存成功");
    } catch (error) {
      const errorMessage = (error as Error).message;
      setMessage(errorMessage);
      window.alert(`表情包保存失败：${errorMessage}`);
    } finally { setSaving(false); }
  }

  async function removeSticker(item: AdminSticker) {
    if (!window.confirm(`确认删除“${item.name}”吗？删除后商城和用户键盘不再展示，历史消息显示已下架。`)) return;
    try { await api(`/api/admin/stickers/${item.id}`, { method: "DELETE" }); await load(); }
    catch (error) { setMessage((error as Error).message); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-black text-ink">表情包管理</h2><p className="mt-1 text-sm text-muted">配置系列、价格、权重和静态/动态素材</p></div>
      <button className="btn btn-primary" onClick={() => tab === "series" ? openSeries() : openSticker()}><Plus size={17} />新增{tab === "series" ? "系列" : "表情包"}</button>
    </div>

    {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.includes("成功") || message.includes("已转为") ? "border-emerald-200 bg-emerald-50 font-bold text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`} role="alert">{message}</div>}

    <div className="flex gap-2 rounded-2xl border border-line bg-white p-2">
      <button className={`btn flex-1 ${tab === "stickers" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("stickers")}>表情包</button>
      <button className={`btn flex-1 ${tab === "series" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("series")}>表情包系列</button>
    </div>

    {tab === "stickers" && <div className="flex justify-end"><label className="flex min-h-11 items-center gap-2 text-sm font-bold text-muted"><span>排序</span><select className="field min-h-11 w-auto py-2" value={stickerSort} onChange={(event) => setStickerSort(event.target.value as StickerSort)}><option value="weight-desc">权重从高到低</option><option value="weight-asc">权重从低到高</option><option value="newest">最新上传</option></select></label></div>}

    {tab === "series"
      ? <div className="grid gap-3 lg:grid-cols-2">{series.map((item) => <article key={item.id} className="card flex items-start justify-between gap-4 p-4"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate font-black text-ink">{item.name}</h3>{item.systemLocked && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-muted"><LockKeyhole size={12} />系统系列</span>}</div><p className="mt-1 text-sm leading-6 text-muted">{item.description || "暂无描述"}</p><p className="mt-2 text-xs font-bold text-primary">权重 {item.weight} · {item.stickerCount} 张表情</p></div>{!item.systemLocked && <button className="btn btn-secondary shrink-0" onClick={() => openSeries(item)}><Pencil size={16} />编辑</button>}</article>)}</div>
      : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sortedStickers.map((item) => <article key={item.id} className={`card overflow-hidden p-3 ${item.deleted ? "opacity-55" : ""}`}><div className="flex gap-3"><div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-slate-50 p-2"><img src={item.staticUrl} alt={item.name} className="h-full w-full object-contain" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><h3 className="truncate font-black text-ink">{item.name}</h3>{item.hasAnimated && <Video size={15} className="shrink-0 text-violet-600" aria-label="包含动态表情" />}</div><p className="mt-1 text-xs text-muted">{item.seriesName} · 权重 {item.weight}</p><p className="mt-2 flex items-center gap-1 text-sm font-black text-primary"><Shell size={14} />{item.price}</p><p className="mt-1 text-[11px] text-muted">{item.ownerCount.toLocaleString()} 人拥有 · {item.deleted ? "已删除" : item.enabled ? "已上架" : "已下架"}</p></div></div><div className="mt-3 flex gap-2"><button className="btn btn-secondary flex-1" disabled={item.deleted} onClick={() => openSticker(item)}><Pencil size={16} />编辑</button><button className="btn border-red-200 bg-red-50 text-red-700 hover:bg-red-100" disabled={item.deleted || item.defaultOwned} title={item.defaultOwned ? "默认免费表情不可删除" : "删除"} onClick={() => void removeSticker(item)}><Trash2 size={16} /></button></div></article>)}</div>}

    {seriesModal && <Modal onClose={() => setSeriesModal(false)}>
      <h2 className="text-xl font-black text-ink">{editingSeriesId ? "编辑系列" : "新增系列"}</h2>
      <div className="mt-4 space-y-3">
        <label className="block"><span className="text-sm font-bold">系列名称</span><input className="field mt-1" maxLength={80} value={seriesForm.name} onChange={(event) => setSeriesForm({ ...seriesForm, name: event.target.value })} /></label>
        <label className="block"><span className="text-sm font-bold">描述</span><textarea className="field mt-1 min-h-24" maxLength={500} value={seriesForm.description} onChange={(event) => setSeriesForm({ ...seriesForm, description: event.target.value })} /></label>
        <label className="block"><span className="text-sm font-bold">权重</span><input type="number" className="field mt-1" value={seriesForm.weight} onChange={(event) => setSeriesForm({ ...seriesForm, weight: Number(event.target.value) })} /><span className="mt-1 block text-xs text-muted">权重越大，系列越靠前。</span></label>
      </div>
      <button className="btn btn-primary mt-5 w-full" disabled={saving} onClick={() => void saveSeries()}><Save size={17} />{saving ? "保存中" : "保存系列"}</button>
    </Modal>}

    {stickerModal && <Modal onClose={() => { if (!saving && !uploadingMotion) setStickerModal(false); }} full contentClassName="max-w-2xl">
      <div className="flex items-center justify-between"><h2 className="text-xl font-black text-ink">{editingStickerId ? "编辑表情包" : "新增表情包"}</h2><button className="btn btn-secondary" disabled={saving || uploadingMotion} onClick={() => setStickerModal(false)}>关闭</button></div>
      {message && <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${message.includes("已转为") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`} role="alert">{message}</div>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="text-sm font-bold">绑定系列</span><select className="field mt-1" value={stickerForm.seriesId} onChange={(event) => setStickerForm({ ...stickerForm, seriesId: event.target.value })}>{series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="block"><span className="text-sm font-bold">表情包名称</span><input className="field mt-1" maxLength={80} value={stickerForm.name} onChange={(event) => setStickerForm({ ...stickerForm, name: event.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="text-sm font-bold">描述</span><textarea className="field mt-1 min-h-20" maxLength={500} value={stickerForm.description} onChange={(event) => setStickerForm({ ...stickerForm, description: event.target.value })} /></label>
        <label className="block"><span className="text-sm font-bold">售价（贝壳）</span><input type="number" min="0" className="field mt-1" value={stickerForm.price} onChange={(event) => setStickerForm({ ...stickerForm, price: Number(event.target.value) })} /></label>
        <label className="block"><span className="text-sm font-bold">权重</span><input type="number" className="field mt-1" value={stickerForm.weight} onChange={(event) => setStickerForm({ ...stickerForm, weight: Number(event.target.value) })} /></label>

        <label className="block">
          <span className="text-sm font-bold">静态表情图片</span>
          <span className="mt-1 grid min-h-32 cursor-pointer place-items-center rounded-2xl border border-dashed border-blue-300 bg-blue-50 p-3 text-center text-sm font-bold text-primary">
            {stickerForm.staticImage ? <img src={stickerForm.staticImage} alt="静态表情预览" className="h-28 w-28 object-contain" /> : <><ImagePlus size={28} />上传 PNG、JPG 或 WebP</>}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readStaticImage(file).then((value) => setStickerForm((current) => ({ ...current, staticImage: value }))).catch((error) => setMessage((error as Error).message)); }} />
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-bold">动态表情视频（可选）</span>
          <span className={`mt-1 grid min-h-32 place-items-center rounded-2xl border border-dashed border-violet-300 bg-violet-50 p-3 text-center text-sm font-bold text-violet-700 ${uploadingMotion ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
            {uploadingMotion ? <><Video size={28} className="animate-pulse" />正在转为动态 WebP…</> : stickerForm.animatedImage ? <img src={stickerForm.animatedImage} alt="动态表情预览" className="h-28 w-28 object-contain" /> : <><Video size={28} />上传短视频</>}
            <input type="file" accept=".mp4,.webm,.mov,.m4v,video/mp4,video/webm,video/quicktime,video/x-m4v" disabled={uploadingMotion} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadAnimatedVideo(file); }} />
          </span>
          <span className="mt-2 block text-xs leading-5 text-muted">支持 MP4、WebM、MOV、M4V，最大 20MB；自动截取前 5 秒、移除声音并压缩为 320×320 动态 WebP。不支持 GIF。</span>
          {stickerForm.animatedImage && !uploadingMotion && <button type="button" className="mt-2 min-h-11 text-xs font-bold text-red-600" onClick={() => setStickerForm({ ...stickerForm, animatedImage: null })}>移除动态表情</button>}
        </label>
      </div>

      <label className="mt-4 flex min-h-11 items-center gap-3 rounded-xl bg-slate-50 px-3 text-sm font-bold"><input type="checkbox" checked={stickerForm.enabled} onChange={(event) => setStickerForm({ ...stickerForm, enabled: event.target.checked })} />{stickerForm.enabled ? <Check size={17} className="text-emerald-600" /> : null}上架到商城</label>
      <p className="mt-2 text-xs leading-5 text-muted">静态图用于商城和聊天键盘；动态 WebP 仅在商城预览及发送后的消息中播放。</p>
      <button className="btn btn-primary mt-5 w-full" disabled={saving || uploadingMotion || !stickerForm.seriesId || !stickerForm.name || !stickerForm.staticImage} onClick={() => void saveSticker()}><Save size={17} />{uploadingMotion ? "正在处理动态视频" : saving ? "正在压缩并保存" : "保存表情包"}</button>
    </Modal>}
  </div>;
}
