export declare const CARD_BATTLE_SUPPORT_LABELS: {
    readonly healing: "有效治疗";
    readonly speed: "速度增减";
    readonly revival: "复活贡献";
    readonly damageReduction: "减伤贡献";
    readonly damageBoost: "增伤贡献";
    readonly healingBoost: "回血增益";
    readonly extraAction: "额外再动";
    readonly stun: "眩晕控制";
    readonly energy: "能量恢复";
    readonly maxHp: "生命上限";
    readonly healingReduction: "抑制回血";
    readonly extraActionPrevention: "阻止再动";
};
export type CardBattleSupportKind = keyof typeof CARD_BATTLE_SUPPORT_LABELS;
export type CardBattleSupportBreakdown = Partial<Record<CardBattleSupportKind, number>>;
