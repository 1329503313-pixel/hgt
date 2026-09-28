// Isolated schema-only MySQL test. Never reads or updates source user rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";

assert.ok(["127.0.0.1", "localhost", "::1"].includes(config.db.host), "Loopback MySQL required");
const prefix = `am_${process.pid}_${Date.now().toString(36)}_`;
assert.match(prefix, /^am_\d+_[a-z0-9]+_$/);
const source = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
const names = [
  "users",
  "user_identities",
  "phone_verification_challenges",
  "phone_verification_send_locks",
  "account_upgrade_tokens",
  "email_recovery_challenges",
  "admin_password_reset_audit",
];
const connection = await mysql.createConnection({ ...config.db, timezone: "Z" });
const created: string[] = [];
const table = (name: string) => `\`${prefix}${name}\``;

function ddl(name: string) {
  const match = source.match(new RegExp(
    `CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  ));
  assert.ok(match, `Missing source DDL: ${name}`);
  return match[0]
    .replace(`CREATE TABLE IF NOT EXISTS ${name}`, `CREATE TABLE IF NOT EXISTS ${table(name)}`)
    .replaceAll(/REFERENCES users\(id\)/g, `REFERENCES ${table("users")}(id)`)
    .replaceAll(/CONSTRAINT (\w+)/g, (_match, constraint) => `CONSTRAINT \`${prefix}${constraint}\``);
}

try {
  await connection.query(ddl("users"));
  created.push("users");
  await connection.query(
    `INSERT INTO ${table("users")} (id, username, password, nickname, role)
     VALUES ('legacy', 'old_account', 'old_password_hash', '旧用户', 'user'),
            ('root', 'super_account', 'root_password_hash', '管理员', 'super_admin')`,
  );
  for (const column of [
    "legacy_login_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER token_version",
    "username_generated TINYINT(1) NOT NULL DEFAULT 0 AFTER legacy_login_enabled",
    "phone_upgraded_at DATETIME NULL AFTER username_generated",
  ]) {
    await connection.query(`ALTER TABLE ${table("users")} ADD COLUMN ${column}`);
  }
  for (const name of names.slice(1)) {
    await connection.query(ddl(name));
    created.push(name);
  }
  const [original] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, username, password, role, legacy_login_enabled, username_generated
     FROM ${table("users")} ORDER BY id`,
  );
  assert.deepEqual(original.map((row) => [
    row.id, row.username, row.password, row.role,
    Number(row.legacy_login_enabled), Number(row.username_generated),
  ]), [
    ["legacy", "old_account", "old_password_hash", "user", 1, 0],
    ["root", "super_account", "root_password_hash", "super_admin", 1, 0],
  ]);
  await connection.query(
    `INSERT INTO ${table("users")}
     (id, username, password, nickname, legacy_login_enabled, username_generated)
     VALUES ('new', 'hgtu_random', 'new_password_hash', '新用户', 0, 1)`,
  );
  await connection.query(
    `INSERT INTO ${table("user_identities")} (id, user_id, identity_type, identifier, verified_at)
     VALUES ('phone-1', 'new', 'phone', '13800138000', UTC_TIMESTAMP())`,
  );
  await assert.rejects(
    connection.query(
      `INSERT INTO ${table("user_identities")} (id, user_id, identity_type, identifier, verified_at)
       VALUES ('phone-2', 'legacy', 'phone', '13800138000', UTC_TIMESTAMP())`,
    ),
    (error: unknown) => (error as { code?: string }).code === "ER_DUP_ENTRY",
  );
  const [[legacyAfter]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, username, password FROM ${table("users")} WHERE id = 'legacy'`,
  );
  assert.deepEqual(
    [legacyAfter.id, legacyAfter.username, legacyAfter.password],
    ["legacy", "old_account", "old_password_hash"],
  );
  console.log("Auth migration fixture passed: legacy rows preserved, administrator exempt, generated user and unique phone valid");
} finally {
  for (const name of created.reverse()) {
    assert.ok(names.includes(name));
    await connection.query(`DROP TABLE IF EXISTS ${table(name)}`);
  }
  await connection.end();
}
