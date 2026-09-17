import type mysql from "mysql2/promise";
import { z } from "zod";
import { applyBattleCollectibleStats, calculateCardBattlePower, battleCollectibleConfigError, type BattleCollectible, type BattleCollectibleBinding, type BattleCollectibleEffectType } from "@hgt/shared";

export class BattleCollectibleRuleError extends Error {}
export const battleCollectibleBindingsSchema = z.array(z.object({
  cardId: z.string().trim().min(1).max(64), collectibleId: z.string().trim().min(1).max(64),
})).max(5);

export function parseBattleCollectibleBindings(value: unknown): BattleCollectibleBinding[] {
  if (value == null) return [];
  try {
    const parsed = battleCollectibleBindingsSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
    if (parsed.success) return parsed.data;
  } catch { /* Reject malformed saved bindings instead of silently dropping equipment. */ }
  throw new BattleCollectibleRuleError("收藏品绑定记录无效，请重新保存卡组");
}

export function validateBattleCollectibleBindings(cardIds: Array<string | null>, bindings: BattleCollectibleBinding[], ownedIds: Set<string>) {
  if (bindings.length > 5 || new Set(bindings.map((b) => b.cardId)).size !== bindings.length || new Set(bindings.map((b) => b.collectibleId)).size !== bindings.length) {
    throw new BattleCollectibleRuleError("每张卡最多装配一件收藏品，同一收藏品不能重复装配");
  }
  if (bindings.some((b) => !cardIds.includes(b.cardId))) throw new BattleCollectibleRuleError("收藏品只能绑定当前在场的卡牌");
  if (bindings.some((b) => !ownedIds.has(b.collectibleId))) throw new BattleCollectibleRuleError("绑定的收藏品已不再拥有或不可用，请重新装配");
}

export async function loadBattleCollectibles(userId: string, db: mysql.Pool | mysql.PoolConnection, lock = false): Promise<BattleCollectible[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT id, collectible_no, name, battle_effect_description, battle_effect_type, battle_effect_value
     FROM collectibles WHERE owner_user_id = ? AND status = 'owned' AND deleted_at IS NULL
     ORDER BY collectible_no, id${lock ? " FOR UPDATE" : ""}`, [userId],
  );
  return rows.map((row) => ({
    id: String(row.id), collectibleNo: String(row.collectible_no), name: String(row.name),
    imageUrl: `/api/media/collectibles/${encodeURIComponent(String(row.id))}/thumbnail`,
    battleEffectDescription: String(row.battle_effect_description ?? ""),
    battleEffectType: (row.battle_effect_type ?? null) as BattleCollectibleEffectType | null,
    battleEffectValue: row.battle_effect_value == null ? null : Number(row.battle_effect_value),
  }));
}

export async function resolveBattleCollectibles(userId: string, cardIds: Array<string | null>, bindings: BattleCollectibleBinding[], db: mysql.Pool | mysql.PoolConnection, lock = false) {
  const items = bindings.length ? await loadBattleCollectibles(userId, db, lock) : [];
  validateBattleCollectibleBindings(cardIds, bindings, new Set(items.map((item) => item.id)));
  const byCard = new Map<string, BattleCollectible>();
  for (const binding of bindings) {
    const item = items.find((item) => item.id === binding.collectibleId)!;
    const error = battleCollectibleConfigError(item.battleEffectType, item.battleEffectValue);
    if (error) throw new BattleCollectibleRuleError(`收藏品“${item.name}”配置无效：${error}`);
    byCard.set(binding.cardId, item);
  }
  return byCard;
}

export function withBattleCollectible<T extends { stats: Parameters<typeof applyBattleCollectibleStats>[0]; combatPower: number }>(card: T, collectible: BattleCollectible | null) {
  const stats = applyBattleCollectibleStats(card.stats, collectible);
  return { ...card, collectible, stats, combatPower: calculateCardBattlePower(stats) };
}
