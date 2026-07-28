import type mysql from "mysql2/promise";

export type RewardGiftBindingKey =
  | "daily:tangtang_pillow"
  | "daily:lucky_shell"
  | "ranking:mystery_key"
  | "ranking:wisdom_crystal"
  | "ranking:moon_boat"
  | "ranking:deep_sea_pearl";

export async function resolveRewardGift(
  connection: mysql.PoolConnection,
  bindingKey: RewardGiftBindingKey,
  expectedName: string
) {
  const [boundRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT gifts.id, gifts.name
     FROM system_reward_gift_bindings bindings
     INNER JOIN gifts ON gifts.id = bindings.gift_id
     WHERE bindings.reward_key = ?
     LIMIT 1`,
    [bindingKey]
  );
  if (boundRows[0]) {
    return { id: String(boundRows[0].id), name: String(boundRows[0].name) };
  }

  const [giftRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, name FROM gifts
     WHERE name = ?
     ORDER BY (status = 'active') DESC, created_at ASC, id ASC
     LIMIT 1`,
    [expectedName]
  );
  if (!giftRows[0]) {
    throw new Error(`REWARD_GIFT_BINDING_MISSING:${bindingKey}:${expectedName}`);
  }
  const giftId = String(giftRows[0].id);
  await connection.query(
    `INSERT INTO system_reward_gift_bindings (reward_key, gift_id, expected_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE gift_id = VALUES(gift_id), expected_name = VALUES(expected_name)`,
    [bindingKey, giftId, expectedName]
  );
  return { id: giftId, name: String(giftRows[0].name) };
}
