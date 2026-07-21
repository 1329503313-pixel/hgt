import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { Edit3, ExternalLink, ImagePlus, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { homeBannerUrl } from "../../shared/staticAssets";
import { Modal } from "../Modal";
import { ListSkeleton } from "../Skeletons";
import { BannerImageCropper } from "./BannerImageCropper";

type AdminBanner = {
  id: string;
  name: string;
  imageUrl: string | null;
  linkUrl: string | null;
  weight: number;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type BannerForm = { name: string; image: string | null; linkUrl: string; weight: number; enabled: boolean };
const emptyForm: BannerForm = { name: "", image: null, linkUrl: "", weight: 0, enabled: true };

function normalizeBannerLink(value: string) {
  const link = value.trim();
  if (!link) return null;
  if (link.startsWith("/") && !link.startsWith("//")) return link;
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(link)) {
    const localUrl = new URL(`http://${link}`);
    return `${localUrl.pathname}${localUrl.search}${localUrl.hash}`;
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9/_?&=.#%-]*$/.test(link)) return `/${link}`;
  return link;
}

export function BannerManagement() {
  const { showToast } = useApp();
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AdminBanner | null | "new">(null);
  const [form, setForm] = useState<BannerForm>(emptyForm);
  const [cropSource, setCropSource] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ banners: AdminBanner[] }>("/api/admin/banners", { bypassCache: true, dedupe: false });
    setBanners(data.banners);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().catch((error) => showToast((error as Error).message)).finally(() => setLoading(false));
  }, [load, showToast]);

  function create() {
    setForm(emptyForm);
    setEditing("new");
  }

  function edit(banner: AdminBanner) {
    setForm({ name: banner.name, image: banner.imageUrl, linkUrl: banner.linkUrl ?? "", weight: banner.weight, enabled: banner.enabled });
    setEditing(banner);
  }

  function readImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return showToast("仅支持 JPG、PNG 或 WebP 图片");
    if (file.size > 4 * 1024 * 1024) return showToast("Banner 图片不能超过 4MB");
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result);
      const image = new Image();
      image.onload = () => {
        const ratio = image.naturalWidth / image.naturalHeight;
        if (Math.abs(ratio - 16 / 9) < 0.01) setForm((current) => ({ ...current, image: source }));
        else setCropSource(source);
      };
      image.onerror = () => showToast("图片读取失败");
      image.src = source;
    };
    reader.onerror = () => showToast("图片读取失败");
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!form.name.trim() || saving || (editing === "new" && !form.image)) return;
    setSaving(true);
    try {
      const body = { ...form, name: form.name.trim(), linkUrl: normalizeBannerLink(form.linkUrl) };
      await api(editing === "new" ? "/api/admin/banners" : `/api/admin/banners/${editing!.id}`, {
        method: editing === "new" ? "POST" : "PUT",
        body
      });
      showToast(editing === "new" ? "Banner 已创建" : "Banner 已更新");
      setEditing(null);
      await load();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(banner: AdminBanner) {
    if (banner.isDefault) return showToast("默认 Banner 不可删除");
    if (!window.confirm(`确认删除 Banner「${banner.name}」？`)) return;
    try {
      await api(`/api/admin/banners/${banner.id}`, { method: "DELETE" });
      setBanners((current) => current.filter((item) => item.id !== banner.id));
      showToast("Banner 已删除");
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft">
        <div><h2 className="text-xl font-black text-ink">Banner 管理</h2><p className="mt-1 text-sm text-muted">上传后自动压缩至 300KB 以内；上架内容按权重从高到低展示，首页每 5 秒自动轮播。</p></div>
        <button className="btn btn-primary" onClick={create}><Plus size={17} />新增 Banner</button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
        {loading ? <ListSkeleton rows={4} /> : banners.length ? (
          <div className="divide-y divide-line">
            {banners.map((banner) => (
              <div key={banner.id} className="flex flex-wrap items-center gap-4 p-4">
                <img className="aspect-video w-44 max-w-[42vw] shrink-0 rounded-xl bg-slate-900 object-cover object-bottom" src={banner.imageUrl || homeBannerUrl} alt="" loading="lazy" />
                <div className="min-w-[180px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black text-ink">{banner.name}</p>
                    {banner.isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600"><LockKeyhole size={12} />默认</span>}
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${banner.enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>{banner.enabled ? "已上架" : "未上架"}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">权重 {banner.weight}</p>
                  <p className="mt-1 truncate text-xs text-muted">{banner.linkUrl ? <span className="inline-flex items-center gap-1"><ExternalLink size={12} />{banner.linkUrl}</span> : "未设置跳转链接"}</p>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary px-3" onClick={() => edit(banner)}><Edit3 size={16} />编辑</button>
                  {!banner.isDefault && <button className="btn bg-red-50 px-3 text-red-600 hover:bg-red-100" onClick={() => void remove(banner)}><Trash2 size={16} />删除</button>}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="py-20 text-center text-sm text-muted">暂无 Banner</p>}
      </div>

      {editing && <Modal onClose={() => !saving && setEditing(null)}>
        <div className="space-y-4">
          <div><h2 className="text-xl font-black text-ink">{editing === "new" ? "新增 Banner" : "编辑 Banner"}</h2><p className="mt-1 text-sm text-muted">图片将以 16:9 展示，比例不符时可手动拖动和缩放裁剪。</p></div>
          <label className="block space-y-1"><span className="label">名称</span><input className="field" maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="用于后台识别" /></label>
          <div className="space-y-2">
            <span className="label">Banner 图片</span>
            <img className="aspect-video w-full rounded-2xl bg-slate-900 object-cover object-bottom" src={form.image || homeBannerUrl} alt="Banner 预览" />
            <label className="btn btn-secondary w-full cursor-pointer"><ImagePlus size={17} />{form.image ? "更换图片" : "选择图片"}<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={readImage} /></label>
          </div>
          <label className="block space-y-1">
            <span className="label">跳转链接（选填）</span>
            <input className="field" maxLength={2000} value={form.linkUrl} onChange={(event) => setForm((current) => ({ ...current, linkUrl: event.target.value }))} placeholder="站内路径 /soups/... 或 https://..." />
            <span className="block rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-muted">
              海龟汤详情：/soups/作品ID<br />
              商城：/mine/store<br />
              某个卡包：/mine/store/卡包ID<br />
              收藏柜：/mine/card-cabinet
            </span>
          </label>
          <label className="block space-y-1"><span className="label">权重</span><input className="field" type="number" min={-999999} max={999999} value={form.weight} onChange={(event) => setForm((current) => ({ ...current, weight: Number(event.target.value) }))} /><span className="text-xs text-muted">权重越大，展示越靠前</span></label>
          <label className="flex items-center justify-between rounded-xl border border-line px-3 py-3"><span><strong className="block text-sm text-ink">上架</strong><span className="text-xs text-muted">关闭后前台不展示</span></span><input className="h-5 w-5 accent-blue-600" type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /></label>
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={saving} onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" disabled={saving || !form.name.trim() || (editing === "new" && !form.image)} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button></div>
        </div>
      </Modal>}
      {cropSource && <BannerImageCropper
        source={cropSource}
        onCancel={() => setCropSource(null)}
        onConfirm={(image) => {
          setForm((current) => ({ ...current, image }));
          setCropSource(null);
        }}
      />}
    </section>
  );
}
