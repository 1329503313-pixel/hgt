import mysql from "mysql2/promise";

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

try {
  const requiredTables = [
    "user_invite_bindings",
    "user_invite_reward_progress"
  ];
  for (const table of requiredTables) {
    const [rows] = await connection.query("SHOW TABLES LIKE ?", [table]);
    console.log(`${table}=${rows.length > 0 ? "present" : "missing"}`);
  }
} finally {
  await connection.end();
}
