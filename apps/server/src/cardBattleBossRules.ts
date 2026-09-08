import { z } from "zod";
import { cardBattleTierSchema } from "./cardBattleConfig.js";

export const BOSS_PLAYER_CARDS = 3;
export const BOSS_PLAYER_SEATS = 3;
export const BOSS_SPECTATOR_SEATS = 10;
export const bossCoverPattern = /^\/api\/online-soup\/card-battle-boss\/covers\/([a-f0-9]{64})$/;
export const bossCardSchema = z.object({
  name: z.string().trim().min(1, "请输入卡牌名称").max(100),
  imageUrl: z.string().regex(bossCoverPattern, "请上传卡牌封面"),
  tier: cardBattleTierSchema.extend({ starLevel: z.literal(3) }),
});
export const bossInputSchema = z.object({
  name: z.string().trim().min(1, "请输入房间名称").max(50),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  enabled: z.boolean(),
  rewardShells: z.number().int().min(0).max(1_000_000_000),
  cards: z.array(bossCardSchema.nullable()).length(5),
  revision: z.number().int().min(1).optional(),
}).superRefine((value, ctx) => {
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "下架时间必须晚于上架时间" });
  for (const [index, card] of value.cards.entries()) {
    if (value.enabled && (!card || !card.tier.skillName.trim() || !card.tier.skillDescription.trim() || !card.tier.effects.length)) {
      ctx.addIssue({ code: "custom", path: ["cards", index], message: `第 ${index + 1} 张卡牌需完整配置封面、名称、属性、技能名称、描述和至少一条技能效果后才能上架` });
    }
    if (card && new Set(card.tier.effects.map((effect) => effect.order)).size !== card.tier.effects.length) {
      ctx.addIssue({ code: "custom", path: ["cards", index], message: "技能效果顺序不能重复" });
    }
  }
});
export type BossCardInput = z.infer<typeof bossCardSchema>;
export type BossInput = z.infer<typeof bossInputSchema>;
export function isBossRoom(room: Record<string, unknown>) { return room.card_battle_mode === "boss"; }
export function bossIsAvailable(boss: { enabled: unknown; starts_at: string | Date; ends_at: string | Date }, now = Date.now()) {
  return Boolean(boss.enabled) && now >= new Date(boss.starts_at).getTime() && now < new Date(boss.ends_at).getTime();
}
