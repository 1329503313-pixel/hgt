import { initDatabase, pool } from "./db.js";
import { initializeEntitlementsDatabase } from "./entitlements.js";

try {
  await initDatabase();
  await initializeEntitlementsDatabase();
  console.log("Database migrations completed.");
} finally {
  await pool.end();
}
