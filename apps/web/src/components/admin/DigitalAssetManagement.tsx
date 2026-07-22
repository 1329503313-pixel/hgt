import { useEffect, useState } from "react";
import { Check, ImagePlus, Plus, Save, Search, Shell, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../Modal";
import { AssetCardVisual } from "../AssetCardVisual";
import type { AssetCard, AssetPackType, AssetRarity } from "../../shared/digitalAssets";
import { ASSET_PACK_TYPE_LABELS, ASSET_RARITY_LABELS } from "../../shared/digitalAssets";
import { PackStoryEditor, richTextCharacterCount } from "./PackStoryEditor";

type AdminCard = AssetCard & { createdAt: string | null; packIds: string[]; ownerCount: number; totalDrawn: number; starCounts: number[] };
type AdminPack = {
  id: string; name: string; coverUrl: string; description: string; packStory: string; packType: AssetPackType; packTypeLabel: string;
  singlePrice: number; tenPrice: number; dailyFreeDraws: number; saleStartAt: string | null; saleEndAt: string | null;
  enabled: boolean; status: string; sortOrder: number; probabilityNotice: string; probabilityTotal: number; configurationReady: boolean;
  rarityProbabilities: Record<AssetRarity, number>; cards: AssetCard[];
};
type AssetStats = { cardCount: number; packCount: number; enabledPackCount: number; totalOrders: number; totalDraws: number; shellSpent: number; shellRefunded: number; rarityCounts: Record<string, number> };
type DrawRecord = { id: string; orderId: string; drawIndex: number; drawMode: string; shellCost: number; usedFreeDraw: boolean; nickname: string; packName: string; cardNo: string; cardName: string; rarity: AssetRarity; pityType: string | null; starBefore: number | null; starAfter: number; firstObtained: boolean; starUpgraded: boolean; fullStarDuplicate: boolean; shellRefund: number; createdAt: string };
type CardSort = "number-asc" | "number-desc" | "rarity-asc" | "rarity-desc";

const blankCard = { cardNo: "", name: "", rarity: "normal" as AssetRarity, imageUrl: "", story: "", status: "active", packIds: [] as string[] };
const blankPack = { name: "", coverUrl: "", description: "", packStory: "", packType: "permanent" as AssetPackType, singlePrice: 10, tenPrice: 90, dailyFreeDraws: 0, saleStartAt: "", saleEndAt: "", sortOrder: 0 };
const rarityKeys: AssetRarity[] = ["normal", "rare", "epic", "legend"];
const rarityRank: Record<AssetRarity, number> = { normal: 0, rare: 1, epic: 2, legend: 3 };
const blankProbabilities: Record<AssetRarity, string> = { normal: "", rare: "", epic: "", legend: "" };

function blobData(blob: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片压缩失败")), "image/webp", quality));
}

async function compressImage(blob: Blob) {
  if (blob.size <= 1_800_000 && blob.type === "image/webp") return blobData(blob);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(blob); }
  catch {
    if (blob.size > 3_500_000) throw new Error("图片体积过大且无法压缩，请转换为 JPG、PNG 或 WebP 后重试");
    return blobData(blob);
  }
  try {
    let maxEdge = 1800;
    let quality = 0.88;
    let lastBlob: Blob | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法处理该图片");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      lastBlob = await canvasBlob(canvas, quality);
      if (lastBlob.size <= 1_800_000) return blobData(lastBlob);
      maxEdge = Math.round(maxEdge * 0.8);
      quality = Math.max(0.55, quality - 0.08);
    }
    if (!lastBlob || lastBlob.size > 3_500_000) throw new Error("图片压缩后仍然过大，请使用更小的素材");
    return blobData(lastBlob);
  } finally {
    bitmap.close();
  }
}

function fileData(file: File) {
  return compressImage(file);
}

async function normalizedImageData(value: string) {
  if (!value.startsWith("data:image/") || value.length <= 2_500_000) return value;
  const response = await fetch(value);
  return compressImage(await response.blob());
}

function localDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function nextCardNo(cardNo: string) {
  if (!/^\d+$/.test(cardNo)) return "";
  return (BigInt(cardNo) + 1n).toString().padStart(3, "0");
}

export function DigitalAssetManagement() {
  const [tab, setTab] = useState<"cards" | "packs" | "records">("cards");
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [packs, setPacks] = useState<AdminPack[]>([]);
  const [cardForm, setCardForm] = useState(blankCard);
  const [packForm, setPackForm] = useState(blankPack);
  const [cardModal, setCardModal] = useState(false);
  const [packModal, setPackModal] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [configPack, setConfigPack] = useState<AdminPack | null>(null);
  const [probabilities, setProbabilities] = useState<Record<AssetRarity, string>>(blankProbabilities);
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [records, setRecords] = useState<DrawRecord[]>([]);
  const [recordKeyword, setRecordKeyword] = useState("");
  const [packKeyword, setPackKeyword] = useState("");
  const [packTypeFilter, setPackTypeFilter] = useState<"all" | AssetPackType>("all");
  const [cardSort, setCardSort] = useState<CardSort>("number-asc");
  const [configCardIds, setConfigCardIds] = useState<string[]>([]);
  const [configCardKeyword, setConfigCardKeyword] = useState("");

  async function load() {
    const [cardData, packData, statsData, recordData] = await Promise.all([
      api<{ cards: AdminCard[] }>("/api/admin/asset-cards", { bypassCache: true }),
      api<{ packs: AdminPack[] }>("/api/admin/asset-packs", { bypassCache: true }),
      api<AssetStats>("/api/admin/asset-stats", { bypassCache: true }),
      api<{ records: DrawRecord[] }>("/api/admin/asset-draw-records", { bypassCache: true })
    ]);
    setCards(cardData.cards); setPacks(packData.packs); setStats(statsData); setRecords(recordData.records);
  }
  useEffect(() => { void load().catch((error) => setMessage((error as Error).message)); }, []);

  async function openCard(card?: AdminCard) {
    if (!card) {
      const latestCard = cards.reduce<AdminCard | null>((latest, candidate) => {
        if (!latest) return candidate;
        return new Date(candidate.createdAt ?? 0).getTime() >= new Date(latest.createdAt ?? 0).getTime() ? candidate : latest;
      }, null);
      setEditingCardId(null);
      setCardForm(latestCard ? {
        ...blankCard,
        cardNo: nextCardNo(latestCard.cardNo),
        rarity: latestCard.rarity,
        packIds: [...latestCard.packIds]
      } : blankCard);
      setPackKeyword("");
      setPackTypeFilter("all");
      setCardModal(true);
      return;
    }
    setMessage("");
    setDetailLoading(`card:${card.id}`);
    try {
      const data = await api<{ card: AssetCard & { packIds: string[] } }>(`/api/admin/asset-cards/${card.id}`, { bypassCache: true });
      setEditingCardId(card.id);
      setCardForm({ cardNo: data.card.cardNo, name: data.card.name, rarity: data.card.rarity, imageUrl: data.card.imageUrl, story: data.card.story, status: data.card.status, packIds: data.card.packIds });
    } catch (error) {
      setMessage((error as Error).message);
      return;
    } finally {
      setDetailLoading(null);
    }
    setPackKeyword("");
    setPackTypeFilter("all");
    setCardModal(true);
  }

  function toggleCardPack(packId: string) {
    if (packs.find((pack) => pack.id === packId)?.enabled && (Boolean(editingCardId) || !cardForm.packIds.includes(packId))) {
      setMessage("已上架卡包不能新增或移除卡牌，请先下架");
      return;
    }
    setCardForm((current) => ({
      ...current,
      packIds: current.packIds.includes(packId) ? current.packIds.filter((id) => id !== packId) : [...current.packIds, packId]
    }));
  }

  async function saveCard() {
    if (cardForm.packIds.length === 0) { setMessage("卡牌必须至少绑定一个卡包"); return; }
    setSaving(true); setMessage("");
    try {
      const imageUrl = await normalizedImageData(cardForm.imageUrl);
      const body = { ...cardForm, imageUrl, releaseAt: null };
      await api(editingCardId ? `/api/admin/asset-cards/${editingCardId}` : "/api/admin/asset-cards", { method: editingCardId ? "PATCH" : "POST", body });
      setCardModal(false); await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  }

  async function openPack(pack?: AdminPack) {
    if (!pack) {
      setEditingPackId(null);
      setPackForm(blankPack);
      setPackModal(true);
      return;
    }
    setMessage("");
    setDetailLoading(`pack:${pack.id}`);
    try {
      const data = await api<{ pack: AdminPack }>(`/api/admin/asset-packs/${pack.id}`, { bypassCache: true });
      const detail = data.pack;
      setEditingPackId(pack.id);
      setPackForm({ name: detail.name, coverUrl: detail.coverUrl, description: detail.description, packStory: detail.packStory, packType: detail.packType, singlePrice: detail.singlePrice, tenPrice: detail.tenPrice, dailyFreeDraws: detail.dailyFreeDraws, saleStartAt: localDate(detail.saleStartAt), saleEndAt: localDate(detail.saleEndAt), sortOrder: detail.sortOrder });
    } catch (error) {
      setMessage((error as Error).message);
      return;
    } finally {
      setDetailLoading(null);
    }
    setPackModal(true);
  }

  async function savePack() {
    if (richTextCharacterCount(packForm.packStory) > 3000) { setMessage("卡包故事不能超过3000字"); return; }
    if (packForm.packType !== "permanent" && (!packForm.saleStartAt || !packForm.saleEndAt)) { setMessage("限定卡包和联名卡包必须设置起止时间"); return; }
    setSaving(true); setMessage("");
    try {
      const coverUrl = await normalizedImageData(packForm.coverUrl);
      const body = { ...packForm, coverUrl, saleStartAt: packForm.packType === "permanent" ? null : new Date(packForm.saleStartAt).toISOString(), saleEndAt: packForm.packType === "permanent" ? null : new Date(packForm.saleEndAt).toISOString(), enabled: false };
      if (editingPackId) delete (body as Partial<typeof body>).enabled;
      await api(editingPackId ? `/api/admin/asset-packs/${editingPackId}` : "/api/admin/asset-packs", { method: editingPackId ? "PATCH" : "POST", body });
      setPackModal(false); await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  }

  function openConfiguration(pack: AdminPack) {
    setConfigPack(pack);
    setConfigCardIds(pack.cards.map((card) => card.id));
    setConfigCardKeyword("");
    setProbabilities(Object.fromEntries(rarityKeys.map((rarity) => [rarity, String(pack.rarityProbabilities[rarity] ?? 0)])) as Record<AssetRarity, string>);
  }

  function toggleConfigCard(cardId: string) {
    if (configPack?.enabled) return;
    setConfigCardIds((current) => current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]);
  }

  async function savePackCards() {
    if (!configPack || configPack.enabled) return;
    setSaving(true); setMessage("");
    try {
      await api(`/api/admin/asset-packs/${configPack.id}/cards`, { method: "PUT", body: { cardIds: configCardIds } });
      setConfigPack({ ...configPack, cards: cards.filter((card) => configCardIds.includes(card.id)) });
      await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  }

  async function saveConfiguration() {
    if (!configPack) return;
    setSaving(true); setMessage("");
    try {
      const configured = Object.fromEntries(rarityKeys.map((rarity) => [rarity, Number(probabilities[rarity] || 0)]));
      const result = await api<{ rarityProbabilities: Record<AssetRarity, number>; probabilityTotal: number; configurationReady: boolean }>(`/api/admin/asset-packs/${configPack.id}/rarity-probabilities`, { method: "PUT", body: { probabilities: configured } });
      setConfigPack({ ...configPack, ...result });
      await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  }

  async function togglePack(pack: AdminPack) {
    try { await api(`/api/admin/asset-packs/${pack.id}`, { method: "PATCH", body: { enabled: !pack.enabled } }); await load(); }
    catch (error) { setMessage((error as Error).message); }
  }

  async function deletePack(pack: AdminPack) {
    if (pack.cards.length > 0 || !window.confirm(`确认删除卡包「${pack.name}」？`)) return;
    try { await api(`/api/admin/asset-packs/${pack.id}`, { method: "DELETE" }); setPackModal(false); await load(); }
    catch (error) { setMessage((error as Error).message); }
  }

  const visibleCardPacks = packs.filter((pack) => {
    const matchesKeyword = !packKeyword.trim() || pack.name.toLocaleLowerCase().includes(packKeyword.trim().toLocaleLowerCase());
    return matchesKeyword && (packTypeFilter === "all" || pack.packType === packTypeFilter);
  });
  const sortedCards = [...cards].sort((left, right) => {
    const numberOrder = left.cardNo.localeCompare(right.cardNo, "zh-CN", { numeric: true, sensitivity: "base" });
    if (cardSort === "number-asc") return numberOrder;
    if (cardSort === "number-desc") return -numberOrder;
    const rarityOrder = rarityRank[left.rarity] - rarityRank[right.rarity];
    return (cardSort === "rarity-asc" ? rarityOrder : -rarityOrder) || numberOrder;
  });
  const configuredCards = sortedCards.filter((card) => configCardIds.includes(card.id));
  const availableConfigCards = sortedCards.filter((card) => {
    if (configCardIds.includes(card.id)) return false;
    const keyword = configCardKeyword.trim().toLocaleLowerCase();
    return !keyword || card.name.toLocaleLowerCase().includes(keyword) || card.cardNo.toLocaleLowerCase().includes(keyword);
  });

  return (
    <div className="space-y-4">
      {message && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{message}</div>}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-lg font-black text-ink">卡牌</h2><p className="mt-1 text-sm text-muted">上传卡面、配置卡包品质概率与销售时间。上架前系统会校验 100% 概率和三级保底卡。</p></div><div className="flex gap-2"><button className={`btn ${tab === "cards" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("cards")}>卡牌</button><button className={`btn ${tab === "packs" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("packs")}>卡包</button><button className={`btn ${tab === "records" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("records")}>记录</button></div></div>

      {stats && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="card p-4"><p className="text-xs text-muted">累计抽取</p><p className="mt-1 text-xl font-black text-ink">{stats.totalDraws.toLocaleString()}</p></div><div className="card p-4"><p className="text-xs text-muted">卡牌 / 上架卡包</p><p className="mt-1 text-xl font-black text-ink">{stats.cardCount} / {stats.enabledPackCount}</p></div><div className="card p-4"><p className="text-xs text-muted">贝壳消耗</p><p className="mt-1 flex items-center gap-1 text-xl font-black text-blue-600"><Shell size={18} />{stats.shellSpent.toLocaleString()}</p></div><div className="card p-4"><p className="text-xs text-muted">满星返还</p><p className="mt-1 text-xl font-black text-emerald-600">+{stats.shellRefunded.toLocaleString()}</p></div></div>}

      {tab === "cards" ? <div className="card overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4"><h3 className="font-black text-ink">卡牌库 {cards.length}</h3><div className="flex items-center gap-2"><select className="field h-10 w-auto min-w-36 py-0 text-sm" aria-label="卡牌排序" value={cardSort} onChange={(event) => setCardSort(event.target.value as CardSort)}><option value="number-asc">按序号正序</option><option value="number-desc">按序号倒序</option><option value="rarity-asc">按品质正序</option><option value="rarity-desc">按品质倒序</option></select><button className="btn btn-primary" onClick={() => openCard()}><Plus size={17} />新增卡牌</button></div></div>{cards.length === 0 ? <div className="p-10 text-center text-sm text-muted">尚未上传卡牌素材</div> : <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-6">{sortedCards.map((card) => <button key={card.id} className="min-w-0 text-left disabled:cursor-wait disabled:opacity-60" disabled={detailLoading === `card:${card.id}`} onClick={() => openCard(card)}><AssetCardVisual card={card} /><p className="mt-2 truncate text-sm font-black text-ink">{card.name}</p><p className="mt-1 text-[11px] text-muted">{detailLoading === `card:${card.id}` ? "正在加载原图…" : <>{ASSET_RARITY_LABELS[card.rarity]} · {card.status === "active" ? "启用" : "停用"} · {card.ownerCount} 人拥有</>}</p></button>)}</div>}</div> : tab === "packs" ? <div className="space-y-3"><div className="flex justify-end"><button className="btn btn-primary" onClick={() => openPack()}><Plus size={17} />新增卡包</button></div>{packs.length === 0 ? <div className="card p-10 text-center text-sm text-muted">尚未创建卡包</div> : packs.map((pack) => <div key={pack.id} className="card grid gap-4 p-4 sm:grid-cols-[112px_minmax(0,1fr)_auto]"><img src={pack.coverUrl} alt="" className="h-36 w-28 rounded-xl object-cover" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-ink">{pack.name}</h3><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-primary">{ASSET_PACK_TYPE_LABELS[pack.packType]}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${pack.configurationReady ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{pack.configurationReady ? "配置完整" : "待配置"}</span></div><p className="mt-2 text-xs text-muted">单抽 {pack.singlePrice} · 十连 {pack.tenPrice} · 免费 {pack.dailyFreeDraws}/日</p><p className="mt-2 text-xs font-bold text-ink">已绑定 {pack.cards.length} 张 · 品质概率合计 {pack.probabilityTotal.toFixed(6)}%</p></div><div className="flex flex-wrap content-start gap-2 sm:max-w-48"><button className="btn btn-secondary text-xs" disabled={detailLoading === `pack:${pack.id}`} onClick={() => openPack(pack)}>{detailLoading === `pack:${pack.id}` ? "加载原图中…" : "编辑"}</button><button className="btn btn-secondary text-xs" onClick={() => openConfiguration(pack)}>卡牌</button><button className={`btn text-xs ${pack.enabled ? "bg-red-50 text-red-600" : "btn-primary"}`} onClick={() => void togglePack(pack)}>{pack.enabled ? "下架" : "启用上架"}</button><button className="btn bg-red-50 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-40" disabled={pack.cards.length > 0} title={pack.cards.length > 0 ? "已绑定卡牌的卡包不能删除" : "删除卡包"} onClick={() => void deletePack(pack)}><Trash2 size={15} />删除</button></div></div>)}</div> : <div className="card overflow-hidden"><div className="flex items-center gap-2 border-b border-line p-4"><Search size={17} className="text-muted" /><input className="field" placeholder="筛选用户、卡包或卡牌" value={recordKeyword} onChange={(event) => setRecordKeyword(event.target.value)} /></div><div className="overflow-x-auto"><table className="min-full text-left text-xs"><thead className="bg-slate-50 text-muted"><tr><th className="px-3 py-2">时间</th><th className="px-3 py-2">用户</th><th className="px-3 py-2">卡包</th><th className="px-3 py-2">卡牌</th><th className="px-3 py-2">结果</th></tr></thead><tbody>{records.filter((record) => !recordKeyword || `${record.nickname}${record.packName}${record.cardName}`.includes(recordKeyword)).map((record) => <tr key={record.id} className="border-t border-line"><td className="whitespace-nowrap px-3 py-3 text-muted">{new Date(record.createdAt).toLocaleString("zh-CN")}</td><td className="px-3 py-3 font-bold text-ink">{record.nickname}</td><td className="px-3 py-3 text-muted">{record.packName}<br />{record.drawMode === "ten" ? "十连" : record.usedFreeDraw ? "免费单抽" : "单抽"}</td><td className="px-3 py-3"><span className="font-bold text-ink">{record.cardName}</span><br /><span className="text-muted">NO.{record.cardNo} · {ASSET_RARITY_LABELS[record.rarity]}</span></td><td className="px-3 py-3 text-muted">{record.firstObtained ? "首次获得" : record.fullStarDuplicate ? `满星返还 +${record.shellRefund}` : record.starUpgraded ? `升至${record.starAfter}星` : "重复卡"}{record.pityType ? " · 保底" : ""}</td></tr>)}</tbody></table></div></div>}

      {cardModal && <Modal full onClose={() => setCardModal(false)}>
        <div className="flex items-center justify-between"><h2 className="text-xl font-black text-ink">{editingCardId ? "编辑卡牌" : "新增卡牌"}</h2><button className="grid h-10 w-10 place-items-center rounded-full bg-slate-100" onClick={() => setCardModal(false)}><X size={18} /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:row-span-5"><span className="text-sm font-bold text-ink">卡面素材</span><input id="asset-card-image" type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void fileData(file).then((imageUrl) => setCardForm((value) => ({ ...value, imageUrl }))).catch((error) => setMessage((error as Error).message)); }} />{cardForm.imageUrl ? <div className="relative mx-auto mt-4 w-full max-w-64"><AssetCardVisual card={{ id: "preview", cardNo: cardForm.cardNo || "000", name: cardForm.name || "卡牌预览", rarity: cardForm.rarity, imageUrl: cardForm.imageUrl, thumbnailUrl: cardForm.imageUrl, story: cardForm.story, releaseAt: null, status: cardForm.status }} animated className="pointer-events-none" /><label htmlFor="asset-card-image" className="absolute inset-0 cursor-pointer rounded-[15px]" aria-label="更换卡面素材" /></div> : <div className="relative mt-4 aspect-[5/7] w-full max-w-64 rounded-2xl border border-dashed border-line text-muted"><div className="grid h-full place-items-center"><div className="text-center"><ImagePlus className="mx-auto" size={36} /><span className="mt-2 block text-xs font-bold">点击上传卡面</span></div></div><label htmlFor="asset-card-image" className="absolute inset-0 cursor-pointer rounded-2xl" aria-label="上传卡面素材" /></div>}</div>
          <label><span className="text-sm font-bold">卡片编号</span><input className="field mt-1" value={cardForm.cardNo} disabled={Boolean(editingCardId && cards.find((card) => card.id === editingCardId)?.ownerCount)} onChange={(e) => setCardForm({ ...cardForm, cardNo: e.target.value })} /></label>
          <label><span className="text-sm font-bold">名称</span><input className="field mt-1" value={cardForm.name} onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })} /></label>
          <label><span className="text-sm font-bold">品质</span><select className="field mt-1" value={cardForm.rarity} disabled={Boolean(editingCardId && cards.find((card) => card.id === editingCardId)?.ownerCount)} onChange={(e) => setCardForm({ ...cardForm, rarity: e.target.value as AssetRarity })}>{Object.entries(ASSET_RARITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="text-sm font-bold">状态</span><select className="field mt-1" value={cardForm.status} onChange={(e) => setCardForm({ ...cardForm, status: e.target.value })}><option value="inactive">停用</option><option value="active">启用</option></select></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold">卡片故事</span><textarea className="field mt-1 min-h-32" value={cardForm.story} onChange={(e) => setCardForm({ ...cardForm, story: e.target.value })} /></label>
          <fieldset className="sm:col-span-2">
            <div className="flex items-center justify-between gap-3"><legend className="text-sm font-bold">卡包 <span className="text-red-500">*</span></legend><span className={`text-xs ${cardForm.packIds.length ? "text-muted" : "font-bold text-red-500"}`}>已选 {cardForm.packIds.length} 个</span></div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
              <label className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={16} /><input className="field pr-9" placeholder="搜索卡包名称" value={packKeyword} onChange={(event) => setPackKeyword(event.target.value)} /></label>
              <select className="field" value={packTypeFilter} onChange={(event) => setPackTypeFilter(event.target.value as "all" | AssetPackType)}><option value="all">全部类型</option>{Object.entries(ASSET_PACK_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line p-2">
              {packs.length === 0 ? <p className="p-4 text-center text-sm text-muted">请先创建卡包</p> : visibleCardPacks.length === 0 ? <p className="p-4 text-center text-sm text-muted">没有匹配的卡包</p> : <div className="grid gap-2 sm:grid-cols-2">{visibleCardPacks.map((pack) => {
                const selected = cardForm.packIds.includes(pack.id);
                const locked = pack.enabled && (Boolean(editingCardId) || !selected);
                return <button key={pack.id} type="button" disabled={locked} title={pack.enabled ? (selected && !editingCardId ? "该卡包已上架，只能取消本次自动勾选" : "已上架卡包不能调整卡牌") : undefined} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-primary bg-blue-50" : "border-line hover:bg-slate-50"}`} onClick={() => toggleCardPack(pack.id)}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${selected ? "border-primary bg-primary text-white" : "border-slate-300 bg-white"}`}>{selected && <Check size={14} />}</span><span className="min-w-0"><span className="block truncate text-sm font-bold text-ink">{pack.name}</span><span className="text-[11px] text-muted">{pack.packTypeLabel} · {pack.enabled ? "已上架（不可新增）" : "未上架"}</span></span></button>;
              })}</div>}
            </div>
            <p className="mt-2 text-xs text-muted">绑定后自动参与对应品质的抽取；同品质存在多张卡牌时等概率抽取。</p>
          </fieldset>
        </div>
        <button className="btn btn-primary mt-5 w-full" disabled={saving || !cardForm.imageUrl || !cardForm.cardNo || !cardForm.name || cardForm.packIds.length === 0} onClick={() => void saveCard()}><Save size={17} />{saving ? "压缩并保存中…" : "保存卡牌"}</button>
      </Modal>}

      {packModal && <Modal full onClose={() => setPackModal(false)}>
        <div className="flex items-center justify-between"><h2 className="text-xl font-black text-ink">{editingPackId ? "编辑卡包" : "新增卡包"}</h2><button className="grid h-10 w-10 place-items-center rounded-full bg-slate-100" onClick={() => setPackModal(false)}><X size={18} /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label><span className="text-sm font-bold">卡包封面</span><input type="file" accept="image/*" className="mt-2 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void fileData(file).then((coverUrl) => setPackForm((value) => ({ ...value, coverUrl }))).catch((error) => setMessage((error as Error).message)); }} />{packForm.coverUrl && <img src={packForm.coverUrl} alt="" className="mt-3 h-44 w-32 rounded-xl object-cover" />}</label>
          <div className="space-y-4">
            <label className="block"><span className="text-sm font-bold">卡包名称</span><input className="field mt-1" value={packForm.name} onChange={(e) => setPackForm({ ...packForm, name: e.target.value })} /></label>
            <label className="block"><span className="text-sm font-bold">类型</span><select className="field mt-1" value={packForm.packType} onChange={(e) => { const packType = e.target.value as AssetPackType; setPackForm({ ...packForm, packType, ...(packType === "permanent" ? { saleStartAt: "", saleEndAt: "" } : {}) }); }}>{Object.entries(ASSET_PACK_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="grid grid-cols-3 gap-2"><label><span className="text-xs font-bold">单抽</span><input type="number" className="field mt-1" value={packForm.singlePrice} onChange={(e) => setPackForm({ ...packForm, singlePrice: Number(e.target.value) })} /></label><label><span className="text-xs font-bold">十连</span><input type="number" className="field mt-1" value={packForm.tenPrice} onChange={(e) => setPackForm({ ...packForm, tenPrice: Number(e.target.value) })} /></label><label><span className="text-xs font-bold">日免费</span><input type="number" className="field mt-1" value={packForm.dailyFreeDraws} onChange={(e) => setPackForm({ ...packForm, dailyFreeDraws: Number(e.target.value) })} /></label></div>
            <label className="block"><span className="text-sm font-bold">权重</span><input type="number" min="-1000000" max="1000000" step="1" className="field mt-1" value={packForm.sortOrder} onChange={(e) => setPackForm({ ...packForm, sortOrder: Number(e.target.value) })} /><span className="mt-1 block text-xs text-muted">权重越大，在商城和管理列表中越靠上。</span></label>
          </div>
          {packForm.packType !== "permanent" && <>
            <label><span className="text-sm font-bold">上架时间 <span className="text-red-500">*</span></span><input type="datetime-local" className="field mt-1" value={packForm.saleStartAt} onChange={(e) => setPackForm({ ...packForm, saleStartAt: e.target.value })} /></label>
            <label><span className="text-sm font-bold">下架时间 <span className="text-red-500">*</span></span><input type="datetime-local" className="field mt-1" value={packForm.saleEndAt} onChange={(e) => setPackForm({ ...packForm, saleEndAt: e.target.value })} /></label>
          </>}
          {packForm.packType === "permanent" && <div className="sm:col-span-2 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">常驻卡包永久展示，无需设置起止时间。</div>}
          <label className="sm:col-span-2"><span className="text-sm font-bold">简介</span><textarea className="field mt-1 min-h-20" value={packForm.description} onChange={(e) => setPackForm({ ...packForm, description: e.target.value })} /></label>
          <div className="sm:col-span-2"><span className="text-sm font-bold">卡包故事</span><p className="mt-1 text-xs text-muted">支持加粗、斜体、下划线和列表，最多 3000 字</p><PackStoryEditor value={packForm.packStory} onChange={(packStory) => setPackForm({ ...packForm, packStory })} /></div>
          <div className="sm:col-span-2 rounded-xl bg-blue-50 p-3 text-sm text-primary">概率公示由系统按实际配置自动生成：品质概率除以该品质启用卡牌数量，即为单张卡牌的实际概率。</div>
        </div>
        <button className="btn btn-primary mt-5 w-full" disabled={saving || !packForm.coverUrl || !packForm.name || (packForm.packType !== "permanent" && (!packForm.saleStartAt || !packForm.saleEndAt))} onClick={() => void savePack()}><Save size={17} />{saving ? "压缩并保存中…" : "保存卡包"}</button>
      </Modal>}

      {configPack && <Modal full onClose={() => setConfigPack(null)}>
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-ink">卡牌「{configPack.name}」</h2><p className="mt-1 text-sm text-muted">查看和管理卡包内卡牌，并配置各品质抽取概率。</p></div><button className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100" onClick={() => setConfigPack(null)}><X size={18} /></button></div>

        <section className="mt-5">
          <h3 className="font-black text-ink">品质概率</h3>
          <p className="mt-1 text-xs text-muted">四种品质概率合计必须精确为 100%；同品质卡牌等概率抽取。</p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">{rarityKeys.map((rarity) => { const count = configuredCards.filter((card) => card.status === "active" && card.rarity === rarity).length; return <label key={rarity} className={`rounded-xl border p-4 ${Number(probabilities[rarity] || 0) > 0 ? "border-primary bg-blue-50" : "border-line"}`}><span className="text-sm font-black text-ink">{ASSET_RARITY_LABELS[rarity]}</span><span className="mt-1 block text-xs text-muted">已绑定 {count} 张启用卡牌</span><span className="mt-3 flex items-center gap-2"><input type="number" min="0" max="100" step="0.000001" className="field h-10 px-2" value={probabilities[rarity]} placeholder="0" onChange={(event) => setProbabilities({ ...probabilities, [rarity]: event.target.value })} /><span className="text-sm font-bold">%</span></span></label>; })}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-slate-50 p-3"><span className={`text-sm font-black ${Math.abs(Object.values(probabilities).reduce((sum, value) => sum + Number(value || 0), 0) - 100) < 0.000001 ? "text-emerald-600" : "text-amber-600"}`}>合计 {Object.values(probabilities).reduce((sum, value) => sum + Number(value || 0), 0).toFixed(6)}%</span><button className="btn btn-primary" disabled={saving} onClick={() => void saveConfiguration()}>{saving ? <Sparkles size={17} /> : <Check size={17} />}保存品质概率</button></div>
        </section>

        <section className="mt-6 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-ink">已绑定卡牌 {configuredCards.length}</h3><p className="mt-1 text-xs text-muted">卡牌可同时存在于多个卡包；每张卡牌至少需要保留一个所属卡包。</p></div>{!configPack.enabled && <button className="btn btn-primary" disabled={saving} onClick={() => void savePackCards()}><Save size={16} />保存卡牌</button>}</div>
          {configPack.enabled && <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">该卡包已上架，当前不能新增或移除卡牌；品质概率仍可编辑。需要调整卡牌时请先下架。</div>}
          <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-line">
            {configuredCards.length === 0 ? <p className="p-6 text-center text-sm text-muted">该卡包尚未绑定卡牌</p> : configuredCards.map((card) => <div key={card.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-ink">{card.name}</span><span className="text-xs text-muted">NO.{card.cardNo} · {ASSET_RARITY_LABELS[card.rarity]} · {card.status === "active" ? "启用" : "停用"}</span></span><button type="button" className="btn bg-red-50 px-3 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-40" disabled={configPack.enabled || saving} onClick={() => toggleConfigCard(card.id)}>移除</button></div>)}
          </div>

          {!configPack.enabled && <div className="mt-4 rounded-xl border border-line p-3"><label className="relative block"><Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={16} /><input className="field pr-9" placeholder="搜索卡牌名称或序号" value={configCardKeyword} onChange={(event) => setConfigCardKeyword(event.target.value)} /></label><div className="mt-2 max-h-64 overflow-y-auto">{availableConfigCards.length === 0 ? <p className="p-5 text-center text-sm text-muted">没有可新增的匹配卡牌</p> : availableConfigCards.map((card) => <div key={card.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-ink">{card.name}</span><span className="text-xs text-muted">NO.{card.cardNo} · {ASSET_RARITY_LABELS[card.rarity]}</span></span><button type="button" className="btn btn-secondary px-3 text-xs" disabled={saving} onClick={() => toggleConfigCard(card.id)}><Plus size={14} />新增</button></div>)}</div></div>}
        </section>
      </Modal>}
    </div>
  );
}
