import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { calculateCardBattlePower, type CardBattlePlayerInput } from "./cardBattle.js";
import {
  buildCardBattlePlayerInput,
  CardBattleRoomRuleError,
  loadEligibleBattleCards,
  loadSavedCardBattleDecks,
} from "./cardBattleRoom.js";
import { vipGrowthSnapshot } from "./vipGrowth.js";

export class CardBattleRankingRuleError extends Error {
  constructor(message: string, public readonly code = "CARD_BATTLE_RANKING_RULE") {
    super(message);
  }
}

type RankingEntry = {
  rank: number;
  userId: string;
  lineup: string[];
  totalPower: number;
  achievedAt: Date;
};

export function promoteCardBattleRankingEntries(entries: RankingEntry[], challenger: RankingEntry, targetRank: number) {
  const shifted = entries
    .filter((entry) => entry.userId !== challenger.userId)
    .map((entry) => entry.rank >= targetRank ? { ...entry, rank: entry.rank + 1 } : { ...entry })
    .filter((entry) => entry.rank <= 100);
  shifted.push({ ...challenger, rank: targetRank });
  return shifted.sort((left, right) => left.rank - right.rank);
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
  const selected = deck.cardIds.map((cardId) => cardsById.get(cardId) ?? null);
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

export async function listCardBattleRanking(limit: 10 | 100) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT entries.rank_position, entries.user_id, entries.total_power AS saved_total_power,
       entries.achieved_at, users.nickname, users.avatar IS NOT NULL AS has_avatar,
       users.role, users.vip_growth_value, users.vip_expires_at, users.vip_legacy_active,
       COALESCE(SUM(owned.star_level), 0) AS star_total,
       COALESCE(SUM(tiers.max_hp + tiers.attack_value * 3 + tiers.defense_value * 4
         + tiers.speed_value * 7 - tiers.energy_required * 10), entries.total_power) AS current_total_power
     FROM card_battle_ranking_entries entries
     JOIN users ON users.id = entries.user_id
     LEFT JOIN JSON_TABLE(entries.lineup_json, '$[*]' COLUMNS(card_id VARCHAR(64) PATH '$')) lineup ON TRUE
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
  return Array.from({ length: limit }, (_, index) => {
    const rank = index + 1;
    const row = byRank.get(rank);
    if (!row) return { rank, occupied: false as const };
    const vip = vipGrowthSnapshot(row);
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
      totalPower: Number(row.current_total_power ?? row.saved_total_power ?? 0),
      achievedAt: new Date(row.achieved_at).toISOString(),
    };
  });
}

export async function cardBattleRankingOwnRank(userId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT rank_position FROM card_battle_ranking_entries WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return row ? Number(row.rank_position) : null;
}

export async function cardBattleRankingDetail(rank: number) {
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
  const cards = cardIds.map((cardId, index) => {
    const card = cardsById.get(cardId);
    return card ? { slot: index + 1, ...card } : { slot: index + 1, id: cardId, unavailable: true as const };
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
    available: cards.length === 5 && cards.every((card) => !("unavailable" in card)),
    achievedAt: new Date(row.achieved_at).toISOString(),
  };
}

export async function claimEmptyCardBattleRank(userId: string, rank: number, deckId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertRankingEligibleUser(userId, connection);
    const [[slot], [own]] = await Promise.all([
      connection.query<mysql.RowDataPacket[]>("SELECT user_id FROM card_battle_ranking_entries WHERE rank_position = ? FOR UPDATE", [rank]),
      connection.query<mysql.RowDataPacket[]>("SELECT rank_position FROM card_battle_ranking_entries WHERE user_id = ? FOR UPDATE", [userId]),
    ]);
    if (own) throw new CardBattleRankingRuleError("你已经在卡牌对战榜中，不能重复占据空位");
    if (slot) throw new CardBattleRankingRuleError("该排名已被占据，请刷新榜单", "RANK_OCCUPIED");
    const selection = await validatedDeck(userId, deckId, connection);
    await connection.query(
      `INSERT INTO card_battle_ranking_entries (rank_position, user_id, lineup_json, total_power)
       VALUES (?, ?, ?, ?)`,
      [rank, userId, JSON.stringify(selection.deck.cardIds), selection.totalPower],
    );
    await connection.commit();
    return cardBattleRankingDetail(rank);
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
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
    await connection.query(
      `UPDATE card_battle_ranking_challenges challenges
       JOIN online_soup_rooms rooms ON rooms.id = challenges.room_id
       SET challenges.status = 'abandoned'
       WHERE challenges.challenger_id = ? AND challenges.status = 'active' AND rooms.status = 'closed'`,
      [userId],
    );
    const [[activeChallenge]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT room_id FROM card_battle_ranking_challenges WHERE challenger_id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [userId],
    );
    if (activeChallenge) throw new CardBattleRankingRuleError("你已有进行中的打榜房间，请先完成或退出当前挑战", "ACTIVE_CHALLENGE");
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
      defenderSnapshot = await buildCardBattlePlayerInput(String(target.user_id), String(target.nickname), 2, defenderCardIds, connection);
    } catch (error) {
      if (error instanceof CardBattleRoomRuleError) throw new CardBattleRankingRuleError("该排名的卡组当前不可用，暂时无法挑战");
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
      `INSERT INTO online_card_battle_seats (room_id, seat_number, user_id, lineup_json, is_ready)
       VALUES (?, 1, ?, ?, 0), (?, 2, ?, ?, 1)`,
      [roomId, userId, JSON.stringify(challenger.deck.cardIds), roomId, target.user_id, JSON.stringify(defenderCardIds)],
    );
    await connection.query(
      `INSERT INTO card_battle_ranking_challenges
        (id, room_id, challenger_id, defender_id, target_rank, defender_lineup_json, defender_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [challengeId, roomId, userId, target.user_id, rank, JSON.stringify(defenderCardIds), JSON.stringify([defenderSnapshot])],
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
  const [[challenge]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM card_battle_ranking_challenges WHERE room_id = ? AND challenger_id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (!challenge) return false;
  await db.query("UPDATE card_battle_ranking_challenges SET status = 'abandoned' WHERE id = ?", [challenge.id]);
  await db.query("UPDATE online_card_battles SET status = 'aborted', ended_at = NOW(3) WHERE room_id = ? AND status = 'playing'", [roomId]);
  await db.query("UPDATE online_soup_members SET is_active = 0, left_at = NOW() WHERE room_id = ? AND user_id = ?", [roomId, userId]);
  await db.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW(), host_grace_started_at = NULL WHERE id = ?", [roomId]);
  return true;
}

export async function confirmCardBattleRankingWin(roomId: string, userId: string) {
  const connection = await pool.getConnection();
  let committed = false;
  try {
    await connection.beginTransaction();
    const [[challenge]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM card_battle_ranking_challenges WHERE room_id = ? AND challenger_id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [roomId, userId],
    );
    if (!challenge) throw new CardBattleRankingRuleError("挑战不存在、已结束或无权确认");
    const [[game]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_card_battles WHERE room_id = ? AND status = 'ended' ORDER BY game_number DESC LIMIT 1 FOR UPDATE",
      [roomId],
    );
    if (!game) throw new CardBattleRankingRuleError("战斗尚未结束");
    const result = typeof game.result_json === "string" ? JSON.parse(game.result_json) : game.result_json;
    const playerInputs = parsePlayerInputs(game.lineup_snapshot_json);
    const challengerPlayer = playerInputs.find((player) => player.userId === userId);
    if (!challengerPlayer || Number(result?.winnerSeat ?? 0) !== challengerPlayer.seat) {
      throw new CardBattleRankingRuleError("只有本局挑战胜利后才能确认上榜");
    }
    const [[progress]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT completed_sequence FROM online_card_battle_playback_progress WHERE game_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
      [game.id, userId],
    );
    if (!progress || Number(progress.completed_sequence ?? 0) < Number(result?.events?.length ?? 0)) {
      throw new CardBattleRankingRuleError("请先完整播放本局战斗动画");
    }
    const [lockedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM card_battle_ranking_entries ORDER BY rank_position FOR UPDATE",
    );
    const target = lockedRows.find((row) => Number(row.rank_position) === Number(challenge.target_rank));
    if (!target || String(target.user_id) !== String(challenge.defender_id)) {
      await connection.query("UPDATE card_battle_ranking_challenges SET status = 'stale' WHERE id = ?", [challenge.id]);
      await connection.query("UPDATE online_soup_members SET is_active = 0, left_at = NOW() WHERE room_id = ?", [roomId]);
      await connection.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW(), host_grace_started_at = NULL WHERE id = ?", [roomId]);
      await connection.commit();
      committed = true;
      throw new CardBattleRankingRuleError("该排名已被其他挑战结果改变，本局不更新榜单，请退出后重新挑战", "RANK_CHANGED");
    }
    const lineup = challengerPlayer.cards.slice().sort((left, right) => left.slot - right.slot).map((card) => card.cardId);
    const totalPower = challengerPlayer.cards.reduce((sum, card) => sum + calculateCardBattlePower({
      maxHp: card.tier.maxHp, attack: card.tier.attack, defense: card.tier.defense,
      speed: card.tier.speed, energyRequired: card.tier.energyRequired,
    }), 0);
    const entries: RankingEntry[] = lockedRows.map((row) => ({
      rank: Number(row.rank_position), userId: String(row.user_id), lineup: parseCardIds(row.lineup_json),
      totalPower: Number(row.total_power ?? 0), achievedAt: new Date(row.achieved_at),
    }));
    const next = promoteCardBattleRankingEntries(entries, {
      rank: Number(challenge.target_rank), userId, lineup, totalPower, achievedAt: new Date(),
    }, Number(challenge.target_rank));
    await connection.query("DELETE FROM card_battle_ranking_entries");
    if (next.length) {
      await connection.query(
        `INSERT INTO card_battle_ranking_entries
          (rank_position, user_id, lineup_json, total_power, achieved_at)
         VALUES ${next.map(() => "(?, ?, ?, ?, ?)").join(",")}`,
        next.flatMap((entry) => [entry.rank, entry.userId, JSON.stringify(entry.lineup), entry.totalPower, entry.achievedAt]),
      );
    }
    await connection.query("UPDATE card_battle_ranking_challenges SET status = 'won', confirmed_at = NOW(3) WHERE id = ?", [challenge.id]);
    await connection.query("UPDATE online_soup_members SET is_active = 0, left_at = NOW() WHERE room_id = ?", [roomId]);
    await connection.query("UPDATE online_soup_rooms SET status = 'closed', closed_at = NOW(), host_grace_started_at = NULL WHERE id = ?", [roomId]);
    await connection.commit();
    committed = true;
    return { rank: Number(challenge.target_rank) };
  } catch (error) {
    if (!committed) await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
