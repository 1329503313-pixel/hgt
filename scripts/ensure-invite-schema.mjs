import mysql from "mysql2/promise";

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: false
});

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_invite_bindings (
      invitee_user_id VARCHAR(64) PRIMARY KEY,
      inviter_user_id VARCHAR(64) NOT NULL,
      invite_code CHAR(5) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_invite_bindings_inviter_created (inviter_user_id, created_at),
      CONSTRAINT fk_user_invite_bindings_invitee
        FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_invite_bindings_inviter
        FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_invite_reward_progress (
      invitee_user_id VARCHAR(64) PRIMARY KEY,
      inviter_user_id VARCHAR(64) NOT NULL,
      email_rewarded_at DATETIME NULL,
      email_shell_reward INT UNSIGNED NOT NULL DEFAULT 0,
      email_experience_reward INT UNSIGNED NOT NULL DEFAULT 0,
      qualifying_shell_earned BIGINT UNSIGNED NOT NULL DEFAULT 0,
      shell_milestones_rewarded BIGINT UNSIGNED NOT NULL DEFAULT 0,
      shell_experience_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
      settled_through DATETIME NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_invite_reward_progress_inviter (inviter_user_id),
      INDEX idx_user_invite_reward_progress_email (email_rewarded_at, invitee_user_id),
      CONSTRAINT fk_user_invite_reward_progress_invitee
        FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_invite_reward_progress_inviter
        FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log("invite_schema=ensured");
} finally {
  await connection.end();
}
