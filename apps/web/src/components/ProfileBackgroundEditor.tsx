import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, SlidersHorizontal, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { removeSessionCache, removeSessionCachePrefix } from "../shared/sessionCache";
import type { AssetRarity } from "../shared/digitalAssets";
import { Modal } from "./Modal";

type BackgroundCard = {
  id: string;
  cardNo: string;
  name: string;
  rarity: AssetRarity;
  thumbnailUrl: string;
  starLevel: number;
};

type BackgroundsResponse = {
  cards: BackgroundCard[];
  total: number;
  selectedCardId: string | null;
  crop: { x: number; y: number; zoom: number };
};

const defaultCrop = { x: 50, y: 50, zoom: 1 };

function drawCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, crop: typeof defaultCrop) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const targetRatio = canvas.width / canvas.height;
  let cropWidth = sourceWidth;
  let cropHeight = cropWidth / targetRatio;
  if (cropHeight > sourceHeight) {
    cropHeight = sourceHeight;
    cropWidth = cropHeight * targetRatio;
  }
  cropWidth /= crop.zoom;
  cropHeight /= crop.zoom;
  const sourceX = (sourceWidth - cropWidth) * crop.x / 100;
  const sourceY = (sourceHeight - cropHeight) * crop.y / 100;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
}

export function ProfileBackgroundEditor({ userId, fullList = false }: { userId: string; fullList?: boolean }) {
  const { showToast } = useApp();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<BackgroundsResponse | null>(null);
  const [editingCard, setEditingCard] = useState<BackgroundCard | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState(defaultCrop);
  const [loadingCardId, setLoadingCardId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = fullList ? 10 : 2;

  async function load() {
    const offset = (page - 1) * pageSize;
    setData(await api<BackgroundsResponse>(`/api/me/profile-backgrounds?limit=${pageSize}&offset=${offset}`, { bypassCache: true }));
  }

  useEffect(() => { void load().catch((error) => showToast((error as Error).message)); }, [userId, page, fullList]);
  useEffect(() => {
    if (canvasRef.current && sourceImage) drawCrop(canvasRef.current, sourceImage, crop);
  }, [sourceImage, crop]);

  async function edit(card: BackgroundCard) {
    if (loadingCardId || saving) return;
    setLoadingCardId(card.id);
    try {
      const result = await api<{ imageUrl: string }>(`/api/me/card-cabinet/cards/${card.id}/image`, { bypassCache: true });
      const image = new window.Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("卡牌原图加载失败"));
        image.src = result.imageUrl;
      });
      setEditingCard(card);
      setSourceImage(image);
      setCrop(data?.selectedCardId === card.id ? data.crop : defaultCrop);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoadingCardId(null);
    }
  }

  function clearProfileCaches() {
    removeSessionCache(`hgt:mine:profile:${userId}`);
    removeSessionCachePrefix("hgt:user-profile:");
  }

  async function save() {
    if (!editingCard || saving) return;
    setSaving(true);
    try {
      await api("/api/me/profile-background", { method: "PATCH", body: { cardId: editingCard.id, crop } });
      clearProfileCaches();
      setEditingCard(null);
      setSourceImage(null);
      await load();
      showToast("主页背景已更新");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (saving) return;
    setSaving(true);
    try {
      await api("/api/me/profile-background", { method: "PATCH", body: { cardId: null } });
      clearProfileCaches();
      await load();
      showToast("已恢复默认主页背景");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><ImageIcon size={20} /></span>
        <div><h2 className="text-sm font-black text-ink">卡牌主页背景</h2><p className="mt-1 text-xs leading-5 text-muted">任意史诗或传说卡牌达到一星后解锁。只能选择已解锁卡牌，不支持自主上传。</p></div>
      </div>
      {!data ? <div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100" /> : data.cards.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-muted">暂无可用背景，将史诗或传说卡牌升至一星即可解锁。</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {data.cards.map((card) => {
              const selected = data.selectedCardId === card.id;
              const loading = loadingCardId === card.id;
              return (
                <button key={card.id} type="button" role="checkbox" aria-checked={selected} disabled={Boolean(loadingCardId) || saving} className={`relative overflow-hidden rounded-xl border-2 text-left transition disabled:cursor-wait disabled:opacity-60 ${selected ? "border-primary" : "border-transparent bg-slate-100"}`} onClick={() => void edit(card)}>
                  <img src={card.thumbnailUrl} alt="" className="aspect-[5/3] w-full object-cover" loading="lazy" decoding="async" />
                  <span className="block bg-white/85 px-2 py-2"><span className="block truncate text-xs font-black text-ink">{card.name}</span><span className="mt-0.5 block text-[10px] font-bold text-muted">{loading ? "正在加载基础卡面…" : `${card.rarity === "legend" ? "传说" : "史诗"} · ${card.starLevel} 星`}</span></span>
                  <span className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded border ${selected ? "border-primary bg-primary text-white" : "border-white/80 bg-white/85 text-transparent"}`}><Check size={13} /></span>
                </button>
              );
            })}
          </div>
          {!fullList && data.total > 2 && (
            <button type="button" className="btn btn-secondary mt-4 w-full" onClick={() => navigate("/mine/settings/backgrounds")}>
              查看更多背景<ChevronRight size={17} />
            </button>
          )}
          {fullList && data.total > pageSize && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
              <button type="button" className="btn btn-secondary px-3" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} />上一页</button>
              <span className="text-xs font-bold text-muted">第 {page} / {Math.ceil(data.total / pageSize)} 页</span>
              <button type="button" className="btn btn-secondary px-3" disabled={page >= Math.ceil(data.total / pageSize)} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight size={17} /></button>
            </div>
          )}
          {data.selectedCardId && <button type="button" className="btn btn-secondary mt-4 w-full" disabled={saving} onClick={() => void clear()}>恢复默认背景</button>}
        </>
      )}

      {editingCard && sourceImage && <Modal full onClose={() => !saving && setEditingCard(null)}>
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-xl font-black text-ink">裁剪主页背景</h2><p className="mt-1 text-sm text-muted">仅裁剪「{editingCard.name}」的基础卡面，编号、品质和星级等元素不会进入背景。</p></div>
          <button type="button" className="btn btn-secondary shrink-0 px-3" disabled={saving} onClick={() => setEditingCard(null)} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-slate-900 shadow-inner">
          <canvas ref={canvasRef} width={1000} height={400} className="block aspect-[5/2] w-full" aria-label="主页背景裁剪预览" />
        </div>
        <div className="mt-5 space-y-4 rounded-2xl bg-slate-50 p-4">
          <div className="flex items-center gap-2 font-black text-ink"><SlidersHorizontal size={18} />调整裁剪区域</div>
          <label className="block"><span className="flex justify-between text-sm font-bold text-ink"><span>横向位置</span><span>{Math.round(crop.x)}%</span></span><input className="mt-2 w-full accent-blue-600" type="range" min="0" max="100" step="1" value={crop.x} onChange={(event) => setCrop((value) => ({ ...value, x: Number(event.target.value) }))} /></label>
          <label className="block"><span className="flex justify-between text-sm font-bold text-ink"><span>纵向位置</span><span>{Math.round(crop.y)}%</span></span><input className="mt-2 w-full accent-blue-600" type="range" min="0" max="100" step="1" value={crop.y} onChange={(event) => setCrop((value) => ({ ...value, y: Number(event.target.value) }))} /></label>
          <label className="block"><span className="flex justify-between text-sm font-bold text-ink"><span>缩放</span><span>{crop.zoom.toFixed(1)}×</span></span><input className="mt-2 w-full accent-blue-600" type="range" min="1" max="3" step="0.1" value={crop.zoom} onChange={(event) => setCrop((value) => ({ ...value, zoom: Number(event.target.value) }))} /></label>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setEditingCard(null)}>取消</button><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "生成并压缩中…" : "保存主页背景"}</button></div>
      </Modal>}
    </div>
  );
}
