import { applyBattleCollectibleStats, type BattleCollectibleBinding } from "@hgt/shared";
import { BattleCollectibleRuleError, parseBattleCollectibleBindings, resolveBattleCollectibles, loadBattleCollectibles, withBattleCollectible } from "./battleCollectibles.js";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { freezeBattleRecordRanks } from "./gameRecords.js";
import { calculateCardBattlePower, type CardBattlePlayerInput } from "./cardBattle.js";
import { applyCardBattleCollectionStats, loadCardBattleCollectionBonuses } from "./cardBattleCollection.js";
import {
  buildCardBattlePlayerInput,
  CardBattleRoomRuleError,
  loadEligibleBattleCards,
  loadSavedCardBattleDecks,
  forfeitCardBattle,
} from "./cardBattleRoom.js";
import { resolveCardBattlePlayback } from "./cardBattlePlayback.js";
import { vipGrowthSnapshot } from "./vipGrowth.js";
import { compactCardBattleRankingEntries, lockAndCompactCardBattleRanking, lockCardBattleRanking, reconcileCardBattleRanking } from "./cardBattleRankingState.js";

export class CardBattleRankingRuleError extends Error {
  constructor(message: string, public readonly code = "CARD_BATTLE_RANKING_RULE") {
    super(message);
  }
}

type CardBattleRankingNotificationListener = (userId: string) => void;
let rankingNotificationListener: CardBattleRankingNotificationListener = () => undefined;

export function setCardBattleRankingNotificationListener(listener: CardBattleRankingNotificationListener) {
  rankingNotificationListener = listener;
}

export function cardBattleRankDefeatedNotificationContent(challengerNickname: string, currentRank: number | null) {
  return currentRank == null
    ? `${challengerNickname}在卡牌对战榜中战胜了您，您当前暂未上榜`
    : `${challengerNickname}在卡牌对战榜中战胜了您，您当前的排名是第${currentRank}名`;
}

type RankingEntry = {
  rank: number;
  userId: string;
  lineup: string[];
  collectibleBindings?: BattleCollectibleBinding[];
  totalPower: number;
  achievedAt: Date;
};

export function promoteCardBattleRankingEntries(entries: RankingEntry[], challenger: RankingEntry, targetRank: number) {
  const ordered = [...entries].sort((a, b) => a.rank - b.rank).filter((entry) => entry.userId !== challenger.userId);
  const targetIndex = ordered.findIndex((entry) => entry.rank >= targetRank);
  ordered.splice(targetIndex < 0 ? ordered.length : targetIndex, 0, challenger);
  return compactCardBattleRankingEntries(ordered.map((entry, index) => ({ ...entry, rank: index + 1 })));
}

export function canClaimEmptyCardBattleRank(currentRank: number | null, targetRank: number) {
  return currentRank === null || targetRank < currentRank;
}

function parseCardIds(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function parsePlayerInputs(value: unknown): CardBattlePlayerInput[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed as CardBattlePlayerInput[] : [];
  } catch {
    return [];
  }
}

async function validatedDeck(userId: string, deckId: string, db: mysql.Pool | mysql.PoolConnection) {
  const deck = (await loadSavedCardBattleDecks(userId, db)).find((item) => item.id === deckId);
  if (!deck) throw new CardBattleRankingRuleError("卡组不存在或已被删除");
  const cards = await loadEligibleBattleCards(userId, db);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const collectibles = await resolveBattleCollectibles(userId, deck.cardIds, deck.collectibleBindings, db, true);
  const selected = deck.cardIds.map((cardId) => cardsById.has(cardId) ? withBattleCollectible(cardsById.get(cardId)!, collectibles.get(cardId) ?? null) : null);
  if (deck.cardIds.length !== 5 || selected.some((card) => !card)) {
    throw new CardBattleRankingRuleError("卡组包含未拥有、已停用或不可参战的卡牌");
  }
  return {
    deck,
    cards: selected.filter((card): card is NonNullable<typeof card> => Boolean(card)),
    totalPower: selected.reduce((sum, card) => sum + (card?.combatPower ?? 0), 0),
  };
}

async function assertRankingEligibleUser(userId: string, db: mysql.Pool | mysql.PoolConnection) {
  const [[user]] = await db.query<mysql.RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!user) throw new CardBattleRankingRuleError("用户不存在");
  if (String(user.role) === "super_admin") throw new CardBattleRankingRuleError("超级管理员不参与排行榜");
}

export async function listCardBattleRanking(
  limit: 10 | 100,
  db: mysql.Pool | mysql.PoolConnection = pool,
  reconcile = true,
) {
  if (reconcile) await reconcileCardBattleRanking();
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT entries.rank_position, entries.user_id, entries.total_power AS saved_total_power,
       entries.achieved_at, users.nickname, users.avatar IS NOT NULL AS has_avatar,
       users.role, users.vip_growth_value, users.vip_expires_at, users.vip_legacy_active,
       COALESCE(SUM(owned.star_level), 0) AS star_total,
       JSON_ARRAYAGG(JSON_OBJECT('cardId', cards.id, 'maxHp', tiers.max_hp,
         'attack', tiers.attack_value, 'defense', tiers.defense_value, 'speed', tiers.speed_value,
         'energyRequired', tiers.energy_required, 'critRate', tiers.crit_rate, 'critDamage', tiers.crit_damage,
         'lifestealRate', tiers.lifesteal_rate, 'extraActionRate', tiers.extra_action_rate,
         'counterRate', tiers.counter_rate, 'dodgeRate', tiers.dodge_rate, 'stunRate', tiers.stun_rate,
         'battleEffectType', relic.battle_effect_type, 'battleEffectValue', relic.battle_effect_value)) AS power_cards
     FROM card_battle_ranking_entries entries
     JOIN users ON users.id = entries.user_id
     LEFT JOIN JSON_TABLE(entries.lineup_json, '$[*]' COLUMNS(card_id VARCHAR(64) PATH '$')) lineup ON TRUE
     LEFT JOIN JSON_TABLE(COALESCE(entries.collectible_bindings_json, JSON_ARRAY()), '$[*]'
       COLUMNS(card_id VARCHAR(64) PATH '$.cardId', collectible_id VARCHAR(64) PATH '$.collectibleId')) equipment
       ON BINARY equipment.card_id = BINARY lineup.card_id
     LEFT JOIN collectibles relic ON BINARY relic.id = BINARY equipment.collectible_id
       AND relic.owner_user_id = entries.user_id AND relic.status = 'owned' AND relic.deleted_at IS NULL
     LEFT JOIN user_asset_cards owned ON owned.user_id = entries.user_id
       AND BINARY owned.card_id = BINARY lineup.card_id
     LEFT JOIN asset_cards cards ON cards.id = owned.card_id AND cards.status = 'active'
     LEFT JOIN asset_card_battle_tiers tiers ON tiers.card_id = owned.card_id AND tiers.star_level = owned.star_level
     WHERE entries.rank_position <= ?
     GROUP BY entries.rank_position, entries.user_id, entries.total_power, entries.achieved_at,
       users.nickname, users.avatar, users.role, users.vip_growth_value, users.vip_expires_at, users.vip_legacy_active
     ORDER BY entries.rank_position`,
    [limit],
  );
  const byRank = new Map(rows.map((row) => [Number(row.rank_position), row]));
  const collections = await loadCardBattleCollectionBonuses(rows.map(row => String(row.user_id)), db);
  return Array.from({ length: limit }, (_, index) => {
    const rank = index + 1;
    const row = byRank.get(rank);
    if (!row) return { rank, occupied: false as const };
    const vip = vipGrowthSnapshot(row);
    const powerCards: Array<Parameters<typeof calculateCardBattlePower>[0] & {
      cardId: string | null;
      battleEffectType: import("@hgt/shared").BattleCollectibleEffectType | null;
      battleEffectValue: number | null;
    }> =
      typeof row.power_cards === "string" ? JSON.parse(row.power_cards) : row.power_cards ?? [];
    const totalPower = powerCards.reduce((sum, card) => {
      if (!card.cardId || card.maxHp == null) return sum;
      const base = {
        maxHp: Number(card.maxHp), attack: Number(card.attack), defense: Number(card.defense), speed: Number(card.speed),
        energyRequired: Number(card.energyRequired), critRate: Number(card.critRate ?? 25), critDamage: Number(card.critDamage ?? 150),
        lifestealRate: Number(card.lifestealRate ?? 0), extraActionRate: Number(card.extraActionRate ?? 0),
        counterRate: Number(card.counterRate ?? 0), dodgeRate: Number(card.dodgeRate ?? 0), stunRate: Number(card.stunRate ?? 0),
      };
      const boosted = applyCardBattleCollectionStats(base, card.cardId, collections.get(String(row.user_id))!);
      const stats = applyBattleCollectibleStats(boosted, {
        battleEffectDescription: "", battleEffectType: card.battleEffectType,
        battleEffectValue: card.battleEffectValue == null ? null : Number(card.battleEffectValue),
      });
      return sum + calculateCardBattlePower(stats);
    }, 0);
    return {
      rank,
      occupied: true as const,
      user: {
        id: String(row.user_id),
        nickname: String(row.nickname),
        avatar: row.has_avatar ? `/api/media/users/${encodeURIComponent(String(row.user_id))}/avatar` : null,
        vipLevel: vip.level,
        vipActive: vip.active,
      },
      starTotal: Number(row.star_total ?? 0),
      totalPower,
      achievedAt: new Date(row.achieved_at).toISOString(),
    };
  });
}

export async function cardBattleRankingOwnRank(userId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT rank_position FROM card_battle_ranking_entries WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return row ? Number(row.rank_position) : null;
}

export async function cardBattleRankingSnapshot(userId: string, limit: 10 | 100) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockAndCompactCardBattleRanking(connection);
    const entries = await listCardBattleRanking(limit, connection, false);
    const ownRank = await cardBattleRankingOwnRank(userId, connection);
    await connection.commit();
    return { entries, ownRank, limit };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function cardBattleRankingDetail(rank: number) {
  await reconcileCardBattleRanking();
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT entries.*, users.nickname, users.avatar IS NOT NULL AS has_avatar,
       users.vip_growth_value, users.vip_expires_at, users.vip_legacy_active
     FROM card_battle_ranking_entries entries JOIN users ON users.id = entries.user_id
     WHERE entries.rank_position = ? LIMIT 1`,
    [rank],
  );
  if (!row) return null;
  const cardIds = parseCardIds(row.lineup_json);
  const eligible = await loadEligibleBattleCards(String(row.user_id));
  const cardsById = new Map(eligible.map((card) => [card.id, card]));
  const bindings = parseBattleCollectibleBindings(row.collectible_bindings_json);
  const owned = await loadBattleCollectibles(String(row.user_id), pool);
  const collectiblesAvailable = bindings.every((b) => owned.some((item) => item.id === b.collectibleId));
  const cards = cardIds.map((cardId, index) => {
    const card = cardsById.get(cardId);
    return card ? { slot: index + 1, ...withBattleCollectible(card, owned.find((item) => bindings.some((b) => b.cardId === cardId && b.collectibleId === item.id)) ?? null) } : { slot: index + 1, id: cardId, unavailable: true as const };
  });
  const vip = vipGrowthSnapshot(row);
  return {
    rank,
    user: {
      id: String(row.user_id), nickname: String(row.nickname),
      avatar: row.has_avatar ? `/api/media/users/${encodeURIComponent(String(row.user_id))}/avatar` : null,
      vipLevel: vip.level, vipActive: vip.active,
    },
    cards,
    starTotal: cards.reduce((sum, card) => sum + ("starLevel" in card ? Number(card.starLevel) : 0), 0),
    totalPower: cards.reduce((sum, card) => sum + ("combatPower" in card ? Number(card.combatPower) : 0), 0),
    available: collectiblesAvailable && cards.length === 5 && cards.every((card) => !("unavailable" in card)),
    achievedAt: new Date(row.achieved_at).toISOString(),
  };
}

export async function claimEmptyCardBattleRank(userId: string, rank: number, deckId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertRankingEligibleUser(userId, connection);
    const rows = await lockAndCompactCardBattleRanking(connection);
    const slot = rows.find((row) => Number(row.rank_position) === rank);
    const own = rows.find((row) => String(row.user_id) === userId);
    if (slot) throw new CardBattleRankingRuleError("该排名已被占据，请刷新榜单", "RANK_OCCUPIED");
    const currentRank = own ? Number(own.rank_position) : null;
    if (!canClaimEmptyCardBattleRank(currentRank, rank)) {
      throw new CardBattleRankingRuleError("已上榜用户只能移动到比当前排名更靠前的空位");
    }
    const selection = await validatedDeck(userId, deckId, connection);
    // Clicking any empty slot ultimately occupies the first available position.
    rank = rows.length + 1;
    if (currentRank === null) {
      await connection.query(
        `INSERT INTO card_battle_ranking_entries (rank_position, user_id, lineup_json, total_power, collectible_bindings_json)
         VALUES (?, ?, ?, ?, ?)`,
        [rank, userId, JSON.stringify(selection.deck.cardIds), selection.totalPower, JSON.stringify(selection.deck.collectibleBindings)],
      );
    } else {
      await connection.query(
        `UPDATE card_battle_ranking_entries
         SET rank_position = ?, lineup_json = ?, total_power = ?, collectible_bindings_json = ?, achieved_at = NOW(3)
         WHERE user_id = ? AND rank_position = ?`,
        [rank, JSON.stringify(selection.deck.cardIds), selection.totalPower, JSON.stringify(selection.deck.collectibleBindings), userId, currentRank],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  return cardBattleRankingDetail(rank);
}

export async function replaceCardBattleRankingDeck(userId: string, rank: number, deckId: string) {
  const connection = await pool.getConnection();
  let currentRank = rank;
  try {
    await connection.beginTransaction();
    await assertRankingEligibleUser(userId, connection);
    const rows = await lockAndCompactCardBattleRanking(connection);
    const own = rows.find((row) => String(row.user_id) === userId);
    if (!own) throw new CardBattleRankingRuleError("您当前暂未上榜，请先占据空榜位");
    currentRank = Number(own.rank_position);
    if (currentRank !== rank) throw new CardBattleRankingRuleError(`您的当前排名已变更为第${currentRank}名，请刷新后重试`, "RANK_CHANGED");
    const selection = await validatedDeck(userId, deckId, connection);
    await connection.query(
      `UPDATE card_battle_ranking_entries
       SET lineup_json = ?, total_power = ?, collectible_bindings_json = ?
       WHERE user_id = ? AND rank_position = ?`,
      [JSON.stringify(selection.deck.cardIds), selection.totalPower, JSON.stringify(selection.deck.collectibleBindings), userId, currentRank],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  return cardBattleRankingDetail(currentRank);
}

async function uniqueRoomCode(db: mysql.PoolConnection) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const [[existing]] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM online_soup_rooms WHERE room_code = ? LIMIT 1", [code]);
    if (!existing) return code;
  }
  throw new CardBattleRankingRuleError("临时房间创建失败，请稍后重试");
}

export async function createCardBattleRankingChallenge(userId: string, rank: number, deckId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertRankingEligibleUser(userId, connection);
    await lockAndCompactCardBattleRanking(connection);
    const [[target]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT entries.*, users.nickname FROM card_battle_ranking_entries entries
       JOIN users ON users.id = entries.user_id WHERE entries.rank_position = ? LIMIT 1 FOR UPDATE`,
      [rank],
    );
    const [[ownRank]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT rank_position FROM card_battle_ranking_entries WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [userId],
    );
    if (!target) throw new CardBattleRankingRuleError("该排名当前为空，请直接占据空位", "RANK_EMPTY");
    if (String(target.user_id) === userId) throw new CardBattleRankingRuleError("不能挑战自己的榜单位置");
    if (ownRank && rank >= Number(ownRank.rank_position)) throw new CardBattleRankingRuleError("榜内用户只能挑战比自己更高的排名");
    const challenger = await validatedDeck(userId, deckId, connection);
    const challengerNicknameRows = await connection.query<mysql.RowDataPacket[]>("SELECT nickname FROM users WHERE id = ? LIMIT 1", [userId]);
    const challengerNickname = String(challengerNicknameRows[0][0]?.nickname ?? "挑战者");
    const defenderCardIds = parseCardIds(target.lineup_json);
    let defenderSnapshot: CardBattlePlayerInput;
    try {
      defenderSnapshot = await buildCardBattlePlayerInput(String(target.user_id), String(target.nickname), 2, defenderCardIds, connection, parseBattleCollectibleBindings(target.collectible_bindings_json));
    } catch (error) {
      if (error instanceof CardBattleRoomRuleError || error instanceof BattleCollectibleRuleError) throw new CardBattleRankingRuleError("该排名的卡组当前不可用，暂时无法挑战");
      throw error;
    }
    const roomId = nanoid();
    const challengeId = nanoid();
    const code = await uniqueRoomCode(connection);
    await connection.query(
      `INSERT INTO online_soup_rooms
        (id, room_code, name, host_id, host_mode, content_type, room_scope, room_type, password_hash)
       VALUES (?, ?, ?, ?, 'human', 'card_battle', 'ranking_challenge', 'public', NULL)`,
      [roomId, code, `卡牌对战榜第${rank}名挑战`, userId],
    );
    await connection.query(
      "INSERT INTO online_soup_members (room_id, user_id, member_role) VALUES (?, ?, 'player')",
      [roomId, userId],
    );
    await connection.query(
      `INSERT INTO online_card_battle_seats (room_id, seat_number, user_id, lineup_json, is_ready, collectible_bindings_json)
       VALUES (?, 1, ?, ?, 0, ?), (?, 2, ?, ?, 1, ?)`,
      [roomId, userId, JSON.stringify(challenger.deck.cardIds), JSON.stringify(challenger.deck.collectibleBindings), roomId, target.user_id, JSON.stringify(defenderCardIds), JSON.stringify(parseBattleCollectibleBindings(target.collectible_bindings_json))],
    );
    await connection.query(
      `INSERT INTO card_battle_ranking_challenges
        (id, room_id, challenger_id, defender_id, target_rank, defender_lineup_json, defender_snapshot_json, challenger_was_unranked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [challengeId, roomId, userId, target.user_id, rank, JSON.stringify(defenderCardIds), JSON.stringify([defenderSnapshot]), ownRank ? 0 : 1],
    );
    await connection.commit();
    return { roomId, challengeId, code, challengerNickname };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function isCardBattleRankingRoom(roomId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT id FROM card_battle_ranking_challenges WHERE room_id = ? LIMIT 1",
    [roomId],
  );
  return Boolean(row);
}

export async function abandonCardBattleRankingChallenge(roomId: string, userId: string, db: mysql.PoolConnection) {
  await lockCardBattleRanking(db);
  await db.query("SELECT id FROM online_soup_rooms WHERE id = ? FOR UPDATE", [roomId]);
  const [[challenge]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM card_battle_ranking_challenges WHERE room_id = ? AND challenger_id = ? AND status IN ('active','stale') LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (!challenge) return false;
  if (challenge.status === "active") {
    await forfeitCardBattle(roomId, userId, db);
    await db.query("UPDATE card_battle_ranking_challenges SET status = 'abandoned' WHERE id = ?", [challenge.id]);
  }
  await db.query("UPDATE online_card_battles SET status = 'aborted', ended_at = NOW(3) WHERE room_id = ? AND status = 'playing'", [roomId]);
  await db.query(`UPDATE game_record_users owners JOIN game_records records ON records.id=owners.record_id
    SET owners.rank_state='known' WHERE records.room_id=? AND owners.rank_state='pending'`,[roomId]);
  await db.query("UPDATE online_soup_members SET is_active = 0, left_at = NOW() WHERE room_id = ? AND user_id = ?", [roomId, userId]);
  await db.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW(), host_grace_started_at = NULL WHERE id = ?", [roomId]);
  return true;
}

async function invalidateRankingRooms(roomIds: string[], connection: mysql.PoolConnection) {
  for (const roomId of [...roomIds].sort()) {
    await connection.query("UPDATE online_soup_rooms SET status = 'ended', last_action_at = NOW() WHERE id = ? AND status <> 'closed'", [roomId]);
    await connection.query("UPDATE card_battle_ranking_challenges SET status = 'stale' WHERE room_id = ? AND status = 'active'", [roomId]);
    await connection.query(`UPDATE game_record_users owners JOIN game_records records ON records.id=owners.record_id
      SET owners.rank_state='known' WHERE records.room_id=? AND owners.rank_state='pending'`,[roomId]);
    await connection.query("UPDATE online_card_battles SET status = 'aborted', playback_ends_at = NOW(3), ended_at = NOW(3) WHERE room_id = ? AND status = 'playing'", [roomId]);
    await connection.query("UPDATE online_card_battle_seats SET is_ready = 0 WHERE room_id = ?", [roomId]);
  }
}

export async function acknowledgeCardBattleRankingChange(roomId: string, userId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockCardBattleRanking(connection);
    const [[challenge]] = await connection.query<mysql.RowDataPacket[]>("SELECT status FROM card_battle_ranking_challenges WHERE room_id = ? AND challenger_id = ? FOR UPDATE", [roomId, userId]);
    if (challenge?.status !== "stale") throw new CardBattleRankingRuleError("当前房间没有待确认的排名变化");
    await abandonCardBattleRankingChallenge(roomId, userId, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function confirmCardBattleRankingWin(roomId: string, userId: string) {
  const connection = await pool.getConnection();
  let committed = false;
  let notificationRecipientId: string | null = null;
  try {
    await connection.beginTransaction();
    const lockedRows = await lockAndCompactCardBattleRanking(connection);
    await connection.query("SELECT id FROM online_soup_rooms WHERE id = ? FOR UPDATE", [roomId]);
    const [[challenge]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM card_battle_ranking_challenges WHERE room_id = ? AND challenger_id = ? LIMIT 1 FOR UPDATE",
      [roomId, userId],
    );
    if (!challenge) throw new CardBattleRankingRuleError("挑战不存在、已结束或无权确认");
    if (challenge.status === "stale") throw new CardBattleRankingRuleError("对方排名已发生变化，请重新打榜。", "RANK_CHANGED");
    if (challenge.status !== "active") throw new CardBattleRankingRuleError("挑战已结束");
    if (Number(challenge.consecutive_wins ?? 0) < 2) throw new CardBattleRankingRuleError("必须连续赢两局才能确认占榜");
    const [[game]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT *, NOW(3) AS db_now FROM online_card_battles WHERE room_id = ? ORDER BY game_number DESC LIMIT 1 FOR UPDATE",
      [roomId],
    );
    if (!game || game.status !== "ended") throw new CardBattleRankingRuleError("战斗尚未结束");
    const result = typeof game.result_json === "string" ? JSON.parse(game.result_json) : game.result_json;
    const playerInputs = parsePlayerInputs(game.lineup_snapshot_json);
    const challengerPlayer = playerInputs.find((player) => player.userId === userId);
    if (!challengerPlayer || Number(result?.winnerSeat ?? 0) !== challengerPlayer.seat) {
      throw new CardBattleRankingRuleError("只有本局挑战胜利后才能确认上榜");
    }
    if (!resolveCardBattlePlayback(result, game.started_at, String(game.status), new Date(game.db_now).getTime()).complete) {
      throw new CardBattleRankingRuleError("本局服务器时间轴尚未结束");
    }
    const target = lockedRows.find((row) => Number(row.rank_position) === Number(challenge.target_rank));
    if (!target || String(target.user_id) !== String(challenge.defender_id)) {
      await invalidateRankingRooms([roomId], connection);
      await connection.commit();
      committed = true;
      throw new CardBattleRankingRuleError("对方排名已发生变化，请重新打榜。", "RANK_CHANGED");
    }
    const lineup = challengerPlayer.cards.slice().sort((left, right) => left.slot - right.slot).map((card) => card.cardId);
    const collectibleBindings = challengerPlayer.cards.flatMap((card) => card.collectible ? [{ cardId: card.cardId, collectibleId: card.collectible.id }] : []);
    await resolveBattleCollectibles(userId, lineup, collectibleBindings, connection, true);
    const totalPower = challengerPlayer.cards.reduce((sum, card) => sum + calculateCardBattlePower(applyBattleCollectibleStats(card.tier, card.collectible)), 0);
    const entries: RankingEntry[] = lockedRows.map((row) => ({
      rank: Number(row.rank_position), userId: String(row.user_id), lineup: parseCardIds(row.lineup_json), collectibleBindings: parseBattleCollectibleBindings(row.collectible_bindings_json),
      totalPower: Number(row.total_power ?? 0), achievedAt: new Date(row.achieved_at),
    }));
    const next = promoteCardBattleRankingEntries(entries, {
      rank: Number(challenge.target_rank), userId, lineup, collectibleBindings, totalPower, achievedAt: new Date(),
    }, Number(challenge.target_rank));
    await connection.query("DELETE FROM card_battle_ranking_entries");
    if (next.length) {
      await connection.query(
        `INSERT INTO card_battle_ranking_entries
          (rank_position, user_id, lineup_json, total_power, achieved_at, collectible_bindings_json)
         VALUES ${next.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
        next.flatMap((entry) => [entry.rank, entry.userId, JSON.stringify(entry.lineup), entry.totalPower, entry.achievedAt, JSON.stringify(entry.collectibleBindings ?? [])]),
      );
    }
    const defenderId = String(challenge.defender_id);
    const defenderRank = next.find((entry) => entry.userId === defenderId)?.rank ?? null;
    const [[challenger]] = await connection.query<mysql.RowDataPacket[]>("SELECT nickname FROM users WHERE id = ? LIMIT 1", [userId]);
    await connection.query(
      `INSERT INTO notifications (id, user_id, type, title, content, related_id, actor_id)
       VALUES (?, ?, 'card_battle_rank_defeated', '卡牌对战榜排名变动', ?, ?, ?)`,
      [nanoid(), defenderId, cardBattleRankDefeatedNotificationContent(String(challenger?.nickname ?? "挑战者"), defenderRank), challenge.id, userId],
    );
    notificationRecipientId = defenderId;
    await connection.query("UPDATE card_battle_ranking_challenges SET status = 'won', confirmed_at = NOW(3) WHERE id = ?", [challenge.id]);
    await freezeBattleRecordRanks(connection, String(game.id));
    const [otherChallenges] = await connection.query<mysql.RowDataPacket[]>("SELECT room_id, challenger_id, defender_id, target_rank FROM card_battle_ranking_challenges WHERE status = 'active' ORDER BY room_id FOR UPDATE");
    const nextOccupants = new Map(next.map((entry) => [entry.rank, entry.userId]));
    const invalidatedRoomIds = otherChallenges.filter((other) => String(other.challenger_id) === userId || nextOccupants.get(Number(other.target_rank)) !== String(other.defender_id)).map((other) => String(other.room_id));
    await invalidateRankingRooms(invalidatedRoomIds, connection);
    await connection.query("UPDATE online_soup_members SET is_active = 0, left_at = NOW() WHERE room_id = ?", [roomId]);
    await connection.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW(), host_grace_started_at = NULL WHERE id = ?", [roomId]);
    await connection.commit();
    committed = true;
    if (notificationRecipientId) {
      try { rankingNotificationListener(notificationRecipientId); }
      catch (error) { console.error("card battle ranking notification listener failed", { userId: notificationRecipientId, error }); }
    }
    return { rank: Number(challenge.target_rank), invalidatedRoomIds };
  } catch (error) {
    if (!committed) await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
