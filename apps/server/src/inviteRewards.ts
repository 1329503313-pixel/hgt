import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { MAX_EXPERIENCE } from "./levelSystem.js";

const INVITE_EMAIL_SHELL_REWARD = 50;
const INVITE_EMAIL_EXPERIENCE_REWARD = 50;
const INVITE_SHELL_MILESTONE = 20;
const INVITE_SHELL_REWARD = 1;
const INVITE_SHELL_EXPERIENCE_REWARD = 1;
const SETTLEMENT_BATCH_SIZE = 200;
const SETTLEMENT_DELAY_MS = 5 * 60_000;
const SETTLEMENT_LOCK = "hgt:invite-shell-daily-settlement";
const EMAIL_SYNC_LOCK = "hgt:invite-email-reward-sync";
const EXCLUDED_TRANSACTION_TYPES = ["invite_email_reward", "invite_shell_milestone_reward"] as const;

type QueryConnection = mysql.PoolConnection;

let rewardProgressListener: ((userId: string) => void) | null = null;

export function setInviteRewardProgressListener(listener: (userId: string) => void) {
  rewardProgressListener = listener;
}

export function calculateInviteMilestoneDelta(totalEarned: number, alreadyRewarded: number) {
  const target = Math.floor(Math.max(0, totalEarned) / INVITE_SHELL_MILESTONE);
  return Math.max(0, target - Math.max(0, alreadyRewarded));
}

export async function awardInviteEmailBindingWithConnection(connection: QueryConnection, inviteeUserId: string) {
  const [[progress]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT inviter_user_id, email_rewarded_at
     FROM user_invite_reward_progress
     WHERE invitee_user_id = ?
     FOR UPDATE`,
    [inviteeUserId]
  );
  if (!progress || progress.email_rewarded_at) return { awarded: false, inviterId: null as string | null };

  const inviterId = String(progress.inviter_user_id);
  const [[inviter]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT shell_balance, experience FROM users WHERE id = ? FOR UPDATE",
    [inviterId]
  );
  if (!inviter) return { awarded: false, inviterId: null as string | null };

  const balanceAfter = Number(inviter.shell_balance ?? 0) + INVITE_EMAIL_SHELL_REWARD;
  const experienceReward = Math.max(
    0,
    Math.min(INVITE_EMAIL_EXPERIENCE_REWARD, MAX_EXPERIENCE - Number(inviter.experience ?? 0))
  );
  await connection.query(
    "UPDATE users SET shell_balance = ?, experience = experience + ? WHERE id = ?",
    [balanceAfter, experienceReward, inviterId]
  );
  await connection.query(
    `INSERT INTO shell_transactions
      (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
     VALUES (?, ?, 'invite_email_reward', ?, ?, 'invited_user', ?, '邀请用户注册并绑定邮箱奖励', ?)`,
    [
      nanoid(),
      inviterId,
      INVITE_EMAIL_SHELL_REWARD,
      balanceAfter,
      inviteeUserId,
      `invite-email:${inviteeUserId}`
    ]
  );
  await connection.query(
    `UPDATE user_invite_reward_progress
     SET email_rewarded_at = UTC_TIMESTAMP(),
         email_shell_reward = ?,
         email_experience_reward = ?,
         updated_at = UTC_TIMESTAMP()
     WHERE invitee_user_id = ?`,
    [INVITE_EMAIL_SHELL_REWARD, experienceReward, inviteeUserId]
  );
  rewardProgressListener?.(inviterId);
  return { awarded: true, inviterId };
}

export async function syncPendingInviteEmailRewards() {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let awardedCount = 0;
  try {
    const [[lockRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 1) AS acquired", [EMAIL_SYNC_LOCK]);
    lockAcquired = Number(lockRow?.acquired ?? 0) === 1;
    if (!lockAcquired) return { skipped: true, awardedCount: 0 };
    let cursor = "";
    while (true) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT progress.invitee_user_id
         FROM user_invite_reward_progress progress
         WHERE progress.invitee_user_id > ?
           AND progress.email_rewarded_at IS NULL
           AND EXISTS (
             SELECT 1 FROM user_identities identity_row
             WHERE identity_row.user_id = progress.invitee_user_id
               AND identity_row.identity_type = 'email'
               AND identity_row.verified_at IS NOT NULL
           )
         ORDER BY progress.invitee_user_id ASC
         LIMIT ?`,
        [cursor, SETTLEMENT_BATCH_SIZE]
      );
      if (!rows.length) break;
      for (const row of rows) {
        await connection.beginTransaction();
        try {
          const result = await awardInviteEmailBindingWithConnection(connection, String(row.invitee_user_id));
          await connection.commit();
          if (result.awarded) awardedCount += 1;
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      }
      cursor = String(rows.at(-1)?.invitee_user_id ?? cursor);
    }
    return { skipped: false, awardedCount };
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", [EMAIL_SYNC_LOCK]).catch(() => undefined);
    connection.release();
  }
}

function beijingDateAndHour(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour"))
  };
}

export async function runDailyInviteShellSettlement(now = new Date()) {
  const { date, hour } = beijingDateAndHour(now);
  if (hour < 3) return { skipped: true, reason: "before_settlement_hour", rewardedMilestones: 0 };
  const migrationKey = `invite-shell-settlement:${date}`;
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let rewardedMilestones = 0;
  const rewardedInviters = new Set<string>();
  try {
    const [[completed]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT migration_key FROM app_data_migrations WHERE migration_key = ? LIMIT 1",
      [migrationKey]
    );
    if (completed) return { skipped: true, reason: "already_settled", rewardedMilestones: 0 };
    const [[lockRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 1) AS acquired", [SETTLEMENT_LOCK]);
    lockAcquired = Number(lockRow?.acquired ?? 0) === 1;
    if (!lockAcquired) return { skipped: true, reason: "lock_busy", rewardedMilestones: 0 };

    const cutoff = new Date(now.getTime() - SETTLEMENT_DELAY_MS);
    let cursor = "";
    while (true) {
      await connection.beginTransaction();
      try {
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT binding.invitee_user_id, binding.inviter_user_id,
            progress.qualifying_shell_earned, progress.shell_milestones_rewarded,
            progress.shell_experience_reward, progress.settled_through,
            COALESCE(SUM(shell_tx.amount), 0) AS newly_earned
           FROM user_invite_bindings binding
           INNER JOIN user_invite_reward_progress progress
             ON progress.invitee_user_id = binding.invitee_user_id
           LEFT JOIN shell_transactions shell_tx
             ON shell_tx.user_id = binding.invitee_user_id
            AND shell_tx.amount > 0
            AND shell_tx.created_at > progress.settled_through
            AND shell_tx.created_at <= ?
            AND shell_tx.transaction_type NOT IN (?, ?)
           WHERE binding.invitee_user_id > ?
           GROUP BY binding.invitee_user_id, binding.inviter_user_id,
             progress.qualifying_shell_earned, progress.shell_milestones_rewarded,
             progress.shell_experience_reward, progress.settled_through
           ORDER BY binding.invitee_user_id ASC
           LIMIT ?`,
          [cutoff, ...EXCLUDED_TRANSACTION_TYPES, cursor, SETTLEMENT_BATCH_SIZE]
        );
        if (!rows.length) {
          await connection.commit();
          break;
        }

        for (const row of rows) {
          const inviteeUserId = String(row.invitee_user_id);
          const inviterId = String(row.inviter_user_id);
          const totalEarned = Number(row.qualifying_shell_earned ?? 0) + Number(row.newly_earned ?? 0);
          const alreadyRewarded = Number(row.shell_milestones_rewarded ?? 0);
          const milestoneDelta = calculateInviteMilestoneDelta(totalEarned, alreadyRewarded);
          let experienceReward = 0;
          if (milestoneDelta > 0) {
            const [[inviter]] = await connection.query<mysql.RowDataPacket[]>(
              "SELECT shell_balance, experience FROM users WHERE id = ? FOR UPDATE",
              [inviterId]
            );
            if (inviter) {
              const shellReward = milestoneDelta * INVITE_SHELL_REWARD;
              const balanceAfter = Number(inviter.shell_balance ?? 0) + shellReward;
              experienceReward = Math.max(
                0,
                Math.min(
                  milestoneDelta * INVITE_SHELL_EXPERIENCE_REWARD,
                  MAX_EXPERIENCE - Number(inviter.experience ?? 0)
                )
              );
              await connection.query(
                "UPDATE users SET shell_balance = ?, experience = experience + ? WHERE id = ?",
                [balanceAfter, experienceReward, inviterId]
              );
              await connection.query(
                `INSERT INTO shell_transactions
                  (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
                 VALUES (?, ?, 'invite_shell_milestone_reward', ?, ?, 'invited_user', ?, ?, ?)`,
                [
                  nanoid(),
                  inviterId,
                  shellReward,
                  balanceAfter,
                  inviteeUserId,
                  `邀请用户累计获得贝壳奖励（${milestoneDelta} 次）`,
                  `invite-shell:${inviteeUserId}:${alreadyRewarded + 1}-${alreadyRewarded + milestoneDelta}`
                ]
              );
              rewardedMilestones += milestoneDelta;
              rewardedInviters.add(inviterId);
            }
          }
          await connection.query(
            `UPDATE user_invite_reward_progress
             SET qualifying_shell_earned = ?,
                 shell_milestones_rewarded = ?,
                 shell_experience_reward = shell_experience_reward + ?,
                 settled_through = ?,
                 updated_at = UTC_TIMESTAMP()
             WHERE invitee_user_id = ?`,
            [totalEarned, alreadyRewarded + milestoneDelta, experienceReward, cutoff, inviteeUserId]
          );
        }
        cursor = String(rows.at(-1)?.invitee_user_id ?? cursor);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    await connection.query("INSERT IGNORE INTO app_data_migrations (migration_key) VALUES (?)", [migrationKey]);
    rewardedInviters.forEach((userId) => rewardProgressListener?.(userId));
    return { skipped: false, reason: null, rewardedMilestones };
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", [SETTLEMENT_LOCK]).catch(() => undefined);
    connection.release();
  }
}

export async function inviteRewardTaskStats(inviterUserId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
      COALESCE(SUM(CASE WHEN email_rewarded_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS email_completed_count,
      COALESCE(SUM(email_shell_reward), 0) AS email_shell_reward,
      COALESCE(SUM(email_experience_reward), 0) AS email_experience_reward,
      COALESCE(SUM(shell_milestones_rewarded), 0) AS shell_completed_count,
      COALESCE(SUM(shell_milestones_rewarded), 0) AS shell_reward,
      COALESCE(SUM(shell_experience_reward), 0) AS shell_experience_reward
     FROM user_invite_reward_progress
     WHERE inviter_user_id = ?`,
    [inviterUserId]
  );
  return {
    emailCompletedCount: Number(row?.email_completed_count ?? 0),
    emailShellReward: Number(row?.email_shell_reward ?? 0),
    emailExperienceReward: Number(row?.email_experience_reward ?? 0),
    shellCompletedCount: Number(row?.shell_completed_count ?? 0),
    shellReward: Number(row?.shell_reward ?? 0),
    shellExperienceReward: Number(row?.shell_experience_reward ?? 0)
  };
}
