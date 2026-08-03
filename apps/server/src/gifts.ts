import type express from "express";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { pool } from "./db.js";
import { calculateGiftConsumption, creditGiftInventory } from "./giftInventory.js";
import { optimizeGiftIconBuffer } from "./giftImages.js";
import { canonicalConversationUserIds } from "./conversations.js";
import { storeMediaBuffer } from "./ossStorage.js";
import type { PublicUser } from "./types.js";
import { recordUserBehavior } from "./behaviorAnalytics.js";

type AuthenticatedUser = PublicUser & { tokenVersion: number };
type RequireUser = (
  req: express.Request,
  res: express.Response
) => Promise<AuthenticatedUser | null>;

type GiftMessage = {
  giftSendId: string;
  giftId: string;
  giftName: string;
  iconUrl: string;
  quantity: number;
  sender: { id: string; nickname: string };
  recipient: { id: string; nickname: string };
  shellReward: number;
  charmReward: number;
  createdAt: string;
};

type GiftRouteDependencies = {
  requireAuth: RequireUser;
  requireAdmin: RequireUser;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
  sendStoredImage: (
    req: express.Request,
    res: express.Response,
    value: unknown,
    maxWidth: number,
    cacheControl?: string
  ) => Promise<express.Response | void>;
  onPrivateGift: (recipientId: string, message: {
    id: string;
    conversationId: string;
    senderId: string;
    senderNickname: string;
    content: string;
    type: "gift";
    gift: GiftMessage;
    createdAt: string;
  }) => void;
  onCircleGift: (circleId: string, messageId: string, senderId: string) => Promise<void>;
  onOnlineSoupGift: (roomId: string) => void;
  onCharmChanged: (userIds: string[]) => void;
};

const giftWriteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().default(""),
  iconImage: z.string().min(1).optional(),
  paymentCurrency: z.literal("shell"),
  costAmount: z.coerce.number().int().min(1).max(10_000_000),
  rewardShell: z.coerce.number().int().min(0).max(10_000_000),
  rewardPearl: z.coerce.number().int().min(0).max(10_000_000).optional().default(0),
  rewardCharm: z.coerce.number().int().min(0).max(10_000_000),
  status: z.enum(["active", "inactive"]).optional().default("inactive"),
  sortOrder: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional().default(0)
});

const giftSendSchema = z.object({
  giftId: z.string().trim().min(1).max(64),
  quantity: z.coerce.number().int().min(1).max(666),
  requestId: z.string().trim().min(8).max(191),
  source: z.object({
    type: z.enum(["profile", "private", "circle", "online_soup"]),
    id: z.string().trim().min(1).max(64).optional()
  })
}).superRefine((value, ctx) => {
  if (value.source.type !== "profile" && !value.source.id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source", "id"], message: "缺少送礼来源" });
  }
});

const adminGiftGrantSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  quantity: z.coerce.number().int().min(1).max(10_000),
  requestId: z.string().trim().min(8).max(100)
});

function iconUrl(giftId: unknown, updatedAt?: unknown) {
  const version = updatedAt ? new Date(updatedAt as string | number | Date).getTime() : "";
  return `/api/media/gifts/${encodeURIComponent(String(giftId))}/icon${version ? `?v=${version}` : ""}`;
}

function giftMessageFromRow(row: mysql.RowDataPacket): GiftMessage {
  return {
    giftSendId: String(row.id),
    giftId: String(row.gift_id),
    giftName: String(row.gift_name_snapshot),
    iconUrl: iconUrl(row.gift_id),
    quantity: Number(row.quantity),
    sender: { id: String(row.sender_id), nickname: String(row.sender_nickname) },
    recipient: { id: String(row.recipient_id), nickname: String(row.recipient_nickname) },
    shellReward: Number(row.total_reward_shell),
    charmReward: Number(row.total_reward_charm),
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function storedGiftSend(giftSendId: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT gs.*, sender.nickname AS sender_nickname, recipient.nickname AS recipient_nickname,
       recipient.charm_value AS recipient_charm_value,
       sender.generosity_value AS sender_generosity_value
     FROM gift_sends gs
     INNER JOIN users sender ON sender.id = gs.sender_id
     INNER JOIN users recipient ON recipient.id = gs.recipient_id
     WHERE gs.id = ? LIMIT 1`,
    [giftSendId]
  );
  return rows[0]
    ? {
        gift: giftMessageFromRow(rows[0]),
        recipientCharmValue: Number(rows[0].recipient_charm_value ?? 0),
        senderGenerosityValue: Number(rows[0].sender_generosity_value ?? 0)
      }
    : null;
}

function adminGift(row: mysql.RowDataPacket) {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    iconUrl: iconUrl(row.id, row.updated_at),
    paymentCurrency: String(row.payment_currency),
    costAmount: Number(row.cost_amount),
    rewardShell: Number(row.reward_shell),
    rewardPearl: Number(row.reward_pearl),
    rewardCharm: Number(row.reward_charm),
    status: String(row.status),
    sortOrder: Number(row.sort_order),
    sentCount: Number(row.sent_count ?? 0),
    inventoryGrantCount: Number(row.inventory_grant_count ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function storeGiftIcon(value: string, giftId: string) {
  const optimized = await optimizeGiftIconBuffer(value);
  if (!optimized) return null;
  return storeMediaBuffer(optimized, {
    category: "gifts",
    entityId: giftId,
    variant: "icon",
    contentType: "image/webp",
    extension: "webp"
  });
}

export function parseGiftMessage(value: unknown): GiftMessage | null {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Partial<GiftMessage>;
    if (!item.giftSendId || !item.giftId || !item.giftName || !item.sender || !item.recipient) return null;
    return {
      giftSendId: String(item.giftSendId),
      giftId: String(item.giftId),
      giftName: String(item.giftName),
      iconUrl: String(item.iconUrl || iconUrl(item.giftId)),
      quantity: Number(item.quantity || 1),
      sender: { id: String(item.sender.id), nickname: String(item.sender.nickname) },
      recipient: { id: String(item.recipient.id), nickname: String(item.recipient.nickname) },
      shellReward: Number(item.shellReward || 0),
      charmReward: Number(item.charmReward || 0),
      createdAt: String(item.createdAt || "")
    };
  } catch {
    return null;
  }
}

export function registerGiftRoutes(app: express.Express, dependencies: GiftRouteDependencies) {
  const {
    requireAuth,
    requireAdmin,
    sendError,
    sendStoredImage,
    onPrivateGift,
    onCircleGift,
    onOnlineSoupGift,
    onCharmChanged
  } = dependencies;

  app.get("/api/media/gifts/:id/icon", async (req, res) => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT icon_image FROM gifts WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    if (!rows[0]) return sendError(res, 404, "礼物不存在");
    return sendStoredImage(req, res, rows[0].icon_image, 192, "public, max-age=31536000, immutable");
  });

  app.get("/api/gifts", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT g.id, g.name, g.description, g.payment_currency, g.cost_amount,
         g.reward_shell, g.reward_charm, g.updated_at,
         COALESCE(inventory.quantity, 0) AS inventory_quantity
       FROM gifts g
       LEFT JOIN user_gift_inventory inventory
         ON inventory.gift_id = g.id AND inventory.user_id = ?
       WHERE g.status = 'active' AND g.payment_currency = 'shell'
       ORDER BY g.sort_order DESC, g.created_at DESC`,
      [user.id]
    );
    res.json({
      gifts: rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        description: String(row.description ?? ""),
        iconUrl: iconUrl(row.id, row.updated_at),
        costAmount: Number(row.cost_amount),
        rewardShell: Number(row.reward_shell),
        rewardCharm: Number(row.reward_charm),
        inventoryQuantity: Number(row.inventory_quantity)
      })),
      maxQuantity: 666
    });
  });

  app.get("/api/users/:id/gifts/recent", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [targetRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id = ? LIMIT 1", [req.params.id]);
    if (!targetRows[0]) return sendError(res, 404, "用户不存在");
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT gs.*, sender.nickname AS sender_nickname, recipient.nickname AS recipient_nickname
       FROM gift_sends gs
       INNER JOIN users sender ON sender.id = gs.sender_id
       INNER JOIN users recipient ON recipient.id = gs.recipient_id
       WHERE gs.recipient_id = ?
       ORDER BY gs.created_at DESC, gs.id DESC
       LIMIT 8`,
      [req.params.id]
    );
    res.json({ gifts: rows.map(giftMessageFromRow) });
  });

  app.post("/api/users/:id/gifts/send", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const parsed = giftSendSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message || "送礼参数不正确");
    if (user.id === req.params.id) return sendError(res, 400, "不能给自己送礼");

    const recipientId = req.params.id;
    const { giftId, quantity, requestId, source } = parsed.data;
    const connection = await pool.getConnection();
    let giftSendId = "";
    let privateMessageId = "";
    let privateConversationId = "";
    let circleMessageId = "";
    let onlineRoomId = "";
    let duplicate = false;
    let senderBalance = 0;

    try {
      await connection.beginTransaction();
      const [duplicateRows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM gift_sends WHERE sender_id = ? AND request_id = ? LIMIT 1",
        [user.id, requestId]
      );
      if (duplicateRows[0]) {
        giftSendId = String(duplicateRows[0].id);
        duplicate = true;
        const [balanceRows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT shell_balance FROM users WHERE id = ? LIMIT 1",
          [user.id]
        );
        senderBalance = Number(balanceRows[0]?.shell_balance ?? 0);
        await connection.commit();
      } else {
        const userIds = canonicalConversationUserIds(user.id, recipientId);
        const [userRows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT id, nickname, shell_balance, pearl_balance, charm_value, generosity_value
           FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE`,
          userIds
        );
        if (userRows.length !== 2) throw Object.assign(new Error("用户不存在"), { status: 404 });
        const sender = userRows.find((row) => String(row.id) === user.id)!;
        const recipient = userRows.find((row) => String(row.id) === recipientId)!;

        const [followRows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
          [user.id, recipientId]
        );
        if (!followRows[0]) throw Object.assign(new Error("必须先关注该用户才能送礼"), { status: 403 });

        const [giftRows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT * FROM gifts WHERE id = ? FOR UPDATE",
          [giftId]
        );
        const gift = giftRows[0];
        if (!gift || gift.status !== "active") throw Object.assign(new Error("礼物已下架或不存在"), { status: 404 });
        if (gift.payment_currency !== "shell") throw Object.assign(new Error("该礼物暂不可赠送"), { status: 400 });

        await connection.query(
          `INSERT INTO user_gift_inventory (user_id, gift_id, quantity)
           VALUES (?, ?, 0)
           ON DUPLICATE KEY UPDATE quantity = quantity`,
          [user.id, giftId]
        );
        const [inventoryRows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT quantity FROM user_gift_inventory
           WHERE user_id = ? AND gift_id = ?
           FOR UPDATE`,
          [user.id, giftId]
        );
        const inventoryQuantity = Number(inventoryRows[0]?.quantity ?? 0);
        const {
          inventoryQuantityUsed,
          purchasedQuantity,
          inventoryQuantityAfter,
          totalCost
        } = calculateGiftConsumption(inventoryQuantity, quantity, Number(gift.cost_amount));
        const rewardShell = Number(gift.reward_shell) * quantity;
        const rewardPearl = Number(gift.reward_pearl) * quantity;
        const rewardCharm = Number(gift.reward_charm) * quantity;
        if (
          ![totalCost, rewardShell, rewardPearl, rewardCharm].every(Number.isSafeInteger)
          || totalCost > 2_147_483_647
          || rewardShell > 2_147_483_647
          || Number(recipient.shell_balance) + rewardShell > 4_294_967_295
          || Number(recipient.pearl_balance) + rewardPearl > 4_294_967_295
        ) {
          throw Object.assign(new Error("礼物数量超出可处理范围"), { status: 400 });
        }
        if (Number(sender.shell_balance) < totalCost) {
          throw Object.assign(new Error("贝壳余额不足"), { status: 409 });
        }

        if (source.type === "private") {
          const [sourceRows] = await connection.query<mysql.RowDataPacket[]>(
            `SELECT id FROM conversations
             WHERE id = ? AND ((user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?))
             LIMIT 1`,
            [source.id, user.id, recipientId, recipientId, user.id]
          );
          if (!sourceRows[0]) throw Object.assign(new Error("私聊来源无效"), { status: 403 });
          privateConversationId = String(sourceRows[0].id);
        } else if (source.type === "circle") {
          const [sourceRows] = await connection.query<mysql.RowDataPacket[]>(
            `SELECT COUNT(*) AS member_count FROM circle_members
             WHERE circle_id = ? AND user_id IN (?, ?)`,
            [source.id, user.id, recipientId]
          );
          if (Number(sourceRows[0]?.member_count ?? 0) !== 2) {
            throw Object.assign(new Error("仅可向同一圈子的成员送礼"), { status: 403 });
          }
        } else if (source.type === "online_soup") {
          const [sourceRows] = await connection.query<mysql.RowDataPacket[]>(
            `SELECT r.id, r.status, r.current_round_id,
               SUM(m.user_id = ? AND m.is_active = 1) AS sender_active,
               SUM(m.user_id = ? AND m.is_active = 1) AS recipient_active
             FROM online_soup_rooms r
             LEFT JOIN online_soup_members m ON m.room_id = r.id
             WHERE r.id = ?
             GROUP BY r.id, r.status, r.current_round_id`,
            [user.id, recipientId, source.id]
          );
          const room = sourceRows[0];
          if (!room || Number(room.sender_active) < 1 || Number(room.recipient_active) < 1 || room.status === "closed") {
            throw Object.assign(new Error("仅可向同一玩汤房间的在线成员送礼"), { status: 403 });
          }
          onlineRoomId = String(source.id);
        }

        if (!privateConversationId) {
          const [a, b] = canonicalConversationUserIds(user.id, recipientId);
          privateConversationId = nanoid();
          await connection.query(
            `INSERT INTO conversations (id, user_a_id, user_b_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE id = conversations.id`,
            [privateConversationId, a, b]
          );
          const [conversationRows] = await connection.query<mysql.RowDataPacket[]>(
            "SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ? LIMIT 1",
            [a, b]
          );
          privateConversationId = String(conversationRows[0].id);
        }

        giftSendId = nanoid();
        await connection.query(
          `INSERT INTO gift_sends (
             id, request_id, gift_id, sender_id, recipient_id, quantity, source_type, source_id,
             gift_name_snapshot, payment_currency, unit_cost, total_cost,
             inventory_quantity_used, purchased_quantity,
             unit_reward_shell, total_reward_shell, unit_reward_pearl, total_reward_pearl,
             unit_reward_charm, total_reward_charm
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            giftSendId, requestId, giftId, user.id, recipientId, quantity, source.type, source.id ?? null,
            gift.name, gift.payment_currency, gift.cost_amount, totalCost,
            inventoryQuantityUsed, purchasedQuantity,
            gift.reward_shell, rewardShell, gift.reward_pearl, rewardPearl,
            gift.reward_charm, rewardCharm
          ]
        );

        if (inventoryQuantityUsed > 0) {
          await connection.query(
            `UPDATE user_gift_inventory SET quantity = ?
             WHERE user_id = ? AND gift_id = ?`,
            [inventoryQuantityAfter, user.id, giftId]
          );
          await connection.query(
            `INSERT INTO gift_inventory_transactions
             (id, user_id, gift_id, transaction_type, quantity_change, balance_after,
              related_type, related_id, remark, idempotency_key)
             VALUES (?, ?, ?, 'gift_sent', ?, ?, 'gift_send', ?, ?, ?)`,
            [
              nanoid(),
              user.id,
              giftId,
              -inventoryQuantityUsed,
              inventoryQuantityAfter,
              giftSendId,
              `送出${gift.name}×${quantity}，消耗库存${inventoryQuantityUsed}`,
              `gift:send:${giftSendId}`
            ]
          );
        }

        senderBalance = Number(sender.shell_balance) - totalCost;
        const recipientShellBalance = Number(recipient.shell_balance) + rewardShell;
        const recipientPearlBalance = Number(recipient.pearl_balance) + rewardPearl;
        const recipientCharm = Number(recipient.charm_value) + rewardCharm;
        const senderGenerosity = Number(sender.generosity_value) + rewardCharm;
        await connection.query(
          "UPDATE users SET shell_balance = ?, generosity_value = ? WHERE id = ?",
          [senderBalance, senderGenerosity, user.id]
        );
        await connection.query(
          "UPDATE users SET shell_balance = ?, pearl_balance = ?, charm_value = ? WHERE id = ?",
          [recipientShellBalance, recipientPearlBalance, recipientCharm, recipientId]
        );
        if (totalCost > 0) {
          await connection.query(
            `INSERT INTO shell_transactions
             (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
             VALUES (?, ?, 'gift_sent', ?, ?, 'gift_send', ?, ?, ?)`,
            [nanoid(), user.id, -totalCost, senderBalance, giftSendId, `赠送${gift.name}×${quantity}`, `gift:send:${giftSendId}`]
          );
        }
        if (rewardShell > 0) {
          await connection.query(
            `INSERT INTO shell_transactions
             (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
             VALUES (?, ?, 'gift_received', ?, ?, 'gift_send', ?, ?, ?)`,
            [nanoid(), recipientId, rewardShell, recipientShellBalance, giftSendId, `收到${gift.name}×${quantity}`, `gift:receive:shell:${giftSendId}`]
          );
        }
        if (rewardPearl > 0) {
          await connection.query(
            `INSERT INTO pearl_transactions
             (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
             VALUES (?, ?, 'gift_received', ?, ?, 'gift_send', ?, ?, ?)`,
            [nanoid(), recipientId, rewardPearl, recipientPearlBalance, giftSendId, `收到${gift.name}×${quantity}`, `gift:receive:pearl:${giftSendId}`]
          );
        }

        const createdAt = new Date().toISOString();
        const messageSnapshot: GiftMessage = {
          giftSendId,
          giftId,
          giftName: String(gift.name),
          iconUrl: iconUrl(giftId),
          quantity,
          sender: { id: user.id, nickname: String(sender.nickname) },
          recipient: { id: recipientId, nickname: String(recipient.nickname) },
          shellReward: rewardShell,
          charmReward: rewardCharm,
          createdAt
        };
        const content = JSON.stringify(messageSnapshot);

        privateMessageId = nanoid();
        await connection.query(
          `INSERT INTO private_messages
           (id, conversation_id, sender_id, content, message_type, gift_send_id)
           VALUES (?, ?, ?, ?, 'gift', ?)`,
          [privateMessageId, privateConversationId, user.id, content, giftSendId]
        );
        await connection.query("UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?", [privateConversationId]);

        if (source.type === "circle") {
          circleMessageId = nanoid();
          await connection.query(
            `INSERT INTO circle_messages
             (id, circle_id, sender_id, content, message_type, gift_send_id)
             VALUES (?, ?, ?, ?, 'gift', ?)`,
            [circleMessageId, source.id, user.id, content, giftSendId]
          );
          await connection.query("UPDATE circles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [source.id]);
        } else if (source.type === "online_soup") {
          const [roomRows] = await connection.query<mysql.RowDataPacket[]>(
            "SELECT current_round_id FROM online_soup_rooms WHERE id = ? LIMIT 1",
            [source.id]
          );
          const onlineMessageId = nanoid();
          await connection.query(
            `INSERT INTO online_soup_messages
             (id, room_id, round_id, sender_id, message_type, content, gift_send_id)
             VALUES (?, ?, ?, ?, 'gift', ?, ?)`,
            [onlineMessageId, source.id, roomRows[0]?.current_round_id ?? null, user.id, content, giftSendId]
          );
          await connection.query(
            `INSERT INTO online_soup_activities
             (id, room_id, actor_user_id, activity_type, reference_id)
             VALUES (?, ?, ?, 'chat', ?)`,
            [nanoid(), source.id, user.id, onlineMessageId]
          );
        }

        await connection.commit();
      }
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        const [existingRows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT id FROM gift_sends WHERE sender_id = ? AND request_id = ? LIMIT 1",
          [user.id, requestId]
        );
        if (existingRows[0]) {
          giftSendId = String(existingRows[0].id);
          duplicate = true;
          const [balanceRows] = await connection.query<mysql.RowDataPacket[]>(
            "SELECT shell_balance FROM users WHERE id = ? LIMIT 1",
            [user.id]
          );
          senderBalance = Number(balanceRows[0]?.shell_balance ?? 0);
        } else {
          console.error("Send gift duplicate handling failed:", error);
          return sendError(res, 500, "送礼失败，请稍后重试");
        }
      } else {
      const status = Number((error as { status?: number }).status ?? 500);
      if (status >= 500) console.error("Send gift failed:", error);
      return sendError(res, status, status >= 500 ? "送礼失败，请稍后重试" : (error as Error).message);
      }
    } finally {
      connection.release();
    }

    if (!duplicate) recordUserBehavior("send_gift");
    const stored = await storedGiftSend(giftSendId);
    if (!stored) return sendError(res, 500, "送礼记录保存失败");
    const { gift, recipientCharmValue, senderGenerosityValue } = stored;
    const [inventoryRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT quantity FROM user_gift_inventory
       WHERE user_id = ? AND gift_id = ?
       LIMIT 1`,
      [user.id, giftId]
    );
    const inventoryQuantity = Number(inventoryRows[0]?.quantity ?? 0);
    if (!duplicate) {
      onCharmChanged([user.id, recipientId]);
      onPrivateGift(recipientId, {
        id: privateMessageId,
        conversationId: privateConversationId,
        senderId: user.id,
        senderNickname: gift.sender.nickname,
        content: JSON.stringify(gift),
        type: "gift",
        gift,
        createdAt: gift.createdAt
      });
      if (circleMessageId) {
        void onCircleGift(String(source.id), circleMessageId, user.id)
          .catch((error) => console.error("Publish circle gift event failed:", error));
      }
      if (onlineRoomId) onOnlineSoupGift(onlineRoomId);
    }
    res.status(201).json({
      gift,
      shellBalance: senderBalance,
      recipientCharmValue,
      senderGenerosityValue,
      inventoryQuantity,
      duplicate
    });
  });

  app.get("/api/admin/gifts", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT g.*,
         (SELECT COUNT(*) FROM gift_sends gs WHERE gs.gift_id = g.id) AS sent_count,
         (SELECT COUNT(*) FROM gift_inventory_transactions git
          WHERE git.gift_id = g.id AND git.transaction_type = 'grant') AS inventory_grant_count
       FROM gifts g
       ORDER BY g.sort_order DESC, g.created_at DESC`
    );
    res.json({ gifts: rows.map(adminGift) });
  });

  app.post("/api/admin/gifts/:id/inventory-grants", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = adminGiftGrantSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0]?.message || "礼物赠送参数不正确");
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [giftRows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT name FROM gifts WHERE id = ? LIMIT 1",
        [req.params.id]
      );
      if (!giftRows[0]) throw Object.assign(new Error("礼物不存在"), { status: 404 });
      const [userRows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT nickname FROM users WHERE id = ? LIMIT 1",
        [parsed.data.userId]
      );
      if (!userRows[0]) throw Object.assign(new Error("用户不存在"), { status: 404 });

      const result = await creditGiftInventory(connection, {
        userId: parsed.data.userId,
        giftId: req.params.id,
        quantity: parsed.data.quantity,
        idempotencyKey: `admin-gift:${admin.id}:${parsed.data.requestId}`,
        relatedType: "admin_gift_grant",
        relatedId: req.params.id,
        operatorId: admin.id,
        remark: `后台赠送${giftRows[0].name}×${parsed.data.quantity}`
      });
      await connection.commit();
      res.status(201).json({
        ...result,
        gift: { id: req.params.id, name: String(giftRows[0].name) },
        user: { id: parsed.data.userId, nickname: String(userRows[0].nickname) }
      });
    } catch (error) {
      await connection.rollback();
      const status = Number((error as { status?: number }).status ?? 500);
      if (status >= 500) console.error("Grant gift inventory failed:", error);
      return sendError(
        res,
        status,
        status >= 500 ? "赠送礼物失败，请稍后重试" : (error as Error).message
      );
    } finally {
      connection.release();
    }
  });

  app.get("/api/admin/gift-sends", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const offsetValue = Number(req.query.offset ?? 0);
    const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.floor(offsetValue)) : 0;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT gs.id, gs.gift_name_snapshot, gs.quantity, gs.created_at,
         sender.id AS sender_id, sender.nickname AS sender_nickname,
         recipient.id AS recipient_id, recipient.nickname AS recipient_nickname
       FROM gift_sends gs
       INNER JOIN users sender ON sender.id = gs.sender_id
       INNER JOIN users recipient ON recipient.id = gs.recipient_id
       ORDER BY gs.created_at DESC, gs.id DESC
       LIMIT 10 OFFSET ?`,
      [offset]
    );
    const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM gift_sends");
    res.json({
      total: Number(totalRow.total ?? 0),
      records: rows.map((row) => ({
        id: String(row.id),
        sender: { id: String(row.sender_id), nickname: String(row.sender_nickname) },
        recipient: { id: String(row.recipient_id), nickname: String(row.recipient_nickname) },
        giftName: String(row.gift_name_snapshot),
        quantity: Number(row.quantity),
        createdAt: new Date(row.created_at).toISOString()
      }))
    });
  });

  app.post("/api/admin/gifts", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = giftWriteSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.iconImage) {
      return sendError(res, 400, parsed.success ? "请上传礼物图标" : parsed.error.issues[0]?.message || "礼物参数不正确");
    }
    const id = nanoid();
    const optimizedIcon = await storeGiftIcon(parsed.data.iconImage, id);
    if (!optimizedIcon) return sendError(res, 400, "礼物图标无效，请上传 5MB 以内的 PNG、JPG、WebP 或 GIF");
    const value = parsed.data;
    await pool.query(
      `INSERT INTO gifts
       (id, name, description, icon_image, payment_currency, cost_amount, reward_shell, reward_pearl, reward_charm, status, sort_order)
       VALUES (?, ?, ?, ?, 'shell', ?, ?, ?, ?, ?, ?)`,
      [id, value.name, value.description, optimizedIcon, value.costAmount, value.rewardShell, value.rewardPearl, value.rewardCharm, value.status, value.sortOrder]
    );
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT g.*, 0 AS sent_count, 0 AS inventory_grant_count FROM gifts g WHERE id = ? LIMIT 1",
      [id]
    );
    res.status(201).json({ gift: adminGift(rows[0]) });
  });

  app.put("/api/admin/gifts/:id", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = giftWriteSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message || "礼物参数不正确");
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT g.*,
         (SELECT COUNT(*) FROM gift_sends gs WHERE gs.gift_id = g.id) AS sent_count,
         (SELECT COUNT(*) FROM gift_inventory_transactions git
          WHERE git.gift_id = g.id AND git.transaction_type = 'grant') AS inventory_grant_count
       FROM gifts g WHERE g.id = ? LIMIT 1`,
      [req.params.id]
    );
    const current = rows[0];
    if (!current) return sendError(res, 404, "礼物不存在");
    if (Number(current.sent_count) > 0 || Number(current.inventory_grant_count) > 0) {
      return sendError(res, 409, "已进入流通的礼物不可编辑，只能下架");
    }
    let optimizedIcon = String(current.icon_image);
    if (parsed.data.iconImage) {
      const nextIcon = await storeGiftIcon(parsed.data.iconImage, req.params.id);
      if (!nextIcon) return sendError(res, 400, "礼物图标无效，请上传 5MB 以内的 PNG、JPG、WebP 或 GIF");
      optimizedIcon = nextIcon;
    }
    const value = parsed.data;
    await pool.query(
      `UPDATE gifts SET name = ?, description = ?, icon_image = ?, payment_currency = 'shell',
       cost_amount = ?, reward_shell = ?, reward_pearl = ?, reward_charm = ?, status = ?, sort_order = ?
       WHERE id = ?`,
      [value.name, value.description, optimizedIcon, value.costAmount, value.rewardShell, value.rewardPearl, value.rewardCharm, value.status, value.sortOrder, req.params.id]
    );
    const [updated] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT g.*, 0 AS sent_count, 0 AS inventory_grant_count FROM gifts g WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    res.json({ gift: adminGift(updated[0]) });
  });

  app.patch("/api/admin/gifts/:id/status", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const parsed = z.object({ status: z.enum(["active", "inactive"]) }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "礼物状态不正确");
    const [result] = await pool.query<mysql.ResultSetHeader>(
      "UPDATE gifts SET status = ? WHERE id = ?",
      [parsed.data.status, req.params.id]
    );
    if (!result.affectedRows) return sendError(res, 404, "礼物不存在");
    res.json({ ok: true, status: parsed.data.status });
  });

  app.delete("/api/admin/gifts/:id", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const [sentRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM gifts g
       WHERE g.id = ? AND (
         EXISTS (SELECT 1 FROM gift_sends gs WHERE gs.gift_id = g.id)
         OR EXISTS (
           SELECT 1 FROM gift_inventory_transactions git
           WHERE git.gift_id = g.id AND git.transaction_type = 'grant'
         )
       )
       LIMIT 1`,
      [req.params.id]
    );
    if (sentRows[0]) return sendError(res, 409, "已进入流通的礼物不可删除，只能下架");
    const [result] = await pool.query<mysql.ResultSetHeader>("DELETE FROM gifts WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return sendError(res, 404, "礼物不存在");
    res.status(204).end();
  });
}
