export declare const CARD_BATTLE_ACCURACY_STATS: readonly [{
    readonly key: "dodgeRate";
    readonly column: "dodge_rate";
    readonly label: "闪避率";
}, {
    readonly key: "hitRate";
    readonly column: "hit_rate";
    readonly label: "命中率";
}];
export type CardBattleAccuracyStat = typeof CARD_BATTLE_ACCURACY_STATS[number]["key"];
/** Missing attributes in historical frozen lineups mean zero. */
export type CardBattleAccuracyStats = Partial<Record<CardBattleAccuracyStat, number>>;
export declare const CARD_BATTLE_DEFENSE_EFFECT_LABELS: {
    readonly shield_self: "为自己增加护盾值";
    readonly shield_front: "为友军前排增加护盾值";
    readonly shield_rear: "为友军后排增加护盾值";
    readonly shield_all: "为友军全员增加护盾值";
    readonly damage_true_single: "造成真实伤害";
    readonly damage_true_random: "对1名随机敌人造成真实伤害";
    readonly damage_true_random_2: "对2名随机敌人造成真实伤害";
    readonly damage_true_random_3: "对3名随机敌人造成真实伤害";
    readonly damage_true_all: "对全体敌人造成真实伤害";
    readonly dodge_self: "为自己增加闪避率";
    readonly dodge_front: "为友军前排增加闪避率";
    readonly dodge_all: "为友军全员增加闪避率";
    readonly hit_self: "为自己增加命中率";
    readonly hit_rear: "为友军后排增加命中率";
    readonly hit_all: "为友军全员增加命中率";
};
export type CardBattleDefenseEffect = keyof typeof CARD_BATTLE_DEFENSE_EFFECT_LABELS;
export declare const CARD_BATTLE_DEFENSE_EFFECT_CODES: CardBattleDefenseEffect[];
export declare const isCardBattleTrueDamage: (type: string) => boolean;
export declare const isCardBattleShield: (type: string) => boolean;
export declare const cardBattleAccuracyStat: (type: string) => CardBattleAccuracyStat | null;
export declare const cardBattleDefenseNeedsDuration: (type: string) => boolean;
/** Critical damage gains 50 hit percentage points for this hit only, before clamping. */
export declare const cardBattleDodgeChance: (dodge: number, hit: number, critical?: boolean) => number;
