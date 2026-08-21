import type { Collectible } from "../shared/collectibles";
import { AssetMotionMedia } from "./AssetCardVisual";

export function CollectibleVisual({ collectible, className = "" }: { collectible: Collectible; className?: string }) {
  const animated = Boolean(collectible.motionMp4Url || collectible.motionWebmUrl);
  return <div className={`relative overflow-hidden rounded-2xl bg-slate-900 ${className}`}>
    {animated
      ? <AssetMotionMedia card={collectible} className="h-full w-full object-cover" />
      : <img src={collectible.imageUrl} alt={collectible.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />}
    <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] font-black text-white">NO.{collectible.collectibleNo}</span>
    <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-black text-slate-900">{collectible.rarityLabel}</span>
    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-10 text-white"><span className="block text-[10px] font-bold text-white/80">{collectible.collectibleTypeLabel}</span><span className="mt-0.5 block text-sm font-black">{collectible.name}</span></span>
  </div>;
}
