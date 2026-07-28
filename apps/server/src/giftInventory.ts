import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";

export const MAX_GIFT_INVENTORY_QUANTITY = 999;

export function calculateGiftConsumption(
  inventoryQuantity: number,
  sendQuantity: number,
  unitCost: number
) {
  if (
    !Number.isSafeInteger(inventoryQuantity)
    || inventoryQuantity < 0
    || inventoryQuantity > MAX_GIFT_INVENTORY_QUANTITY
    || !Number.isSafeInteger(sendQuantity)
    || sendQuantity < 1
    || !Number.isSafeInteger(unitCost)
    || unitCost < 0
  ) {
    throw new Error("礼物消耗参数不正确");
  }
  const inventoryQuantityUsed = Math.min(inventoryQuantity, sendQuantity);
  const purchasedQuantity = sendQuantity - inventoryQuantityUsed;
  const inventoryQuantityAfter = inventoryQuantity - inventoryQuantityUsed;
  const totalCost = unitCost * purchasedQuantity;
  if (!Number.isSafeInteger(totalCost)) throw new Error("礼物补购金额超出可处理范围");
  return { inventoryQuantityUsed, purchasedQuantity, inventoryQuantityAfter, totalCost };
}

export function calculateGiftInventoryCredit(
  inventoryQuantity: number,
  creditQuantity: number,
  unitCost: number
) {
  if (
    !Number.isSafeInteger(inventoryQuantity)
    || inventoryQuantity < 0
    || inventoryQuantity > MAX_GIFT_INVENTORY_QUANTITY
    || !Number.isSafeInteger(creditQuantity)
    || creditQuantity < 1
    || !Number.isSafeInteger(unitCost)
    || unitCost < 0
  ) {
    throw new Error("礼物入库参数不正确");
  }
  const creditedQuantity = Math.min(creditQuantity, MAX_GIFT_INVENTORY_QUANTITY - inventoryQuantity);
  const inventoryQuantityAfter = inventoryQuantity + creditedQuantity;
  const overflowQuantity = creditQuantity - creditedQuantity;
  const overflowShell = unitCost * overflowQuantity;
  if (!Number.isSafeInteger(overflowShell)) throw new Error("礼物溢出折算金额超出可处理范围");
  return { creditedQuantity, inventoryQuantityAfter, overflowQuantity, overflowShell };
}

export type CreditGiftInventoryInput = {
  userId: string;
  giftId: string;
  quantity: number;
  idempotencyKey: string;
  relatedType?: string;
  relatedId?: string;
  operatorId?: string;
  remark?: string;
};

export type CreditGiftInventoryResult = {
  inventoryQuantity: number;
  creditedQuantity: number;
  overflowQuantity: number;
  overflowShell: number;
  shellBalance: number;
  duplicate: boolean;
};

/**
 * Credits stackable gifts inside an existing transaction.
 * Callers should begin/commit the transaction and use this helper for every
 * future task, activity, or admin gift grant so the 999 cap behaves uniformly.
 */
export async function creditGiftInventory(
  connection: mysql.PoolConnection,
  input: CreditGiftInventoryInput
): Promise<CreditGiftInventoryResult> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    throw new Error("礼物入库数量必须是正整数");
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 177) {
    throw new Error("礼物入库幂等编号不正确");
  }

  const [existingRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT user_id, gift_id, balance_after, quantity_change, overflow_quantity, overflow_shell
     FROM gift_inventory_transactions
     WHERE idempotency_key = ?
     LIMIT 1`,
    [input.idempotencyKey]
  );
  if (existingRows[0]) {
    if (
      String(existingRows[0].user_id) !== input.userId
      || String(existingRows[0].gift_id) !== input.giftId
    ) {
      throw Object.assign(new Error("礼物入库幂等编号已被其他操作使用"), { status: 409 });
    }
    const [userRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT shell_balance FROM users WHERE id = ? LIMIT 1",
      [input.userId]
    );
    const overflowQuantity = Number(existingRows[0].overflow_quantity);
    return {
      inventoryQuantity: Number(existingRows[0].balance_after),
      creditedQuantity: Number(existingRows[0].quantity_change),
      overflowQuantity,
      overflowShell: Number(existingRows[0].overflow_shell),
      shellBalance: Number(userRows[0]?.shell_balance ?? 0),
      duplicate: true
    };
  }

  const [userRows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT shell_balance FROM users WHERE id = ? FOR UPDATE",
    [input.userId]
  );
  if (!userRows[0]) throw Object.assign(new Error("用户不存在"), { status: 404 });

  const [giftRows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT cost_amount FROM gifts WHERE id = ? FOR UPDATE",
    [input.giftId]
  );
  if (!giftRows[0]) throw Object.assign(new Error("礼物不存在"), { status: 404 });

  await connection.query(
    `INSERT INTO user_gift_inventory (user_id, gift_id, quantity)
     VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE quantity = quantity`,
    [input.userId, input.giftId]
  );
  const [inventoryRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT quantity FROM user_gift_inventory
     WHERE user_id = ? AND gift_id = ?
     FOR UPDATE`,
    [input.userId, input.giftId]
  );

  const currentQuantity = Number(inventoryRows[0]?.quantity ?? 0);
  const {
    creditedQuantity,
    inventoryQuantityAfter: inventoryQuantity,
    overflowQuantity,
    overflowShell
  } = calculateGiftInventoryCredit(currentQuantity, input.quantity, Number(giftRows[0].cost_amount));
  const shellBalance = Number(userRows[0].shell_balance) + overflowShell;
  if (
    !Number.isSafeInteger(overflowShell)
    || !Number.isSafeInteger(shellBalance)
    || overflowShell > 2_147_483_647
    || shellBalance > 4_294_967_295
  ) {
    throw Object.assign(new Error("礼物溢出折算金额超出可处理范围"), { status: 400 });
  }

  await connection.query(
    `UPDATE user_gift_inventory SET quantity = ?
     WHERE user_id = ? AND gift_id = ?`,
    [inventoryQuantity, input.userId, input.giftId]
  );
  if (overflowShell > 0) {
    await connection.query("UPDATE users SET shell_balance = ? WHERE id = ?", [shellBalance, input.userId]);
    await connection.query(
      `INSERT INTO shell_transactions
       (id, user_id, transaction_type, amount, balance_after, related_type, related_id,
        operator_id, remark, idempotency_key)
       VALUES (?, ?, 'gift_overflow', ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        input.userId,
        overflowShell,
        shellBalance,
        input.relatedType ?? "gift_inventory",
        input.relatedId ?? input.giftId,
        input.operatorId ?? null,
        input.remark ?? `礼物库存已满，${overflowQuantity} 个礼物折算为贝壳`,
        `gift:overflow:${input.idempotencyKey}`
      ]
    );
  }
  await connection.query(
    `INSERT INTO gift_inventory_transactions
     (id, user_id, gift_id, transaction_type, quantity_change, balance_after,
      overflow_quantity, overflow_shell, related_type, related_id, operator_id, remark, idempotency_key)
     VALUES (?, ?, ?, 'grant', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      input.userId,
      input.giftId,
      creditedQuantity,
      inventoryQuantity,
      overflowQuantity,
      overflowShell,
      input.relatedType ?? null,
      input.relatedId ?? null,
      input.operatorId ?? null,
      input.remark ?? null,
      input.idempotencyKey
    ]
  );

  return {
    inventoryQuantity,
    creditedQuantity,
    overflowQuantity,
    overflowShell,
    shellBalance,
    duplicate: false
  };
}
