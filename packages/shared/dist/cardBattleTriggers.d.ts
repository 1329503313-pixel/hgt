export declare const CARD_BATTLE_EVENT_CONDITION_CODES: readonly ["critical", "extra_action", "dodge", "stun"];
export type CardBattleEventCondition = typeof CARD_BATTLE_EVENT_CONDITION_CODES[number];
export declare const CARD_BATTLE_EVENT_CONDITION_LABELS: {
    readonly critical: "攻击或技能造成暴击";
    readonly extra_action: "触发再动";
    readonly dodge: "触发闪避";
    readonly stun: "触发击晕";
};
