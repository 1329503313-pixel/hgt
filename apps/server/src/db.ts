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
      title VARCHAR(200) NOT NULL,
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
  await ensureIndex("soups", "idx_soups_created_at", "created_at");
  await ensureIndex("soups", "idx_soups_type_created", "type, created_at");
  await ensureIndex("evaluations", "idx_evaluations_created_at", "created_at");
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
      PRIMARY KEY (user_id, badge_key),
      INDEX idx_badge_unlocks_user_time (user_id, unlocked_at),
      CONSTRAINT fk_badge_unlock_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureIndex("user_badge_unlocks", "idx_badge_unlocks_badge_user", "badge_key, user_id");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS legendary_badges (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300) NOT NULL,
      requirement VARCHAR(300) NULL,
      icon_url VARCHAR(255) NOT NULL,
      achievement_points INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureColumn("legendary_badges", "achievement_points", "achievement_points INT NOT NULL DEFAULT 0 AFTER icon_url");
  await seedLegendaryBadges();

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

async function seedLegendaryBadges() {
  await pool.query(
    `INSERT INTO legendary_badges (id, name, description, requirement, icon_url, achievement_points)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), description = VALUES(description), requirement = VALUES(requirement), icon_url = VALUES(icon_url), achievement_points = VALUES(achievement_points)`,
    ["founder-turtle", "创始神龟", "海龟汤应用创始者之一", null, "/badges/founder-turtle-legend.png", 300]
  );
}
