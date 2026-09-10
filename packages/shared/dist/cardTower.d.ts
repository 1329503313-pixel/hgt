import type { BattleCollectibleBinding } from "./index.js";
export type CardTowerFormation = {
    cardIds: Array<string | null>;
    collectibleBindings: BattleCollectibleBinding[];
};
export declare const emptyCardTowerFormations: () => CardTowerFormation[];
/** The most recent formation operation owns every selected card and collectible. */
export declare function replaceCardTowerFormation(formations: CardTowerFormation[], index: number, incoming: CardTowerFormation): CardTowerFormation[];
export declare function cardTowerFormationError(formations: CardTowerFormation[]): "需要三个五卡阵容" | "至少配置一个完整的五卡阵容才能开始" | "三个阵容不能重复使用同一张卡牌" | "每个阵容必须选满五张卡，或清空该阵容" | "三个阵容不能重复装配同一件收藏品" | null;
