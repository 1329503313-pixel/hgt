import { isCardBattleDamageEffect, isCardBattleAttachedOnly } from "@hgt/shared";
import type { CardBattleCondition, CardBattleEffectType, CardBattleSkillAction, CardBattleSkillEffect, CardBattleTier } from "../../shared/digitalAssets";

// Empty selections belong to the editor only; persisted battle types remain strict.
export type CardBattleActionDraft = Omit<CardBattleSkillAction, "type"> & { type: CardBattleEffectType | "" };
export type CardBattleEffectDraft = Omit<CardBattleSkillEffect, "condition" | "type" | "additionalEffects"> & {
  condition: CardBattleCondition | "";
  type: CardBattleEffectType | "";
  additionalEffects?: CardBattleActionDraft[];
};
export type CardBattleTierDraft = Omit<CardBattleTier, "effects"> & { effects: CardBattleEffectDraft[] };

export function cardBattleSelectionError(tiers: readonly CardBattleTierDraft[] | null) {
  for (const tier of tiers ?? []) {
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
