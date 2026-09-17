export const CARD_BATTLE_PROC_STATS = [
    { key: "lifestealRate", column: "lifesteal_rate", label: "吸血比例" },
    { key: "stunRate", column: "stun_rate", label: "击晕概率" },
    { key: "extraActionRate", column: "extra_action_rate", label: "再动概率" },
    { key: "counterRate", column: "counter_rate", label: "反击率" },
];
export const CARD_BATTLE_PROC_BUFF_LABELS = {
    counter_self: "增加自身反击率", counter_all_allies: "增加全体友军反击率",
    lifesteal_self: "增加自己吸血比例", lifesteal_all_allies: "增加己方全员吸血比例",
    stun_self: "增加自己击晕概率", stun_all_allies: "增加己方全员击晕概率",
    extra_action_self: "增加自己再动概率", extra_action_all_allies: "增加己方全员再动概率",
};
export const CARD_BATTLE_PROC_DEBUFF_LABELS = {
    counter_down_all: "降低全体敌军反击率",
    lifesteal_down_single: "降低一名敌方吸血比例", lifesteal_down_front: "降低敌方前排吸血比例", lifesteal_down_rear: "降低敌方后排吸血比例", lifesteal_down_all: "降低敌方全体成员吸血比例",
    stun_down_single: "降低一名敌方击晕概率", stun_down_front: "降低敌方前排击晕概率", stun_down_rear: "降低敌方后排击晕概率", stun_down_all: "降低敌方全体成员击晕概率",
    extra_action_down_single: "降低一名敌方再动概率", extra_action_down_front: "降低敌方前排再动概率", extra_action_down_rear: "降低敌方后排再动概率", extra_action_down_all: "降低敌方全体成员再动概率",
};
export const CARD_BATTLE_PROC_BUFF_CODES = Object.keys(CARD_BATTLE_PROC_BUFF_LABELS);
export const CARD_BATTLE_PROC_DEBUFF_CODES = Object.keys(CARD_BATTLE_PROC_DEBUFF_LABELS);
export function cardBattleProcStat(type) {
    if (!Object.hasOwn(CARD_BATTLE_PROC_BUFF_LABELS, type) && !Object.hasOwn(CARD_BATTLE_PROC_DEBUFF_LABELS, type))
        return null;
    return type.startsWith("lifesteal_") ? "lifestealRate" : type.startsWith("stun_") ? "stunRate" : type.startsWith("counter_") ? "counterRate" : "extraActionRate";
}
