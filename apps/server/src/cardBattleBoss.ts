import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import type { CardBattlePlayerInput, CardBattleResult } from "./cardBattle.js";
import { bossInputSchema, bossIsAvailable, type BossInput } from "./cardBattleBossRules.js";

export class CardBattleBossRuleError extends Error {}
type DB = mysql.Pool | mysql.PoolConnection;
export function parseBossCards(value: unknown): BossInput["cards"] {
  try { return (typeof value === "string" ? JSON.parse(value) : value) as BossInput["cards"]; }
  catch { throw new CardBattleBossRuleError("BOSS 卡牌配置不可用"); }
}
export async function loadBoss(roomId: string, db: DB = pool) {
  const [[row]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT bosses.*, rooms.name, rooms.room_code, NOW(3) AS db_now
     FROM card_battle_bosses bosses JOIN online_soup_rooms rooms ON rooms.id = bosses.room_id WHERE room_id = ?`, [roomId]);
  return row ?? null;
}
export function bossPublic(row: mysql.RowDataPacket) {
  return {
    roomId: String(row.room_id), name: String(row.name), code: String(row.room_code),
    enabled: Boolean(row.enabled), startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(),
    rewardShells: Number(row.reward_shells), revision: Number(row.revision),
    available: bossIsAvailable(row as any, new Date(row.db_now).getTime()), cards: parseBossCards(row.cards_json),
  };
}
export async function bossAvailable(roomId: string, db: DB = pool) {
  const row = await loadBoss(roomId, db);
  return Boolean(row && bossIsAvailable(row as any, new Date(row.db_now).getTime()));
}
export async function requireAvailableBoss(roomId: string, db: DB) {
  const boss = await loadBoss(roomId, db);
  if (!boss || !bossIsAvailable(boss as any, new Date(boss.db_now).getTime())) throw new CardBattleBossRuleError("BOSS 房间尚未开放、已下架或已到期，不能加入或开始新挑战");
  return boss;
}
export function bossBattlePlayer(row: mysql.RowDataPacket): CardBattlePlayerInput {
  const input = bossInputSchema.safeParse({ ...bossPublic(row), enabled: true });
  if (!input.success) throw new CardBattleBossRuleError("BOSS 五张卡牌尚未完整配置，暂时不能开始挑战");
  return {
    userId: `boss:${row.room_id}`, nickname: String(row.name), seat: 2,
    cards: input.data.cards.map((card, index) => ({
      instanceId: `boss:${row.room_id}:${index + 1}`, cardId: `boss:${row.room_id}:${index + 1}`,
      name: card!.name, imageUrl: card!.imageUrl, rarity: "legend", battleRole: "damage", starLevel: 3,
      slot: (index + 1) as 1 | 2 | 3 | 4 | 5, motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
      tier: { ...card!.tier, effects: card!.tier.effects.map((effect, i) => ({ ...effect, id: `boss:${index}:${i}` })) },
    })),
  };
}

type RewardEvent = { userId: string; amount: number; balance: number; source?: "card_battle_boss" | "card_tower" };
let rewardListener: (events: RewardEvent[]) => void = () => {};
export function setBossRewardListener(listener: typeof rewardListener) { rewardListener = listener; }
export function emitBossRewards(events: RewardEvent[]) { if (events.length) rewardListener(events); }

/** The caller holds the room and game locks. Rewards and finalization share one transaction. */
export async function settleBossRewards(game: mysql.RowDataPacket, result: CardBattleResult, db: mysql.PoolConnection): Promise<RewardEvent[]> {
  if (game.mode !== "boss" || result.mode !== "boss" || result.winnerSeat !== 1 || result.endReason !== "elimination") return [];
  const [participants] = await db.query<mysql.RowDataPacket[]>(
    `SELECT participants.user_id FROM card_battle_boss_participants participants
     WHERE game_id = ? AND forfeited_at IS NULL ORDER BY user_id FOR UPDATE`, [game.id]);
  const events: RewardEvent[] = [];
  for (const participant of participants) {
    const userId = String(participant.user_id);
    if (!result.players.some((player) => player.seat === 1 && player.userId === userId)) throw new CardBattleBossRuleError("挑战参与记录与对局不一致");
    const [[user]] = await db.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!user) continue;
    const [[claimed]] = await db.query<mysql.RowDataPacket[]>("SELECT 1 FROM card_battle_boss_rewards WHERE room_id = ? AND user_id = ? FOR UPDATE", [game.room_id, userId]);
    if (claimed) continue;
    const amount = Number(game.boss_reward_shells);
    const balance = Number(user.shell_balance) + amount;
    if (!Number.isSafeInteger(amount) || amount < 0 || balance > 4_294_967_295) throw new CardBattleBossRuleError("通关奖励暂时无法入账，请联系管理员");
    await db.query("INSERT INTO card_battle_boss_rewards (room_id, user_id, game_id, amount) VALUES (?, ?, ?, ?)", [game.room_id, userId, game.id, amount]);
    await db.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balance, userId]);
    await db.query(`INSERT INTO shell_transactions
      (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
      VALUES (?, ?, 'card_battle_boss', ?, ?, 'card_battle_boss', ?, ?, ?)`,
      [nanoid(), userId, amount, balance, game.room_id, `首次通关「${game.boss_name_snapshot}」`, `boss:${game.room_id}:${userId}`]);
    await db.query(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
      VALUES (?, ?, 'card_battle_boss', 'BOSS 挑战通关奖励', ?, ?)`,
      [nanoid(), userId, `首次通关「${game.boss_name_snapshot}」，${amount} 贝壳已到账。每个房间仅可获得一次通关奖励。`, game.room_id]);
    events.push({ userId, amount, balance });
  }
  return events;
}
