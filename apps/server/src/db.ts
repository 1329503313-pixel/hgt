import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool({
  ...config.db,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  timezone: "Z",
  ssl: config.db.host !== "127.0.0.1" && config.db.host !== "localhost" ? { rejectUnauthorized: false } : undefined
});

export const db = drizzle(pool);

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password VARCHAR(128) NOT NULL,
      nickname VARCHAR(50) NOT NULL,
      role ENUM('admin','user') NOT NULL DEFAULT 'user',
      token_version INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS soups (
      id VARCHAR(64) PRIMARY KEY,
      title LONGTEXT NOT NULL,
      author VARCHAR(100) NOT NULL,
      type VARCHAR(20) NOT NULL,
      summary VARCHAR(40) NOT NULL DEFAULT '',
      cover_image LONGTEXT NULL,
      is_original BOOLEAN NOT NULL DEFAULT TRUE,
      surface TEXT NOT NULL,
      supplemental_surfaces JSON NULL,
      bottom TEXT NOT NULL,
      supplemental_bottoms JSON NULL,
      host_manual TEXT NULL,
      is_surface_public BOOLEAN NOT NULL DEFAULT TRUE,
      is_bottom_public BOOLEAN NOT NULL DEFAULT FALSE,
      enable_ai_game BOOLEAN NOT NULL DEFAULT FALSE,
      review_status ENUM('approved','pending','rejected') NOT NULL DEFAULT 'approved',
      review_reason VARCHAR(500) NULL,
      review_version INT NOT NULL DEFAULT 1,
      reviewed_at DATETIME NULL,
      reviewed_by VARCHAR(64) NULL,
      view_count INT NOT NULL DEFAULT 0,
      creator_id VARCHAR(64) NOT NULL,
      creator_name VARCHAR(50) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_soups_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id VARCHAR(64) PRIMARY KEY,
      soup_id VARCHAR(64) NOT NULL,
      total DECIMAL(3,1) NOT NULL,
      reviewer VARCHAR(50) NOT NULL,
      reviewer_id VARCHAR(64) NOT NULL,
      writing DECIMAL(3,1) NULL,
      logic DECIMAL(3,1) NULL,
      share DECIMAL(3,1) NULL,
      mechanism DECIMAL(3,1) NULL,
      twist DECIMAL(3,1) NULL,
      depth DECIMAL(3,1) NULL,
      content TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_evaluation_user_soup (soup_id, reviewer_id),
      CONSTRAINT fk_eval_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
      CONSTRAINT fk_eval_user FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS view_requests (
      id VARCHAR(64) PRIMARY KEY,
      soup_id VARCHAR(64) NOT NULL,
      requester_id VARCHAR(64) NOT NULL,
      requester_name VARCHAR(50) NOT NULL,
      owner_id VARCHAR(64) NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handled_at DATETIME NULL,
      handled_by VARCHAR(64) NULL,
      INDEX idx_requests_owner_status (owner_id, status),
      INDEX idx_requests_soup_user_status (soup_id, requester_id, status),
      CONSTRAINT fk_request_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
      CONSTRAINT fk_request_user FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_request_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS soup_access_grants (
      id VARCHAR(64) PRIMARY KEY,
      soup_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      granted_by VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_grant_soup_user (soup_id, user_id),
      CONSTRAINT fk_grant_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
      CONSTRAINT fk_grant_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS soup_favorites (
      id VARCHAR(64) PRIMARY KEY,
      soup_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_favorite_soup_user (soup_id, user_id),
      INDEX idx_favorites_user_time (user_id, created_at),
      CONSTRAINT fk_favorite_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
      CONSTRAINT fk_favorite_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS soup_likes (
      id VARCHAR(64) PRIMARY KEY,
      soup_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_like_soup_user (soup_id, user_id),
      INDEX idx_likes_user_time (user_id, created_at),
      CONSTRAINT fk_like_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
      CONSTRAINT fk_like_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(120) NOT NULL,
      content VARCHAR(500) NOT NULL,
      related_id VARCHAR(64) NULL,
      actor_id VARCHAR(64) NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notifications_user_read (user_id, is_read),
      UNIQUE KEY uq_notification_actor_event (user_id, type, related_id, actor_id),
      CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query("ALTER TABLE soups MODIFY COLUMN title LONGTEXT NOT NULL");
  await ensureColumn("soups", "summary", "summary VARCHAR(40) NOT NULL DEFAULT '' AFTER type");
  await pool.query("ALTER TABLE soups MODIFY COLUMN summary VARCHAR(40) NOT NULL DEFAULT ''");
  await ensureColumn("soups", "cover_image", "cover_image LONGTEXT NULL AFTER summary");
  await ensureColumn("soups", "is_original", "is_original BOOLEAN NOT NULL DEFAULT TRUE AFTER cover_image");
  await ensureColumn("soups", "supplemental_surfaces", "supplemental_surfaces JSON NULL AFTER surface");
  await ensureColumn("soups", "supplemental_bottoms", "supplemental_bottoms JSON NULL AFTER bottom");
  await ensureColumn("soups", "view_count", "view_count INT NOT NULL DEFAULT 0 AFTER is_bottom_public");
  await ensureColumn("soups", "enable_ai_game", "enable_ai_game BOOLEAN NOT NULL DEFAULT FALSE AFTER is_bottom_public");
  await ensureColumn("soups", "is_sensitive", "is_sensitive BOOLEAN NOT NULL DEFAULT FALSE AFTER is_original");
  await ensureColumn("evaluations", "content", "content TEXT NULL AFTER depth");
  await ensureColumn("users", "avatar", "avatar LONGTEXT NULL AFTER nickname");
  await ensureColumn("users", "badges_initialized", "badges_initialized TINYINT(1) NOT NULL DEFAULT 0 AFTER avatar");
  await ensureColumn("users", "equipped_badge_key", "equipped_badge_key VARCHAR(128) NULL AFTER badges_initialized");
  await ensureColumn("users", "equipped_badge_icon_url", "equipped_badge_icon_url VARCHAR(255) NULL AFTER equipped_badge_key");
  await ensureColumn("users", "last_login_at", "last_login_at DATETIME NULL AFTER badges_initialized");
  await ensureColumn("users", "token_version", "token_version INT NOT NULL DEFAULT 0 AFTER role");
  await ensureColumn("notifications", "actor_id", "actor_id VARCHAR(64) NULL AFTER related_id");
  await ensureIndex("notifications", "uq_notification_actor_event", "user_id, type, related_id, actor_id", true);
  await ensureColumn("soups", "cover_thumbnail", "cover_thumbnail LONGTEXT NULL AFTER cover_image");
  await ensureIndex("users", "idx_users_created_at", "created_at");
  await ensureIndex("users", "idx_users_nickname", "nickname");
  await ensureIndex("soups", "idx_soups_created_at", "created_at");
  await ensureIndex("soups", "idx_soups_type_created", "type, created_at");
  await ensureIndex("evaluations", "idx_evaluations_created_at", "created_at");
  await ensureIndex("evaluations", "idx_evaluations_reviewer", "reviewer_id");
  await migrateCoverThumbnails();
  await migrateSoupViewsColumn();

  // AI 游戏存档表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id VARCHAR(64) PRIMARY KEY,
      soup_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      messages JSON NOT NULL,
      revealed_keys JSON NOT NULL,
      revealed_supplements JSON NULL,
      content_hash VARCHAR(64) NULL,
      progress INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_game_user_soup (soup_id, user_id),
      CONSTRAINT fk_game_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
      CONSTRAINT fk_game_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 多人在线玩汤（与 AI 玩汤会话完全独立）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_soup_rooms (
      id VARCHAR(64) PRIMARY KEY,
      room_code CHAR(6) NOT NULL UNIQUE,
      name VARCHAR(50) NOT NULL,
      host_id VARCHAR(64) NOT NULL,
      room_type ENUM('public','password') NOT NULL DEFAULT 'public',
      password_hash VARCHAR(128) NULL,
      status ENUM('preparing','playing','ended','closed') NOT NULL DEFAULT 'preparing',
      current_soup_id VARCHAR(64) NULL,
      current_round_id VARCHAR(64) NULL,
      host_last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      closed_at DATETIME NULL,
      INDEX idx_online_rooms_lobby (room_type, status, updated_at),
      CONSTRAINT fk_online_room_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_online_room_soup FOREIGN KEY (current_soup_id) REFERENCES soups(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_soup_rounds (
      id VARCHAR(64) PRIMARY KEY,
      room_id VARCHAR(64) NOT NULL,
      soup_id VARCHAR(64) NOT NULL,
      round_number INT UNSIGNED NOT NULL,
      status ENUM('preparing','playing','ended') NOT NULL DEFAULT 'preparing',
      question_count INT UNSIGNED NOT NULL DEFAULT 0,
      published_surface_indices JSON NULL,
      published_bottom_indices JSON NULL,
      started_at DATETIME NULL,
      ended_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_online_room_round_number (room_id, round_number),
      INDEX idx_online_round_room_time (room_id, created_at),
      CONSTRAINT fk_online_round_room FOREIGN KEY (room_id) REFERENCES online_soup_rooms(id) ON DELETE CASCADE,
      CONSTRAINT fk_online_round_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_soup_members (
      room_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      member_role ENUM('host','player','spectator') NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      left_at DATETIME NULL,
      PRIMARY KEY (room_id, user_id),
      INDEX idx_online_members_room_active (room_id, is_active, member_role),
      CONSTRAINT fk_online_member_room FOREIGN KEY (room_id) REFERENCES online_soup_rooms(id) ON DELETE CASCADE,
      CONSTRAINT fk_online_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_soup_messages (
      id VARCHAR(64) PRIMARY KEY,
      message_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      room_id VARCHAR(64) NOT NULL,
      round_id VARCHAR(64) NULL,
      sender_id VARCHAR(64) NULL,
      message_type ENUM('discussion','question','host','sticker','clue','supplemental_surface','bottom','manual','system') NOT NULL,
      content TEXT NOT NULL,
      sticker_id VARCHAR(64) NULL,
      content_index INT UNSIGNED NULL,
      question_number INT UNSIGNED NULL,
      answer ENUM('yes','no','both','unknown','irrelevant') NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_online_message_sequence (message_sequence),
      INDEX idx_online_messages_room_time (room_id, created_at, id),
      CONSTRAINT fk_online_message_room FOREIGN KEY (room_id) REFERENCES online_soup_rooms(id) ON DELETE CASCADE,
      CONSTRAINT fk_online_message_round FOREIGN KEY (round_id) REFERENCES online_soup_rounds(id) ON DELETE SET NULL,
      CONSTRAINT fk_online_message_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn(
    "online_soup_rounds",
    "published_surface_indices",
    "published_surface_indices JSON NULL AFTER question_count"
  );
  await ensureColumn(
    "online_soup_rounds",
    "published_bottom_indices",
    "published_bottom_indices JSON NULL AFTER published_surface_indices"
  );
  await ensureColumn(
    "online_soup_messages",
    "message_sequence",
    "message_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE AFTER id"
  );
  await ensureColumn(
    "online_soup_messages",
    "content_index",
    "content_index INT UNSIGNED NULL AFTER content"
  );
  await ensureColumn(
    "online_soup_messages",
    "sticker_id",
    "sticker_id VARCHAR(64) NULL AFTER content"
  );
  await ensureIndex(
    "online_soup_messages",
    "idx_online_messages_room_sequence",
    "room_id, message_sequence"
  );
  await ensureIndex(
    "online_soup_messages",
    "idx_online_messages_round_type_sequence",
    "round_id, message_type, message_sequence"
  );
  await ensureIndex(
    "online_soup_members",
    "idx_online_members_presence",
    "is_active, last_seen_at"
  );
  await ensureIndex(
    "online_soup_rooms",
    "idx_online_rooms_status_updated",
    "status, updated_at"
  );
  const [[onlineSoupMessageType]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'online_soup_messages' AND COLUMN_NAME = 'message_type'`
  );
  if (!String(onlineSoupMessageType?.COLUMN_TYPE ?? "").includes("'sticker'")) {
    await pool.query(
      "ALTER TABLE online_soup_messages MODIFY COLUMN message_type ENUM('discussion','question','host','sticker','clue','supplemental_surface','bottom','manual','system') NOT NULL"
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_notices (
      id VARCHAR(64) PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      author VARCHAR(100) NOT NULL,
      content LONGTEXT NOT NULL,
      created_by VARCHAR(64) NULL,
      valid_duration_minutes INT UNSIGNED NOT NULL DEFAULT 10080,
      expires_at DATETIME NULL,
      published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_admin_notices_published (published_at),
      CONSTRAINT fk_admin_notice_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_notice_reads (
      notice_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notice_id, user_id),
      INDEX idx_admin_notice_reads_time (notice_id, read_at),
      CONSTRAINT fk_admin_notice_read_notice FOREIGN KEY (notice_id) REFERENCES admin_notices(id) ON DELETE CASCADE,
      CONSTRAINT fk_admin_notice_read_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn(
    "admin_notices",
    "valid_duration_minutes",
    "valid_duration_minutes INT UNSIGNED NOT NULL DEFAULT 10080 AFTER created_by"
  );
  await ensureColumn("admin_notices", "expires_at", "expires_at DATETIME NULL AFTER valid_duration_minutes");
  await pool.query(
    "UPDATE admin_notices SET expires_at = DATE_ADD(published_at, INTERVAL valid_duration_minutes MINUTE) WHERE expires_at IS NULL"
  );
  await ensureIndex("admin_notices", "idx_admin_notices_expires", "expires_at");
  await ensureAdminNoticeCreatorConstraint();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS excellent_author_applications (
      id VARCHAR(64) PRIMARY KEY,
      applicant_id VARCHAR(64) NOT NULL,
      applicant_name VARCHAR(50) NOT NULL,
      primary_soup_id VARCHAR(64) NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handled_at DATETIME NULL,
      handled_by VARCHAR(64) NULL,
      INDEX idx_excellent_author_status_time (status, created_at),
      INDEX idx_excellent_author_applicant_time (applicant_id, created_at),
      CONSTRAINT fk_excellent_author_applicant FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_excellent_author_primary_soup FOREIGN KEY (primary_soup_id) REFERENCES soups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS excellent_author_application_soups (
      application_id VARCHAR(64) NOT NULL,
      soup_id VARCHAR(64) NOT NULL,
      sort_order TINYINT UNSIGNED NOT NULL,
      PRIMARY KEY (application_id, soup_id),
      UNIQUE KEY uq_excellent_author_application_order (application_id, sort_order),
      CONSTRAINT fk_excellent_author_application FOREIGN KEY (application_id) REFERENCES excellent_author_applications(id) ON DELETE CASCADE,
      CONSTRAINT fk_excellent_author_qualification_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS soup_publish_daily_usage (
      user_id VARCHAR(64) NOT NULL,
      usage_date DATE NOT NULL,
      published_count INT NOT NULL DEFAULT 0,
      auto_reject_count INT NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, usage_date),
      CONSTRAINT fk_soup_publish_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // AI 请求共享配额：所有服务实例共用每分钟和每日计数
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_game_usage (
      user_id VARCHAR(64) PRIMARY KEY,
      minute_window_start DATETIME NOT NULL,
      minute_request_count INT NOT NULL DEFAULT 0,
      daily_date DATE NOT NULL,
      daily_request_count INT NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_ai_game_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // AI 玩汤关键点命中历史：同一用户、同一汤、同一关键点永久只计一次
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_key_hits (
      user_id VARCHAR(64) NOT NULL,
      soup_id VARCHAR(64) NOT NULL,
      key_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, soup_id, key_id),
      INDEX idx_game_key_hits_user (user_id),
      CONSTRAINT fk_game_key_hit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_game_key_hit_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 累计登录天数：按北京时间自然日去重
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_login_days (
      user_id VARCHAR(64) NOT NULL,
      login_date DATE NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, login_date),
      CONSTRAINT fk_login_day_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureIndex("user_login_days", "idx_login_days_date_user", "login_date, user_id");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_badge_unlocks (
      user_id VARCHAR(64) NOT NULL,
      badge_key VARCHAR(64) NOT NULL,
      unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      surfaced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, badge_key),
      INDEX idx_badge_unlocks_user_time (user_id, unlocked_at),
      CONSTRAINT fk_badge_unlock_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn(
    "user_badge_unlocks",
    "surfaced_at",
    "surfaced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP AFTER unlocked_at"
  );
  await ensureIndex("user_badge_unlocks", "idx_badge_unlocks_badge_user", "badge_key, user_id");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS legendary_badges (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300) NOT NULL,
      requirement VARCHAR(300) NULL,
      icon_url VARCHAR(255) NOT NULL,
      achievement_points INT NOT NULL DEFAULT 0,
      badge_type ENUM('achievement','activity','limited') NOT NULL DEFAULT 'achievement',
      tier ENUM('epic','legend') NOT NULL DEFAULT 'legend',
      activity_conditions JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn("legendary_badges", "achievement_points", "achievement_points INT NOT NULL DEFAULT 0 AFTER icon_url");
  await ensureColumn("legendary_badges", "badge_type", "badge_type ENUM('achievement','activity','limited') NOT NULL DEFAULT 'achievement' AFTER achievement_points");
  await ensureColumn("legendary_badges", "tier", "tier ENUM('epic','legend') NOT NULL DEFAULT 'legend' AFTER badge_type");
  await ensureColumn("legendary_badges", "activity_conditions", "activity_conditions JSON NULL AFTER tier");
  await seedLegendaryBadges();
  await pool.query(`
    INSERT IGNORE INTO user_badge_unlocks (user_id, badge_key, unlocked_at, surfaced_at)
    SELECT user_id, 'excellentAuthor:epic', unlocked_at, surfaced_at
    FROM user_badge_unlocks
    WHERE badge_key = 'legendary:excellent-author'
  `);
  await pool.query(
    "UPDATE users SET equipped_badge_key = 'excellentAuthor:epic', equipped_badge_icon_url = '/badges/excellent-author.webp' WHERE equipped_badge_key = 'legendary:excellent-author'"
  );
  await pool.query("DELETE FROM user_badge_unlocks WHERE badge_key = 'legendary:excellent-author'");
  await pool.query("DELETE FROM legendary_badges WHERE id = 'excellent-author'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS soup_like_history (
      soup_id VARCHAR(64) NOT NULL,
      actor_id VARCHAR(64) NOT NULL,
      creator_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (soup_id, actor_id),
      INDEX idx_like_history_creator (creator_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS soup_favorite_history (
      soup_id VARCHAR(64) NOT NULL,
      actor_id VARCHAR(64) NOT NULL,
      creator_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (soup_id, actor_id),
      INDEX idx_favorite_history_creator (creator_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS evaluation_comment_history (
      soup_id VARCHAR(64) NOT NULL,
      reviewer_id VARCHAR(64) NOT NULL,
      creator_id VARCHAR(64) NOT NULL,
      is_original BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (soup_id, reviewer_id),
      INDEX idx_comment_history_creator (creator_id),
      INDEX idx_comment_history_reviewer (reviewer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn(
    "evaluation_comment_history",
    "is_original",
    "is_original BOOLEAN NOT NULL DEFAULT TRUE AFTER creator_id"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_follows (
      follower_id VARCHAR(64) NOT NULL,
      following_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, following_id),
      INDEX idx_user_follows_following_time (following_id, created_at),
      INDEX idx_user_follows_follower_time (follower_id, created_at),
      CONSTRAINT fk_user_follow_follower FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_follow_following FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(64) PRIMARY KEY,
      user_a_id VARCHAR(64) NOT NULL,
      user_b_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_conversation_users (user_a_id, user_b_id),
      INDEX idx_conversations_user_a_time (user_a_id, last_message_at),
      INDEX idx_conversations_user_b_time (user_b_id, last_message_at),
      CONSTRAINT fk_conversation_user_a FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_conversation_user_b FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id VARCHAR(64) PRIMARY KEY,
      conversation_id VARCHAR(64) NOT NULL,
      sender_id VARCHAR(64) NOT NULL,
      content VARCHAR(1000) NOT NULL,
      message_type VARCHAR(16) NOT NULL DEFAULT 'text',
      sticker_id VARCHAR(64) NULL,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_private_messages_conversation_time (conversation_id, created_at),
      INDEX idx_private_messages_unread (conversation_id, sender_id, read_at),
      CONSTRAINT fk_private_message_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      CONSTRAINT fk_private_message_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn("private_messages", "message_type", "message_type VARCHAR(16) NOT NULL DEFAULT 'text' AFTER content");
  await ensureColumn("private_messages", "sticker_id", "sticker_id VARCHAR(64) NULL AFTER message_type");
  await ensureIndex("private_messages", "idx_private_messages_conversation_cursor", "conversation_id, created_at, id");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS circles (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      avatar LONGTEXT NULL,
      created_by VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_circles_updated (updated_at),
      CONSTRAINT fk_circle_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS circle_members (
      circle_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_read_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (circle_id, user_id),
      INDEX idx_circle_members_user_time (user_id, joined_at),
      CONSTRAINT fk_circle_member_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
      CONSTRAINT fk_circle_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn("circle_members", "last_read_sequence", "last_read_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER joined_at");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS circle_messages (
      id VARCHAR(64) PRIMARY KEY,
      message_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      circle_id VARCHAR(64) NOT NULL,
      sender_id VARCHAR(64) NULL,
      content VARCHAR(1000) NOT NULL DEFAULT '',
      message_type ENUM('text','sticker','room_invite') NOT NULL DEFAULT 'text',
      sticker_id VARCHAR(64) NULL,
      mentions_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_circle_message_sequence (message_sequence),
      INDEX idx_circle_messages_circle_sequence (circle_id, message_sequence),
      CONSTRAINT fk_circle_message_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
      CONSTRAINT fk_circle_message_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  const [[circleMessageType]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'circle_messages' AND COLUMN_NAME = 'message_type'`
  );
  if (!String(circleMessageType?.COLUMN_TYPE ?? "").includes("'room_invite'")) {
    await pool.query(
      "ALTER TABLE circle_messages MODIFY COLUMN message_type ENUM('text','sticker','room_invite') NOT NULL DEFAULT 'text'"
    );
  }
  await ensureColumn("circle_messages", "mentions_json", "mentions_json JSON NULL AFTER sticker_id");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS circle_message_mentions (
      message_id VARCHAR(64) NOT NULL,
      circle_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id),
      INDEX idx_circle_mentions_user_unread (user_id, circle_id, read_at),
      CONSTRAINT fk_circle_mention_message FOREIGN KEY (message_id) REFERENCES circle_messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_circle_mention_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
      CONSTRAINT fk_circle_mention_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_completions (
      session_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      soup_id VARCHAR(64) NOT NULL,
      completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id),
      INDEX idx_game_completions_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 将当前有效数据补录为历史基线
  await pool.query(`
    INSERT IGNORE INTO soup_like_history (soup_id, actor_id, creator_id, created_at)
    SELECT likes.soup_id, likes.user_id, soups.creator_id, likes.created_at
    FROM soup_likes AS likes
    JOIN soups ON soups.id = likes.soup_id
    WHERE soups.is_original = TRUE
  `);
  await pool.query(`
    INSERT IGNORE INTO soup_favorite_history (soup_id, actor_id, creator_id, created_at)
    SELECT favorites.soup_id, favorites.user_id, soups.creator_id, favorites.created_at
    FROM soup_favorites AS favorites
    JOIN soups ON soups.id = favorites.soup_id
    WHERE soups.is_original = TRUE
  `);
  await pool.query(`
    INSERT IGNORE INTO evaluation_comment_history (soup_id, reviewer_id, creator_id, is_original, created_at)
    SELECT evaluations.soup_id, evaluations.reviewer_id, soups.creator_id, soups.is_original, evaluations.created_at
    FROM evaluations
    JOIN soups ON soups.id = evaluations.soup_id
    WHERE evaluations.content IS NOT NULL
      AND TRIM(evaluations.content) <> ''
  `);
  await pool.query(`
    INSERT IGNORE INTO game_completions (session_id, user_id, soup_id, completed_at)
    SELECT id, user_id, soup_id, updated_at
    FROM game_sessions
    WHERE progress = 100
  `);

  // 将现有游戏存档中的关键点补录到永久命中历史
  await pool.query(`
    INSERT IGNORE INTO game_key_hits (user_id, soup_id, key_id)
    SELECT gs.user_id, gs.soup_id, hit.key_id
    FROM game_sessions gs
    JOIN JSON_TABLE(
      gs.revealed_keys,
      '$[*]' COLUMNS (key_id INT PATH '$')
    ) AS hit
    WHERE hit.key_id IS NOT NULL
  `);
  await ensureColumn("game_sessions", "revealed_supplements", "revealed_supplements JSON NULL AFTER revealed_keys");
  await ensureColumn("game_sessions", "content_hash", "content_hash VARCHAR(64) NULL AFTER revealed_supplements");
  await ensureColumn("soups", "key_facts", "key_facts JSON NULL AFTER enable_ai_game");
  await ensureColumn("soups", "key_facts_hash", "key_facts_hash VARCHAR(64) NULL AFTER key_facts");
  await ensureColumn("soups", "key_facts_customized", "key_facts_customized TINYINT(1) NOT NULL DEFAULT 0 AFTER key_facts_hash");
  await ensureColumn("soups", "ai_prompt", "ai_prompt TEXT NULL AFTER enable_ai_game");
  await ensureColumn("soups", "review_status", "review_status ENUM('approved','pending','rejected') NOT NULL DEFAULT 'approved' AFTER enable_ai_game");
  await ensureColumn("soups", "review_reason", "review_reason VARCHAR(500) NULL AFTER review_status");
  await ensureColumn("soups", "review_version", "review_version INT NOT NULL DEFAULT 1 AFTER review_reason");
  await ensureColumn("soups", "reviewed_at", "reviewed_at DATETIME NULL AFTER review_version");
  await ensureColumn("soups", "reviewed_by", "reviewed_by VARCHAR(64) NULL AFTER reviewed_at");
  await ensureIndex("soups", "idx_soups_review_status_created", "review_status, created_at");

  await seedAdmin();
  await seedDefaultCircles();
}

async function ensureColumn(table: string, column: string, ddl: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [config.db.database, table, column]
  );
  if (rows.length === 0) {
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_FIELDNAME") {
        throw error;
      }
    }
  }
}

async function ensureAdminNoticeCreatorConstraint() {
  await pool.query("ALTER TABLE admin_notices MODIFY COLUMN created_by VARCHAR(64) NULL");
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
     WHERE rc.CONSTRAINT_SCHEMA = ?
       AND rc.TABLE_NAME = 'admin_notices'
       AND rc.CONSTRAINT_NAME = 'fk_admin_notice_creator'
     LIMIT 1`,
    [config.db.database]
  );
  if (rows[0] && String(rows[0].DELETE_RULE).toUpperCase() !== "SET NULL") {
    await pool.query("ALTER TABLE admin_notices DROP FOREIGN KEY fk_admin_notice_creator");
    rows.length = 0;
  }
  if (!rows[0]) {
    await pool.query(
      "ALTER TABLE admin_notices ADD CONSTRAINT fk_admin_notice_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
    );
  }
}

async function ensureIndex(table: string, index: string, columns: string, unique = false) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
    LIMIT 1
    `,
    [config.db.database, table, index]
  );
  if (rows.length === 0) {
    try {
      await pool.query(`ALTER TABLE ${table} ADD ${unique ? "UNIQUE " : ""}INDEX ${index} (${columns})`);
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_KEYNAME") throw error;
    }
  }
}

async function migrateCoverThumbnails() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, cover_image FROM soups WHERE cover_image IS NOT NULL AND cover_image LIKE 'data:%' AND (cover_thumbnail IS NULL OR cover_thumbnail = '')"
  );
  if (rows.length === 0) return;
  console.log(`migrateCoverThumbnails: processing ${rows.length} soups...`);
  const sharp = (await import("sharp")).default;
  for (const row of rows) {
    try {
      const base64 = String(row.cover_image);
      const buf = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const thumb = await sharp(buf).resize(400, undefined, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const thumbBase64 = `data:image/jpeg;base64,${thumb.toString("base64")}`;
      await pool.query("UPDATE soups SET cover_thumbnail = ? WHERE id = ?", [thumbBase64, row.id]);
    } catch (err) {
      console.error(`migrateCoverThumbnails: failed for soup ${row.id}`, (err as Error).message);
    }
  }
  console.log("migrateCoverThumbnails: done");
}

async function migrateSoupViewsColumn() {
  // 注意: 不 DROP TABLE，避免丢失浏览数据。如果表已存在则跳过，用 ensureColumn 补列。
  const [exists] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'soup_views'",
    [config.db.database]
  );
  if (exists.length > 0) return;

  await pool.query(`
    CREATE TABLE soup_views (
      id VARCHAR(64) PRIMARY KEY,
      soup_id VARCHAR(64) NOT NULL,
      user_identifier VARCHAR(191) NOT NULL,
      viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_views_soup_uid_time (soup_id, user_identifier, viewed_at),
      CONSTRAINT fk_view_soup FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function seedAdmin() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    ["admin"]
  );
  if (rows.length > 0) return;

  if (!config.adminDefaultPassword || config.adminDefaultPassword.length < 12 || config.adminDefaultPassword === "change-me") {
    throw new Error("ADMIN_DEFAULT_PASSWORD 未设置、长度不足 12 位或仍为默认值，拒绝创建管理员账号");
  }

  const hash = await bcrypt.hash(config.adminDefaultPassword, 10);
  await pool.query(
    "INSERT INTO users (id, username, password, nickname, role) VALUES (?, ?, ?, ?, ?)",
    ["admin", "admin", hash, "管理员", "admin"]
  );
}

async function seedDefaultCircles() {
  await pool.query(
    `INSERT IGNORE INTO circles (id, name, avatar, created_by)
     VALUES
       ('default-turtle-soup-circle', '一起来玩海龟汤', '/circle-avatars/play-turtle-soup-v1.png', NULL),
       ('classic-turtle-soup-circle', '本格海龟汤专区', '/circle-avatars/classic-mystery-v1.png', NULL),
       ('variant-turtle-soup-circle', '变格海龟汤专区', '/circle-avatars/variant-mystery-v1.png', NULL),
       ('mechanism-turtle-soup-circle', '机制海龟汤专区', '/circle-avatars/mechanism-mystery-v1.png', NULL),
       ('casual-chat-circle', '闲聊灌水区', '/circle-avatars/casual-chat-v1.png', NULL)`
  );

  // 为已经存在、但仍使用旧默认头像或空头像的预设圈子补上新版 PNG。
  // 管理员后续自行上传的头像不会被启动迁移覆盖。
  await pool.query(
    `UPDATE circles
     SET avatar = CASE id
       WHEN 'default-turtle-soup-circle' THEN '/circle-avatars/play-turtle-soup-v1.png'
       WHEN 'classic-turtle-soup-circle' THEN '/circle-avatars/classic-mystery-v1.png'
       WHEN 'variant-turtle-soup-circle' THEN '/circle-avatars/variant-mystery-v1.png'
       WHEN 'mechanism-turtle-soup-circle' THEN '/circle-avatars/mechanism-mystery-v1.png'
       WHEN 'casual-chat-circle' THEN '/circle-avatars/casual-chat-v1.png'
       ELSE avatar
     END,
     updated_at = CURRENT_TIMESTAMP
     WHERE (id = 'default-turtle-soup-circle' AND (avatar IS NULL OR avatar LIKE '/turtle-avatar.png%'))
        OR (id IN ('classic-turtle-soup-circle', 'variant-turtle-soup-circle', 'mechanism-turtle-soup-circle', 'casual-chat-circle') AND avatar IS NULL)`
  );
}

async function seedLegendaryBadges() {
  await pool.query(
    `INSERT INTO legendary_badges (id, name, description, requirement, icon_url, achievement_points, badge_type, tier)
     VALUES (?, ?, ?, ?, ?, ?, 'limited', 'legend')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), description = VALUES(description), requirement = VALUES(requirement), icon_url = VALUES(icon_url),
       achievement_points = VALUES(achievement_points), badge_type = 'limited', tier = 'legend'`,
    ["founder-turtle", "创始神龟", "海龟汤应用创始者之一", null, "/badges/founder-turtle-legend.webp", 300]
  );
  await pool.query(
    `INSERT INTO legendary_badges (id, name, description, requirement, icon_url, achievement_points, badge_type, tier)
     VALUES (?, ?, ?, ?, ?, ?, 'activity', 'epic')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), description = VALUES(description), requirement = VALUES(requirement), icon_url = VALUES(icon_url),
       achievement_points = VALUES(achievement_points), badge_type = 'activity', tier = 'epic'`,
    ["original-shareholder", "原始股东", "我就是原始股东！", "平台初创用户可获得", "/badges/original-shareholder-epic.webp", 150]
  );
  await pool.query(
    `INSERT INTO legendary_badges (id, name, description, requirement, icon_url, achievement_points, badge_type, tier, activity_conditions)
     VALUES (?, ?, ?, ?, ?, ?, 'activity', 'epic', NULL)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), description = VALUES(description), requirement = VALUES(requirement), icon_url = VALUES(icon_url),
       achievement_points = VALUES(achievement_points), badge_type = 'activity', tier = 'epic'`,
    ["perfect-score", "一百分！", "考一百分一直是我的梦想……", "成为平台前一百名注册用户", "/badges/perfect-score-epic.webp", 100]
  );
  await pool.query(
    `INSERT INTO legendary_badges (id, name, description, requirement, icon_url, achievement_points, badge_type, tier)
     VALUES (?, ?, ?, ?, ?, ?, 'limited', 'legend')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), description = VALUES(description), requirement = VALUES(requirement), icon_url = VALUES(icon_url),
       achievement_points = VALUES(achievement_points), badge_type = 'limited', tier = 'legend'`,
    ["crimson-moon-covenant", "绯月契约", "以绯月为契，倾听封存故事的低语", null, "/badges/crimson-moon-covenant-legend.webp", 300]
  );
  await pool.query(
    `INSERT INTO legendary_badges (id, name, description, requirement, icon_url, achievement_points, badge_type, tier)
     VALUES (?, ?, ?, ?, ?, ?, 'limited', 'legend')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), description = VALUES(description), requirement = VALUES(requirement), icon_url = VALUES(icon_url),
       achievement_points = VALUES(achievement_points), badge_type = 'limited', tier = 'legend'`,
    ["permission-turtle-soup", "权限龟汤汤", "权限龟汤汤本龟！", null, "/badges/permission-turtle-soup-legend.webp", 300]
  );
}
