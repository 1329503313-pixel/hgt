import { z } from "zod";
import { CARD_BATTLE_BOND_EVENTS, CARD_BATTLE_BOND_TARGETS, CARD_BATTLE_BOND_ACTIONS, bondNeedsValue, bondNeedsDuration, bondIsRate, bondValueMaximum } from "@hgt/shared";
const keys = <T extends Record<string, string>>(map: T) => Object.keys(map) as [keyof T & string, ...(keyof T & string)[]];
export const cardBattleBondActionSchema = z.object({
  target: z.enum(keys(CARD_BATTLE_BOND_TARGETS)), type: z.enum(keys(CARD_BATTLE_BOND_ACTIONS)),
  value: z.number().finite().positive().max(1_000_000_000).nullable(),
  duration: z.number().int().positive().safe().nullable(),
}).strict().superRefine((action, ctx) => {
  if (bondNeedsValue(action.type) !== (action.value !== null)) ctx.addIssue({code:'custom',path:['value'],message:'请按羁绊类型填写数值，无需数值的类型必须留空'});
  if (bondNeedsDuration(action.type) !== (action.duration !== null)) ctx.addIssue({code:'custom',path:['duration'],message:'请按羁绊类型填写回合，无需回合的类型必须留空'});
  if (action.value !== null && (bondIsRate(action.type) ? action.value > bondValueMaximum(action.type) || Math.abs(action.value * 100 - Math.round(action.value * 100)) > 1e-6 : !Number.isInteger(action.value))) {
    ctx.addIssue({code:'custom',path:['value'],message:'概率增益不超过100个百分点，暴击伤害增益不超过10000个百分点，最多两位小数；其他数值须为正整数'});
  }
});
export const cardBattleBondsSchema = z.array(z.object({
  id: z.string().trim().min(1).max(64).optional(),
  cardNos: z.array(z.string().trim().min(1).max(64).regex(/^\S+$/, '卡牌序号不能包含空格')).min(1).max(100).transform(values => [...new Set(values)]),
  event: z.enum(keys(CARD_BATTLE_BOND_EVENTS)),
  actions: z.array(cardBattleBondActionSchema).min(1).max(50),
}).strict()).max(50);
