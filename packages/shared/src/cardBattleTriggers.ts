export const CARD_BATTLE_EVENT_CONDITION_CODES = ["critical", "extra_action", "dodge", "stun"] as const;
export type CardBattleEventCondition = typeof CARD_BATTLE_EVENT_CONDITION_CODES[number];

export const CARD_BATTLE_EVENT_CONDITION_LABELS = {
  critical: "攻击或技能造成暴击",
  extra_action: "触发再动",
  dodge: "触发闪避",
  stun: "触发击晕",
} as const satisfies Record<CardBattleEventCondition, string>;
