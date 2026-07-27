import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { Edit3, Gift, ImagePlus, Plus, Power, Trash2 } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";
import { ListSkeleton } from "../Skeletons";

type AdminGift = {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  paymentCurrency: "shell" | "pearl";
  costAmount: number;
  rewardShell: number;
  rewardPearl: number;
  rewardCharm: number;
  status: "active" | "inactive";
  sortOrder: number;
  sentCount: number;
};

type GiftForm = {
  name: string;
  description: string;
  iconImage?: string;
  paymentCurrency: "shell";
  costAmount: number;
  rewardShell: number;
  rewardPearl: number;
  rewardCharm: number;
  status: "active" | "inactive";
  sortOrder: number;
};

const emptyForm: GiftForm = {
  name: "",
  description: "",
  paymentCurrency: "shell",
  costAmount: 1,
  rewardShell: 0,
  rewardPearl: 0,
  rewardCharm: 0,
  status: "inactive",
  sortOrder: 0
};

export function GiftManagement() {
  const { showToast } = useApp();
  const [gifts, setGifts] = useState<AdminGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AdminGift | "new" | null>(null);
  const [form, setForm] = useState<GiftForm>(emptyForm);

  const load = useCallback(async () => {
    const data = await api<{ gifts: AdminGift[] }>("/api/admin/gifts", { bypassCache: true, dedupe: false });
    setGifts(data.gifts);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().catch((error) => showToast((error as Error).message)).finally(() => setLoading(false));
  }, [load, showToast]);

  function beginCreate() {
    setForm(emptyForm);
    setEditing("new");
  }

  function beginEdit(gift: AdminGift) {
    if (gift.sentCount > 0) return showToast("已赠送过的礼物不可编辑，只能下架");
    setForm({
      name: gift.name,
      description: gift.description,
      paymentCurrency: "shell",
      costAmount: gift.costAmount,
      rewardShell: gift.rewardShell,
      rewardPearl: gift.rewardPearl,
      rewardCharm: gift.rewardCharm,
      status: gift.status,
      sortOrder: gift.sortOrder
    });
    setEditing(gift);
  }

  function readIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return showToast("仅支持 PNG、JPG、WebP 或 GIF");
    if (file.size > 5 * 1024 * 1024) return showToast("礼物图标不能超过 5MB");
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, iconImage: String(reader.result) }));
    reader.onerror = () => showToast("图标读取失败");
    reader.readAsDataURL(file);
  }

  async function save() {
    if (saving || !form.name.trim() || (editing === "new" && !form.iconImage)) return;
    setSaving(true);
    try {
      await api(editing === "new" ? "/api/admin/gifts" : `/api/admin/gifts/${editing!.id}`, {
        method: editing === "new" ? "POST" : "PUT",
        body: { ...form, name: form.name.trim(), description: form.description.trim() }
      });
      showToast(editing === "new" ? "礼物已创建" : "礼物已更新");
      setEditing(null);
      await load();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(gift: AdminGift) {
    try {
      const status = gift.status === "active" ? "inactive" : "active";
      await api(`/api/admin/gifts/${gift.id}/status`, { method: "PATCH", body: { status } });
      setGifts((current) => current.map((item) => item.id === gift.id ? { ...item, status } : item));
      showToast(status === "active" ? "礼物已上架" : "礼物已下架");
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  async function remove(gift: AdminGift) {
    if (gift.sentCount > 0) return showToast("已赠送过的礼物不可删除，只能下架");
    if (!window.confirm(`确认删除礼物「${gift.name}」？`)) return;
    try {
      await api(`/api/admin/gifts/${gift.id}`, { method: "DELETE" });
      setGifts((current) => current.filter((item) => item.id !== gift.id));
      showToast("礼物已删除");
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft">
        <div><h2 className="text-xl font-black text-ink">礼物管理</h2><p className="mt-1 text-sm text-muted">当前仅支持贝壳礼物。图标会自动压缩成 192×192 正方形 WebP；已赠送礼物只能下架。</p></div>
        <button className="btn btn-primary" onClick={beginCreate}><Plus size={17} />新增礼物</button>
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
        {loading ? <ListSkeleton rows={5} /> : gifts.length === 0 ? <div className="py-20 text-center"><Gift className="mx-auto text-slate-300" size={42} /><p className="mt-3 text-sm text-muted">暂无礼物，前端送礼列表保持为空</p></div> : (
          <div className="divide-y divide-line">
            {gifts.map((gift) => (
              <div key={gift.id} className="flex flex-wrap items-center gap-4 p-4">
                <img className="h-16 w-16 shrink-0 rounded-2xl bg-slate-50 object-contain p-1" src={gift.iconUrl} alt={gift.name} />
                <div className="min-w-[210px] flex-1">
                  <div className="flex flex-wrap items-center gap-2"><strong className="text-ink">{gift.name}</strong><span className={`rounded-full px-2 py-1 text-xs font-bold ${gift.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"}`}>{gift.status === "active" ? "已上架" : "已下架"}</span>{gift.sentCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">已赠送 {gift.sentCount} 次</span>}</div>
                  <p className="mt-1 text-sm text-muted">{gift.description || "无描述"}</p>
                  <p className="mt-2 text-xs font-bold text-slate-600">消耗贝壳 {gift.costAmount} · 收礼贝壳 +{gift.rewardShell} · 明珠 +{gift.rewardPearl} · 魅力 +{gift.rewardCharm}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-secondary px-3" onClick={() => void toggleStatus(gift)}><Power size={15} />{gift.status === "active" ? "下架" : "上架"}</button>
                  <button className="btn btn-secondary px-3" disabled={gift.sentCount > 0} onClick={() => beginEdit(gift)}><Edit3 size={15} />编辑</button>
                  <button className="btn bg-red-50 px-3 text-red-600 hover:bg-red-100 disabled:opacity-40" disabled={gift.sentCount > 0} onClick={() => void remove(gift)}><Trash2 size={15} />删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <Modal onClose={() => !saving && setEditing(null)}>
        <div className="space-y-4">
          <div><h2 className="text-xl font-black text-ink">{editing === "new" ? "新增礼物" : "编辑礼物"}</h2><p className="mt-1 text-sm text-muted">支付货币暂时固定为贝壳，明珠字段仅作为未来能力预留。</p></div>
          <label className="block space-y-1"><span className="label">礼物名称</span><input className="field" maxLength={100} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="block space-y-1"><span className="label">礼物描述</span><textarea className="field min-h-20" maxLength={500} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <div className="space-y-2"><span className="label">礼物图标</span><div className="flex items-center gap-3">{(form.iconImage || (editing !== "new" && editing.iconUrl)) && <img className="h-20 w-20 rounded-2xl bg-slate-50 object-contain" src={form.iconImage || (editing !== "new" ? editing.iconUrl : "")} alt="礼物图标预览" />}<label className="btn btn-secondary cursor-pointer"><ImagePlus size={17} />选择图片<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={readIcon} /></label></div><p className="text-xs text-muted">最大 5MB，任意比例会等比缩放并补透明边，最终为正方形。</p></div>
          <label className="block space-y-1"><span className="label">支付货币</span><select className="field" value="shell" disabled><option value="shell">贝壳</option></select></label>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="送礼消耗贝壳" value={form.costAmount} min={1} onChange={(costAmount) => setForm((current) => ({ ...current, costAmount }))} />
            <NumberField label="收礼获得贝壳" value={form.rewardShell} onChange={(rewardShell) => setForm((current) => ({ ...current, rewardShell }))} />
            <NumberField label="收礼获得明珠" value={form.rewardPearl} onChange={(rewardPearl) => setForm((current) => ({ ...current, rewardPearl }))} />
            <NumberField label="收礼获得魅力" value={form.rewardCharm} onChange={(rewardCharm) => setForm((current) => ({ ...current, rewardCharm }))} />
            <NumberField label="排序权重" value={form.sortOrder} min={-1_000_000} onChange={(sortOrder) => setForm((current) => ({ ...current, sortOrder }))} />
          </div>
          <label className="flex items-center justify-between rounded-xl border border-line p-3"><span><strong className="block text-sm text-ink">立即上架</strong><span className="text-xs text-muted">下架状态不会在前端出现</span></span><input className="h-5 w-5 accent-blue-600" type="checkbox" checked={form.status === "active"} onChange={(event) => setForm((current) => ({ ...current, status: event.target.checked ? "active" : "inactive" }))} /></label>
          <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={saving} onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" disabled={saving || !form.name.trim() || (editing === "new" && !form.iconImage)} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button></div>
        </div>
      </Modal>}
    </section>
  );
}

function NumberField({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  return <label className="block space-y-1"><span className="label">{label}</span><input className="field" type="number" min={min} max={10_000_000} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
