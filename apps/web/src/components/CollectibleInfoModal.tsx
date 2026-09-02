import { Gem, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Collectible } from "../shared/collectibles";
import { CollectibleVisual } from "./CollectibleVisual";
import { Modal } from "./Modal";

export function CollectibleInfoModal({ collectibleId, onClose }: { collectibleId: string; onClose: () => void }) {
  const [item, setItem] = useState<Collectible | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ collectible: Collectible }>(`/api/collectibles/${collectibleId}`, { bypassCache: true });
      setItem(data.collectible);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "收藏品信息加载失败");
    } finally {
      setLoading(false);
    }
  }, [collectibleId]);

  useEffect(() => { void load(); }, [load]);

  return <Modal onClose={onClose} contentClassName="max-w-sm">
    {loading ? <div className="grid min-h-72 place-items-center text-sm font-bold text-muted" role="status"><span className="text-center"><LoaderCircle className="mx-auto mb-3 animate-spin" size={28} />正在加载收藏品信息</span></div> : error ? <div className="py-8 text-center"><p className="text-sm font-bold text-red-600">{error}</p><button type="button" className="btn btn-secondary mt-4 min-h-11" onClick={() => void load()}><RefreshCw size={16} />重新加载</button></div> : item ? <article aria-labelledby="chat-collectible-card-title">
      <CollectibleVisual collectible={item} className="mx-auto aspect-[5/6] w-full max-w-[280px] shadow-soft" />
      <header className="mt-4 text-center"><p className="text-xs font-black tracking-[0.12em] text-primary">{item.rarityLabel} · NO.{item.collectibleNo}</p><h2 id="chat-collectible-card-title" className="mt-1 break-words text-xl font-black text-ink">{item.name}</h2></header>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-bold text-muted">类型</dt><dd className="mt-1 font-black text-ink">{item.collectibleTypeLabel}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-bold text-muted">收藏品价值</dt><dd className="mt-1 inline-flex items-center gap-1 font-black text-ink"><Gem size={14} />{item.collectibleValue.toLocaleString()}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-bold text-muted">状态</dt><dd className="mt-1 font-black text-ink">{item.statusLabel}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-bold text-muted">拥有者</dt><dd className="mt-1 break-words font-black text-ink">{item.owner?.nickname || "暂无拥有者"}</dd></div>
      </dl>
      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{item.description || "暂无介绍"}</p>
    </article> : null}
  </Modal>;
}
