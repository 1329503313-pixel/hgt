import type mysql from "mysql2/promise";

export async function initCardTowerSchema(db: mysql.Pool) {
  await db.query(`CREATE TABLE IF NOT EXISTS card_tower_admin_lock (id TINYINT PRIMARY KEY) ENGINE=InnoDB`);
  await db.query("INSERT IGNORE INTO card_tower_admin_lock VALUES (1)");
  await db.query(`CREATE TABLE IF NOT EXISTS card_tower_floors (
    id VARCHAR(64) PRIMARY KEY, floor_number INT UNSIGNED NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT 0, reward_shells INT UNSIGNED NOT NULL DEFAULT 0,
    cards_json JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
    created_by VARCHAR(64) NOT NULL, updated_by VARCHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS card_tower_profiles (
    user_id VARCHAR(64) PRIMARY KEY, formations_json JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
    current_room_id VARCHAR(64) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS card_tower_rooms (
    id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, name VARCHAR(50) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), closed_at DATETIME(3) NULL,
    INDEX idx_tower_room_user (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS card_tower_games (
    id VARCHAR(64) PRIMARY KEY, room_id VARCHAR(64) NOT NULL, user_id VARCHAR(64) NOT NULL,
    floor_id VARCHAR(64) NOT NULL, floor_number INT UNSIGNED NOT NULL,
    reward_shells INT UNSIGNED NOT NULL, total_power BIGINT NOT NULL, lineup_json JSON NOT NULL, result_json JSON NOT NULL,
    status ENUM('playing','ended','aborted') NOT NULL DEFAULT 'playing',
    started_at DATETIME(3) NOT NULL, playback_ends_at DATETIME(3) NOT NULL, ended_at DATETIME(3) NULL,
    INDEX idx_tower_due (status, playback_ends_at), INDEX idx_tower_game_room (room_id, started_at), INDEX idx_tower_game_user (user_id, status),
    FOREIGN KEY (room_id) REFERENCES card_tower_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (floor_id) REFERENCES card_tower_floors(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS card_tower_clears (
    user_id VARCHAR(64) NOT NULL, floor_id VARCHAR(64) NOT NULL, floor_number INT UNSIGNED NOT NULL,
    game_id VARCHAR(64) NOT NULL UNIQUE, total_power BIGINT NOT NULL, reward_shells INT UNSIGNED NOT NULL,
    cleared_at DATETIME(3) NOT NULL, PRIMARY KEY (user_id, floor_id), UNIQUE KEY uq_tower_user_floor (user_id, floor_number),
    INDEX idx_tower_clear_floor (floor_id, cleared_at), INDEX idx_tower_ranking (floor_number, cleared_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (floor_id) REFERENCES card_tower_floors(id), FOREIGN KEY (game_id) REFERENCES card_tower_games(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
