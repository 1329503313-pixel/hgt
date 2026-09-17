import mysql from "mysql2/promise";
import { archiveBattleRecord } from "./gameRecords.js";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { lockAndCompactCardBattleRanking, lockRankingForCardBattleRoom } from "./cardBattleRankingState.js";
import { isBossRoom } from "./cardBattleBossRules.js";
import { bossBattlePlayer, bossPublic, emitBossRewards, loadBoss, requireAvailableBoss, settleBossRewards } from "./cardBattleBoss.js";
import { loadCardBattleTiers } from "./cardBattleConfig.js";
import { applyCardBattleCollectionStats, applyCardBattlePlayerCollection, loadCardBattleCollectionBonus } from "./cardBattleCollection.js";
import { CARD_BATTLE_LINEUP_SIZE, calculateCardBattlePower, simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleResult } from "./cardBattle.js";
import { resolveCardBattlePlayback, surrenderCardBattleResult } from "./cardBattlePlayback.js";
import { resolveCardBattleSettlementPlayers } from "./cardBattleSettlement.js";
import { applyBattleCollectibleStats, type BattleCollectibleBinding } from "@hgt/shared";
import { loadBattleCollectibles, parseBattleCollectibleBindings, resolveBattleCollectibles, withBattleCollectible } from "./battleCollectibles.js";

export class CardBattleRoomRuleError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

async function assertRankingChallengeActive(roomId: string, db: mysql.PoolConnection) {
  const [[challenge]] = await db.query<mysql.RowDataPacket[]>("SELECT status FROM card_battle_ranking_challenges WHERE room_id = ? FOR UPDATE", [roomId]);
  if (challenge && challenge.status !== "active") throw new CardBattleRoomRuleError("对方排名已发生变化，请重新打榜。", "RANK_CHANGED");
}

export type CardBattlePlaybackState = {
  completedSequence: number;
  totalEvents: number;
  complete: boolean;
  states: CardBattleResult["initialStates"];
  activeEvent: CardBattleResult["events"][number] | null;
  activeEventStartedAt: string | null;
  activeEventElapsedMs: number;
  serverNow: string;
};

function parseList(value: unknown): Array<string | null> {
  if (Array.isArray(value)) return value.slice(0, CARD_BATTLE_LINEUP_SIZE).map((item) => typeof item === "string" && item ? item : null);
  if (typeof value !== "string" || !value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.slice(0, CARD_BATTLE_LINEUP_SIZE).map((item) => typeof item === "string" && item ? item : null) : []; }
  catch { return []; }
}

function parseResult(value: unknown): CardBattleResult | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && (parsed as CardBattleResult).version === 1 ? parsed as CardBattleResult : null;
  } catch { return null; }
}

function parseLineupSnapshot(value: unknown): CardBattlePlayerInput[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed as CardBattlePlayerInput[] : [];
  } catch { return []; }
}

function iso(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

function battleMotionPayload(row: mysql.RowDataPacket, starLevel: number) {
  const unlocked = starLevel >= 2 && Boolean(row.motion_mp4_path);
  if (!unlocked) return { motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null };
  const cardId = encodeURIComponent(String(row.id ?? row.card_id));
  const version = encodeURIComponent(String(row.motion_version ?? new Date(row.updated_at).getTime()));
  return {
    motionMp4Url: `/api/media/assets/cards/${cardId}/motion/mp4?v=${version}`,
    motionWebmUrl: row.motion_webm_path ? `/api/media/assets/cards/${cardId}/motion/webm?v=${version}` : null,
    motionPosterUrl: row.motion_poster_path ? `/api/media/assets/cards/${cardId}/motion/poster?v=${version}` : null,
  };
}

export async function readCardBattlePlayback(roomId: string) {
  await finalizeCardBattleIfDue(roomId);
  const [[game]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT *, NOW(3) AS db_now FROM online_card_battles WHERE room_id = ? ORDER BY game_number DESC LIMIT 1",
    [roomId],
  );
  if (!game) throw new CardBattleRoomRuleError("当前没有可播放的卡牌对战");
  const result = parseResult(game.result_json);
  if (!result) throw new CardBattleRoomRuleError("战斗记录不可用");
  return { gameId: String(game.id), playback: resolveCardBattlePlayback(result, game.started_at, String(game.status), new Date(game.db_now).getTime()) };
}

// Compatibility for older clients: sequence is ignored and cannot move the shared timeline.
export async function acknowledgeCardBattleEvent(roomId: string, _viewerId: string, _sequence: number) {
  return (await readCardBattlePlayback(roomId)).playback;
}

/** Caller holds the room lock; winner, stop time and seat release commit with leaving. */
export async function forfeitCardBattle(roomId: string, userId: string, db: mysql.PoolConnection) {
  const [[game]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT *, NOW(3) AS db_now FROM online_card_battles WHERE room_id = ? AND status = 'playing' ORDER BY game_number DESC LIMIT 1 FOR UPDATE",
    [roomId],
  );
  if (!game) return false;
  const result = parseResult(game.result_json);
  if (!result) throw new CardBattleRoomRuleError("战斗记录不可用");
  if (game.mode === "boss") {
    // Explicit departure loses only this player's reward; the frozen team keeps fighting.
    if (new Date(game.db_now).getTime() < new Date(game.playback_ends_at).getTime()) await db.query(
      "UPDATE card_battle_boss_participants SET forfeited_at = COALESCE(forfeited_at, NOW(3)) WHERE game_id = ? AND user_id = ?", [game.id, userId]);
    return false;
  }
  const forfeited = surrenderCardBattleResult(result, userId, game.started_at, new Date(game.db_now).getTime());
  if (!forfeited) return false;
  await db.query("UPDATE online_card_battles SET status = 'ended', result_json = ?, playback_ends_at = NOW(3), ended_at = NOW(3) WHERE id = ? AND status = 'playing'", [JSON.stringify(forfeited), game.id]);
  await archiveBattleRecord(db, String(game.id));
  await db.query("UPDATE online_card_battle_seats SET is_ready = 0 WHERE room_id = ?", [roomId]);
  await releaseCardBattleSeat(roomId, userId, db);
  await db.query("UPDATE online_soup_rooms SET status = 'ended', last_action_at = NOW() WHERE id = ? AND status <> 'closed'", [roomId]);
  return true;
}

export function publicFrozenCard(card: CardBattleDeckCard) {
  const stats = applyBattleCollectibleStats({
    maxHp: card.tier.maxHp, attack: card.tier.attack, defense: card.tier.defense, speed: card.tier.speed,
    energyRequired: card.tier.energyRequired, canAttackRear: card.tier.canAttackRear,
    critRate: card.tier.critRate ?? 25, critDamage: card.tier.critDamage ?? 150,
    dodgeRate: card.tier.dodgeRate ?? 0, hitRate: card.tier.hitRate ?? 0,
    lifestealRate: card.tier.lifestealRate ?? 0, stunRate: card.tier.stunRate ?? 0, extraActionRate: card.tier.extraActionRate ?? 0, counterRate: card.tier.counterRate ?? 0,
  }, card.collectible);
  return {
    id: card.cardId, instanceId: card.instanceId, cardNo: card.cardNo ?? "", name: card.name, rarity: card.rarity, starLevel: card.starLevel,
    battleRole: card.battleRole ?? "damage", imageUrl: card.imageUrl,
    motionMp4Url: card.motionMp4Url ?? null,
    motionWebmUrl: card.motionWebmUrl ?? null,
    motionPosterUrl: card.motionPosterUrl ?? null,
    stats,
    collectible: card.collectible ?? null,
    combatPower: calculateCardBattlePower(stats),
    skillName: card.tier.skillName, skillDescription: card.tier.skillDescription,
  };
}

export function isCardBattleRoom(room: mysql.RowDataPacket) {
  return String(room.content_type ?? "soup") === "card_battle";
}

export async function cardBattleRoomMode(roomId: string, db: mysql.Pool | mysql.PoolConnection = pool): Promise<"1v1" | "boss"> {
  const [[room]] = await db.query<mysql.RowDataPacket[]>("SELECT card_battle_mode FROM online_soup_rooms WHERE id = ?", [roomId]);
  return room && isBossRoom(room) ? "boss" : "1v1";
}

export async function eligibleCardCount(userId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM user_asset_cards owned
     JOIN asset_cards cards ON cards.id = owned.card_id
     JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
     WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity IN ('epic','legend')`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

export async function claimCardBattleSeat(roomId: string, userId: string, db: mysql.PoolConnection) {
  const mode = await cardBattleRoomMode(roomId, db);
  if (mode === "boss") await requireAvailableBoss(roomId, db);
  const [[existing]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT seat_number FROM online_card_battle_seats WHERE room_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (existing) return Number(existing.seat_number) as 1 | 2 | 3;
  if (await eligibleCardCount(userId, db) < (mode === "boss" ? 3 : CARD_BATTLE_LINEUP_SIZE)) return null;
  const [seats] = await db.query<mysql.RowDataPacket[]>(
    "SELECT seat_number FROM online_card_battle_seats WHERE room_id = ? ORDER BY seat_number FOR UPDATE",
    [roomId],
  );
  const used = new Set(seats.map((seat) => Number(seat.seat_number)));
  const seat = !used.has(1) ? 1 : !used.has(2) ? 2 : mode === "boss" && !used.has(3) ? 3 : null;
  if (!seat) return null;
  await db.query(
    "INSERT INTO online_card_battle_seats (room_id, seat_number, user_id, lineup_json) VALUES (?, ?, ?, JSON_ARRAY())",
    [roomId, seat, userId],
  );
  return seat as 1 | 2 | 3;
}

export async function releaseCardBattleSeat(roomId: string, userId: string, db: mysql.PoolConnection) {
  await db.query("DELETE FROM online_card_battle_seats WHERE room_id = ? AND user_id = ?", [roomId, userId]);
}

export async function loadEligibleBattleCards(userId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const collection = await loadCardBattleCollectionBonus(userId, db);
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT cards.id, cards.card_no, cards.name, cards.rarity, cards.battle_role, cards.updated_at,
       cards.motion_mp4_path, cards.motion_webm_path, cards.motion_poster_path, cards.motion_version, owned.star_level,
       tiers.max_hp, tiers.attack_value, tiers.defense_value, tiers.speed_value, tiers.energy_required, tiers.can_attack_rear, tiers.crit_rate, tiers.crit_damage,
       tiers.lifesteal_rate, tiers.stun_rate, tiers.extra_action_rate, tiers.counter_rate, tiers.dodge_rate, tiers.hit_rate,
       tiers.skill_name, tiers.skill_description
     FROM user_asset_cards owned
     JOIN asset_cards cards ON cards.id = owned.card_id
     JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
     WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity IN ('epic','legend')
     ORDER BY cards.card_no ASC`,
    [userId],
  );
  return rows.map((row) => {
    const starLevel = Number(row.star_level);
    const stats = applyCardBattleCollectionStats({
      maxHp: Number(row.max_hp), attack: Number(row.attack_value), defense: Number(row.defense_value), speed: Number(row.speed_value),
      energyRequired: Number(row.energy_required), canAttackRear: Boolean(row.can_attack_rear),
      critRate: Number(row.crit_rate ?? 25), critDamage: Number(row.crit_damage ?? 150),
      dodgeRate: Number(row.dodge_rate ?? 0), hitRate: Number(row.hit_rate ?? 0),
      lifestealRate: Number(row.lifesteal_rate ?? 0), stunRate: Number(row.stun_rate ?? 0), extraActionRate: Number(row.extra_action_rate ?? 0), counterRate: Number(row.counter_rate ?? 0),
    }, String(row.id), collection);
    return {
      id: String(row.id),
      cardNo: String(row.card_no),
      name: String(row.name),
      rarity: String(row.rarity) as "epic" | "legend",
      battleRole: String(row.battle_role ?? "damage") as "damage" | "tank" | "support",
      starLevel,
      imageUrl: `/api/media/assets/cards/${encodeURIComponent(String(row.id))}/thumbnail?v=${new Date(row.updated_at).getTime()}`,
      ...battleMotionPayload(row, starLevel),
      stats,
      combatPower: calculateCardBattlePower(stats),
      skillName: String(row.skill_name ?? ""),
      skillDescription: String(row.skill_description ?? ""),
    };
  });
}

export type SavedCardBattleDeck = {
  collectibleBindings: BattleCollectibleBinding[];
  id: string;
  name: string;
  cardIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

function savedDeck(row: mysql.RowDataPacket): SavedCardBattleDeck {
  return {
    id: String(row.id),
    name: String(row.name),
    cardIds: parseList(row.lineup_json).filter((cardId): cardId is string => Boolean(cardId)),
    collectibleBindings: parseBattleCollectibleBindings(row.collectible_bindings_json),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function validateSavedDeckLineup(userId: string, cardIds: string[], db: mysql.Pool | mysql.PoolConnection, mode: "1v1" | "boss" = "1v1") {
  const size = mode === "boss" ? 3 : CARD_BATTLE_LINEUP_SIZE;
  if (cardIds.length !== size || new Set(cardIds).size !== size) {
    throw new CardBattleRoomRuleError(`卡组必须包含${size}张不同卡牌`);
  }
  const [eligible] = await db.query<mysql.RowDataPacket[]>(
    `SELECT cards.id FROM user_asset_cards owned
     JOIN asset_cards cards ON cards.id = owned.card_id
     JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
     WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity IN ('epic','legend')
       AND cards.id IN (${cardIds.map(() => "?").join(",")})`,
    [userId, ...cardIds],
  );
  if (eligible.length !== size) throw new CardBattleRoomRuleError("卡组包含未拥有、已停用或不可参战的卡牌");
}

export async function loadSavedCardBattleDecks(userId: string, db: mysql.Pool | mysql.PoolConnection = pool, mode: "1v1" | "boss" = "1v1") {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM user_card_battle_decks WHERE user_id = ? AND mode = ? ORDER BY updated_at DESC, created_at DESC",
    [userId, mode],
  );
  const owned = await loadBattleCollectibles(userId, db);
  return rows.map((row) => {
    const deck = savedDeck(row);
    return { ...deck, collectibles: owned.filter((item) => deck.collectibleBindings.some((b) => b.collectibleId === item.id)),
      collectiblesAvailable: deck.collectibleBindings.every((b) => owned.some((item) => item.id === b.collectibleId)) };
  });
}

export async function createSavedCardBattleDeck(userId: string, name: string, cardIds: string[], db: mysql.Pool | mysql.PoolConnection = pool, collectibleBindings: BattleCollectibleBinding[] = [], mode: "1v1" | "boss" = "1v1") {
  await validateSavedDeckLineup(userId, cardIds, db, mode);
  await resolveBattleCollectibles(userId, cardIds, collectibleBindings, db);
  const id = nanoid();
  try {
    await db.query(
      "INSERT INTO user_card_battle_decks (id, user_id, name, lineup_json, collectible_bindings_json, mode) VALUES (?, ?, ?, ?, ?, ?)",
      [id, userId, name, JSON.stringify(cardIds), JSON.stringify(collectibleBindings), mode],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new CardBattleRoomRuleError("已有同名卡组，请换一个名称");
    throw error;
  }
  const [[row]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM user_card_battle_decks WHERE id = ? AND user_id = ? LIMIT 1", [id, userId]);
  if (!row) throw new CardBattleRoomRuleError("卡组保存失败");
  const deck = savedDeck(row);
  const owned = await loadBattleCollectibles(userId, db);
  return { ...deck, collectibles: owned.filter((item) => deck.collectibleBindings.some((b) => b.collectibleId === item.id)),
    collectiblesAvailable: deck.collectibleBindings.every((b) => owned.some((item) => item.id === b.collectibleId)) };
}

export async function updateSavedCardBattleDeck(userId: string, deckId: string, name: string, cardIds: string[] | undefined, db: mysql.Pool | mysql.PoolConnection = pool, collectibleBindings?: BattleCollectibleBinding[], mode: "1v1" | "boss" = "1v1") {
  if (cardIds) await validateSavedDeckLineup(userId, cardIds, db, mode);
  const [[current]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM user_card_battle_decks WHERE id = ? AND user_id = ? AND mode = ? LIMIT 1", [deckId, userId, mode]);
  if (!current) throw new CardBattleRoomRuleError("卡组不存在或已被删除");
  const selected = cardIds ?? parseList(current.lineup_json);
  const bindings = collectibleBindings ?? parseBattleCollectibleBindings(current.collectible_bindings_json).filter((b) => selected.includes(b.cardId));
  if (cardIds || collectibleBindings) await resolveBattleCollectibles(userId, selected, bindings, db);
  try {
    const [result] = await db.query<mysql.ResultSetHeader>(
      `UPDATE user_card_battle_decks SET name = ?, lineup_json = COALESCE(?, lineup_json), collectible_bindings_json = COALESCE(?, collectible_bindings_json)
       WHERE id = ? AND user_id = ? AND mode = ?`,
      [name, cardIds ? JSON.stringify(cardIds) : null, cardIds || collectibleBindings ? JSON.stringify(bindings) : null, deckId, userId, mode],
    );
    if (!result.affectedRows) throw new CardBattleRoomRuleError("卡组不存在或已被删除");
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new CardBattleRoomRuleError("已有同名卡组，请换一个名称");
    throw error;
  }
  const [[row]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM user_card_battle_decks WHERE id = ? AND user_id = ? LIMIT 1", [deckId, userId]);
  if (!row) throw new CardBattleRoomRuleError("卡组不存在或已被删除");
  const deck = savedDeck(row);
  const owned = await loadBattleCollectibles(userId, db);
  return { ...deck, collectibles: owned.filter((item) => deck.collectibleBindings.some((b) => b.collectibleId === item.id)),
    collectiblesAvailable: deck.collectibleBindings.every((b) => owned.some((item) => item.id === b.collectibleId)) };
}

export async function deleteSavedCardBattleDeck(userId: string, deckId: string, db: mysql.Pool | mysql.PoolConnection = pool, mode: "1v1" | "boss" = "1v1") {
  const [result] = await db.query<mysql.ResultSetHeader>(
    "DELETE FROM user_card_battle_decks WHERE id = ? AND user_id = ? AND mode = ?",
    [deckId, userId, mode],
  );
  if (!result.affectedRows) throw new CardBattleRoomRuleError("卡组不存在或已被删除");
}

export async function saveCardBattleLineup(roomId: string, userId: string, cardIds: Array<string | null>, db: mysql.PoolConnection, collectibleBindings?: BattleCollectibleBinding[]) {
  await assertRankingChallengeActive(roomId, db);
  const size = await cardBattleRoomMode(roomId, db) === "boss" ? 3 : CARD_BATTLE_LINEUP_SIZE;
  const selectedIds = cardIds.filter((cardId): cardId is string => Boolean(cardId));
  if (cardIds.length > size || new Set(selectedIds).size !== selectedIds.length) {
    throw new CardBattleRoomRuleError(`阵容最多选择${size}张不同卡牌`);
  }
  const [[seat]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT seat_number, is_ready, collectible_bindings_json FROM online_card_battle_seats WHERE room_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (!seat) throw new CardBattleRoomRuleError("你当前不在对战席");
  if (Boolean(seat.is_ready)) throw new CardBattleRoomRuleError("请先取消准备再调整阵容或收藏品");
  const bindings = collectibleBindings ?? parseBattleCollectibleBindings(seat.collectible_bindings_json).filter((b) => selectedIds.includes(b.cardId));
  await resolveBattleCollectibles(userId, cardIds, bindings, db, true);
  if (selectedIds.length) {
    const [eligible] = await db.query<mysql.RowDataPacket[]>(
      `SELECT cards.id FROM user_asset_cards owned
       JOIN asset_cards cards ON cards.id = owned.card_id
       JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
       WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity IN ('epic','legend')
         AND cards.id IN (${selectedIds.map(() => "?").join(",")})`,
      [userId, ...selectedIds],
    );
    if (eligible.length !== selectedIds.length) throw new CardBattleRoomRuleError("阵容包含未拥有、已停用或不可参战的卡牌");
  }
  await db.query(
    "UPDATE online_card_battle_seats SET lineup_json = ?, collectible_bindings_json = ?, is_ready = 0 WHERE room_id = ? AND user_id = ?",
    [JSON.stringify(cardIds), JSON.stringify(bindings), roomId, userId],
  );
}

export async function setCardBattleReady(roomId: string, userId: string, ready: boolean, db: mysql.PoolConnection) {
  await assertRankingChallengeActive(roomId, db);
  const mode = await cardBattleRoomMode(roomId, db);
  const size = mode === "boss" ? 3 : CARD_BATTLE_LINEUP_SIZE;
  if (ready && mode === "boss") await requireAvailableBoss(roomId, db);
  const [[seat]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT lineup_json, collectible_bindings_json FROM online_card_battle_seats WHERE room_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (!seat) throw new CardBattleRoomRuleError("你当前不在对战席");
  const cardIds = parseList(seat.lineup_json);
  const selectedIds = cardIds.filter((cardId): cardId is string => Boolean(cardId));
  if (ready && (cardIds.length !== size || selectedIds.length !== size || new Set(selectedIds).size !== size)) throw new CardBattleRoomRuleError(`必须选满${size}张不同卡牌才能准备`);
  if (ready) {
    await resolveBattleCollectibles(userId, cardIds, parseBattleCollectibleBindings(seat.collectible_bindings_json), db, true);
    const [eligible] = await db.query<mysql.RowDataPacket[]>(
      `SELECT cards.id FROM user_asset_cards owned JOIN asset_cards cards ON cards.id = owned.card_id
       JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
       WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity IN ('epic','legend')
         AND cards.id IN (${selectedIds.map(() => "?").join(",")})`,
      [userId, ...selectedIds],
    );
    if (eligible.length !== size) throw new CardBattleRoomRuleError("阵容中有卡牌已停用或不再可用，请重新选择");
  }
  await db.query(
    "UPDATE online_card_battle_seats SET is_ready = ? WHERE room_id = ? AND user_id = ?",
    [ready ? 1 : 0, roomId, userId],
  );
}

async function battleDeckCard(userId: string, seat: 1 | 2, slot: number, cardId: string, db: mysql.PoolConnection): Promise<CardBattleDeckCard> {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT cards.id, cards.card_no, cards.name, cards.rarity, cards.battle_role, cards.updated_at,
       cards.motion_mp4_path, cards.motion_webm_path, cards.motion_poster_path, cards.motion_version, owned.star_level
     FROM user_asset_cards owned JOIN asset_cards cards ON cards.id = owned.card_id
     WHERE owned.user_id = ? AND cards.id = ? AND cards.status = 'active' AND cards.rarity IN ('epic','legend') LIMIT 1`,
    [userId, cardId],
  );
  if (!row) throw new CardBattleRoomRuleError("阵容中有卡牌已停用或不再可用，请重新选择");
  const tiers = await loadCardBattleTiers(cardId, db);
  const starLevel = Number(row.star_level) as 0 | 1 | 2 | 3;
  const tier = tiers.find((item) => item.starLevel === starLevel);
  if (!tier) throw new CardBattleRoomRuleError("卡牌战斗配置不完整，请联系管理员");
  return {
    instanceId: `${seat}:${slot}:${cardId}`,
    cardId,
    cardNo: String(row.card_no),
    name: String(row.name),
    imageUrl: `/api/media/assets/cards/${encodeURIComponent(cardId)}/thumbnail?v=${new Date(row.updated_at).getTime()}`,
    rarity: String(row.rarity) as "epic" | "legend",
    battleRole: String(row.battle_role ?? "damage") as "damage" | "tank" | "support",
    starLevel,
    slot: slot as 1 | 2 | 3 | 4 | 5,
    ...battleMotionPayload(row, starLevel),
    tier,
  };
}

export async function buildCardBattlePlayerInput(
  userId: string,
  nickname: string,
  seat: 1 | 2,
  cardIds: string[],
  db: mysql.PoolConnection,
  collectibleBindings: BattleCollectibleBinding[] = [],
  bossPlayerSeat?: 1 | 2 | 3,
): Promise<CardBattlePlayerInput> {
  const size = bossPlayerSeat ? 3 : CARD_BATTLE_LINEUP_SIZE;
  if (cardIds.length !== size || new Set(cardIds).size !== size) {
    throw new CardBattleRoomRuleError(`卡组必须包含 ${size} 张不同卡牌`);
  }
  const cards: CardBattleDeckCard[] = [];
  const collectibles = await resolveBattleCollectibles(userId, cardIds, collectibleBindings, db, true);
  for (let index = 0; index < cardIds.length; index += 1) {
    cards.push({ ...await battleDeckCard(userId, seat, index + 1, cardIds[index]!, db),
      ...(bossPlayerSeat ? { instanceId: `team:${userId}:${index + 1}:${cardIds[index]}` } : {}),
      collectible: collectibles.get(cardIds[index]!) ?? null });
  }
  return applyCardBattlePlayerCollection(
    { userId, nickname, seat, ...(bossPlayerSeat ? { playerSeat: bossPlayerSeat } : {}), cards },
    await loadCardBattleCollectionBonus(userId, db),
  );
}

export async function startCardBattle(roomId: string, hostId: string | null, db: mysql.PoolConnection) {
  await lockRankingForCardBattleRoom(roomId, db);
  await assertRankingChallengeActive(roomId, db);
  const [[room]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM online_soup_rooms WHERE id = ? AND content_type = 'card_battle' AND status <> 'closed' LIMIT 1 FOR UPDATE",
    [roomId],
  );
  if (!room || (!isBossRoom(room) && String(room.host_id) !== hostId)) throw new CardBattleRoomRuleError("仅当前房主可以开始游戏");
  const boss = isBossRoom(room) ? await requireAvailableBoss(roomId, db) : null;
  if (!['preparing', 'ended'].includes(String(room.status))) throw new CardBattleRoomRuleError("当前对局已经开始");
  const [seatRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT seats.*, users.nickname FROM online_card_battle_seats seats
     JOIN users ON users.id = seats.user_id WHERE seats.room_id = ? ORDER BY seats.seat_number FOR UPDATE`,
    [roomId],
  );
  if ((boss ? seatRows.length < 1 || seatRows.length > 3 : seatRows.length !== 2)
    || seatRows.some((seat) => !Boolean(seat.is_ready) || parseList(seat.lineup_json).length !== (boss ? 3 : CARD_BATTLE_LINEUP_SIZE))) {
    throw new CardBattleRoomRuleError(boss ? "在席玩家均须选满三张不同卡牌并准备" : "双方都进入对战席、选满五张卡牌并准备后才能开始");
  }
  const [[rankingChallenge]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT defender_id, defender_snapshot_json, consecutive_wins FROM card_battle_ranking_challenges WHERE room_id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
    [roomId],
  );
  if (Number(rankingChallenge?.consecutive_wins ?? 0) >= 2) throw new CardBattleRoomRuleError("已达成两连胜，请先确认占榜");
  const [[previousGame]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT id, status, result_json, started_at, NOW(3) AS db_now FROM online_card_battles WHERE room_id = ? ORDER BY game_number DESC LIMIT 1 FOR UPDATE",
    [roomId],
  );
  if (previousGame && String(previousGame.status) !== "aborted") {
    const previousResult = parseResult(previousGame.result_json);
    if (!previousResult || !resolveCardBattlePlayback(previousResult, previousGame.started_at, String(previousGame.status), new Date(previousGame.db_now).getTime()).complete) {
      throw new CardBattleRoomRuleError("上一局服务器时间轴尚未结束，暂时不能开始新对局");
    }
  }
  const playerInputs: CardBattlePlayerInput[] = [];
  for (const row of seatRows) {
    const seat = Number(row.seat_number) as 1 | 2;
    const cardIds = parseList(row.lineup_json);
    if (rankingChallenge && String(row.user_id) === String(rankingChallenge.defender_id)) {
      const frozen = parseLineupSnapshot(rankingChallenge.defender_snapshot_json)[0];
      if (!frozen || frozen.userId !== String(row.user_id) || frozen.seat !== seat || frozen.cards.length !== CARD_BATTLE_LINEUP_SIZE) {
        throw new CardBattleRoomRuleError("榜单对手阵容快照不可用，请退出后重新发起挑战");
      }
      playerInputs.push(applyCardBattlePlayerCollection(frozen, await loadCardBattleCollectionBonus(frozen.userId, db)));
    } else {
      playerInputs.push(await buildCardBattlePlayerInput(String(row.user_id), String(row.nickname), boss ? 1 : seat, cardIds.filter((cardId): cardId is string => Boolean(cardId)), db, parseBattleCollectibleBindings(row.collectible_bindings_json), boss ? Number(row.seat_number) as 1 | 2 | 3 : undefined));
    }
  }
  if (boss) playerInputs.push(bossBattlePlayer(boss));
  if (rankingChallenge) await db.query("UPDATE card_battle_ranking_challenges SET consecutive_wins = 0 WHERE room_id = ?", [roomId]);
  return createCardBattleGame(roomId, playerInputs, db, boss);
}

/** Caller holds the room lock; a rematch reuses the complete frozen inputs. */
async function createCardBattleGame(roomId: string, playerInputs: CardBattlePlayerInput[], db: mysql.PoolConnection,
  boss: Awaited<ReturnType<typeof requireAvailableBoss>> | null = null, scheduledStart?: Date) {
  const [[numberRow]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT COALESCE(MAX(game_number), 0) + 1 AS next_number FROM online_card_battles WHERE room_id = ?",
    [roomId],
  );
  const gameId = nanoid();
  const seed = `${roomId}:${numberRow.next_number}:${nanoid()}`;
  const result = simulateCardBattle(playerInputs, seed, boss ? "boss" : "1v1");
  const [[clock]] = await db.query<mysql.RowDataPacket[]>("SELECT NOW(3) AS db_now");
  const startedAt = scheduledStart ?? new Date(clock.db_now);
  const playbackEndsAt = new Date(startedAt.getTime() + result.playbackDurationMs);
  await db.query(
    `INSERT INTO online_card_battles
      (id, room_id, game_number, random_seed, lineup_snapshot_json, result_json, playback_ends_at, started_at, mode, boss_reward_shells, boss_name_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [gameId, roomId, Number(numberRow.next_number), seed, JSON.stringify(playerInputs), JSON.stringify(result), playbackEndsAt, startedAt, boss ? "boss" : "1v1", boss ? Number(boss.reward_shells) : null, boss ? String(boss.name) : null],
  );
  if (boss) for (const player of playerInputs.filter((item) => item.seat === 1)) await db.query(
    "INSERT INTO card_battle_boss_participants (game_id, user_id, player_seat, nickname_snapshot) VALUES (?, ?, ?, ?)",
    [gameId, player.userId, player.playerSeat, player.nickname]);
  await db.query(
    `UPDATE online_soup_rooms SET status = 'playing', current_soup_id = NULL, current_round_id = NULL,
       current_mystery_id = NULL, current_mystery_run_id = NULL, last_action_at = NOW() WHERE id = ?`,
    [roomId],
  );
  return { gameId, gameNumber: Number(numberRow.next_number), result, startedAt, playbackEndsAt };
}

/** Called while holding the room lock, after a ready/seat transition. */
export async function startBossIfReady(roomId: string, db: mysql.PoolConnection) {
  const [[room]] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM online_soup_rooms WHERE id = ? FOR UPDATE", [roomId]);
  if (!room || !isBossRoom(room) || !["preparing", "ended"].includes(String(room.status))) return null;
  // Concurrent ready requests can establish a repeatable-read snapshot before the
  // room lock. Read the committed seats under that lock to see the final readiness.
  const [seats] = await db.query<mysql.RowDataPacket[]>("SELECT is_ready FROM online_card_battle_seats WHERE room_id = ? FOR UPDATE", [roomId]);
  if (!seats.length || seats.some((seat) => !Boolean(seat.is_ready))) return null;
  return startCardBattle(roomId, null, db);
}

async function occupyRankAfterDefeat(game: mysql.RowDataPacket, challenge: mysql.RowDataPacket, result: CardBattleResult, connection: mysql.PoolConnection) {
  if (!challenge.challenger_was_unranked || !result.winnerSeat || result.endReason === "surrender") return;
  const player = parseLineupSnapshot(game.lineup_snapshot_json).find((entry) => entry.userId === String(challenge.challenger_id));
  if (!player || result.winnerSeat === player.seat) return;
  const [[user]] = await connection.query<mysql.RowDataPacket[]>("SELECT role FROM users WHERE id = ?", [player.userId]);
  if (!user || user.role === "super_admin") return;
  const rows = await lockAndCompactCardBattleRanking(connection);
  if (rows.some((row) => String(row.user_id) === player.userId)) return;
  if (rows.length >= 100) {
    await connection.query("UPDATE online_card_battles SET ranking_fallback_full = 1 WHERE id = ?", [game.id]);
    return;
  }
  const cards = [...player.cards].sort((a, b) => a.slot - b.slot);
  const lineup = cards.map((card) => card.cardId);
  if (lineup.length !== 5 || new Set(lineup).size !== 5) throw new CardBattleRoomRuleError("打榜阵容记录不完整");
  const bindings = cards.flatMap((card) => card.collectible ? [{ cardId: card.cardId, collectibleId: card.collectible.id }] : []);
  const totalPower = cards.reduce((sum, card) => sum + calculateCardBattlePower(applyBattleCollectibleStats(card.tier, card.collectible)), 0);
  const rank = rows.length + 1;
  await connection.query(
    "INSERT INTO card_battle_ranking_entries (rank_position,user_id,lineup_json,total_power,collectible_bindings_json) VALUES (?,?,?,?,?)",
    [rank, player.userId, JSON.stringify(lineup), totalPower, JSON.stringify(bindings)],
  );
  await connection.query("UPDATE online_card_battles SET ranking_fallback_rank = ? WHERE id = ?", [rank, game.id]);
}

export async function finalizeCardBattleIfDue(roomId: string) {
  const [[game]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, playback_ends_at, NOW(3) AS db_now FROM online_card_battles WHERE room_id = ? AND status = 'playing' ORDER BY game_number DESC LIMIT 1",
    [roomId],
  );
  if (!game || new Date(game.playback_ends_at).getTime() > new Date(game.db_now).getTime()) return false;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize start/leave/finalization on the room before locking child rows.
    await lockRankingForCardBattleRoom(roomId, connection);
    await connection.query("SELECT id FROM online_soup_rooms WHERE id = ? FOR UPDATE", [roomId]);
    const [[locked]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT *, NOW(3) AS db_now FROM online_card_battles WHERE id = ? AND status = 'playing' FOR UPDATE",
      [game.id],
    );
    if (!locked || new Date(locked.playback_ends_at).getTime() > new Date(locked.db_now).getTime()) { await connection.commit(); return false; }
    const result = parseResult(locked.result_json);
    if (!result) throw new CardBattleRoomRuleError("战斗记录不可用");
    const rewards = await settleBossRewards(locked, result, connection);
    await connection.query("UPDATE online_card_battles SET status = 'ended', ended_at = NOW(3) WHERE id = ?", [locked.id]);
    const [[rankingChallenge]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT defender_id, challenger_id, challenger_was_unranked, consecutive_wins FROM card_battle_ranking_challenges WHERE room_id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [roomId],
    );
    let nextRankingInputs: CardBattlePlayerInput[] | null = null;
    if (rankingChallenge) {
      await occupyRankAfterDefeat(locked, rankingChallenge, result, connection);
      const frozenInputs = parseLineupSnapshot(locked.lineup_snapshot_json);
      const challenger = frozenInputs.find(player => player.userId === String(rankingChallenge.challenger_id));
      const won = challenger && result.winnerSeat === challenger.seat && result.endReason !== "surrender";
      const wins = won ? Math.min(2, Number(rankingChallenge.consecutive_wins ?? 0) + 1) : 0;
      await connection.query("UPDATE card_battle_ranking_challenges SET consecutive_wins = ? WHERE room_id = ?", [wins, roomId]);
      if (wins === 1) {
        if (frozenInputs.length !== 2 || frozenInputs.some(player => player.cards.length !== CARD_BATTLE_LINEUP_SIZE)) {
          throw new CardBattleRoomRuleError("打榜阵容快照不可用，无法开始第二局");
        }
        nextRankingInputs = frozenInputs;
      }
      await connection.query(
        "UPDATE online_card_battle_seats SET is_ready = IF(user_id = ?, 1, 0) WHERE room_id = ?",
        [rankingChallenge.defender_id, roomId],
      );
    } else {
      await connection.query("UPDATE online_card_battle_seats SET is_ready = 0 WHERE room_id = ?", [roomId]);
    }
    await connection.query("UPDATE online_soup_rooms SET status = 'ended', last_action_at = NOW() WHERE id = ? AND content_type = 'card_battle'", [roomId]);
    if (!rankingChallenge) await connection.query(
      `DELETE seats FROM online_card_battle_seats seats
       LEFT JOIN online_soup_members members
         ON members.room_id = seats.room_id AND members.user_id = seats.user_id
       WHERE seats.room_id = ?
         AND (members.user_id IS NULL OR members.is_active = 0 OR members.member_role <> 'player')`,
      [roomId],
    );
    await archiveBattleRecord(connection, String(locked.id));
    if (nextRankingInputs) {
      await connection.query("UPDATE online_card_battle_seats SET is_ready = 1 WHERE room_id = ?", [roomId]);
      await createCardBattleGame(roomId, nextRankingInputs, connection, null, new Date(locked.playback_ends_at));
    }
    await connection.commit();
    emitBossRewards(rewards);
    return true;
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}

export async function cardBattleClientState(roomId: string, viewerId: string) {
  await finalizeCardBattleIfDue(roomId);
  const [seatRows, gameRows, roomRows] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT seats.*, users.nickname, users.avatar IS NOT NULL AS has_avatar, members.is_active, members.member_role
       FROM online_card_battle_seats seats JOIN users ON users.id = seats.user_id
       LEFT JOIN online_soup_members members ON members.room_id = seats.room_id AND members.user_id = seats.user_id
       WHERE seats.room_id = ? ORDER BY seats.seat_number`,
      [roomId],
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      "SELECT *, NOW(3) AS db_now FROM online_card_battles WHERE room_id = ? ORDER BY game_number DESC LIMIT 1",
      [roomId],
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT rooms.status, rooms.card_battle_mode, challenges.id AS challenge_id, challenges.challenger_id,
         challenges.defender_id, challenges.target_rank, challenges.status AS challenge_status, challenges.consecutive_wins
       FROM online_soup_rooms rooms
       LEFT JOIN card_battle_ranking_challenges challenges ON challenges.room_id = rooms.id
       WHERE rooms.id = ? LIMIT 1`,
      [roomId],
    ).then(([rows]) => rows),
  ]);
  const currentGame = gameRows[0] ?? null;
  const bossRow = isBossRoom(roomRows[0] ?? {}) ? await loadBoss(roomId) : null;
  const result = currentGame ? parseResult(currentGame.result_json) : null;
  const frozenPlayers = currentGame ? parseLineupSnapshot(currentGame.lineup_snapshot_json) : [];
  const gamePublic = Boolean(result && String(currentGame?.status) === "playing");
  const seatNumbers = bossRow ? [1, 2, 3] as const : [1, 2] as const;
  const lineupSize = bossRow ? 3 : 5;
  const seats = await Promise.all(seatNumbers.map(async (seatNumber) => {
    const row = seatRows.find((seat) => Number(seat.seat_number) === seatNumber);
    if (!row) return { seat: seatNumber, user: null, ready: false, lineup: Array.from({ length: lineupSize }, (_, index) => ({ slot: index + 1, card: null, cardBack: false })) };
    const ids = parseList(row.lineup_json);
    const ownSeat = String(row.user_id) === viewerId;
    const eligible = (ownSeat || bossRow) && ids.length ? await loadEligibleBattleCards(String(row.user_id)) : [];
    const cardsById = new Map(eligible.map((card) => [card.id, card]));
    const bindings = parseBattleCollectibleBindings(row.collectible_bindings_json);
    const collectibles = ownSeat || bossRow ? await loadBattleCollectibles(String(row.user_id), pool) : [];
    const frozenPlayer = frozenPlayers.find((player) => player.userId === String(row.user_id)) ?? null;
    return {
      seat: seatNumber,
      user: { id: String(row.user_id), nickname: String(row.nickname), avatar: row.has_avatar ? `/api/media/users/${encodeURIComponent(String(row.user_id))}/avatar` : null },
      ready: Boolean(row.is_ready),
      lineup: Array.from({ length: lineupSize }, (_, index) => {
        const cardId = ids[index];
        const frozen = frozenPlayer?.cards[index];
        const canSee = ownSeat || gamePublic || Boolean(bossRow);
        const card = gamePublic && frozen
          ? publicFrozenCard(frozen)
          : cardId && (ownSeat || bossRow) && cardsById.has(cardId) ? withBattleCollectible(cardsById.get(cardId)!, collectibles.find((item) => bindings.some((b) => b.cardId === cardId && b.collectibleId === item.id)) ?? null) : null;
        return { slot: index + 1, card: canSee ? card : null, cardBack: Boolean(cardId && !canSee) };
      }),
    };
  }));
  const mySeat = seatRows.find((seat) => String(seat.user_id) === viewerId && (!bossRow || (seat.is_active && seat.member_role === "player")));
  const eligibleCount = await eligibleCardCount(viewerId);
  const gameStatus = currentGame ? String(currentGame.status) : null;
  const roomStatus = String(roomRows[0]?.status ?? "preparing");
  const challengeRow = roomRows[0]?.challenge_id ? roomRows[0] : null;
  const rankingInvalidated = challengeRow?.challenge_status === "stale";
  const phase = rankingInvalidated ? "aborted" : roomStatus === "preparing" ? "preparing"
    : roomStatus === "playing" ? "playing"
      : gameStatus === "aborted" ? "aborted"
        : roomStatus === "ended" ? "ended" : "preparing";
  const playback = currentGame && result
    ? resolveCardBattlePlayback(result, currentGame.started_at, gameStatus ?? "ended", new Date(currentGame.db_now).getTime())
    : null;
  const [[reward]] = bossRow ? await pool.query<mysql.RowDataPacket[]>(
    "SELECT game_id, amount FROM card_battle_boss_rewards WHERE room_id = ? AND user_id = ?", [roomId, viewerId]) : [[]];
  const [[participant]] = bossRow && currentGame ? await pool.query<mysql.RowDataPacket[]>(
    "SELECT forfeited_at FROM card_battle_boss_participants WHERE game_id = ? AND user_id = ?", [currentGame.id, viewerId]) : [[]];
  return {
    mode: bossRow ? "boss" as const : "1v1" as const,
    boss: bossRow ? {
      ...bossPublic(bossRow),
      lineup: parseBossLineupForPreview(bossRow),
      rewardClaimed: Boolean(reward),
      currentReward: currentGame ? {
        amount: Number(currentGame.boss_reward_shells), participant: Boolean(participant), forfeited: Boolean(participant?.forfeited_at),
        granted: Boolean(reward && String(reward.game_id) === String(currentGame.id)),
      } : null,
    } : null,
    phase: phase as "preparing" | "playing" | "ended" | "aborted",
    seats,
    me: { userId: viewerId, seat: mySeat ? Number(mySeat.seat_number) as 1 | 2 | 3 : null, eligibleCardCount: eligibleCount,
      collectibleBindings: mySeat ? parseBattleCollectibleBindings(mySeat.collectible_bindings_json) : [] },
    rankingChallenge: challengeRow ? {
      id: String(challengeRow.challenge_id),
      challengerUserId: String(challengeRow.challenger_id),
      defenderUserId: String(challengeRow.defender_id),
      targetRank: Number(challengeRow.target_rank),
      consecutiveWins: Number(challengeRow.consecutive_wins ?? 0),
      status: String(challengeRow.challenge_status) as "active" | "won" | "abandoned" | "stale",
      fallbackRank: currentGame?.ranking_fallback_rank == null ? null : Number(currentGame.ranking_fallback_rank),
      fallbackFull: Boolean(currentGame?.ranking_fallback_full),
    } : null,
    game: currentGame && result ? {
      id: String(currentGame.id),
      gameNumber: Number(currentGame.game_number),
      status: String(currentGame.status),
      startedAt: iso(currentGame.started_at),
      playbackEndsAt: iso(currentGame.playback_ends_at),
      playback: playback!,
      lineups: frozenPlayers.map((player) => ({
        userId: player.userId,
        nickname: player.nickname,
        seat: player.seat,
        playerSeat: player.playerSeat,
        cards: player.cards.map(publicFrozenCard),
      })),
      settlement: playback!.complete && gameStatus !== "aborted" && !rankingInvalidated
        ? { winnerSeat: result.winnerSeat, endReason: result.endReason, rounds: result.rounds, players: resolveCardBattleSettlementPlayers(result) }
        : null,
    } : null,
  };
}

function parseBossLineupForPreview(row: mysql.RowDataPacket) {
  try { return bossBattlePlayer(row).cards.map(publicFrozenCard); }
  catch { return []; } // Draft rooms can intentionally have incomplete cards.
}
