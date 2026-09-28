import type express from "express";
import type mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { CARD_BATTLE_TRAIT_EFFECTS, CARD_BATTLE_TRAIT_TARGETS, cardBattleTraitEffectError, type CardBattleTrait, type CardBattleTraitEffect } from "@hgt/shared";
import { pool } from "./db.js";

const effectSchema = z.object({
  requiredCount: z.number().int().min(1).max(5),
  type: z.enum(CARD_BATTLE_TRAIT_EFFECTS),
  target: z.enum(CARD_BATTLE_TRAIT_TARGETS),
  valueType: z.enum(["flat", "percent"]),
  value: z.number().positive().max(1_000_000),
  cadence: z.enum(["fixed", "round"]),
  durationRounds: z.number().int().min(1).max(30).nullable(),
}).strict().superRefine((effect, context) => {
  const error = cardBattleTraitEffectError(effect as CardBattleTraitEffect);
  if (error) context.addIssue({ code: "custom", message: error });
});
const traitInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000),
  effects: z.array(effectSchema).min(1).max(5),
}).strict();

export function cardTraitsFromJson(value: unknown): CardBattleTrait[] {
  if (typeof value === "string") {
    try { return cardTraitsFromJson(JSON.parse(value)); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((trait): trait is CardBattleTrait => Boolean(trait && typeof trait === "object" && typeof trait.id === "string" && typeof trait.name === "string" && Array.isArray(trait.effects)));
}

export async function selectedCardBattleTraits(ids: string[] | undefined, db: mysql.Pool | mysql.PoolConnection = pool): Promise<CardBattleTrait[]> {
  if (!ids?.length) return [];
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length || unique.length > 20) throw new Error("特质不能重复选择，且一张卡最多选择20个特质");
  const [rows] = await db.query<mysql.RowDataPacket[]>(`SELECT id,name,description,effects_json FROM card_battle_traits WHERE id IN (${unique.map(() => "?").join(",")})`, unique);
  const byId = new Map(rows.map((row) => [String(row.id), {
    id: String(row.id), name: String(row.name), description: String(row.description),
    effects: (typeof row.effects_json === "string" ? JSON.parse(row.effects_json) : row.effects_json) as CardBattleTraitEffect[],
  } satisfies CardBattleTrait]));
  if (byId.size !== unique.length) throw new Error("所选特质已删除，请重新选择");
  return unique.map((id) => byId.get(id)!);
}

export function registerCardBattleTraitRoutes(app: express.Express, dependencies: {
  requireAdmin: (req: express.Request, res: express.Response) => Promise<unknown>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
}) {
  const { requireAdmin, sendError } = dependencies;
  app.get("/api/admin/card-battle/traits", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id,name,description,effects_json FROM card_battle_traits ORDER BY name,id");
    res.setHeader("Cache-Control", "no-store");
    res.json({ traits: rows.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description), effects: typeof row.effects_json === "string" ? JSON.parse(row.effects_json) : row.effects_json })) });
  });
  app.post("/api/admin/card-battle/traits", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = traitInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "特质配置无效");
    const id = nanoid();
    try {
      await pool.query("INSERT INTO card_battle_traits (id,name,description,effects_json) VALUES (?,?,?,?)", [id, parsed.data.name, parsed.data.description, JSON.stringify(parsed.data.effects)]);
      res.status(201).json({ id });
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") return sendError(res, 409, "特质名称已存在");
      throw error;
    }
  });
  app.patch("/api/admin/card-battle/traits/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = traitInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "特质配置无效");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM card_battle_traits WHERE id=? FOR UPDATE", [req.params.id]);
      if (!existing) { await connection.rollback(); return sendError(res, 404, "特质不存在"); }
      await connection.query("UPDATE card_battle_traits SET name=?,description=?,effects_json=? WHERE id=?", [parsed.data.name, parsed.data.description, JSON.stringify(parsed.data.effects), req.params.id]);
      const [cards] = await connection.query<mysql.RowDataPacket[]>("SELECT id,battle_traits_json FROM asset_cards WHERE JSON_CONTAINS(COALESCE(battle_traits_json, JSON_ARRAY()), JSON_OBJECT('id', ?)) FOR UPDATE", [req.params.id]);
      for (const card of cards) {
        const selected = cardTraitsFromJson(card.battle_traits_json);
        const updated = selected.map((trait) => trait.id === req.params.id ? { id: req.params.id, ...parsed.data } : trait);
        await connection.query("UPDATE asset_cards SET battle_traits_json=? WHERE id=?", [JSON.stringify(updated), card.id]);
      }
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") return sendError(res, 409, "特质名称已存在");
      throw error;
    } finally { connection.release(); }
  });
  app.delete("/api/admin/card-battle/traits/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[trait]] = await connection.query<mysql.RowDataPacket[]>("SELECT name FROM card_battle_traits WHERE id=? FOR UPDATE", [req.params.id]);
      if (!trait) { await connection.rollback(); return sendError(res, 404, "特质不存在"); }
      const [cards] = await connection.query<mysql.RowDataPacket[]>("SELECT id,battle_traits_json FROM asset_cards WHERE JSON_CONTAINS(COALESCE(battle_traits_json, JSON_ARRAY()), JSON_OBJECT('id', ?)) FOR UPDATE", [req.params.id]);
      for (const card of cards) await connection.query("UPDATE asset_cards SET battle_traits_json=? WHERE id=?", [JSON.stringify(cardTraitsFromJson(card.battle_traits_json).filter((item) => item.id !== req.params.id)), card.id]);
      await connection.query("DELETE FROM card_battle_traits WHERE id=?", [req.params.id]);
      await connection.commit();
      res.json({ ok: true, detachedCards: cards.length });
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  });
}
