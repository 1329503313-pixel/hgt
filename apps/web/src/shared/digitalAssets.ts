export type AssetRarity = "normal" | "rare" | "epic" | "legend";
export type AssetPackType = "permanent" | "limited" | "collaboration";
export type CardBattleRole = "damage" | "tank" | "support";

export const CARD_BATTLE_ROLE_LABELS: Record<CardBattleRole, string> = {
  damage: "输出",
  tank: "坦克",
  support: "辅助",
};

export type CardBattleCondition = "energy_full" | "self_death" | "self_hp_below_percent" | "normal_kill" | "skill_kill" | "ally_death" | "self_death_energy_full" | "self_hp_below_percent_energy_full" | "normal_kill_energy_full" | "skill_kill_energy_full" | "ally_death_energy_full";
export type CardBattleEffectType = import("@hgt/shared").CardBattleDefenseEffect | import("@hgt/shared").CardBattleControlEffect | import("@hgt/shared").CardBattleProcEffect | import("./cardBattleEffects").CardBattleDebuffType | "damage_single" | "damage_rear" | "damage_random" | "damage_all_front" | "damage_all_rear" | "damage_random_2" | "damage_random_3" | "damage_random_4" | "damage_all" | "heal_self" | "heal_lowest_ally" | "energy_self" | "energy_lowest_ally" | "heal_all_allies" | "energy_all_allies" | "defense_self" | "defense_all_allies" | "speed_self" | "speed_all_allies" | "max_hp_self" | "max_hp_all_allies" | "attack_self" | "attack_all_allies" | "attack_skill_damage_self" | "attack_skill_damage_all_allies" | "revive_self" | "revive_ally_1" | "revive_ally_2" | "revive_ally_3" | "revive_ally_4" | "revive_all_allies";
export type CardBattleSkillEffect = import("@hgt/shared").CardBattleDamageOptions & { id?: string; order: number; condition: CardBattleCondition; conditionValue: number | null; type: CardBattleEffectType; value: number | null; duration: number | null; probability?: number; additionalEffects?: CardBattleSkillAction[] };
export type CardBattleSkillAction = Omit<CardBattleSkillEffect, "order" | "condition" | "conditionValue" | "additionalEffects">;
export type CardBattleTier = import("@hgt/shared").CardBattleProcStats & import("@hgt/shared").CardBattleAccuracyStats & { starLevel: 0 | 1 | 2 | 3; maxHp: number; attack: number; defense: number; speed: number; energyRequired: number; critRate: number; critDamage: number; canAttackRear: boolean; skillName: string; skillDescription: string; effects: CardBattleSkillEffect[]; bonds?: import("@hgt/shared").CardBattleBond[] };

export const DEFAULT_EPIC_CARD_BATTLE_TIERS: CardBattleTier[] = [
  { starLevel: 0, maxHp: 800, attack: 250, defense: 30, speed: 80, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 1, maxHp: 1200, attack: 375, defense: 60, speed: 95, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 2, maxHp: 1500, attack: 500, defense: 90, speed: 110, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 3, maxHp: 1900, attack: 625, defense: 120, speed: 125, energyRequired: 40, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
];

export const DEFAULT_LEGEND_CARD_BATTLE_TIERS: CardBattleTier[] = [
  { starLevel: 0, maxHp: 1000, attack: 500, defense: 100, speed: 100, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 1, maxHp: 1500, attack: 750, defense: 150, speed: 150, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 2, maxHp: 2000, attack: 1000, defense: 200, speed: 200, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
  { starLevel: 3, maxHp: 3000, attack: 1500, defense: 300, speed: 300, energyRequired: 50, canAttackRear: false, critRate: 25, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0, dodgeRate: 0, hitRate: 0, skillName: "", skillDescription: "", effects: [] },
];

export const DEFAULT_CARD_BATTLE_TIERS = DEFAULT_LEGEND_CARD_BATTLE_TIERS;

export function defaultCardBattleTiersForRarity(rarity: "epic" | "legend") {
  return rarity === "epic" ? DEFAULT_EPIC_CARD_BATTLE_TIERS : DEFAULT_LEGEND_CARD_BATTLE_TIERS;
}

export type AssetCard = {
  id: string;
  cardNo: string;
  name: string;
  rarity: AssetRarity;
  battleRole?: CardBattleRole | null;
  imageUrl: string;
  thumbnailUrl: string;
  motionMp4Url?: string | null;
  motionWebmUrl?: string | null;
  motionPosterUrl?: string | null;
  story: string;
  releaseAt: string | null;
  status: string;
  battleTiers?: CardBattleTier[] | null;
};

export type AssetCardBattlePreview = Pick<CardBattleTier, "starLevel" | "maxHp" | "attack" | "defense" | "speed" | "energyRequired" | "critRate" | "critDamage" | "lifestealRate" | "stunRate" | "extraActionRate" | "counterRate" | "dodgeRate" | "hitRate" | "skillName" | "skillDescription">;

export type OwnedAssetCard = AssetCard & {
  starLevel: number;
  duplicateProgress: number;
  nextStarRequirement: number | null;
  totalObtained: number;
  collectionValue: number;
  firstObtainedAt: string | null;
  lastObtainedAt: string | null;
  displayOrder: number | null;
  battleTier?: AssetCardBattlePreview | null;
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
  totalDrawCount?: number;
  upCardId?: string | null;
  epicUpGuaranteed?: boolean;
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
  cards?: Array<AssetCard & { actualProbability: number; owned: boolean; starLevel?: number; battleTier?: AssetCardBattlePreview | null }>;
  collectibleRewards?: Array<import("./collectibles").Collectible & {
    probability: number;
    acquired: boolean;
    baseProbability?: number;
    probabilityBoost?: number;
    probabilityBoostLevel?: number;
  }>;
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
  collectibleAwards: Array<import("./collectibles").Collectible & { drawIndex: number; packDrawNumber: number; probability: number }>;
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
