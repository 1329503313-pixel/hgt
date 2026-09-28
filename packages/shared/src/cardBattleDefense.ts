export const CARD_BATTLE_ACCURACY_STATS = [
  { key: "dodgeRate", column: "dodge_rate", label: "闪避率" },
  { key: "hitRate", column: "hit_rate", label: "命中率" },
] as const;
export type CardBattleAccuracyStat = typeof CARD_BATTLE_ACCURACY_STATS[number]["key"];
/** Missing attributes in historical frozen lineups mean zero. */
export type CardBattleAccuracyStats = Partial<Record<CardBattleAccuracyStat, number>>;
export const CARD_BATTLE_DEFENSE_EFFECT_LABELS = {
  shield_self: "为自己增加护盾值", shield_front: "为友军前排增加护盾值",
  shield_rear: "为友军后排增加护盾值", shield_all: "为友军全员增加护盾值",
  damage_true_single: "造成真实伤害", damage_true_random: "对1名随机敌人造成真实伤害",
  damage_true_random_2: "对2名随机敌人造成真实伤害", damage_true_random_3: "对3名随机敌人造成真实伤害",
  damage_true_all: "对全体敌人造成真实伤害",
  dodge_self: "为自己增加闪避率", dodge_front: "为友军前排增加闪避率", dodge_all: "为友军全员增加闪避率",
  hit_self: "为自己增加命中率", hit_rear: "为友军后排增加命中率", hit_all: "为友军全员增加命中率",
} as const;
export type CardBattleDefenseEffect = keyof typeof CARD_BATTLE_DEFENSE_EFFECT_LABELS;
export const CARD_BATTLE_DEFENSE_EFFECT_CODES = Object.keys(CARD_BATTLE_DEFENSE_EFFECT_LABELS) as CardBattleDefenseEffect[];
export const isCardBattleTrueDamage = (type: string) => type.startsWith("damage_true_");
export const isCardBattleShield = (type: string) => type.startsWith("shield_");
export const cardBattleAccuracyStat = (type: string): CardBattleAccuracyStat | null =>
  type.startsWith("dodge_") ? "dodgeRate" : type.startsWith("hit_") ? "hitRate" : null;
export const cardBattleDefenseNeedsDuration = (type: string) => isCardBattleShield(type) || cardBattleAccuracyStat(type) !== null;
/** Critical damage gains 50 hit percentage points for this hit only, before clamping. */
export const cardBattleDodgeChance = (dodge: number, hit: number, critical = false) => Math.min(100, Math.max(0, dodge - hit - (critical ? 50 : 0)));
