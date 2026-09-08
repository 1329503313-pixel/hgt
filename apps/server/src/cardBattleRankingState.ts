import mysql from "mysql2/promise";
import { pool } from "./db.js";

/** Preserve relative order while filling every gap, including gaps before first place. */
export function compactCardBattleRankingEntries<T extends { rank: number }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.rank - b.rank).slice(0, 100).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** Ranking room mutations take this lock before their room/game/seat locks. */
export async function lockCardBattleRanking(connection: mysql.PoolConnection) {
  const [[lock]] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM card_battle_ranking_lock WHERE id = 1 FOR UPDATE");
  if (!lock) throw new Error("Card battle ranking lock is not initialized");
}

export async function lockRankingForCardBattleRoom(roomId: string, connection: mysql.PoolConnection) {
  const [[room]] = await connection.query<mysql.RowDataPacket[]>("SELECT room_scope FROM online_soup_rooms WHERE id = ?", [roomId]);
  if (room?.room_scope === "ranking_challenge") await lockCardBattleRanking(connection);
}

/** All ranking writers take this row lock, including when the board is empty. */
export async function lockAndCompactCardBattleRanking(connection: mysql.PoolConnection) {
  await lockCardBattleRanking(connection);
  const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM card_battle_ranking_entries ORDER BY rank_position FOR UPDATE");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rank = index + 1;
    if (Number(row.rank_position) === rank) continue;
    await connection.query("UPDATE card_battle_ranking_entries SET rank_position = ?, updated_at = updated_at WHERE user_id = ?", [rank, row.user_id]);
    row.rank_position = rank;
  }
  return rows;
}

export async function reconcileCardBattleRanking() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockAndCompactCardBattleRanking(connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
