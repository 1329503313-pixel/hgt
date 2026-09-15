import { isCardBattleDamageEffect, isCardBattleAttachedOnly } from "@hgt/shared";
import { bondNeedsValue, bondNeedsDuration, bondIsRate, bondValueMaximum, type CardBattleBond, type CardBattleBondAction } from "@hgt/shared";
import type { CardBattleCondition, CardBattleEffectType, CardBattleSkillAction, CardBattleSkillEffect, CardBattleTier } from "../../shared/digitalAssets";

// Empty selections belong to the editor only; persisted battle types remain strict.
export type CardBattleActionDraft = Omit<CardBattleSkillAction, "type"> & { type: CardBattleEffectType | "" };
export type CardBattleEffectDraft = Omit<CardBattleSkillEffect, "condition" | "type" | "additionalEffects"> & {
  condition: CardBattleCondition | "";
  type: CardBattleEffectType | "";
  additionalEffects?: CardBattleActionDraft[];
};
export type CardBattleBondActionDraft = Omit<CardBattleBondAction, "type" | "target"> & { type: CardBattleBondAction["type"] | ""; target: CardBattleBondAction["target"] | "" };
export type CardBattleBondDraft = Omit<CardBattleBond, "event" | "actions"> & { event: CardBattleBond["event"] | ""; actions: CardBattleBondActionDraft[] };
export type CardBattleTierDraft = Omit<CardBattleTier, "effects" | "bonds"> & { effects: CardBattleEffectDraft[]; bonds?: CardBattleBondDraft[] };

export function cardBattleBondError(bond: CardBattleBondDraft) {
  if (!bond.cardNos.length || bond.cardNos.length > 100 || bond.cardNos.some(no => !no || no.length > 64 || /\s/.test(no))) return "请输入有效卡牌固定序号，多个序号用空格分隔（最多100个）";
  if (!bond.event) return "请选择卡牌行动";
  if (!bond.actions.length) return "至少配置一个羁绊效果";
  for (const action of bond.actions) {
    if (!action.target) return "请选择羁绊技能对象";
    if (!action.type) return "请选择羁绊技能类型";
    if (bondNeedsValue(action.type) && (action.value == null || !Number.isFinite(action.value) || action.value <= 0 || action.value > bondValueMaximum(action.type)
      || (bondIsRate(action.type) ? Math.abs(action.value * 100 - Math.round(action.value * 100)) > 1e-6 : !Number.isInteger(action.value)))) return "请填写有效羁绊数值：属性为正整数，概率不超过100、暴击伤害不超过10000个百分点，最多两位小数";
    if (bondNeedsDuration(action.type) && (action.duration == null || !Number.isSafeInteger(action.duration) || action.duration < 1)) return "羁绊持续回合必须为正整数";
  }
  return null;
}

export function cardBattleSelectionError(tiers: readonly CardBattleTierDraft[] | null) {
  for (const tier of tiers ?? []) {
    for (const [index, bond] of (tier.bonds ?? []).entries()) {
      const error = cardBattleBondError(bond);
      if (error) return `${tier.starLevel}星羁绊条件${index + 1}：${error}`;
    }
    for (const [index, effect] of tier.effects.entries()) {
      if (!effect.condition || !effect.type) {
        return `请为${tier.starLevel}星条件${index + 1}从下拉列表选择${!effect.condition ? "技能条件" : "技能类型"}`;
      }
      if (isCardBattleAttachedOnly(effect.type)) return `${tier.starLevel}星条件${index + 1}的主技能不能使用仅限附加的类型`;
      for (const [addition, action] of (effect.additionalEffects ?? []).entries()) {
        if (!action.type) return `请为${tier.starLevel}星条件${index + 1}附加类型${addition + 1}从下拉列表选择技能类型`;
        if (action.type === "revival_block_damaged" && ![effect, ...effect.additionalEffects ?? []].some((item) => isCardBattleDamageEffect(item.type))) {
          return `${tier.starLevel}星条件${index + 1}须配置伤害类型，才能禁止受伤单位复活`;
        }
      }
    }
  }
  return null;
}
