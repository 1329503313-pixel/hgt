import { initDatabase, pool } from "./db.js";

try {
  await initDatabase();
  console.log("Database migrations completed.");
} finally {
  await pool.end();
}
