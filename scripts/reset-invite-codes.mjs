import mysql from "mysql2/promise";

const inviteCodesModule = process.env.INVITE_CODES_MODULE
  ?? new URL("../apps/server/dist/inviteCodes.js", import.meta.url).href;
const {
  generateInviteCode,
  isInviteCodeAllowed
} = await import(inviteCodesModule);

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

try {
  const [[columnState]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'users'
       AND column_name = 'invite_code'`
  );
  if (Number(columnState.count) === 0) {
    await connection.query(
      "ALTER TABLE users ADD COLUMN invite_code CHAR(5) NULL AFTER nickname"
    );
    console.log("invite_code_column=created");
  }

  const [[indexState]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'users'
       AND index_name = 'uq_users_invite_code'`
  );
  if (Number(indexState.count) === 0) {
    await connection.query(
      "CREATE UNIQUE INDEX uq_users_invite_code ON users (invite_code)"
    );
    console.log("invite_code_unique_index=created");
  }

  await connection.beginTransaction();
  const [users] = await connection.query(
    "SELECT id, invite_code FROM users ORDER BY id FOR UPDATE"
  );
  const unavailable = new Set(
    users.map((user) => String(user.invite_code ?? "")).filter(Boolean)
  );
  const nextCodes = new Map();

  for (const user of users) {
    let nextCode;
    do {
      nextCode = generateInviteCode();
    } while (unavailable.has(nextCode));
    unavailable.add(nextCode);
    nextCodes.set(String(user.id), nextCode);
  }

  for (const [userId, nextCode] of nextCodes) {
    await connection.query(
      "UPDATE users SET invite_code = ? WHERE id = ?",
      [nextCode, userId]
    );
  }

  const [verificationRows] = await connection.query(
    "SELECT id, invite_code FROM users ORDER BY id"
  );
  const verifiedCodes = verificationRows.map((row) => String(row.invite_code ?? ""));
  const invalidCount = verifiedCodes.filter((code) => !isInviteCodeAllowed(code)).length;
  const uniqueCount = new Set(verifiedCodes).size;
  if (invalidCount > 0 || uniqueCount !== verificationRows.length) {
    throw new Error(
      `Invite-code verification failed: invalid=${invalidCount}, unique=${uniqueCount}, users=${verificationRows.length}`
    );
  }

  await connection.commit();
  console.log(`invite_codes_reset=${verificationRows.length}`);
  console.log("invalid_codes=0");
  console.log(`unique_codes=${uniqueCount}`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
