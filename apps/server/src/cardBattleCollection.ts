import type mysql from "mysql2/promise";
import { isCardBattleDamageEffect } from "@hgt/shared";
import { pool } from "./db.js";
import type { CardBattlePlayerInput, CardBattleSkillAction, CardBattleTier } from "./cardBattle.js";

export type CardBattleCollectionBonus = {
  completePackCount: number;
  threeStarLegendCount: number;
  threeStarPackCardIds: Set<string>;
};

const emptyBonus = (): CardBattleCollectionBonus => ({ completePackCount: 0, threeStarLegendCount: 0, threeStarPackCardIds: new Set() });

/** Count current ownership, including off-sale packs; disabled bindings/cards cannot complete an empty pack. */
export async function loadCardBattleCollectionBonuses(userIds: string[], db: mysql.Pool | mysql.PoolConnection = pool) {
  const ids = [...new Set(userIds)];
  const bonuses = new Map(ids.map(id => [id, emptyBonus()]));
  if (!ids.length) return bonuses;
  const placeholders = ids.map(() => "?").join(",");
  const [packs] = await db.query<mysql.RowDataPacket[]>(
    `SELECT users.id AS user_id, packs.id AS pack_id, JSON_ARRAYAGG(cards.id) AS card_ids,
       MIN(CASE WHEN owned.star_level = 3 THEN 1 ELSE 0 END) AS all_three_star
     FROM users
     CROSS JOIN asset_packs packs
     JOIN asset_pack_cards bindings ON bindings.pack_id = packs.id AND bindings.enabled = TRUE
     JOIN asset_cards cards ON cards.id = bindings.card_id AND cards.status = 'active'
     LEFT JOIN user_asset_cards owned ON owned.user_id = users.id AND owned.card_id = cards.id
     WHERE users.id IN (${placeholders})
     GROUP BY users.id, packs.id
     HAVING COUNT(*) = COUNT(owned.card_id)`, ids,
  );
  for (const row of packs) {
    const bonus = bonuses.get(String(row.user_id))!;
    bonus.completePackCount += 1;
    if (Number(row.all_three_star) === 1) {
      const cardIds: string[] = typeof row.card_ids === "string" ? JSON.parse(row.card_ids) : row.card_ids;
      for (const id of cardIds) bonus.threeStarPackCardIds.add(id);
    }
  }
  const [legends] = await db.query<mysql.RowDataPacket[]>(
    `SELECT owned.user_id, COUNT(*) AS total FROM user_asset_cards owned
     JOIN asset_cards cards ON cards.id = owned.card_id
     WHERE owned.user_id IN (${placeholders}) AND owned.star_level = 3 AND cards.rarity = 'legend'
     GROUP BY owned.user_id`, ids,
  );
  for (const row of legends) bonuses.get(String(row.user_id))!.threeStarLegendCount = Number(row.total);
  return bonuses;
}

export async function loadCardBattleCollectionBonus(userId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  return (await loadCardBattleCollectionBonuses([userId], db)).get(userId)!;
}

function scale(value: number, cardId: string, bonus: CardBattleCollectionBonus) {
  // Integer half-percent units avoid rounding 100 * 1.005 down to 100.
  return Math.round(value * (200 + bonus.completePackCount + (bonus.threeStarPackCardIds.has(cardId) ? 6 : 0)) / 200);
}

export function applyCardBattleCollectionStats<T extends { maxHp: number; attack: number; defense: number; speed: number; critDamage: number }>(
  stats: T, cardId: string, bonus: CardBattleCollectionBonus,
): T {
  return {
    ...stats,
    maxHp: scale(stats.maxHp, cardId, bonus), attack: scale(stats.attack, cardId, bonus),
    defense: scale(stats.defense, cardId, bonus), speed: scale(stats.speed, cardId, bonus),
    critDamage: (Math.round((stats.critDamage ?? 150) * 100) + bonus.threeStarLegendCount * 200) / 100,
  };
}

const boostedSkillTypes = new Set([
  "heal_self", "heal_lowest_ally", "heal_all_allies", "max_hp_self", "max_hp_all_allies",
  "defense_self", "defense_all_allies", "speed_self", "speed_all_allies", "attack_self", "attack_all_allies",
  "attack_skill_damage_self", "attack_skill_damage_all_allies",
]);

export function applyCardBattleCollectionTier(tier: CardBattleTier, cardId: string, bonus: CardBattleCollectionBonus): CardBattleTier {
  const action = <T extends CardBattleSkillAction>(effect: T): T => ({
    ...effect,
    ...(isCardBattleDamageEffect(effect.type) && effect.damageType === "formula" ? {
      formulaMultiplier: (200 + bonus.completePackCount + (bonus.threeStarPackCardIds.has(cardId) ? 6 : 0)) / 200,
    } : {}),
    value: effect.value != null && (isCardBattleDamageEffect(effect.type) || boostedSkillTypes.has(effect.type))
      ? scale(effect.value, cardId, bonus) : effect.value,
  });
  return {
    ...applyCardBattleCollectionStats(tier, cardId, bonus),
    effects: tier.effects.map(effect => ({ ...action(effect),
      ...(effect.additionalEffects ? { additionalEffects: effect.additionalEffects.map(action) } : {}),
    })),
  };
}

/** Keep the unmodified tier for ranking retries; reapplying never compounds a previous bonus. */
export function applyCardBattlePlayerCollection(player: CardBattlePlayerInput, bonus: CardBattleCollectionBonus): CardBattlePlayerInput {
  return { ...player, cards: player.cards.map(card => {
    const base = card.collectionBaseTier ?? card.tier;
    return { ...card, collectionBaseTier: base, tier: applyCardBattleCollectionTier(base, card.cardId, bonus) };
  }) };
}
