const mysql = require("mysql2/promise");
(async () => {
  const p = mysql.createPool({
    host: "mysql-docker-mysql-1",
    user: "hgt",
    password: "hgt_password",
    database: "hgt",
    charset: "utf8mb4"
  });
  const c = await p.getConnection();

  // Check ACTUAL connection charset
  const [vars] = await c.query("SHOW SESSION VARIABLES WHERE Variable_name IN ('character_set_client','character_set_connection','character_set_results')");
  console.log("Session charset:", JSON.stringify(vars));

  // Insert via execute (prepared)
  const id = "debug_" + Date.now();
  await c.execute(
    "INSERT INTO soups (id,title,author,type,summary,surface,bottom,creator_id,creator_name,is_surface_public,is_bottom_public) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, "测试海龟汤", "作者名", "本格清汤", "摘要", "汤面", "汤底", "admin", "管理员", 1, 0]
  );

  const [r1] = await c.query("SELECT id,title,HEX(title) h FROM soups WHERE id=?", [id]);
  console.log("After execute:", JSON.stringify(r1));
  await c.query("DELETE FROM soups WHERE id=?", [id]);

  // Now insert via .query with ? placeholders (same as API does)
  await c.query(
    "INSERT INTO soups (id,title,author,type,summary,surface,bottom,creator_id,creator_name,is_surface_public,is_bottom_public) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, "测试海龟汤", "作者名", "本格清汤", "摘要", "汤面", "汤底", "admin", "管理员", 1, 0]
  );

  const [r2] = await c.query("SELECT id,title,HEX(title) h FROM soups WHERE id=?", [id]);
  console.log("After query:", JSON.stringify(r2));
  await c.query("DELETE FROM soups WHERE id=?", [id]);

  c.release();
  await p.end();
})();
