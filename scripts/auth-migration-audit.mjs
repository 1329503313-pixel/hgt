// Read-only account migration audit. Run with a DB user that has SELECT only.
// Before: node scripts/auth-migration-audit.mjs snapshot .local/auth-before.json
// After:  node scripts/auth-migration-audit.mjs verify .local/auth-before.json
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const [mode, file] = process.argv.slice(2);
if (!["snapshot", "verify"].includes(mode) || !file) {
  throw new Error("Usage: node scripts/auth-migration-audit.mjs snapshot|verify <snapshot.json>");
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "hgt",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "hgt",
  dateStrings: true,
});

function digestRows(rows) {
  const hash = createHash("sha256");
  for (const row of rows) hash.update(JSON.stringify(row)).update("\n");
  return hash.digest("hex");
}

try {
  await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
  const [users] = await connection.query(
    `SELECT id, username, password, nickname, role, token_version, invite_code, created_at
     FROM users ORDER BY id`,
  );
  const [identities] = await connection.query(
    `SELECT user_id, identity_type, identifier, verified_at, created_at
     FROM user_identities ORDER BY user_id, identity_type, identifier`,
  );
  const [orphanRows] = await connection.query(
    `SELECT COUNT(*) AS orphan_count FROM user_identities i
     LEFT JOIN users u ON u.id = i.user_id WHERE u.id IS NULL`,
  );
  const [duplicatePhoneRows] = await connection.query(
    `SELECT COUNT(*) AS duplicate_count FROM (
       SELECT identifier FROM user_identities WHERE identity_type = 'phone'
       GROUP BY identifier HAVING COUNT(*) > 1
     ) duplicate_phones`,
  );
  await connection.commit();
  const audit = {
    version: 1,
    userCount: users.length,
    superAdminCount: users.filter((row) => row.role === "super_admin").length,
    userIdentityDigest: digestRows(users),
    userIdsDigest: digestRows(users.map((row) => row.id)),
    identityCount: identities.length,
    identitiesDigest: digestRows(identities),
    orphanIdentities: Number(orphanRows[0].orphan_count),
    duplicatePhones: Number(duplicatePhoneRows[0].duplicate_count),
  };
  if (mode === "snapshot") {
    await writeFile(file, JSON.stringify(audit, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ result: "snapshot-created", file, ...audit }));
  } else {
    const before = JSON.parse(await readFile(file, "utf8"));
    const failures = Object.keys(audit).filter((key) => before[key] !== audit[key]);
    console.log(JSON.stringify({ result: failures.length ? "mismatch" : "matched", failures, before, after: audit }));
    if (failures.length) process.exitCode = 1;
  }
} finally {
  await connection.end();
}
