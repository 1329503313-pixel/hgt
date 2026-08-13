import type mysql from "mysql2/promise";

export const CHAT_STICKER_BURST_SIZE = 3;
export const CHAT_STICKER_COOLDOWN_MS = 10_000;

export type ChatMessageScope = "private" | "circle" | "online_soup";

export function stickerCooldownRemainingMs(
  consecutiveStickerCount: number,
  elapsedSinceLastStickerMs: number,
): number {
  if (consecutiveStickerCount < CHAT_STICKER_BURST_SIZE) return 0;
  if (!Number.isFinite(elapsedSinceLastStickerMs)) return CHAT_STICKER_COOLDOWN_MS;
  return Math.max(0, CHAT_STICKER_COOLDOWN_MS - Math.max(0, elapsedSinceLastStickerMs));
}

/**
 * 原子记录同一用户在一个聊天范围内的发送序列。
 * 连续 3 个表情后，第 4 个及之后的每个表情都必须与前一个至少间隔 10 秒；
 * 用户自己发送任意非表情消息后重置。数据库行锁保证多实例及并发请求也无法绕过。
 */
export async function recordChatMessageForRateLimit(
  connection: mysql.PoolConnection,
  input: {
    scopeType: ChatMessageScope;
    scopeId: string;
    userId: string;
    messageType: string;
  },
): Promise<number> {
  await connection.query(
    `INSERT INTO chat_message_rate_limits
       (scope_type, scope_id, user_id, consecutive_sticker_count, last_sticker_at)
     VALUES (?, ?, ?, 0, NULL)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
    [input.scopeType, input.scopeId, input.userId],
  );
  const [[state]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT consecutive_sticker_count,
       CASE WHEN last_sticker_at IS NULL THEN NULL
         ELSE TIMESTAMPDIFF(MICROSECOND, last_sticker_at, CURRENT_TIMESTAMP(6)) / 1000
       END AS elapsed_ms
     FROM chat_message_rate_limits
     WHERE scope_type = ? AND scope_id = ? AND user_id = ?
     FOR UPDATE`,
    [input.scopeType, input.scopeId, input.userId],
  );

  if (input.messageType !== "sticker") {
    await connection.query(
      `UPDATE chat_message_rate_limits
       SET consecutive_sticker_count = 0, last_sticker_at = NULL
       WHERE scope_type = ? AND scope_id = ? AND user_id = ?`,
      [input.scopeType, input.scopeId, input.userId],
    );
    return 0;
  }

  const remainingMs = stickerCooldownRemainingMs(
    Number(state?.consecutive_sticker_count ?? 0),
    state?.elapsed_ms == null ? Number.POSITIVE_INFINITY : Number(state.elapsed_ms),
  );
  if (remainingMs > 0) return remainingMs;

  await connection.query(
    `UPDATE chat_message_rate_limits
     SET consecutive_sticker_count = consecutive_sticker_count + 1,
         last_sticker_at = CURRENT_TIMESTAMP(6)
     WHERE scope_type = ? AND scope_id = ? AND user_id = ?`,
    [input.scopeType, input.scopeId, input.userId],
  );
  return 0;
}

export function stickerCooldownMessage(remainingMs: number): string {
  return `连续发送 3 个表情后，请等待 ${Math.max(1, Math.ceil(remainingMs / 1000))} 秒再发送`;
}
