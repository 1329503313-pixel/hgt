import { useState } from "react";
import { DigitalAssetManagement } from "./DigitalAssetManagement";
import { StickerManagement } from "./StickerManagement";
import { CollectibleAuctionManagement } from "./CollectibleAuctionManagement";

export function StoreManagement() {
  const [section, setSection] = useState<"cards" | "stickers" | "collectibles">("cards");
  return <div className="space-y-4"><div className="rounded-2xl border border-line bg-white p-2"><div className="grid grid-cols-3 gap-2"><button className={`btn ${section === "cards" ? "btn-primary" : "btn-secondary"}`} onClick={() => setSection("cards")}>卡牌</button><button className={`btn ${section === "stickers" ? "btn-primary" : "btn-secondary"}`} onClick={() => setSection("stickers")}>表情包</button><button className={`btn ${section === "collectibles" ? "btn-primary" : "btn-secondary"}`} onClick={() => setSection("collectibles")}>收藏品</button></div></div>{section === "cards" ? <DigitalAssetManagement /> : section === "stickers" ? <StickerManagement /> : <CollectibleAuctionManagement />}</div>;
}
