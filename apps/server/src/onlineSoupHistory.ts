import type mysql from "mysql2/promise";

type Database = mysql.Pool | mysql.PoolConnection;

/** A completed round owns the timeline after the previous settlement, through its own settlement. */
export function onlineSoupMessageVisibleSql(alias = "m") {
  return `NOT EXISTS (
    SELECT 1 FROM online_soup_round_history history
    WHERE history.room_id = ${alias}.room_id
      AND ${alias}.message_sequence > history.after_sequence
      AND ${alias}.message_sequence <= history.through_sequence
      AND NOT EXISTS (
        SELECT 1 FROM online_soup_round_viewers viewer
        WHERE viewer.round_id = history.round_id AND viewer.user_id = ?
      )
  )`;
}

export async function canViewOnlineSoupMessage(db: Database, roomId: string, messageId: string, userId: string) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT m.id FROM online_soup_messages m WHERE m.room_id = ? AND m.id = ?
      AND ${onlineSoupMessageVisibleSql()} LIMIT 1`, [roomId, messageId, userId]
  );
  return Boolean(row);
}

/** Called under the room lock, after the start transition or a successful join. */
export async function recordOnlineSoupRoundViewers(db: Database, roomId: string, userId?: string) {
  await db.query(
    `INSERT IGNORE INTO online_soup_round_viewers (round_id, user_id)
     SELECT rounds.id, members.user_id
     FROM online_soup_rooms rooms
     JOIN online_soup_rounds rounds ON rounds.id = rooms.current_round_id AND rounds.status = 'playing'
     JOIN online_soup_members members ON members.room_id = rooms.id AND members.is_active = 1
     WHERE rooms.id = ? AND rooms.content_type = 'soup' AND rooms.status = 'playing'
       ${userId ? "AND members.user_id = ?" : ""}`,
    userId ? [roomId, userId] : [roomId]
  );
}

/** Freeze the inclusive final message sequence in the same transaction as settlement. */
export async function sealOnlineSoupRoundHistory(db: Database, roomId: string, roundId: string) {
  await db.query(
    `INSERT IGNORE INTO online_soup_round_history (round_id, room_id, after_sequence, through_sequence)
     SELECT ?, ?, COALESCE((SELECT MAX(previous.through_sequence)
       FROM online_soup_round_history previous WHERE previous.room_id = ?), 0),
       COALESCE(MAX(messages.message_sequence), 0)
     FROM online_soup_messages messages WHERE messages.room_id = ?`,
    [roundId, roomId, roomId, roomId]
  );
}

export async function canViewOnlineSoupRoundHistory(db: Database, roundId: string | null, userId: string) {
  if (!roundId) return true;
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT rounds.status <> 'ended' OR EXISTS (
       SELECT 1 FROM online_soup_round_viewers viewer WHERE viewer.round_id = rounds.id AND viewer.user_id = ?
     ) AS visible FROM online_soup_rounds rounds WHERE rounds.id = ?`,
    [userId, roundId]
  );
  return Boolean(Number(row?.visible));
}

export async function initOnlineSoupHistorySchema(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS online_soup_round_viewers (
    round_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (round_id, user_id),
    CONSTRAINT fk_online_round_viewer_round FOREIGN KEY (round_id) REFERENCES online_soup_rounds(id) ON DELETE CASCADE,
    CONSTRAINT fk_online_round_viewer_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS online_soup_round_history (
    round_id VARCHAR(64) PRIMARY KEY,
    room_id VARCHAR(64) NOT NULL,
    after_sequence BIGINT UNSIGNED NOT NULL,
    through_sequence BIGINT UNSIGNED NOT NULL,
    INDEX idx_online_round_history_room (room_id, through_sequence),
    CONSTRAINT fk_online_round_history_round FOREIGN KEY (round_id) REFERENCES online_soup_rounds(id) ON DELETE CASCADE,
    CONSTRAINT fk_online_round_history_room FOREIGN KEY (room_id) REFERENCES online_soup_rooms(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

/** One-time conservative recovery: never treat the latest join as proof of all earlier visits. */
export async function backfillOnlineSoupHistory(db: Database) {
  await db.query(`INSERT IGNORE INTO online_soup_round_viewers (round_id, user_id)
    SELECT rounds.id, members.user_id FROM online_soup_rounds rounds
    JOIN online_soup_members members ON members.room_id = rounds.room_id
    WHERE rounds.started_at IS NOT NULL
      AND members.joined_at < COALESCE(rounds.ended_at, NOW())
      AND COALESCE(members.left_at, NOW()) > rounds.started_at`);
  await db.query(`INSERT IGNORE INTO online_soup_round_viewers (round_id, user_id)
    SELECT rounds.id, messages.sender_id FROM online_soup_rounds rounds
    JOIN online_soup_messages messages ON messages.room_id = rounds.room_id
    WHERE rounds.started_at IS NOT NULL AND messages.sender_id IS NOT NULL
      AND messages.created_at >= rounds.started_at
      AND messages.created_at < COALESCE(rounds.ended_at, NOW())`);
  // Honors are the precise legacy boundary. Interrupted rounds have only an end timestamp.
  const [rounds] = await db.query<mysql.RowDataPacket[]>(`SELECT rounds.id, rounds.room_id,
      COALESCE(MAX(CASE WHEN messages.message_type = 'ai_honor' THEN messages.message_sequence END),
        MAX(CASE WHEN messages.created_at <= rounds.ended_at THEN messages.message_sequence END), 0) AS through_sequence
    FROM online_soup_rounds rounds
    LEFT JOIN online_soup_messages messages ON messages.room_id = rounds.room_id AND messages.round_id = rounds.id
    WHERE rounds.status = 'ended' AND rounds.started_at IS NOT NULL AND rounds.ended_at IS NOT NULL
    GROUP BY rounds.id ORDER BY rounds.room_id, rounds.round_number`);
  const previous = new Map<string, string>();
  for (const round of rounds) {
    const roomId = String(round.room_id);
    const after = previous.get(roomId) ?? "0";
    const through = String(round.through_sequence);
    if (BigInt(through) <= BigInt(after)) continue;
    await db.query(`INSERT IGNORE INTO online_soup_round_history (round_id, room_id, after_sequence, through_sequence)
      VALUES (?, ?, ?, ?)`, [round.id, roomId, after, through]);
    previous.set(roomId, through);
  }
}

export async function initOnlineSoupHistory(pool: mysql.Pool) {
  await initOnlineSoupHistorySchema(pool);
  const db = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await db.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('hgt:online-soup-history-v1', 60) AS acquired");
    if (Number(lock?.acquired) !== 1) throw new Error("房间历史记录迁移锁获取失败");
    locked = true;
    await db.beginTransaction();
    const [[done]] = await db.query<mysql.RowDataPacket[]>(
      "SELECT migration_key FROM app_data_migrations WHERE migration_key = 'online-soup-history-v1'"
    );
    if (!done) {
      await backfillOnlineSoupHistory(db);
      await db.query("INSERT INTO app_data_migrations (migration_key) VALUES ('online-soup-history-v1')");
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK('hgt:online-soup-history-v1')");
    db.release();
  }
}
