import type mysql from "mysql2/promise";

/** Additive migration; existing duel rooms, cards and game snapshots retain their meaning. */
export async function initCardBattleBossSchema(db: mysql.Pool) {
  const column = async (table: string, name: string, definition: string) => {
    const [[found]] = await db.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, name]);
    if (!found) await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  await column("online_soup_rooms", "card_battle_mode", "ENUM('1v1','boss') NOT NULL DEFAULT '1v1'");
  const [[host]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'online_soup_rooms' AND COLUMN_NAME = 'host_id'");
  if (host?.IS_NULLABLE === "NO") await db.query("ALTER TABLE online_soup_rooms MODIFY COLUMN host_id VARCHAR(64) NULL");
  const [[check]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_online_card_battle_seat'`);
  if (check && !String(check.CHECK_CLAUSE).includes("3")) {
    await db.query("ALTER TABLE online_card_battle_seats DROP CHECK chk_online_card_battle_seat, ADD CONSTRAINT chk_online_card_battle_seat CHECK (seat_number IN (1,2,3))");
  }
  const [[mode]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'online_card_battles' AND COLUMN_NAME = 'mode'");
  if (!String(mode?.COLUMN_TYPE).includes("'boss'")) await db.query("ALTER TABLE online_card_battles MODIFY COLUMN mode ENUM('1v1','boss') NOT NULL DEFAULT '1v1'");
  await column("user_card_battle_decks", "mode", "ENUM('1v1','boss') NOT NULL DEFAULT '1v1'");
  const [[deckIndex]] = await db.query<mysql.RowDataPacket[]>(
    "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_card_battle_decks' AND INDEX_NAME = 'uq_user_card_battle_deck_name'");
  if (deckIndex?.columns_list === "user_id,name") await db.query("ALTER TABLE user_card_battle_decks DROP INDEX uq_user_card_battle_deck_name, ADD UNIQUE KEY uq_user_card_battle_deck_name (user_id, mode, name)");
  await column("online_card_battles", "boss_reward_shells", "INT UNSIGNED NULL");
  await column("online_card_battles", "boss_name_snapshot", "VARCHAR(50) NULL");
  await db.query(`CREATE TABLE IF NOT EXISTS card_battle_boss_covers (
    id CHAR(64) PRIMARY KEY, image MEDIUMBLOB NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS card_battle_bosses (
    room_id VARCHAR(64) PRIMARY KEY, enabled TINYINT(1) NOT NULL DEFAULT 0,
    starts_at DATETIME(3) NOT NULL, ends_at DATETIME(3) NOT NULL,
    reward_shells INT UNSIGNED NOT NULL DEFAULT 0, cards_json JSON NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1, created_by VARCHAR(64) NOT NULL,
    updated_by VARCHAR(64) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_boss_schedule (enabled, starts_at, ends_at),
    CONSTRAINT fk_boss_room FOREIGN KEY (room_id) REFERENCES online_soup_rooms(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS card_battle_boss_participants (
    game_id VARCHAR(64) NOT NULL, user_id VARCHAR(64) NOT NULL,
    player_seat TINYINT UNSIGNED NOT NULL, nickname_snapshot VARCHAR(100) NOT NULL,
    forfeited_at DATETIME(3) NULL, PRIMARY KEY (game_id, user_id),
    CONSTRAINT fk_boss_participant_game FOREIGN KEY (game_id) REFERENCES online_card_battles(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS card_battle_boss_rewards (
    room_id VARCHAR(64) NOT NULL, user_id VARCHAR(64) NOT NULL, game_id VARCHAR(64) NOT NULL,
    amount INT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (room_id, user_id), INDEX idx_boss_reward_game (game_id),
    CONSTRAINT fk_boss_reward_room FOREIGN KEY (room_id) REFERENCES card_battle_bosses(room_id),
    CONSTRAINT fk_boss_reward_game FOREIGN KEY (game_id) REFERENCES online_card_battles(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
