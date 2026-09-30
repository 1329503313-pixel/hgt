export type CollectibleAchievementStat = "epicCollectibleAcquired" | "legendCollectibleAcquired" | "highestCollectibleValue";
export interface CollectibleAchievementDefinition {
    key: string;
    series: string;
    tier: "normal" | "rare" | "epic" | "legend";
    tierIndex: number;
    name: string;
    description: string;
    requirement: string;
    iconUrl: string;
    stat: CollectibleAchievementStat;
    target: number;
    achievementPoints: number;
    nextBadgeLabel?: string;
}
export declare const COLLECTIBLE_ACHIEVEMENTS: readonly CollectibleAchievementDefinition[];
export declare const COLLECTIBLE_ACHIEVEMENT_POINTS: Record<string, number>;
export declare const COLLECTIBLE_ACHIEVEMENT_NAMES: Record<string, string>;
