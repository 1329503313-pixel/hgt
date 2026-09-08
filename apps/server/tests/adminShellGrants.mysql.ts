// Disposable schema-only fixtures on loopback MySQL. Never reads or changes source rows.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback MySQL required");
const prefix = `sg_${process.pid}_${Date.now().toString(36)}_`;
const tables = ["users", "notifications", "shell_transactions", "admin_shell_grants"];
const db = await mysql.createConnection({ ...config.db, timezone: "Z" });
let pool: mysql.Pool | undefined;
const created: string[] = [];
try {
  for (const table of tables) {
    await db.query(`CREATE TABLE \`${prefix}${table}\` LIKE \`${table}\``);
    created.push(prefix + table);
  }
  ({ pool } = await import("../src/db.js"));
  const rewrite = (sql: string) => sql.replace(new RegExp(`\\b(${tables.join("|")})\\b`, "g"), name => prefix + name);
  const query = pool.query.bind(pool);
  pool.query = ((sql: string, values?: unknown) => query(rewrite(sql), values as any)) as typeof pool.query;
  const lease = pool.getConnection.bind(pool);
  let failTransactionInsert = false;
  pool.getConnection = async () => {
    const connection = await lease();
    return new Proxy(connection, { get(target, key) {
      if (key === "query") return (sql: string, values?: unknown) => {
        if (failTransactionInsert && /INSERT INTO shell_transactions/.test(sql)) throw Error("fixture-ledger-failure");
        return target.query(rewrite(sql), values as any);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  const { issueAdminShellGrants, claimAdminShellGrantsOnLogin } = await import("../src/shellCurrency.js");
  await pool.query("INSERT INTO users (id,username,password,nickname,role,shell_balance) VALUES ('admin','sg-admin','unused','测试管理','super_admin',0),('u1','sg-u1','unused','测试用户','user',100)");
  const readBalance = async () => { const [[row]] = await pool!.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id='u1'"); return Number(row.shell_balance); };
  const issued = await issueAdminShellGrants(["u1"], "admin", 1500, 1, new Set(), "single");
  assert.equal(issued.pendingCount, 1);
  assert.equal(await readBalance(), 100);
  const [[pending]] = await pool.query<mysql.RowDataPacket[]>("SELECT title FROM notifications WHERE user_id='u1'");
  assert.equal(pending.title, "贝壳待领取通知");
  // A reconnect, balance request and notification request can all arrive together.
  const claims = await Promise.all(Array.from({ length: 4 }, () => claimAdminShellGrantsOnLogin("u1")));
  assert.equal(claims.reduce((sum, claim) => sum + claim.claimedAmount, 0), 1500);
  assert.equal(await readBalance(), 1600);
  const [[claimed]] = await pool.query<mysql.RowDataPacket[]>("SELECT g.claimed_at, n.title, t.amount, t.balance_after FROM admin_shell_grants g JOIN notifications n ON n.id=g.notification_id JOIN shell_transactions t ON t.id=g.transaction_id WHERE g.user_id='u1'");
  assert.ok(claimed.claimed_at);
  assert.equal(claimed.title, "贝壳到账通知");
  assert.equal(Number(claimed.amount), 1500);
  assert.equal(Number(claimed.balance_after), 1600);
  assert.equal((await claimAdminShellGrantsOnLogin("u1")).claimedCount, 0);
  await issueAdminShellGrants(["u1"], "admin", 200, 1, new Set(["u1"]), "single");
  assert.equal(await readBalance(), 1800);
  assert.equal((await claimAdminShellGrantsOnLogin("u1")).claimedCount, 0);
  await issueAdminShellGrants(["u1"], "admin", 300, 1, new Set(), "single");
  failTransactionInsert = true;
  await assert.rejects(claimAdminShellGrantsOnLogin("u1"), /fixture-ledger-failure/);
  failTransactionInsert = false;
  assert.equal(await readBalance(), 1800);
  const [[unclaimed]] = await pool.query<mysql.RowDataPacket[]>("SELECT n.title FROM admin_shell_grants g JOIN notifications n ON n.id=g.notification_id WHERE g.claimed_at IS NULL");
  assert.equal(unclaimed.title, "贝壳待领取通知");
  await pool.query("UPDATE admin_shell_grants SET expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE claimed_at IS NULL");
  const expired = await claimAdminShellGrantsOnLogin("u1");
  assert.equal(expired.claimedCount, 0);
  assert.equal(expired.expiredGrantChanged, true);
  assert.equal(await readBalance(), 1800);
  console.log("PASS: pending 1500-shell grant, concurrent session claims, one ledger entry, immediate issuance, transactional rollback and expiry.");
} finally {
  await pool?.end();
  for (const name of created.reverse()) {
    assert.ok(name.startsWith(prefix));
    await db.query(`DROP TABLE \`${name}\``);
  }
  await db.end();
}
