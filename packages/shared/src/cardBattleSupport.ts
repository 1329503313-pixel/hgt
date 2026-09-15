export const CARD_BATTLE_SUPPORT_LABELS = {
  shield: "护盾抵挡",
  healing: "有效治疗",
  speed: "速度增减",
  revival: "复活贡献",
  damageReduction: "减伤贡献",
  damageBoost: "增伤贡献",
  healingBoost: "回血增益",
  extraAction: "额外再动",
  stun: "眩晕控制",
  energy: "能量恢复",
  maxHp: "生命上限",
  healingReduction: "抑制回血",
  extraActionPrevention: "阻止再动",
} as const;

export type CardBattleSupportKind = keyof typeof CARD_BATTLE_SUPPORT_LABELS;
export type CardBattleSupportBreakdown = Partial<Record<CardBattleSupportKind, number>>;
