import { Gift, History, ImagePlus, Plus, RotateCcw, Save, Search, Trash2, Video, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { COLLECTIBLE_EDITABLE_RARITY_LABELS, COLLECTIBLE_TYPE_LABELS, type Collectible, type CollectibleRarity, type CollectibleType } from "../../shared/collectibles";
import { CollectibleVisual } from "../CollectibleVisual";
import { Modal } from "../Modal";

const blank = { name: "", collectibleNo: "", rarity: "epic" as CollectibleRarity, collectibleType: "treasure" as CollectibleType, collectibleValue: 1, description: "", imageUrl: "" };
type Transfer = { id: string; from: string; to: string; type: string; operator: string | null; createdAt: string };
type UserOption = { id: string; username: string; nickname: string };

function dataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
}

export function CollectibleManagement() {
  const [items, setItems] = useState<Collectible[]>([]);
  const [nextNo, setNextNo] = useState("001");
  const [keyword, setKeyword] = useState("");
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Collectible | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [video, setVideo] = useState<File | null>(null);
  const videoPreviewUrl = useMemo(() => video ? URL.createObjectURL(video) : null, [video]);
  const [saving, setSaving] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [grantItem, setGrantItem] = useState<Collectible | null>(null);
  const [userKeyword, setUserKeyword] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => () => { if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); }, [videoPreviewUrl]);

  async function load() {
    const data = await api<{ collectibles: Collectible[]; nextCollectibleNo: string }>("/api/admin/collectibles", { bypassCache: true });
    setItems(data.collectibles);
    setNextNo(data.nextCollectibleNo);
  }
  useEffect(() => { void load(); }, []);
  const motionProcessing = items.some((item) => item.motionStatus === "processing");
  useEffect(() => { if (!motionProcessing) return; const timer = window.setInterval(() => void load(), 3_000); return () => window.clearInterval(timer); }, [motionProcessing]);

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase();
    return items.filter((item) => !normalized || `${item.collectibleNo}${item.name}${item.collectibleTypeLabel}${item.owner?.nickname ?? ""}${item.owner?.username ?? ""}`.toLocaleLowerCase().includes(normalized));
  }, [items, keyword]);

  function openForm(item?: Collectible) {
    setEditing(item ?? null);
    setForm(item ? { name: item.name, collectibleNo: item.collectibleNo, rarity: item.rarity === "legend" ? "legend" : "epic", collectibleType: item.collectibleType, collectibleValue: item.collectibleValue, description: item.description, imageUrl: item.imageUrl } : { ...blank, collectibleNo: nextNo });
    setVideo(null);
    setFormOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      let id = editing?.id;
      const body: Record<string, unknown> = { ...form, collectibleNo: form.collectibleNo || undefined };
      if (editing && form.imageUrl === editing.imageUrl) delete body.imageUrl;
      if (id) await api(`/api/admin/collectibles/${id}`, { method: "PATCH", body });
      else id = (await api<{ id: string }>("/api/admin/collectibles", { method: "POST", body })).id;
      if (video) await api(`/api/admin/collectibles/${id}/motion`, { method: "PUT", headers: { "Content-Type": video.type || "application/octet-stream" }, body: video });
      setFormOpen(false);
      await load();
    } finally { setSaving(false); }
  }

  async function reclaim(item: Collectible) {
    if (!window.confirm(`确认收回“${item.name}”吗？`)) return;
    await api(`/api/admin/collectibles/${item.id}/reclaim`, { method: "POST" });
    await load();
  }
  async function remove(item: Collectible) {
    if (!window.confirm(`确认删除“${item.name}”吗？历史记录仍会保留。`)) return;
    await api(`/api/admin/collectibles/${item.id}`, { method: "DELETE" });
    await load();
  }
  async function showTransfers(item: Collectible) {
    const data = await api<{ transfers: Transfer[] }>(`/api/admin/collectibles/${item.id}/transfers`, { bypassCache: true });
    setTransfers(data.transfers);
  }
  async function searchUsers() {
    const data = await api<{ users: UserOption[] }>(`/api/admin/collectibles/users/search?keyword=${encodeURIComponent(userKeyword)}`, { bypassCache: true });
    setUsers(data.users);
  }
  async function grant(userId: string) {
    if (!grantItem) return;
    await api(`/api/admin/collectibles/${grantItem.id}/grant`, { method: "POST", body: { userId } });
    setGrantItem(null);
    await load();
  }

  const previewCollectible: Collectible = {
    ...(editing ?? {
      id: "preview", thumbnailUrl: form.imageUrl, owner: null, status: "unowned", statusLabel: "无主",
      packBinding: null, auction: null
    }),
    collectibleNo: form.collectibleNo || nextNo,
    name: form.name || "收藏品预览",
    rarity: form.rarity,
    rarityLabel: COLLECTIBLE_EDITABLE_RARITY_LABELS[form.rarity as keyof typeof COLLECTIBLE_EDITABLE_RARITY_LABELS] ?? "史诗",
    collectibleType: form.collectibleType,
    collectibleTypeLabel: COLLECTIBLE_TYPE_LABELS[form.collectibleType],
    collectibleValue: form.collectibleValue,
    description: form.description,
    imageUrl: form.imageUrl,
    thumbnailUrl: form.imageUrl,
    motionMp4Url: videoPreviewUrl ?? editing?.motionMp4Url ?? null,
    motionWebmUrl: videoPreviewUrl ? null : editing?.motionWebmUrl ?? null,
    motionPosterUrl: editing?.motionPosterUrl ?? null
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">收藏品档案</h2><p className="mt-1 text-sm text-muted">创建和维护收藏品资料、归属及流转；卡包关联与拍卖任务分别在对应商城模块管理。</p></div><button className="btn btn-primary" onClick={() => openForm()}><Plus size={17} />新增收藏品</button></div>
    <label className="relative block max-w-md"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={17} /><input className="field pr-10" placeholder="搜索名称、编号、类型或所有者" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label>
    <div className="grid gap-3">{filtered.map((item) => <article key={item.id} className="card flex flex-col gap-4 p-4 lg:flex-row lg:items-center"><CollectibleVisual collectible={item} className="aspect-[5/4] w-full lg:w-36" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-ink">{item.name}</h3><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-primary">NO.{item.collectibleNo}</span><span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">{item.collectibleTypeLabel}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{item.rarityLabel}</span><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{item.statusLabel}</span></div><p className="mt-2 text-xs text-muted">所有者：{item.owner ? `${item.owner.nickname}（${item.owner.username}）` : "系统/无主"}</p>{item.packBinding && <p className="mt-1 text-xs text-primary">已由卡包管理关联至：{item.packBinding.packName} · 独立概率 {item.packBinding.probability}%</p>}{item.auction && <p className="mt-1 text-xs text-amber-700">已由商城创建拍卖任务 · {new Date(item.auction.startsAt).toLocaleString("zh-CN")}</p>}</div><div className="flex max-w-xl flex-wrap gap-2"><button className="btn btn-secondary text-xs" onClick={() => openForm(item)}>编辑</button><button className="btn btn-secondary text-xs" onClick={() => void showTransfers(item)}><History size={14} />流转</button>{item.status === "unowned" && <><button className="btn btn-secondary text-xs" onClick={() => { setGrantItem(item); setUsers([]); setUserKeyword(""); }}><Gift size={14} />赠送</button><button className="btn bg-red-50 text-xs text-red-600" onClick={() => void remove(item)}><Trash2 size={14} />删除</button></>}{item.status === "owned" && <button className="btn btn-secondary text-xs" onClick={() => void reclaim(item)}><RotateCcw size={14} />收回</button>}</div></article>)}</div>

    {formOpen && <Modal full onClose={() => !saving && setFormOpen(false)}><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">{editing ? "编辑" : "新增"}收藏品</h2><button type="button" aria-label={`关闭${editing ? "编辑" : "新增"}收藏品弹窗`} title="关闭" disabled={saving} onClick={() => setFormOpen(false)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-slate-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"><X size={21} /></button></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><span className="label flex items-center gap-1"><ImagePlus size={15} />封面与动态视频预览</span><div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div>{form.imageUrl ? <div className="relative mx-auto aspect-[5/4] w-full max-w-sm"><CollectibleVisual collectible={previewCollectible} className="h-full w-full" /><label htmlFor="collectible-cover" className="absolute inset-0 cursor-pointer rounded-2xl focus-within:ring-2 focus-within:ring-primary" aria-label="更换收藏品封面" /></div> : <label htmlFor="collectible-cover" className="grid aspect-[5/4] w-full cursor-pointer place-items-center rounded-2xl border border-dashed border-line bg-slate-50 text-muted transition hover:bg-slate-100"><span className="text-center"><ImagePlus className="mx-auto" size={36} /><span className="mt-2 block text-xs font-bold">点击上传封面</span></span></label>}<input id="collectible-cover" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) setForm({ ...form, imageUrl: await dataUrl(file) }); }} /></div><label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-violet-200 bg-violet-50/60 p-4 text-center text-violet-700 transition hover:bg-violet-50"><Video size={30} /><span className="mt-2 text-sm font-black">{video ? "更换动态视频" : editing?.motionMp4Url || editing?.motionWebmUrl ? "更换动态视频" : "上传动态视频"}</span><span className="mt-1 text-xs leading-5 text-muted">{video ? `${video.name} · ${(video.size / 1024 / 1024).toFixed(1)}MB，已在左侧预览` : editing?.motionMp4Url || editing?.motionWebmUrl ? "已配置动态视频，可在左侧预览" : "支持 MP4、WebM、MOV、M4V，最大 200MB"}</span><input className="sr-only" type="file" accept=".mp4,.webm,.mov,.m4v,video/mp4,video/webm,video/quicktime,video/x-m4v" onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; setVideo(file); }} /></label></div></div><label><span className="label">名称</span><input className="field mt-1" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span className="label">编号</span><input className="field mt-1" placeholder={`自动编号 ${nextNo}`} value={form.collectibleNo} onChange={(event) => setForm({ ...form, collectibleNo: event.target.value })} /></label><label><span className="label">品质</span><select className="field mt-1" value={form.rarity} onChange={(event) => setForm({ ...form, rarity: event.target.value as CollectibleRarity })}>{Object.entries(COLLECTIBLE_EDITABLE_RARITY_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label><span className="label">收藏品类型</span><select className="field mt-1" value={form.collectibleType} onChange={(event) => setForm({ ...form, collectibleType: event.target.value as CollectibleType })}>{Object.entries(COLLECTIBLE_TYPE_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label><span className="label">收藏品价值</span><input className="field mt-1" type="number" min="1" step="1" value={form.collectibleValue} onChange={(event) => setForm({ ...form, collectibleValue: Number(event.target.value) })} /><span className="mt-1 block text-xs text-muted">仅用于收藏品价值展示与排行榜，不代表实际价格。</span></label><label><span className="label">当前状态</span><input className="field mt-1" readOnly value={editing?.statusLabel ?? "无主"} /></label><label className="sm:col-span-2"><span className="label">描述</span><textarea className="field mt-1 min-h-32" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div><button className="btn btn-primary mt-5 w-full" disabled={saving || !form.name || !form.imageUrl || !Number.isInteger(form.collectibleValue) || form.collectibleValue <= 0} onClick={() => void save()}><Save size={17} />{saving ? "保存中" : "保存收藏品"}</button></Modal>}
    {transfers && <Modal onClose={() => setTransfers(null)}><h2 className="text-xl font-black">流转记录</h2><div className="mt-4 max-h-96 space-y-2 overflow-y-auto">{transfers.length ? transfers.map((transfer) => <div key={transfer.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-bold">{transfer.from} → {transfer.to}</p><p className="mt-1 text-xs text-muted">{transfer.type} · {new Date(transfer.createdAt).toLocaleString("zh-CN")}</p></div>) : <p className="text-sm text-muted">暂无流转记录</p>}</div></Modal>}
    {grantItem && <Modal onClose={() => setGrantItem(null)}><h2 className="text-xl font-black">赠送收藏品</h2><p className="mt-1 text-sm text-muted">选择“{grantItem.name}”的接收用户。</p><div className="mt-4 flex gap-2"><input className="field" value={userKeyword} onChange={(event) => setUserKeyword(event.target.value)} placeholder="搜索账号或昵称" /><button className="btn btn-secondary" onClick={() => void searchUsers()}>搜索</button></div><div className="mt-3 space-y-2">{users.map((user) => <button key={user.id} className="min-h-11 w-full rounded-xl border border-line p-3 text-left hover:bg-slate-50" onClick={() => void grant(user.id)}>{user.nickname}（{user.username}）</button>)}</div></Modal>}
  </div>;
}
