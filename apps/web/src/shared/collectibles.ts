export type CollectibleRarity = "limited" | "collaboration" | "legend" | "epic";
export type CollectibleType = "treasure" | "commemorative" | "honor";
export type CollectibleStatus = "unowned" | "owned" | "auction_pending" | "auction_active" | "draw_linked";

export type Collectible = {
  id: string; collectibleNo: string; name: string; rarity: CollectibleRarity; rarityLabel: string; collectibleType: CollectibleType; collectibleTypeLabel: string; description: string;
  collectibleValue: number;
  imageUrl: string; thumbnailUrl: string; motionMp4Url?: string | null; motionWebmUrl?: string | null; motionPosterUrl?: string | null;
  motionStatus?: string; motionError?: string | null; owner?: { id: string; nickname: string; username: string } | null;
  status: CollectibleStatus; statusLabel: string; packBinding?: { packId: string; packName: string; probability: number } | null;
  auction?: { id: string; startingPrice: number; currentPrice: number | null; startsAt: string; endsAt: string } | null;
  acquiredAt?: string | null; acquired?: boolean; followed?: boolean; createdAt?: string | null; updatedAt?: string | null;
};

export type CollectibleAuction = {
  id: string; collectible: Collectible; startingPrice: number; currentPrice: number | null;
  highestBidder: { id: string; nickname: string } | null; isHighestBidder: boolean;
  startsAt: string; endsAt: string; status: "pending" | "active" | "sold" | "unsold" | "cancelled"; settledAt: string | null;
};

export const COLLECTIBLE_RARITY_LABELS: Record<CollectibleRarity, string> = {
  limited: "限定", collaboration: "联动", legend: "传说", epic: "史诗"
};

export const COLLECTIBLE_EDITABLE_RARITY_LABELS = {
  epic: "史诗", legend: "传说"
} as const satisfies Partial<Record<CollectibleRarity, string>>;

export const COLLECTIBLE_TYPE_LABELS: Record<CollectibleType, string> = {
  treasure: "珍宝", commemorative: "纪念", honor: "荣耀"
};
