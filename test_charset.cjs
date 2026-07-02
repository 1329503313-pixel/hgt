// test-db-charset.cjs — run inside container: node test/test-db-charset.cjs
const mysql = require("mysql2/promise");

async function main() {
  // Use same config as db.ts but with charset
  const pool = mysql.createPool({
    host: "mysql-docker-mysql-1",
    user: "hgt",
    password: "hgt_password",
    database: "hgt",
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: "Z"
  });

  const c = await pool.getConnection();

  // 1) Check charset
  const [vars] = await c.query(
    `SHOW SESSION VARIABLES WHERE Variable_name IN ('character_set_client','character_set_connection','character_set_results')`
  );
  console.log("Session charset:", JSON.stringify(vars));

  // 2) Test raw insert via .query (same as API index.ts)
  const id = "raw_" + Date.now();
  await c.query(
    `INSERT INTO soups (id,title,author,type,summary,surface,bottom,creator_id,creator_name,is_surface_public,is_bottom_public)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "中文标题测试", "作者中文", "本格清汤", "摘要中文", "汤面内容", "汤底内容", "admin", "管理员", 1, 0]
  );

  const [rows] = await c.query(`SELECT id,title,HEX(title) AS hex_title FROM soups WHERE id=?`, [id]);
  console.log("Read back .query():", JSON.stringify(rows));

  // 3) Test raw insert via .execute (prepared statement)
  const id2 = "prep_" + Date.now();
  await c.execute(
    `INSERT INTO soups (id,title,author,type,summary,surface,bottom,creator_id,creator_name,is_surface_public,is_bottom_public)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id2, "中文标题测试", "作者中文", "本格清汤", "摘要中文", "汤面内容", "汤底内容", "admin", "管理员", 1, 0]
  );

  const [rows2] = await c.query(`SELECT id,title,HEX(title) AS hex_title FROM soups WHERE id=?`, [id2]);
  console.log("Read back .execute():", JSON.stringify(rows2));

  await c.query("DELETE FROM soups WHERE id IN (?,?)", [id, id2]);
  c.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
