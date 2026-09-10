/** Skill actions share a trigger only when explicitly attached to the same row. */
export declare const CARD_BATTLE_CONTROL_LABELS: {
    readonly revival_block_all: "禁止所有敌方单位复活";
    readonly revival_block_front: "禁止所有敌方前排单位复活";
    readonly revival_block_rear: "禁止所有敌方后排单位复活";
    readonly revival_block_damaged: "禁止敌方受到本技能伤害的单位复活";
    readonly act_again: "立刻再次行动";
    readonly stun_enemy_single: "令敌方一名单位眩晕";
    readonly stun_enemy_front: "令敌方前排单位眩晕";
    readonly stun_enemy_rear: "令敌方后排单位眩晕";
    readonly stun_enemy_all: "令敌方所有单位眩晕";
    readonly stun_enemy_random: "令敌方随机一名单位眩晕";
    readonly immunity_self: "令自己获得免疫";
    readonly immunity_front: "令己方前排获得免疫";
    readonly immunity_rear: "令己方后排获得免疫";
    readonly immunity_all: "令己方全员获得免疫";
    readonly cleanse_self: "净化自己";
    readonly cleanse_random: "净化随机一名友军";
    readonly cleanse_front: "净化全体前排";
    readonly cleanse_rear: "净化全体后排";
    readonly cleanse_all: "净化全体友军";
};
export type CardBattleControlEffect = keyof typeof CARD_BATTLE_CONTROL_LABELS;
export declare const CARD_BATTLE_CONTROL_CODES: CardBattleControlEffect[];
export declare const isCardBattleControlEffect: (type: string) => type is CardBattleControlEffect;
export declare const isCardBattleStun: (type: string) => boolean;
export declare const isCardBattleRevivalBlock: (type: string) => boolean;
export declare const isCardBattleImmunity: (type: string) => boolean;
export declare const isCardBattleCleanse: (type: string) => boolean;
export declare const isCardBattleAttachedOnly: (type: string) => type is "act_again" | "revival_block_damaged";
export declare const cardBattleControlNeedsDuration: (type: string) => boolean;
export type CardBattleStatusCategory = "buff" | "debuff";
/** Also classifies older frozen snapshots that predate the category field. */
export declare function cardBattleStatusCategory(type: string): CardBattleStatusCategory;
