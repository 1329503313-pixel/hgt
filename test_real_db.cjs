// Test insert via pool.query() NOT pool.getConnection()
// This is the EXACT pattern the API uses
import { pool } from "./server/dist/db.js";

async function main() {
  const id = "mimic_api_" + Date.now();

  // EXACT code from index.ts POST /api/soups
  await pool.query(
    `INSERT INTO soups
      (id, title, author, type, summary, cover_image, is_original, surface, supplemental_surfaces, bottom, supplemental_bottoms, host_manual, is_surface_public, is_bottom_public, creator_id, creator_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      "模仿API标题",
      "作者",
      "本格清汤",
      "摘要",
      null,
      true,
      "汤面",
      "[]",
      "汤底",
      "[]",
      null,
      true,
      false,
      "admin",
      "管理员"
    ]
  );

  const [rows] = await pool.query(`SELECT id,title,HEX(title) ht FROM soups WHERE id=?`, [id]);
  console.log("pool.query (mimicking API):", JSON.stringify(rows));

  await pool.query("DELETE FROM soups WHERE id=?", [id]);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
