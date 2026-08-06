import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { Edit3, Gift, ImagePlus, Plus, Power, Search, Trash2 } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";
import { ListSkeleton } from "../Skeletons";
import { AdminPagination } from "./AdminPagination";

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
  inventoryGrantCount: number;
};

type GiftGrantUser = {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
};

type GiftGrantResult = {
  inventoryQuantity: number;
  creditedQuantity: number;
  overflowQuantity: number;
  overflowShell: number;
  duplicate: boolean;
  user: { id: string; nickname: string };
  gift: { id: string; name: string };
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
  const [activeTab, setActiveTab] = useState<"config" | "records">("config");
  const [grantingGift, setGrantingGift] = useState<AdminGift | null>(null);
  const [grantKeyword, setGrantKeyword] = useState("");
  const [grantUsers, setGrantUsers] = useState<GiftGrantUser[]>([]);
  const [selectedGrantUser, setSelectedGrantUser] = useState<GiftGrantUser | null>(null);
  const [grantQuantity, setGrantQuantity] = useState("1");
  const [grantSearching, setGrantSearching] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);

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

  function beginGrant(gift: AdminGift) {
    setGrantingGift(gift);
    setGrantKeyword("");
    setGrantUsers([]);
    setSelectedGrantUser(null);
    setGrantQuantity("1");
  }

  async function searchGrantUsers() {
    const keyword = grantKeyword.trim();
    if (!keyword) {
      setGrantUsers([]);
      setSelectedGrantUser(null);
      return;
    }
    setGrantSearching(true);
    try {
      const data = await api<{ users: GiftGrantUser[] }>(
        `/api/admin/users?keyword=${encodeURIComponent(keyword)}&limit=10&offset=0`,
        { bypassCache: true, dedupe: false }
      );
      setGrantUsers(data.users);
      setSelectedGrantUser((current) => data.users.some((user) => user.id === current?.id) ? current : null);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setGrantSearching(false);
    }
  }

  async function grantInventory() {
    if (!grantingGift || !selectedGrantUser || grantSaving) return;
    const quantity = Number(grantQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
      showToast("赠送数量须为 1 至 10000 的整数");
      return;
    }
    setGrantSaving(true);
    try {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await api<GiftGrantResult>(
        `/api/admin/gifts/${grantingGift.id}/inventory-grants`,
        { method: "POST", body: { userId: selectedGrantUser.id, quantity, requestId } }
      );
      const overflowText = result.overflowQuantity > 0
        ? `，其中 ${result.overflowQuantity} 个超出上限，已折算 ${result.overflowShell} 贝壳`
        : "";
      showToast(`已向 ${result.user.nickname} 赠送 ${quantity} 个${result.gift.name}${overflowText}`);
      setGrantingGift(null);
      await load();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setGrantSaving(false);
    }
  }

  function beginEdit(gift: AdminGift) {
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
      <div className="card flex flex-wrap gap-2 p-2">
        <button className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === "config" ? "bg-primary text-white" : "text-muted hover:bg-blue-50"}`} onClick={() => setActiveTab("config")}>礼物配置</button>
        <button className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === "records" ? "bg-primary text-white" : "text-muted hover:bg-blue-50"}`} onClick={() => setActiveTab("records")}>送礼记录</button>
      </div>
      {activeTab === "config" ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft">
        <div><h2 className="text-xl font-black text-ink">礼物</h2><p className="mt-1 text-sm text-muted">当前仅支持贝壳礼物。图标会自动压缩成 192×192 正方形 WebP；已赠送礼物只能下架。</p></div>
        <button className="btn btn-primary" onClick={beginCreate}><Plus size={17} />新增礼物</button>
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
        {loading ? <ListSkeleton rows={5} /> : gifts.length === 0 ? <div className="py-20 text-center"><Gift className="mx-auto text-slate-300" size={42} /><p className="mt-3 text-sm text-muted">暂无礼物，前端送礼列表保持为空</p></div> : (
          <div className="divide-y divide-line">
            {gifts.map((gift) => (
              <div key={gift.id} className="flex flex-wrap items-center gap-4 p-4">
                <img className="h-16 w-16 shrink-0 rounded-2xl bg-slate-50 object-contain p-1" src={gift.iconUrl} alt={gift.name} />
                <div className="min-w-[210px] flex-1">
                  <div className="flex flex-wrap items-center gap-2"><strong className="text-ink">{gift.name}</strong><span className={`rounded-full px-2 py-1 text-xs font-bold ${gift.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"}`}>{gift.status === "active" ? "已上架" : "已下架"}</span>{gift.sentCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">已送出 {gift.sentCount} 次</span>}{gift.inventoryGrantCount > 0 && <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">后台赠送 {gift.inventoryGrantCount} 次</span>}</div>
                  <p className="mt-1 text-sm text-muted">{gift.description || "无描述"}</p>
                  <p className="mt-2 text-xs font-bold text-slate-600">消耗贝壳 {gift.costAmount} · 收礼贝壳 +{gift.rewardShell} · 明珠 +{gift.rewardPearl} · 魅力 +{gift.rewardCharm}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary px-3" onClick={() => beginGrant(gift)}><Gift size={15} />赠送</button>
                  <button className="btn btn-secondary px-3" onClick={() => void toggleStatus(gift)}><Power size={15} />{gift.status === "active" ? "下架" : "上架"}</button>
                  <button className="btn btn-secondary px-3" onClick={() => beginEdit(gift)}><Edit3 size={15} />编辑</button>
                  <button className="btn bg-red-50 px-3 text-red-600 hover:bg-red-100" onClick={() => void remove(gift)}><Trash2 size={15} />删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </> : <GiftSendRecords />}

      {activeTab === "config" && grantingGift && <Modal onClose={() => !grantSaving && setGrantingGift(null)}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <img className="h-14 w-14 rounded-2xl bg-slate-50 object-contain p-1" src={grantingGift.iconUrl} alt={grantingGift.name} />
            <div>
              <h2 className="text-xl font-black text-ink">赠送「{grantingGift.name}」</h2>
              <p className="mt-1 text-sm text-muted">礼物将直接进入所选用户的库存。</p>
            </div>
          </div>

          <div className="space-y-2">
            <span className="label">搜索用户</span>
            <div className="flex gap-2">
              <input
                className="field min-w-0 flex-1"
                placeholder="输入昵称或账号"
                value={grantKeyword}
                onChange={(event) => setGrantKeyword(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void searchGrantUsers(); }}
              />
              <button className="btn btn-secondary shrink-0 px-3" disabled={grantSearching || !grantKeyword.trim()} onClick={() => void searchGrantUsers()}>
                <Search size={16} />{grantSearching ? "搜索中" : "搜索"}
              </button>
            </div>
          </div>

          <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-line p-2">
            {grantUsers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{grantKeyword.trim() ? "暂无搜索结果" : "输入昵称或账号后搜索用户"}</p>
            ) : grantUsers.map((user) => {
              const selected = selectedGrantUser?.id === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-blue-50 ring-1 ring-primary" : "border-line hover:bg-slate-50"}`}
                  onClick={() => setSelectedGrantUser(user)}
                >
                  {user.avatar ? (
                    <img className="h-10 w-10 rounded-full object-cover" src={user.avatar} alt="" />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-200 font-black text-slate-600">{user.nickname.slice(0, 1)}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-ink">{user.nickname}</strong>
                    <span className="block truncate text-xs text-muted">@{user.username}</span>
                  </span>
                  {selected && <span className="rounded-full bg-primary px-2 py-1 text-xs font-bold text-white">已选择</span>}
                </button>
              );
            })}
          </div>

          <label className="block space-y-1">
            <span className="label">赠送数量</span>
            <input
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              max={10_000}
              step={1}
              value={grantQuantity}
              onChange={(event) => setGrantQuantity(event.target.value)}
            />
          </label>
          <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800">
            单种礼物库存上限为 999；超出上限的部分将按每个 {grantingGift.costAmount} 贝壳自动折现给用户。
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-secondary" disabled={grantSaving} onClick={() => setGrantingGift(null)}>取消</button>
            <button className="btn btn-primary" disabled={grantSaving || !selectedGrantUser} onClick={() => void grantInventory()}>
              {grantSaving ? "赠送中…" : "确定赠送"}
            </button>
          </div>
        </div>
      </Modal>}

      {activeTab === "config" && editing && <Modal onClose={() => !saving && setEditing(null)}>
        <div className="space-y-4">
          <div><h2 className="text-xl font-black text-ink">{editing === "new" ? "新增礼物" : "编辑礼物"}</h2><p className="mt-1 text-sm text-muted">支付货币暂时固定为贝壳，明珠字段仅作为未来能力预留。</p></div>
          {editing !== "new" && (editing.sentCount > 0 || editing.inventoryGrantCount > 0) && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800">
              <strong className="block">该礼物已进入流通</strong>
              名称、价格、奖励在送礼时已写入历史流水，编辑后新送礼将使用新值，历史记录不受影响；但<strong>修改图标会影响历史礼物卡片显示</strong>，请知悉。
            </div>
          )}
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

type GiftSendRecord = {
  id: string;
  sender: { id: string; nickname: string };
  recipient: { id: string; nickname: string };
  giftName: string;
  quantity: number;
  createdAt: string;
};

function GiftSendRecords() {
  const { showToast } = useApp();
  const [records, setRecords] = useState<GiftSendRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ records: GiftSendRecord[]; total: number }>(`/api/admin/gift-sends?offset=${(page - 1) * 10}`, { bypassCache: true, dedupe: false });
      setRecords(data.records);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load().catch((error) => showToast((error as Error).message)); }, [load, showToast]);

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
      <div className="border-b border-line p-4"><h2 className="text-xl font-black text-ink">送礼记录</h2><p className="mt-1 text-sm text-muted">共 {total} 条，按送礼时间倒序排列，每页10条。</p></div>
      <div className="overflow-x-auto p-4">
        <div className="min-w-[820px]">
          <div className="mb-2 grid grid-cols-[1fr_1fr_minmax(180px,1.2fr)_100px_180px] items-center justify-items-center gap-2 px-3 text-xs font-bold text-muted">
            <span>送出人</span><span>收礼人</span><span>送礼内容</span><span>送礼数量</span><span>送礼时间</span>
          </div>
          <div className="space-y-1">
            {records.map((record) => <div key={record.id} className="grid grid-cols-[1fr_1fr_minmax(180px,1.2fr)_100px_180px] items-center justify-items-center gap-2 rounded-lg border border-line p-3 text-center text-sm"><strong>{record.sender.nickname}</strong><strong>{record.recipient.nickname}</strong><span>{record.giftName}</span><span className="font-black text-primary">× {record.quantity}</span><span className="text-xs text-muted">{new Date(record.createdAt).toLocaleString()}</span></div>)}
          </div>
        </div>
      </div>
      {loading && <ListSkeleton rows={6} />}
      {!loading && records.length === 0 && <p className="py-16 text-center text-sm text-muted">暂无送礼记录</p>}
      <div className="px-4 pb-4"><AdminPagination page={page} pageSize={10} total={total} onPageChange={setPage} /></div>
    </div>
  );
}

function NumberField({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  return <label className="block space-y-1"><span className="label">{label}</span><input className="field" type="number" min={min} max={10_000_000} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
