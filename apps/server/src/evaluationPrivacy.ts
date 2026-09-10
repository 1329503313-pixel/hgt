import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";

export const evaluationTypeSchema = z.enum(["all", "normal", "anonymous"]).default("all");

export function presentEvaluation<T extends { isAnonymous: boolean; reviewerId: unknown }>(evaluation: T, viewerId?: string, audience: "public" | "admin" = "public") {
  const isOwnEvaluation = Boolean(viewerId && String(evaluation.reviewerId) === viewerId);
  if (!evaluation.isAnonymous || audience === "admin") return { ...evaluation, isOwnEvaluation };
  return {
    ...evaluation, isOwnEvaluation,
    reviewer: "匿名用户", reviewerId: null, reviewerAvatar: null,
    reviewerLevel: 0, reviewerVipGrowthValue: 0, reviewerVipLevel: 0 as const,
    reviewerVipActive: false, reviewerEquippedBadge: null, isCreatorEvaluation: false,
  };
}

export function presentEvaluationInteraction<T extends { isAnonymous: boolean }>(interaction: T) {
  return interaction.isAnonymous ? { ...interaction, userId: null, nickname: "匿名用户", avatar: null } : interaction;
}

export function evaluationAdminFilter(keyword: string, type: z.infer<typeof evaluationTypeSchema>) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (keyword) {
    conditions.push("(e.reviewer LIKE ? OR e.content LIKE ? OR s.title LIKE ?)");
    params.push(...Array<string>(3).fill(`%${keyword}%`));
  }
  if (type !== "all") { conditions.push("e.is_anonymous = ?"); params.push(type === "anonymous" ? 1 : 0); }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

// Keep the notification and its anonymity change in the evaluation transaction.
export async function syncEvaluationNotification(connection: Pick<mysql.PoolConnection, "query">, input: {
  soupId: string; soupTitle: string; creatorId: string; reviewerId: string; reviewer: string;
  total: number; isAnonymous: boolean; created: boolean;
}) {
  if (input.creatorId === input.reviewerId) return false;
  const content = `${input.isAnonymous ? "匿名用户" : input.reviewer} 评价了你的海龟汤《${input.soupTitle}》，评分 ${input.total} 分`.slice(0, 500);
  if (input.created) {
    const [result] = await connection.query<mysql.ResultSetHeader>(
      "INSERT IGNORE INTO notifications (id, user_id, type, title, content, related_id, actor_id) VALUES (?, ?, 'soup_evaluation', '收到新的评价', ?, ?, ?)",
      [nanoid(), input.creatorId, content, input.soupId, input.isAnonymous ? null : input.reviewerId],
    );
    return result.affectedRows > 0;
  }
  if (input.isAnonymous) {
    const [result] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE notifications SET content = ?, actor_id = NULL WHERE type = 'soup_evaluation' AND related_id = ? AND actor_id = ?",
      [content, input.soupId, input.reviewerId],
    );
    return result.affectedRows > 0;
  }
  return false;
}
