import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { loadCardBattleTiers } from "./cardBattleConfig.js";
import { CARD_BATTLE_LINEUP_SIZE, simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleResult } from "./cardBattle.js";
import { resolveCardBattlePlaybackStates } from "./cardBattlePlayback.js";

export class CardBattleRoomRuleError extends Error {}

export type CardBattlePlaybackState = {
  completedSequence: number;
  totalEvents: number;
  complete: boolean;
  states: CardBattleResult["initialStates"];
  activeEvent: CardBattleResult["events"][number] | null;
  activeEventStartedAt: string | null;
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

function playbackState(result: CardBattleResult, row: mysql.RowDataPacket, status: string): CardBattlePlaybackState {
  const completedSequence = Math.max(0, Math.min(result.events.length, Number(row.completed_sequence ?? 0)));
  const complete = completedSequence >= result.events.length;
  return {
    completedSequence,
    totalEvents: result.events.length,
    complete,
    states: resolveCardBattlePlaybackStates(result, completedSequence, status),
    activeEvent: !complete && status !== "aborted" ? result.events[completedSequence] ?? null : null,
    activeEventStartedAt: !complete && status !== "aborted" ? iso(row.active_started_at) : null,
  };
}

async function ensurePlaybackState(gameId: string, viewerId: string, result: CardBattleResult, status: string) {
  const firstSequence = result.events.length ? 1 : null;
  await pool.query(
    `INSERT IGNORE INTO online_card_battle_playback_progress
      (game_id, user_id, completed_sequence, active_sequence, active_started_at, completed_at)
     VALUES (?, ?, 0, ?, IF(? IS NULL, NULL, NOW(3)), IF(? IS NULL, NOW(3), NULL))`,
    [gameId, viewerId, firstSequence, firstSequence, firstSequence],
  );
  let [[row]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM online_card_battle_playback_progress WHERE game_id = ? AND user_id = ? LIMIT 1",
    [gameId, viewerId],
  );
  if (!row) throw new CardBattleRoomRuleError("战斗动画进度初始化失败");
  const completed = Math.max(0, Math.min(result.events.length, Number(row.completed_sequence ?? 0)));
  if (status !== "aborted" && completed < result.events.length && Number(row.active_sequence ?? 0) !== completed + 1) {
    await pool.query(
      `UPDATE online_card_battle_playback_progress
       SET active_sequence = ?, active_started_at = NOW(3), completed_at = NULL
       WHERE game_id = ? AND user_id = ? AND completed_sequence = ?`,
      [completed + 1, gameId, viewerId, completed],
    );
    [[row]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_card_battle_playback_progress WHERE game_id = ? AND user_id = ? LIMIT 1",
      [gameId, viewerId],
    );
  }
  return playbackState(result, row, status);
}

export async function acknowledgeCardBattleEvent(roomId: string, viewerId: string, sequence: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[game]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_card_battles WHERE room_id = ? ORDER BY game_number DESC LIMIT 1 FOR UPDATE",
      [roomId],
    );
    if (!game) throw new CardBattleRoomRuleError("当前没有可播放的卡牌对战");
    const result = parseResult(game.result_json);
    if (!result) throw new CardBattleRoomRuleError("战斗记录不可用");
    if (String(game.status) === "aborted") throw new CardBattleRoomRuleError("本局已经中止");
    const firstSequence = result.events.length ? 1 : null;
    await connection.query(
      `INSERT IGNORE INTO online_card_battle_playback_progress
        (game_id, user_id, completed_sequence, active_sequence, active_started_at, completed_at)
       VALUES (?, ?, 0, ?, IF(? IS NULL, NULL, NOW(3)), IF(? IS NULL, NOW(3), NULL))`,
      [game.id, viewerId, firstSequence, firstSequence, firstSequence],
    );
    const [[progress]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT progress.*, NOW(3) AS db_now
       FROM online_card_battle_playback_progress progress
       WHERE game_id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
      [game.id, viewerId],
    );
    if (!progress) throw new CardBattleRoomRuleError("战斗动画进度不存在");
    const completed = Math.max(0, Math.min(result.events.length, Number(progress.completed_sequence ?? 0)));
    if (sequence <= completed) {
      await connection.commit();
      return playbackState(result, progress, String(game.status));
    }
    const expectedSequence = completed + 1;
    if (sequence !== expectedSequence || Number(progress.active_sequence ?? 0) !== expectedSequence) {
      throw new CardBattleRoomRuleError("必须按顺序完整播放战斗动画");
    }
    const event = result.events[completed];
    if (!event || !progress.active_started_at) throw new CardBattleRoomRuleError("当前战斗动画不存在");
    const elapsedMs = new Date(progress.db_now).getTime() - new Date(progress.active_started_at).getTime();
    if (elapsedMs + 25 < event.durationMs) throw new CardBattleRoomRuleError("当前战斗动画尚未播放完成");
    const nextSequence = expectedSequence < result.events.length ? expectedSequence + 1 : null;
    await connection.query(
      `UPDATE online_card_battle_playback_progress
       SET completed_sequence = ?, active_sequence = ?,
         active_started_at = IF(? IS NULL, NULL, NOW(3)),
         completed_at = IF(? IS NULL, NOW(3), NULL)
       WHERE game_id = ? AND user_id = ?`,
      [expectedSequence, nextSequence, nextSequence, nextSequence, game.id, viewerId],
    );
    const [[updated]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_card_battle_playback_progress WHERE game_id = ? AND user_id = ? LIMIT 1",
      [game.id, viewerId],
    );
    await connection.commit();
    return playbackState(result, updated, String(game.status));
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function publicFrozenCard(card: CardBattleDeckCard) {
  return {
    id: card.cardId, cardNo: "", name: card.name, rarity: card.rarity, starLevel: card.starLevel,
    imageUrl: card.imageUrl,
    stats: {
      maxHp: card.tier.maxHp, attack: card.tier.attack, defense: card.tier.defense, speed: card.tier.speed,
      energyRequired: card.tier.energyRequired, canAttackRear: card.tier.canAttackRear,
    },
    skillName: card.tier.skillName, skillDescription: card.tier.skillDescription,
  };
}

export function isCardBattleRoom(room: mysql.RowDataPacket) {
  return String(room.content_type ?? "soup") === "card_battle";
}

export async function eligibleCardCount(userId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM user_asset_cards owned
     JOIN asset_cards cards ON cards.id = owned.card_id
     JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
     WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity = 'legend'`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

export async function claimCardBattleSeat(roomId: string, userId: string, db: mysql.PoolConnection) {
  const [[existing]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT seat_number FROM online_card_battle_seats WHERE room_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (existing) return Number(existing.seat_number) as 1 | 2;
  if (await eligibleCardCount(userId, db) < CARD_BATTLE_LINEUP_SIZE) return null;
  const [seats] = await db.query<mysql.RowDataPacket[]>(
    "SELECT seat_number FROM online_card_battle_seats WHERE room_id = ? ORDER BY seat_number FOR UPDATE",
    [roomId],
  );
  const used = new Set(seats.map((seat) => Number(seat.seat_number)));
  const seat = !used.has(1) ? 1 : !used.has(2) ? 2 : null;
  if (!seat) return null;
  await db.query(
    "INSERT INTO online_card_battle_seats (room_id, seat_number, user_id, lineup_json) VALUES (?, ?, ?, JSON_ARRAY())",
    [roomId, seat, userId],
  );
  return seat as 1 | 2;
}

export async function releaseCardBattleSeat(roomId: string, userId: string, db: mysql.PoolConnection) {
  await db.query("DELETE FROM online_card_battle_seats WHERE room_id = ? AND user_id = ?", [roomId, userId]);
}

export async function loadEligibleBattleCards(userId: string, db: mysql.Pool | mysql.PoolConnection = pool) {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT cards.id, cards.card_no, cards.name, cards.rarity, cards.updated_at, owned.star_level,
       tiers.max_hp, tiers.attack_value, tiers.defense_value, tiers.speed_value, tiers.energy_required, tiers.can_attack_rear,
       tiers.skill_name, tiers.skill_description
     FROM user_asset_cards owned
     JOIN asset_cards cards ON cards.id = owned.card_id
     JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
     WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity = 'legend'
     ORDER BY cards.card_no ASC`,
    [userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    cardNo: String(row.card_no),
    name: String(row.name),
    rarity: "legend" as const,
    starLevel: Number(row.star_level),
    imageUrl: `/api/media/assets/cards/${encodeURIComponent(String(row.id))}/thumbnail?v=${new Date(row.updated_at).getTime()}`,
    stats: {
      maxHp: Number(row.max_hp), attack: Number(row.attack_value), defense: Number(row.defense_value), speed: Number(row.speed_value),
      energyRequired: Number(row.energy_required), canAttackRear: Boolean(row.can_attack_rear),
    },
    skillName: String(row.skill_name ?? ""),
    skillDescription: String(row.skill_description ?? ""),
  }));
}

export async function saveCardBattleLineup(roomId: string, userId: string, cardIds: Array<string | null>, db: mysql.PoolConnection) {
  const selectedIds = cardIds.filter((cardId): cardId is string => Boolean(cardId));
  if (cardIds.length > CARD_BATTLE_LINEUP_SIZE || new Set(selectedIds).size !== selectedIds.length) {
    throw new CardBattleRoomRuleError("阵容最多选择五张不同卡牌");
  }
  const [[seat]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT seat_number FROM online_card_battle_seats WHERE room_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (!seat) throw new CardBattleRoomRuleError("你当前不在对战席");
  if (selectedIds.length) {
    const [eligible] = await db.query<mysql.RowDataPacket[]>(
      `SELECT cards.id FROM user_asset_cards owned
       JOIN asset_cards cards ON cards.id = owned.card_id
       JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
       WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity = 'legend'
         AND cards.id IN (${selectedIds.map(() => "?").join(",")})`,
      [userId, ...selectedIds],
    );
    if (eligible.length !== selectedIds.length) throw new CardBattleRoomRuleError("阵容包含未拥有、已停用或不可参战的卡牌");
  }
  await db.query(
    "UPDATE online_card_battle_seats SET lineup_json = ?, is_ready = 0 WHERE room_id = ? AND user_id = ?",
    [JSON.stringify(cardIds), roomId, userId],
  );
}

export async function setCardBattleReady(roomId: string, userId: string, ready: boolean, db: mysql.PoolConnection) {
  const [[seat]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT lineup_json FROM online_card_battle_seats WHERE room_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [roomId, userId],
  );
  if (!seat) throw new CardBattleRoomRuleError("你当前不在对战席");
  const cardIds = parseList(seat.lineup_json);
  const selectedIds = cardIds.filter((cardId): cardId is string => Boolean(cardId));
  if (ready && (cardIds.length !== CARD_BATTLE_LINEUP_SIZE || selectedIds.length !== CARD_BATTLE_LINEUP_SIZE)) throw new CardBattleRoomRuleError("必须选满五张卡牌才能准备");
  if (ready) {
    const [eligible] = await db.query<mysql.RowDataPacket[]>(
      `SELECT cards.id FROM user_asset_cards owned JOIN asset_cards cards ON cards.id = owned.card_id
       JOIN asset_card_battle_tiers tiers ON tiers.card_id = cards.id AND tiers.star_level = owned.star_level
       WHERE owned.user_id = ? AND cards.status = 'active' AND cards.rarity = 'legend'
         AND cards.id IN (${selectedIds.map(() => "?").join(",")})`,
      [userId, ...selectedIds],
    );
    if (eligible.length !== CARD_BATTLE_LINEUP_SIZE) throw new CardBattleRoomRuleError("阵容中有卡牌已停用或不再可用，请重新选择");
  }
  await db.query(
    "UPDATE online_card_battle_seats SET is_ready = ? WHERE room_id = ? AND user_id = ?",
    [ready ? 1 : 0, roomId, userId],
  );
}

async function battleDeckCard(userId: string, seat: 1 | 2, slot: number, cardId: string, db: mysql.PoolConnection): Promise<CardBattleDeckCard> {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT cards.id, cards.name, cards.rarity, cards.updated_at, owned.star_level
     FROM user_asset_cards owned JOIN asset_cards cards ON cards.id = owned.card_id
     WHERE owned.user_id = ? AND cards.id = ? AND cards.status = 'active' AND cards.rarity = 'legend' LIMIT 1`,
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
    name: String(row.name),
    imageUrl: `/api/media/assets/cards/${encodeURIComponent(cardId)}/thumbnail?v=${new Date(row.updated_at).getTime()}`,
    rarity: "legend",
    starLevel,
    slot: slot as 1 | 2 | 3 | 4 | 5,
    tier,
  };
}

export async function startCardBattle(roomId: string, hostId: string, db: mysql.PoolConnection) {
  const [[room]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT * FROM online_soup_rooms WHERE id = ? AND content_type = 'card_battle' AND status <> 'closed' LIMIT 1 FOR UPDATE",
    [roomId],
  );
  if (!room || String(room.host_id) !== hostId) throw new CardBattleRoomRuleError("仅当前房主可以开始游戏");
  if (!['preparing', 'ended'].includes(String(room.status))) throw new CardBattleRoomRuleError("当前对局已经开始");
  const [seatRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT seats.*, users.nickname FROM online_card_battle_seats seats
     JOIN users ON users.id = seats.user_id WHERE seats.room_id = ? ORDER BY seats.seat_number FOR UPDATE`,
    [roomId],
  );
  if (seatRows.length !== 2 || seatRows.some((seat) => !Boolean(seat.is_ready) || parseList(seat.lineup_json).length !== CARD_BATTLE_LINEUP_SIZE)) {
    throw new CardBattleRoomRuleError("双方都进入对战席、选满五张卡牌并准备后才能开始");
  }
  const [[previousGame]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT id, status, result_json FROM online_card_battles WHERE room_id = ? ORDER BY game_number DESC LIMIT 1 FOR UPDATE",
    [roomId],
  );
  if (previousGame && String(previousGame.status) !== "aborted") {
    const previousResult = parseResult(previousGame.result_json);
    if (!previousResult) throw new CardBattleRoomRuleError("上一局战斗记录不可用，暂时不能开始新对局");
    const requiredViewerIds = [...new Set([hostId, ...seatRows.map((seat) => String(seat.user_id))])];
    const [progressRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT user_id, completed_sequence FROM online_card_battle_playback_progress
       WHERE game_id = ? AND user_id IN (${requiredViewerIds.map(() => "?").join(",")}) FOR UPDATE`,
      [previousGame.id, ...requiredViewerIds],
    );
    const progressByUser = new Map(progressRows.map((row) => [String(row.user_id), Number(row.completed_sequence ?? 0)]));
    if (requiredViewerIds.some((userId) => (progressByUser.get(userId) ?? -1) < previousResult.events.length)) {
      throw new CardBattleRoomRuleError("房主和双方对战玩家必须完整播放上一局战斗动画后才能开始新对局");
    }
  }
  const playerInputs: CardBattlePlayerInput[] = [];
  for (const row of seatRows) {
    const seat = Number(row.seat_number) as 1 | 2;
    const cardIds = parseList(row.lineup_json);
    const cards: CardBattleDeckCard[] = [];
    for (let index = 0; index < cardIds.length; index += 1) cards.push(await battleDeckCard(String(row.user_id), seat, index + 1, cardIds[index]!, db));
    playerInputs.push({ userId: String(row.user_id), nickname: String(row.nickname), seat, cards });
  }
  const [[numberRow]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT COALESCE(MAX(game_number), 0) + 1 AS next_number FROM online_card_battles WHERE room_id = ?",
    [roomId],
  );
  const gameId = nanoid();
  const seed = `${roomId}:${numberRow.next_number}:${nanoid()}`;
  const result = simulateCardBattle(playerInputs, seed);
  const startedAt = new Date();
  const playbackEndsAt = new Date(startedAt.getTime() + result.playbackDurationMs);
  await db.query(
    `INSERT INTO online_card_battles
      (id, room_id, game_number, random_seed, lineup_snapshot_json, result_json, playback_ends_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [gameId, roomId, Number(numberRow.next_number), seed, JSON.stringify(playerInputs), JSON.stringify(result), playbackEndsAt, startedAt],
  );
  await db.query(
    `UPDATE online_soup_rooms SET status = 'playing', current_soup_id = NULL, current_round_id = NULL,
       current_mystery_id = NULL, current_mystery_run_id = NULL, last_action_at = NOW() WHERE id = ?`,
    [roomId],
  );
  return { gameId, gameNumber: Number(numberRow.next_number), result, startedAt, playbackEndsAt };
}

export async function finalizeCardBattleIfDue(roomId: string) {
  const [[game]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, playback_ends_at FROM online_card_battles WHERE room_id = ? AND status = 'playing' ORDER BY game_number DESC LIMIT 1",
    [roomId],
  );
  if (!game || new Date(game.playback_ends_at).getTime() > Date.now()) return false;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[locked]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id, playback_ends_at FROM online_card_battles WHERE id = ? AND status = 'playing' FOR UPDATE",
      [game.id],
    );
    if (!locked || new Date(locked.playback_ends_at).getTime() > Date.now()) { await connection.commit(); return false; }
    await connection.query("UPDATE online_card_battles SET status = 'ended', ended_at = NOW(3) WHERE id = ?", [locked.id]);
    await connection.query("UPDATE online_card_battle_seats SET is_ready = 0 WHERE room_id = ?", [roomId]);
    await connection.query("UPDATE online_soup_rooms SET status = 'ended', last_action_at = NOW() WHERE id = ? AND content_type = 'card_battle'", [roomId]);
    await connection.query(
      `DELETE seats FROM online_card_battle_seats seats
       LEFT JOIN online_soup_members members
         ON members.room_id = seats.room_id AND members.user_id = seats.user_id
       WHERE seats.room_id = ?
         AND (members.user_id IS NULL OR members.is_active = 0 OR members.member_role <> 'player')`,
      [roomId],
    );
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}

export async function cardBattleClientState(roomId: string, viewerId: string) {
  await finalizeCardBattleIfDue(roomId);
  const [seatRows, gameRows, roomRows] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT seats.*, users.nickname, users.avatar IS NOT NULL AS has_avatar
       FROM online_card_battle_seats seats JOIN users ON users.id = seats.user_id
       WHERE seats.room_id = ? ORDER BY seats.seat_number`,
      [roomId],
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM online_card_battles WHERE room_id = ? ORDER BY game_number DESC LIMIT 1",
      [roomId],
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      "SELECT status FROM online_soup_rooms WHERE id = ? LIMIT 1",
      [roomId],
    ).then(([rows]) => rows),
  ]);
  const currentGame = gameRows[0] ?? null;
  const result = currentGame ? parseResult(currentGame.result_json) : null;
  const frozenPlayers = currentGame ? parseLineupSnapshot(currentGame.lineup_snapshot_json) : [];
  const gamePublic = Boolean(result && String(currentGame?.status) === "playing");
  const seats = await Promise.all(([1, 2] as const).map(async (seatNumber) => {
    const row = seatRows.find((seat) => Number(seat.seat_number) === seatNumber);
    if (!row) return { seat: seatNumber, user: null, ready: false, lineup: Array.from({ length: 5 }, (_, index) => ({ slot: index + 1, card: null, cardBack: false })) };
    const ids = parseList(row.lineup_json);
    const ownSeat = String(row.user_id) === viewerId;
    const eligible = ownSeat && ids.length ? await loadEligibleBattleCards(String(row.user_id)) : [];
    const cardsById = new Map(eligible.map((card) => [card.id, card]));
    const frozenPlayer = frozenPlayers.find((player) => player.seat === seatNumber) ?? null;
    return {
      seat: seatNumber,
      user: { id: String(row.user_id), nickname: String(row.nickname), avatar: row.has_avatar ? `/api/media/users/${encodeURIComponent(String(row.user_id))}/avatar` : null },
      ready: Boolean(row.is_ready),
      lineup: Array.from({ length: 5 }, (_, index) => {
        const cardId = ids[index];
        const frozen = frozenPlayer?.cards[index];
        const canSee = ownSeat || gamePublic;
        const card = gamePublic && frozen
          ? publicFrozenCard(frozen)
          : cardId && ownSeat ? cardsById.get(cardId) ?? null : null;
        return { slot: index + 1, card: canSee ? card : null, cardBack: Boolean(cardId && !canSee) };
      }),
    };
  }));
  const mySeat = seatRows.find((seat) => String(seat.user_id) === viewerId);
  const eligibleCount = await eligibleCardCount(viewerId);
  const gameStatus = currentGame ? String(currentGame.status) : null;
  const roomStatus = String(roomRows[0]?.status ?? "preparing");
  const phase = roomStatus === "preparing" ? "preparing"
    : roomStatus === "playing" ? "playing"
      : gameStatus === "aborted" ? "aborted"
        : roomStatus === "ended" ? "ended" : "preparing";
  const playback = currentGame && result
    ? await ensurePlaybackState(String(currentGame.id), viewerId, result, gameStatus ?? "ended")
    : null;
  return {
    mode: "1v1" as const,
    phase: phase as "preparing" | "playing" | "ended" | "aborted",
    seats,
    me: { userId: viewerId, seat: mySeat ? Number(mySeat.seat_number) as 1 | 2 : null, eligibleCardCount: eligibleCount },
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
        cards: player.cards.map(publicFrozenCard),
      })),
      settlement: playback!.complete && gameStatus !== "aborted"
        ? { winnerSeat: result.winnerSeat, endReason: result.endReason, rounds: result.rounds, players: result.players }
        : null,
    } : null,
  };
}
