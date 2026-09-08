export declare const CARD_BATTLE_PROC_STATS: readonly [{
    readonly key: "lifestealRate";
    readonly column: "lifesteal_rate";
    readonly label: "吸血比例";
}, {
    readonly key: "stunRate";
    readonly column: "stun_rate";
    readonly label: "击晕概率";
}, {
    readonly key: "extraActionRate";
    readonly column: "extra_action_rate";
    readonly label: "再动概率";
}];
export type CardBattleProcStat = typeof CARD_BATTLE_PROC_STATS[number]["key"];
/** Optional only for frozen lineups saved before these attributes existed. */
export type CardBattleProcStats = Partial<Record<CardBattleProcStat, number>>;
export declare const CARD_BATTLE_PROC_BUFF_LABELS: {
    readonly lifesteal_self: "增加自己吸血比例";
    readonly lifesteal_all_allies: "增加己方全员吸血比例";
    readonly stun_self: "增加自己击晕概率";
    readonly stun_all_allies: "增加己方全员击晕概率";
    readonly extra_action_self: "增加自己再动概率";
    readonly extra_action_all_allies: "增加己方全员再动概率";
};
export declare const CARD_BATTLE_PROC_DEBUFF_LABELS: {
    readonly lifesteal_down_single: "降低一名敌方吸血比例";
    readonly lifesteal_down_front: "降低敌方前排吸血比例";
    readonly lifesteal_down_rear: "降低敌方后排吸血比例";
    readonly lifesteal_down_all: "降低敌方全体成员吸血比例";
    readonly stun_down_single: "降低一名敌方击晕概率";
    readonly stun_down_front: "降低敌方前排击晕概率";
    readonly stun_down_rear: "降低敌方后排击晕概率";
    readonly stun_down_all: "降低敌方全体成员击晕概率";
    readonly extra_action_down_single: "降低一名敌方再动概率";
    readonly extra_action_down_front: "降低敌方前排再动概率";
    readonly extra_action_down_rear: "降低敌方后排再动概率";
    readonly extra_action_down_all: "降低敌方全体成员再动概率";
};
export declare const CARD_BATTLE_PROC_BUFF_CODES: Array<keyof typeof CARD_BATTLE_PROC_BUFF_LABELS>;
export declare const CARD_BATTLE_PROC_DEBUFF_CODES: Array<keyof typeof CARD_BATTLE_PROC_DEBUFF_LABELS>;
export type CardBattleProcEffect = keyof typeof CARD_BATTLE_PROC_BUFF_LABELS | keyof typeof CARD_BATTLE_PROC_DEBUFF_LABELS;
export declare function cardBattleProcStat(type: string): CardBattleProcStat | null;
