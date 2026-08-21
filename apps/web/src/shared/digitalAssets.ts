export type AssetRarity = "normal" | "rare" | "epic" | "legend";
export type AssetPackType = "permanent" | "limited" | "collaboration";

export type AssetCard = {
  id: string;
  cardNo: string;
  name: string;
  rarity: AssetRarity;
  imageUrl: string;
  thumbnailUrl: string;
  motionMp4Url?: string | null;
  motionWebmUrl?: string | null;
  motionPosterUrl?: string | null;
  story: string;
  releaseAt: string | null;
  status: string;
};

export type OwnedAssetCard = AssetCard & {
  starLevel: number;
  duplicateProgress: number;
  nextStarRequirement: number | null;
  totalObtained: number;
  collectionValue: number;
  firstObtainedAt: string | null;
  lastObtainedAt: string | null;
  displayOrder: number | null;
  packs: Array<{ id: string; name: string; packType: AssetPackType; coverUrl: string }>;
};

export type AssetPity = {
  rare: number;
  epic: number;
  legend: number;
  rareLimit: number;
  epicLimit: number;
  legendLimit: number;
};

export type AssetPack = {
  id: string;
  name: string;
  coverUrl: string;
  coverCard?: AssetCard | null;
  description: string;
  packStory: string;
  packType: AssetPackType;
  packTypeLabel: string;
  singlePrice: number;
  tenPrice: number;
  dailyFreeDraws: number;
  freeDrawsRemaining: number;
  freeDrawsUnlimited?: boolean;
  saleStartAt: string | null;
  saleEndAt: string | null;
  enabled: boolean;
  status: "on_sale" | "upcoming" | "ended" | "offline";
  sortOrder: number;
  probabilityNotice: string;
  rarityProbabilities: Record<AssetRarity, number>;
  pity: AssetPity;
  previewCards?: AssetCard[];
  collectibleCounts?: { available: number; total: number } | null;
  cards?: Array<AssetCard & { actualProbability: number; owned: boolean; starLevel?: number }>;
  collectibleRewards?: Array<import("./collectibles").Collectible & { probability: number; acquired: boolean }>;
};

export type CardCabinet = {
  user: {
    id: string;
    nickname: string;
    avatar: string | null;
    totalCollectionValue: number;
    unlockedCardCount: number;
    legendaryCardCount: number;
  };
  showcase: OwnedAssetCard[];
  cards: OwnedAssetCard[];
};

export type AssetDrawResult = AssetCard & {
  drawIndex: number;
  pityType: "rare" | "epic" | "legend" | null;
  starBefore: number | null;
  starAfter: number;
  firstObtained: boolean;
  starUpgraded: boolean;
  fullStarDuplicate: boolean;
  shellRefund: number;
};

export type AssetDrawOrder = {
  id: string;
  requestId: string;
  packId: string;
  packName: string;
  packType: AssetPackType;
  packCoverUrl: string;
  drawMode: "single" | "ten";
  shellCost: number;
  usedFreeDraw: boolean;
  createdAt: string;
  results: AssetDrawResult[];
  collectibleAwards: Array<import("./collectibles").Collectible & { drawIndex: number; probability: number }>;
};

export const ASSET_RARITY_LABELS: Record<AssetRarity, string> = {
  normal: "普通",
  rare: "稀有",
  epic: "史诗",
  legend: "传说"
};

export const ASSET_PACK_TYPE_LABELS: Record<AssetPackType, string> = {
  permanent: "常驻卡包",
  limited: "限定卡包",
  collaboration: "联动卡包"
};

const ASSET_RARITY_PREFIXES: Record<AssetPackType, string> = {
  permanent: "",
  limited: "限定",
  collaboration: "联动"
};

export function assetRarityLabel(rarity: AssetRarity, packType?: AssetPackType | null) {
  return `${packType ? ASSET_RARITY_PREFIXES[packType] : ""}${ASSET_RARITY_LABELS[rarity]}`;
}

export function assetRarityMatchesQuery(rarity: AssetRarity, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return ([undefined, "permanent", "limited", "collaboration"] as const).some((packType) => {
    const label = assetRarityLabel(rarity, packType).toLocaleLowerCase();
    return label.includes(normalized) || normalized.includes(label);
  });
}

const ASSET_DRAW_DISPLAY_RARITY_RANK: Record<AssetRarity, number> = {
  normal: 0,
  rare: 1,
  epic: 2,
  legend: 3
};

export function sortAssetDrawResultsForDisplay<T extends Pick<AssetDrawResult, "rarity" | "drawIndex">>(results: readonly T[]) {
  return [...results].sort((left, right) => (
    ASSET_DRAW_DISPLAY_RARITY_RANK[right.rarity] - ASSET_DRAW_DISPLAY_RARITY_RANK[left.rarity]
    || left.drawIndex - right.drawIndex
  ));
}

const warmedAssetImages = new Set<string>();

export function warmAssetImage(src: string | null | undefined) {
  if (!src || src.startsWith("data:") || warmedAssetImages.has(src) || typeof Image === "undefined") return;
  warmedAssetImages.add(src);
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  void image.decode?.().catch(() => warmedAssetImages.delete(src));
}
