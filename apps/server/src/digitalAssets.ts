import type express from "express";
import type mysql from "mysql2/promise";
import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { z } from "zod";
import { pool } from "./db.js";
import { beijingTaskDate } from "./shellCurrency.js";

type RouteUser = { id: string; role: "admin" | "user" | string };
type RouteDependencies = {
  requireAuth: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  requireAdmin: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
  sendStoredImage: (
    req: express.Request,
    res: express.Response,
    value: unknown,
    maxWidth: number,
    cacheControl?: string
  ) => Promise<express.Response | void>;
  onBadgeProgress?: (userId: string) => void;
};

const assetMediaSourceCache = new Map<string, { expiresAt: number; image: unknown }>();

function cacheAssetMedia(key: string, image: unknown) {
  assetMediaSourceCache.set(key, { expiresAt: Date.now() + 10 * 60_000, image });
  if (assetMediaSourceCache.size > 80) assetMediaSourceCache.delete(assetMediaSourceCache.keys().next().value!);
}

type Rarity = "normal" | "rare" | "epic" | "legend";
type PackType = "permanent" | "limited" | "collaboration";
type PityType = "rare" | "epic" | "legend";
type PityState = { rare_count: number; epic_count: number; legend_count: number };

const RARITY_RANK: Record<Rarity, number> = { normal: 0, rare: 1, epic: 2, legend: 3 };
const RARITY_LABELS: Record<Rarity, string> = { normal: "普通", rare: "稀有", epic: "史诗", legend: "传说" };
const COLLECTION_VALUES: Record<Rarity, readonly [number, number, number, number]> = {
  normal: [1, 2, 5, 15],
  rare: [2, 5, 12, 35],
  epic: [5, 12, 30, 100],
  legend: [15, 40, 120, 360]
};
const FULL_STAR_REFUNDS: Record<Rarity, number> = { normal: 2, rare: 4, epic: 8, legend: 30 };
const PITY_LIMITS: Record<PityType, number> = { rare: 10, epic: 60, legend: 150 };
const PACK_TYPE_LABELS: Record<PackType, string> = { permanent: "常驻卡包", limited: "限定卡包", collaboration: "联动卡包" };
const PUBLIC_PACK_COLUMNS = `id, name, '' AS cover_url, description, pack_story, pack_type,
  single_price, ten_price, daily_free_draws, sale_start_at, sale_end_at, enabled,
  sort_order, probability_notice, created_at, updated_at`;

function richTextCharacterCount(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, "x")
    .trim().length;
}

const cardSchema = z.object({
  cardNo: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  rarity: z.enum(["normal", "rare", "epic", "legend"]),
  imageUrl: z.string().trim().min(1).max(8_000_000),
  thumbnailUrl: z.string().trim().max(8_000_000).optional().default(""),
  story: z.string().trim().max(20_000).optional().default(""),
  releaseAt: z.string().datetime().nullable().optional().default(null),
  status: z.enum(["active", "inactive"]).optional().default("inactive"),
  packIds: z.array(z.string().trim().min(1).max(64)).min(1, "卡牌必须至少绑定一个卡包").max(500).transform((ids) => [...new Set(ids)]).optional().default([])
});

const packSchemaObject = z.object({
  name: z.string().trim().min(1).max(120),
  coverUrl: z.string().trim().min(1).max(8_000_000),
  description: z.string().trim().max(1000).optional().default(""),
  packStory: z.string().trim().max(20_000).refine((value) => richTextCharacterCount(value) <= 3000, "卡包故事不能超过3000字").optional().default(""),
  packType: z.enum(["permanent", "limited", "collaboration"]),
  singlePrice: z.coerce.number().int().min(0).max(1_000_000),
  tenPrice: z.coerce.number().int().min(0).max(10_000_000),
  dailyFreeDraws: z.coerce.number().int().min(0).max(100).optional().default(0),
  saleStartAt: z.string().datetime().nullable().optional().default(null),
  saleEndAt: z.string().datetime().nullable().optional().default(null),
  enabled: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional().default(0),
  probabilityNotice: z.string().trim().max(20_000).optional().default("")
});
const packSchema = packSchemaObject.superRefine((value, ctx) => {
  if (value.packType !== "permanent" && !value.saleStartAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "限定卡包和联名卡包必须设置上架时间", path: ["saleStartAt"] });
  }
  if (value.packType !== "permanent" && !value.saleEndAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "限定卡包和联名卡包必须设置下架时间", path: ["saleEndAt"] });
  }
  if (value.saleStartAt && value.saleEndAt && value.saleEndAt <= value.saleStartAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "下架时间必须晚于上架时间", path: ["saleEndAt"] });
  }
});

const rarityProbabilitiesSchema = z.object({
  probabilities: z.object({
    normal: z.coerce.number().min(0).max(100),
    rare: z.coerce.number().min(0).max(100),
    epic: z.coerce.number().min(0).max(100),
    legend: z.coerce.number().min(0).max(100)
  })
}).superRefine((value, ctx) => {
  const total = Object.values(value.probabilities).reduce((sum, probability) => sum + probability, 0);
  if (Math.abs(total - 100) > 0.000001) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "四种品质概率合计必须为100%", path: ["probabilities"] });
});

function bool(value: unknown) {
  return Boolean(Number(value));
}

function iso(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

function rarity(value: unknown): Rarity {
  const candidate = String(value) as Rarity;
  return candidate in RARITY_RANK ? candidate : "normal";
}

function packType(value: unknown): PackType {
  const candidate = String(value) as PackType;
  return candidate in PACK_TYPE_LABELS ? candidate : "permanent";
}

async function optimizedAssetImages(value: string, fullWidth: number, thumbnailWidth: number) {
  const match = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) return { full: value, thumbnail: value };
  const source = Buffer.from(match[1], "base64");
  const [full, thumbnail] = await Promise.all([
    sharp(source).rotate().resize({ width: fullWidth, height: fullWidth, fit: "inside", withoutEnlargement: true }).webp({ quality: 84, effort: 4 }).toBuffer(),
    sharp(source).rotate().resize({ width: thumbnailWidth, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer()
  ]);
  return {
    full: `data:image/webp;base64,${full.toString("base64")}`,
    thumbnail: `data:image/webp;base64,${thumbnail.toString("base64")}`
  };
}

function packStatus(row: mysql.RowDataPacket, now = Date.now()) {
  if (!bool(row.enabled)) return "offline" as const;
  if (packType(row.pack_type) === "permanent") return "on_sale" as const;
  const start = row.sale_start_at ? new Date(row.sale_start_at).getTime() : null;
  const end = row.sale_end_at ? new Date(row.sale_end_at).getTime() : null;
  if (start != null && start > now) return "upcoming" as const;
  if (end != null && end <= now) return "ended" as const;
  return "on_sale" as const;
}

async function pruneDrawHistory(userId: string, executor: mysql.Pool | mysql.PoolConnection = pool) {
  const [staleRows] = await executor.query<mysql.RowDataPacket[]>(
    `SELECT id FROM asset_draw_orders
     WHERE user_id = ? AND status = 'completed'
     ORDER BY created_at DESC, id DESC
     LIMIT 10, 18446744073709551615`,
    [userId]
  );
  if (staleRows.length === 0) return;
  await executor.query(
    `DELETE FROM asset_draw_orders WHERE user_id = ? AND id IN (${staleRows.map(() => "?").join(",")})`,
    [userId, ...staleRows.map((row) => String(row.id))]
  );
}

function assetVersion(value: unknown) {
  return value ? new Date(value as string | number | Date).getTime() : 0;
}

function cardMediaUrl(row: mysql.RowDataPacket, variant: "image" | "thumbnail") {
  const id = String(row.id ?? row.card_id);
  return `/api/media/assets/cards/${encodeURIComponent(id)}/${variant}?v=${assetVersion(row.updated_at)}`;
}

function packMediaUrl(row: mysql.RowDataPacket, variant: "cover" | "thumbnail") {
  return `/api/media/assets/packs/${encodeURIComponent(String(row.id ?? row.pack_id))}/${variant}?v=${assetVersion(row.updated_at ?? row.pack_updated_at)}`;
}

function cardPayload(row: mysql.RowDataPacket, useMediaUrls = false) {
  return {
    id: String(row.id ?? row.card_id),
    cardNo: String(row.card_no),
    name: String(row.name),
    rarity: rarity(row.rarity),
    imageUrl: useMediaUrls ? cardMediaUrl(row, "image") : String(row.image_url),
    thumbnailUrl: useMediaUrls ? cardMediaUrl(row, "thumbnail") : row.thumbnail_url ? String(row.thumbnail_url) : String(row.image_url),
    story: String(row.story ?? ""),
    releaseAt: iso(row.release_at),
    status: String(row.status ?? "active")
  };
}

function packPayload(row: mysql.RowDataPacket, mediaVariant?: "cover" | "thumbnail") {
  const type = packType(row.pack_type);
  return {
    id: String(row.id),
    name: String(row.name),
    coverUrl: mediaVariant ? packMediaUrl(row, mediaVariant) : String(row.cover_url),
    description: String(row.description ?? ""),
    packStory: String(row.pack_story ?? ""),
    packType: type,
    packTypeLabel: PACK_TYPE_LABELS[type],
    singlePrice: Number(row.single_price ?? 0),
    tenPrice: Number(row.ten_price ?? 0),
    dailyFreeDraws: Number(row.daily_free_draws ?? 0),
    saleStartAt: type === "permanent" ? null : iso(row.sale_start_at),
    saleEndAt: type === "permanent" ? null : iso(row.sale_end_at),
    enabled: bool(row.enabled),
    status: packStatus(row),
    sortOrder: Number(row.sort_order ?? 0),
    probabilityNotice: String(row.probability_notice ?? "")
  };
}

function starForTotal(total: number) {
  if (total >= 19) return 3;
  if (total >= 9) return 2;
  if (total >= 4) return 1;
  return 0;
}

function duplicateProgress(total: number, star: number) {
  if (star >= 3) return 0;
  return Math.max(0, total - ([1, 4, 9] as const)[star]);
}

function nextStarRequirement(star: number) {
  return star >= 3 ? null : ([3, 5, 10] as const)[star];
}

function pityTrigger(row: PityState): PityType | null {
  if (Number(row.legend_count ?? 0) + 1 >= PITY_LIMITS.legend) return "legend";
  if (Number(row.epic_count ?? 0) + 1 >= PITY_LIMITS.epic) return "epic";
  if (Number(row.rare_count ?? 0) + 1 >= PITY_LIMITS.rare) return "rare";
  return null;
}

function updatePity(current: PityState, drawn: Rarity) {
  const rank = RARITY_RANK[drawn];
  return {
    rare: rank >= RARITY_RANK.rare ? 0 : Number(current.rare_count ?? 0) + 1,
    epic: rank >= RARITY_RANK.epic ? 0 : Number(current.epic_count ?? 0) + 1,
    legend: rank >= RARITY_RANK.legend ? 0 : Number(current.legend_count ?? 0) + 1
  };
}

function chooseWeighted(cards: mysql.RowDataPacket[], probabilities: Record<Rarity, number>, minimum: PityType | null) {
  const minRank = minimum ? RARITY_RANK[minimum] : 0;
  const eligibleRarities = (Object.keys(RARITY_RANK) as Rarity[]).filter((candidate) =>
    RARITY_RANK[candidate] >= minRank && cards.some((card) => rarity(card.rarity) === candidate)
  );
  if (!eligibleRarities.length) throw new Error("ASSET_PACK_PITY_CONFIGURATION_INVALID");
  const total = eligibleRarities.reduce((sum, candidate) => sum + probabilities[candidate], 0);
  let selectedRarity = eligibleRarities[0];
  if (total > 0) {
    const point = (randomInt(1_000_000_000) / 1_000_000_000) * total;
    let cursor = 0;
    for (const candidate of eligibleRarities) {
      cursor += probabilities[candidate];
      if (point < cursor) { selectedRarity = candidate; break; }
    }
  }
  const rarityCards = cards.filter((card) => rarity(card.rarity) === selectedRarity);
  const card = rarityCards[randomInt(rarityCards.length)];
  const rarityProbability = total > 0 ? probabilities[selectedRarity] / total : 1;
  return { card, normalizedProbability: rarityProbability / rarityCards.length, originalProbability: probabilities[selectedRarity] / rarityCards.length };
}

async function packConfiguration(
  packId: string,
  connection: mysql.Pool | mysql.PoolConnection = pool,
  _lightweight = false
) {
  const queryable = connection as mysql.PoolConnection;
  // Configuration, probability and draw paths only need metadata. Never pull the
  // LONGTEXT originals here: images are served by dedicated cached media routes.
  const cardColumns = `c.id, c.card_no, c.name, c.rarity,
    '' AS image_url, '' AS thumbnail_url,
    NULL AS story, c.release_at, c.status, c.updated_at`;
  const [cards, probabilityRows] = await Promise.all([
    queryable.query<mysql.RowDataPacket[]>(
    `SELECT ${cardColumns}, pc.probability, pc.enabled AS pack_card_enabled
     FROM asset_pack_cards pc
     INNER JOIN asset_cards c ON c.id = pc.card_id
     WHERE pc.pack_id = ?
     ORDER BY c.card_no ASC`,
    [packId]
    ).then(([rows]) => rows),
    queryable.query<mysql.RowDataPacket[]>("SELECT rarity, probability FROM asset_pack_rarity_probabilities WHERE pack_id = ?", [packId]).then(([rows]) => rows)
  ]);
  const hasRarityConfiguration = probabilityRows.length > 0;
  const enabled = cards.filter((card) => card.status === "active" && (hasRarityConfiguration || bool(card.pack_card_enabled)));
  const rarityProbabilities: Record<Rarity, number> = { normal: 0, rare: 0, epic: 0, legend: 0 };
  if (hasRarityConfiguration) {
    for (const row of probabilityRows) rarityProbabilities[rarity(row.rarity)] = Number(row.probability);
  } else {
    for (const card of enabled) rarityProbabilities[rarity(card.rarity)] += Number(card.probability);
  }
  const probabilityTotal = Object.values(rarityProbabilities).reduce((sum, probability) => sum + probability, 0);
  const hasRare = enabled.some((card) => RARITY_RANK[rarity(card.rarity)] >= 1);
  const hasEpic = enabled.some((card) => RARITY_RANK[rarity(card.rarity)] >= 2);
  const hasLegend = enabled.some((card) => rarity(card.rarity) === "legend");
  const configuredRaritiesHaveCards = (Object.keys(rarityProbabilities) as Rarity[]).every((candidate) => rarityProbabilities[candidate] <= 0 || enabled.some((card) => rarity(card.rarity) === candidate));
  const ready = enabled.length > 0 && Math.abs(probabilityTotal - 100) <= 0.000001 && configuredRaritiesHaveCards && hasRare && hasEpic && hasLegend;
  return { cards, enabled, rarityProbabilities, probabilityTotal, hasRare, hasEpic, hasLegend, ready };
}

function actualCardProbability(configuration: Awaited<ReturnType<typeof packConfiguration>>, card: mysql.RowDataPacket) {
  const cardRarity = rarity(card.rarity);
  const count = configuration.enabled.filter((candidate) => rarity(candidate.rarity) === cardRarity).length;
  return count > 0 ? configuration.rarityProbabilities[cardRarity] / count : 0;
}

function formatProbability(value: number) {
  return Number(value.toFixed(8)).toString();
}

function probabilityDisclosure(configuration: Awaited<ReturnType<typeof packConfiguration>>) {
  return (Object.keys(RARITY_RANK) as Rarity[]).map((candidate) => {
    const count = configuration.enabled.filter((card) => rarity(card.rarity) === candidate).length;
    const rarityProbability = configuration.rarityProbabilities[candidate];
    const actualProbability = count > 0 ? rarityProbability / count : 0;
    return `${RARITY_LABELS[candidate]}：${formatProbability(rarityProbability)}%（${count}张，每张实际概率${formatProbability(actualProbability)}%）`;
  }).join("\n");
}

async function syncCardPacks(cardId: string, packIds: string[], connection: mysql.PoolConnection) {
  const selected = [...new Set(packIds)];
  const [currentRows] = await connection.query<mysql.RowDataPacket[]>("SELECT pack_id FROM asset_pack_cards WHERE card_id = ?", [cardId]);
  const currentIds = currentRows.map((row) => String(row.pack_id));

  if (selected.length) {
    const placeholders = selected.map(() => "?").join(", ");
    const [packRows] = await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM asset_packs WHERE id IN (${placeholders})`, selected);
    if (packRows.length !== selected.length) throw new Error("选择的卡包不存在");
    await connection.query(`DELETE FROM asset_pack_cards WHERE card_id = ? AND pack_id NOT IN (${placeholders})`, [cardId, ...selected]);
    for (const packId of selected) {
      await connection.query(
        "INSERT IGNORE INTO asset_pack_cards (pack_id, card_id, probability, enabled) VALUES (?, ?, 0, 1)",
        [packId, cardId]
      );
    }
  } else {
    await connection.query("DELETE FROM asset_pack_cards WHERE card_id = ?", [cardId]);
  }

  for (const packId of new Set([...currentIds, ...selected])) {
    const [[pack]] = await connection.query<mysql.RowDataPacket[]>("SELECT enabled FROM asset_packs WHERE id = ? LIMIT 1", [packId]);
    if (bool(pack?.enabled) && !(await packConfiguration(packId, connection)).ready) {
      throw new Error("不能移除已上架卡包中的有效卡牌，请先下架卡包或调整概率");
    }
  }
}

async function assertCardHasPack(cardId: string, connection: mysql.PoolConnection) {
  const [[row]] = await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM asset_pack_cards WHERE card_id = ?", [cardId]);
  if (Number(row?.count ?? 0) < 1) throw new Error("卡牌必须至少绑定一个卡包");
}

async function drawOrderPayload(orderId: string) {
  const [orderRows, results] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT o.id, o.request_id, o.pack_id, o.draw_mode, o.shell_cost, o.used_free_draw, o.created_at,
        p.name AS pack_name, p.updated_at AS pack_updated_at
       FROM asset_draw_orders o INNER JOIN asset_packs p ON p.id = o.pack_id
       WHERE o.id = ? LIMIT 1`,
      [orderId]
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT r.*, c.card_no, c.name, '' AS story, c.updated_at
       FROM asset_draw_results r INNER JOIN asset_cards c ON c.id = r.card_id
       WHERE r.order_id = ? ORDER BY r.draw_index ASC`,
      [orderId]
    ).then(([rows]) => rows)
  ]);
  const order = orderRows[0];
  if (!order) return null;
  return {
    id: String(order.id),
    requestId: String(order.request_id),
    packId: String(order.pack_id),
    packName: String(order.pack_name),
    packCoverUrl: packMediaUrl({ id: order.pack_id, updated_at: order.pack_updated_at } as mysql.RowDataPacket, "cover"),
    drawMode: String(order.draw_mode),
    shellCost: Number(order.shell_cost),
    usedFreeDraw: bool(order.used_free_draw),
    createdAt: iso(order.created_at),
    results: results.map((row) => ({
      ...cardPayload({ ...row, id: row.card_id, rarity: row.rarity }, true),
      drawIndex: Number(row.draw_index),
      pityType: row.pity_type ? String(row.pity_type) : null,
      starBefore: row.star_before == null ? null : Number(row.star_before),
      starAfter: Number(row.star_after),
      firstObtained: bool(row.first_obtained),
      starUpgraded: bool(row.star_upgraded),
      fullStarDuplicate: bool(row.full_star_duplicate),
      shellRefund: Number(row.shell_refund)
    }))
  };
}

async function performDraw(userId: string, packId: string, mode: "single" | "ten", requestId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id, user_id, status FROM asset_draw_orders WHERE request_id = ? FOR UPDATE",
      [requestId]
    );
    if (existing) {
      if (String(existing.user_id) !== userId) throw new Error("ASSET_REQUEST_ID_CONFLICT");
      if (existing.status !== "completed") throw new Error("ASSET_DRAW_IN_PROGRESS");
      await connection.commit();
      return drawOrderPayload(String(existing.id));
    }

    const [[pack]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, name, pack_type, single_price, ten_price, daily_free_draws,
        sale_start_at, sale_end_at, enabled
       FROM asset_packs WHERE id = ? FOR UPDATE`,
      [packId]
    );
    if (!pack) throw new Error("ASSET_PACK_NOT_FOUND");
    if (packStatus(pack) !== "on_sale") throw new Error("ASSET_PACK_NOT_ON_SALE");
    const configuration = await packConfiguration(packId, connection);
    if (!configuration.ready) throw new Error("ASSET_PACK_CONFIGURATION_INVALID");

    const drawCount = mode === "ten" ? 10 : 1;
    const [[userRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!userRow) throw new Error("ASSET_USER_NOT_FOUND");
    let balance = Number(userRow.shell_balance ?? 0);
    let usedFreeDraw = false;
    let shellCost = mode === "ten" ? Number(pack.ten_price) : Number(pack.single_price);
    const taskDate = beijingTaskDate();

    if (mode === "single" && Number(pack.daily_free_draws ?? 0) > 0) {
      await connection.query(
        "INSERT IGNORE INTO asset_daily_free_usage (user_id, pack_id, usage_date, used_count) VALUES (?, ?, ?, 0)",
        [userId, packId, taskDate]
      );
      const [[usage]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT used_count FROM asset_daily_free_usage WHERE user_id = ? AND pack_id = ? AND usage_date = ? FOR UPDATE",
        [userId, packId, taskDate]
      );
      if (Number(usage.used_count ?? 0) < Number(pack.daily_free_draws)) {
        usedFreeDraw = true;
        shellCost = 0;
        await connection.query(
          "UPDATE asset_daily_free_usage SET used_count = used_count + 1 WHERE user_id = ? AND pack_id = ? AND usage_date = ?",
          [userId, packId, taskDate]
        );
      }
    }
    if (balance < shellCost) throw new Error("ASSET_INSUFFICIENT_SHELLS");

    const orderId = nanoid();
    const snapshot = JSON.stringify({
      id: pack.id,
      name: pack.name,
      packType: pack.pack_type,
      singlePrice: Number(pack.single_price),
      tenPrice: Number(pack.ten_price),
      dailyFreeDraws: Number(pack.daily_free_draws),
      cards: configuration.enabled.map((card) => ({ cardId: card.id, rarity: card.rarity })),
      rarityProbabilities: configuration.rarityProbabilities,
      pityLimits: PITY_LIMITS
    });
    await connection.query(
      `INSERT INTO asset_draw_orders
        (id, request_id, user_id, pack_id, draw_mode, draw_count, shell_cost, used_free_draw, status, pack_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?)`,
      [orderId, requestId, userId, packId, mode, drawCount, shellCost, usedFreeDraw ? 1 : 0, snapshot]
    );
    if (shellCost > 0) {
      balance -= shellCost;
      await connection.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balance, userId]);
      await connection.query(
        `INSERT INTO shell_transactions
          (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
         VALUES (?, ?, ?, ?, ?, 'asset_draw_order', ?, ?, ?)`,
        [nanoid(), userId, mode === "ten" ? "pack_ten_draw" : "pack_single_draw", -shellCost, balance, orderId, `${pack.name}${mode === "ten" ? "十连抽" : "单抽"}`, `asset-draw:${orderId}:spend`]
      );
    }

    const type = packType(pack.pack_type);
    await connection.query(
      "INSERT IGNORE INTO asset_pity_progress (user_id, pack_type, rare_count, epic_count, legend_count) VALUES (?, ?, 0, 0, 0)",
      [userId, type]
    );
    const [[pity]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT rare_count, epic_count, legend_count FROM asset_pity_progress WHERE user_id = ? AND pack_type = ? FOR UPDATE",
      [userId, type]
    );
    await connection.query("INSERT IGNORE INTO user_asset_summaries (user_id) VALUES (?)", [userId]);
    await connection.query<mysql.RowDataPacket[]>(
      "SELECT user_id FROM user_asset_summaries WHERE user_id = ? FOR UPDATE",
      [userId]
    );

    let pityState: PityState = {
      rare_count: Number(pity.rare_count ?? 0),
      epic_count: Number(pity.epic_count ?? 0),
      legend_count: Number(pity.legend_count ?? 0)
    };
    let totalRefund = 0;
    let collectionDelta = 0;
    let unlockedDelta = 0;
    let legendaryDelta = 0;

    for (let index = 1; index <= drawCount; index += 1) {
      const triggeredPity = pityTrigger(pityState);
      const { card, normalizedProbability, originalProbability } = chooseWeighted(configuration.enabled, configuration.rarityProbabilities, triggeredPity);
      const cardRarity = rarity(card.rarity);
      const [[owned]] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT * FROM user_asset_cards WHERE user_id = ? AND card_id = ? FOR UPDATE",
        [userId, card.id]
      );
      const starBefore = owned ? Number(owned.star_level) : null;
      const firstObtained = !owned;
      let starAfter = starBefore ?? 0;
      let starUpgraded = false;
      let fullStarDuplicate = false;
      let shellRefund = 0;

      if (!owned) {
        const value = COLLECTION_VALUES[cardRarity][0];
        collectionDelta += value;
        unlockedDelta += 1;
        if (cardRarity === "legend") legendaryDelta += 1;
        await connection.query(
          `INSERT INTO user_asset_cards
            (user_id, card_id, star_level, duplicate_progress, total_obtained, collection_value)
           VALUES (?, ?, 0, 0, 1, ?)`,
          [userId, card.id, value]
        );
      } else {
        const previousTotal = Number(owned.total_obtained);
        const nextTotal = previousTotal + 1;
        if (Number(owned.star_level) >= 3) {
          fullStarDuplicate = true;
          shellRefund = FULL_STAR_REFUNDS[cardRarity];
          totalRefund += shellRefund;
          await connection.query(
            "UPDATE user_asset_cards SET total_obtained = ?, last_obtained_at = CURRENT_TIMESTAMP WHERE user_id = ? AND card_id = ?",
            [nextTotal, userId, card.id]
          );
        } else {
          starAfter = starForTotal(nextTotal);
          starUpgraded = starAfter > Number(owned.star_level);
          const nextValue = COLLECTION_VALUES[cardRarity][starAfter];
          collectionDelta += Math.max(0, nextValue - Number(owned.collection_value));
          await connection.query(
            `UPDATE user_asset_cards
             SET star_level = ?, duplicate_progress = ?, total_obtained = ?, collection_value = ?, last_obtained_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND card_id = ?`,
            [starAfter, duplicateProgress(nextTotal, starAfter), nextTotal, nextValue, userId, card.id]
          );
        }
      }

      const nextPity = updatePity(pityState, cardRarity);
      pityState = { rare_count: nextPity.rare, epic_count: nextPity.epic, legend_count: nextPity.legend };
      await connection.query(
        `INSERT INTO asset_draw_results
          (id, order_id, draw_index, card_id, rarity, pity_type, star_before, star_after, first_obtained,
           star_upgraded, full_star_duplicate, shell_refund, probability_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nanoid(), orderId, index, card.id, cardRarity, triggeredPity, starBefore, starAfter,
          firstObtained ? 1 : 0, starUpgraded ? 1 : 0, fullStarDuplicate ? 1 : 0, shellRefund,
          JSON.stringify({ originalProbability, normalizedProbability, rarityProbability: configuration.rarityProbabilities[cardRarity], pityType: triggeredPity })
        ]
      );
    }

    await connection.query(
      `UPDATE asset_pity_progress SET rare_count = ?, epic_count = ?, legend_count = ?
       WHERE user_id = ? AND pack_type = ?`,
      [pityState.rare_count, pityState.epic_count, pityState.legend_count, userId, type]
    );
    if (collectionDelta > 0 || unlockedDelta > 0) {
      await connection.query(
        `UPDATE user_asset_summaries
         SET total_collection_value = total_collection_value + ?,
             unlocked_card_count = unlocked_card_count + ?,
             legendary_card_count = legendary_card_count + ?,
             score_reached_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE score_reached_at END
         WHERE user_id = ?`,
        [collectionDelta, unlockedDelta, legendaryDelta, collectionDelta, userId]
      );
    }
    if (totalRefund > 0) {
      balance += totalRefund;
      await connection.query("UPDATE users SET shell_balance = ? WHERE id = ?", [balance, userId]);
      await connection.query(
        `INSERT INTO shell_transactions
          (id, user_id, transaction_type, amount, balance_after, related_type, related_id, remark, idempotency_key)
         VALUES (?, ?, 'duplicate_card_refund', ?, ?, 'asset_draw_order', ?, '满星重复卡片返还', ?)`,
        [nanoid(), userId, totalRefund, balance, orderId, `asset-draw:${orderId}:refund`]
      );
    }
    await connection.query("UPDATE asset_draw_orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [orderId]);
    await pruneDrawHistory(userId, connection);
    await connection.commit();
    return drawOrderPayload(orderId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function cabinetPayload(userId: string, compact = false) {
  const [userRows, ownedRows, packRows] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.nickname, u.avatar IS NOT NULL AS has_avatar, COALESCE(s.total_collection_value, 0) AS total_collection_value,
        COALESCE(s.unlocked_card_count, 0) AS unlocked_card_count,
        COALESCE(s.legendary_card_count, 0) AS legendary_card_count
       FROM users u LEFT JOIN user_asset_summaries s ON s.user_id = u.id WHERE u.id = ? LIMIT 1`,
      [userId]
    ).then(([rows]) => rows),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT uc.user_id, uc.card_id, uc.star_level, uc.duplicate_progress, uc.total_obtained,
              uc.collection_value, uc.first_obtained_at, uc.last_obtained_at, uc.display_order,
              c.id, c.card_no, c.name, c.rarity,
              '' AS image_url, '' AS thumbnail_url, c.story, c.release_at, c.status, c.updated_at
       FROM user_asset_cards uc INNER JOIN asset_cards c ON c.id = uc.card_id
       WHERE uc.user_id = ? ${compact ? "AND uc.display_order IS NOT NULL ORDER BY uc.display_order ASC LIMIT 8" : "ORDER BY c.card_no ASC"}`,
      [userId]
    ).then(([rows]) => rows),
    compact ? Promise.resolve([] as mysql.RowDataPacket[]) : pool.query<mysql.RowDataPacket[]>(
      `SELECT pc.card_id, p.id, p.name, p.pack_type, p.sort_order
       FROM asset_pack_cards pc INNER JOIN asset_packs p ON p.id = pc.pack_id
       WHERE pc.card_id IN (SELECT card_id FROM user_asset_cards WHERE user_id = ?)
       ORDER BY p.sort_order DESC, p.created_at DESC`,
      [userId]
    ).then(([rows]) => rows)
  ]);
  const user = userRows[0];
  if (!user) return null;
  const packsByCard = new Map<string, Array<{ id: string; name: string; packType: PackType; coverUrl: string }>>();
  for (const row of packRows) {
    const list = packsByCard.get(String(row.card_id)) ?? [];
    list.push({ id: String(row.id), name: String(row.name), packType: packType(row.pack_type), coverUrl: "" });
    packsByCard.set(String(row.card_id), list);
  }
  const cards = ownedRows.map((row) => ({
    ...cardPayload(row, true),
    starLevel: Number(row.star_level),
    duplicateProgress: Number(row.duplicate_progress),
    nextStarRequirement: nextStarRequirement(Number(row.star_level)),
    totalObtained: Number(row.total_obtained),
    collectionValue: Number(row.collection_value),
    firstObtainedAt: iso(row.first_obtained_at),
    lastObtainedAt: iso(row.last_obtained_at),
    displayOrder: row.display_order == null ? null : Number(row.display_order),
    packs: packsByCard.get(String(row.id)) ?? []
  }));
  return {
    user: {
      id: String(user.id), nickname: String(user.nickname), avatar: bool(user.has_avatar) ? `/api/media/users/${encodeURIComponent(String(user.id))}/avatar` : null,
      totalCollectionValue: Number(user.total_collection_value), unlockedCardCount: Number(user.unlocked_card_count),
      legendaryCardCount: Number(user.legendary_card_count)
    },
    showcase: cards.filter((card) => card.displayOrder != null).sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder)).slice(0, 6),
    cards
  };
}

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    ASSET_PACK_NOT_FOUND: "卡包不存在",
    ASSET_PACK_NOT_ON_SALE: "卡包当前不可抽取，请刷新商城",
    ASSET_PACK_CONFIGURATION_INVALID: "卡包配置不完整，暂时无法抽取",
    ASSET_PACK_PITY_CONFIGURATION_INVALID: "卡包缺少保底品质卡片",
    ASSET_INSUFFICIENT_SHELLS: "贝壳余额不足",
    ASSET_USER_NOT_FOUND: "用户不存在",
    ASSET_REQUEST_ID_CONFLICT: "请求编号冲突，请重试",
    ASSET_DRAW_IN_PROGRESS: "本次抽卡正在处理中，请稍后刷新"
  };
  return messages[code] ?? (error instanceof Error ? error.message : "卡牌操作失败");
}

export function registerDigitalAssetRoutes(app: express.Express, dependencies: RouteDependencies) {
  const { requireAuth, requireAdmin, sendError, sendStoredImage, onBadgeProgress } = dependencies;

  app.get("/api/media/assets/cards/:id/:variant", async (req, res) => {
    if (!(await requireAuth(req, res))) return;
    if (req.params.variant !== "image" && req.params.variant !== "thumbnail") return sendError(res, 404, "图片不存在");
    const cacheKey = `card:${req.params.id}:${req.params.variant}:${String(req.query.v ?? "")}`;
    const cached = assetMediaSourceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return sendStoredImage(req, res, cached.image, req.params.variant === "thumbnail" ? 360 : 1200, "private, max-age=31536000, immutable");
    }
    const column = req.params.variant === "thumbnail" ? "COALESCE(thumbnail_url, image_url)" : "image_url";
    const [[card]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT ${column} AS image FROM asset_cards WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!card) return sendError(res, 404, "卡牌不存在");
    cacheAssetMedia(cacheKey, card.image);
    return sendStoredImage(req, res, card.image, req.params.variant === "thumbnail" ? 360 : 1200, "private, max-age=31536000, immutable");
  });

  app.get("/api/media/assets/packs/:id/:variant", async (req, res) => {
    if (!(await requireAuth(req, res))) return;
    if (req.params.variant !== "cover" && req.params.variant !== "thumbnail") return sendError(res, 404, "图片不存在");
    const cacheKey = `pack:${req.params.id}:${req.params.variant}:${String(req.query.v ?? "")}`;
    const cached = assetMediaSourceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return sendStoredImage(req, res, cached.image, req.params.variant === "thumbnail" ? 480 : 1280, "private, max-age=31536000, immutable");
    }
    const column = req.params.variant === "thumbnail" ? "COALESCE(cover_thumbnail, cover_url)" : "cover_url";
    const [[pack]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT ${column} AS image FROM asset_packs WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!pack) return sendError(res, 404, "卡包不存在");
    cacheAssetMedia(cacheKey, pack.image);
    return sendStoredImage(req, res, pack.image, req.params.variant === "thumbnail" ? 480 : 1280, "private, max-age=31536000, immutable");
  });

  app.get("/api/asset-store/packs", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    res.setHeader("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
    const taskDate = beijingTaskDate();
    const [userRows, packs, pityRows, usageRows] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? LIMIT 1", [user.id]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>(`SELECT ${PUBLIC_PACK_COLUMNS} FROM asset_packs WHERE enabled = 1 ORDER BY sort_order DESC, created_at DESC`).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT * FROM asset_pity_progress WHERE user_id = ?", [user.id]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT pack_id, used_count FROM asset_daily_free_usage WHERE user_id = ? AND usage_date = ?", [user.id, taskDate]).then(([rows]) => rows)
    ]);
    const userRow = userRows[0];
    const pityByType = new Map(pityRows.map((row) => [String(row.pack_type), row]));
    const usageByPack = new Map(usageRows.map((row) => [String(row.pack_id), Number(row.used_count)]));
    const onSale = packs.filter((pack) => packStatus(pack) === "on_sale");
    const previews = await Promise.all(onSale.map(async (pack) => {
      const configuration = await packConfiguration(String(pack.id), pool, true);
      const previewCards = configuration.enabled.slice(0, 5).map((card) => cardPayload(card, true));
      const type = packType(pack.pack_type);
      const pity = (pityByType.get(type) ?? {}) as mysql.RowDataPacket;
      return {
        ...packPayload(pack, "thumbnail"),
        freeDrawsRemaining: Math.max(0, Number(pack.daily_free_draws) - (usageByPack.get(String(pack.id)) ?? 0)),
        pity: {
          rare: Number(pity.rare_count ?? 0), epic: Number(pity.epic_count ?? 0), legend: Number(pity.legend_count ?? 0),
          rareLimit: PITY_LIMITS.rare, epicLimit: PITY_LIMITS.epic, legendLimit: PITY_LIMITS.legend
        },
        rarityProbabilities: configuration.rarityProbabilities,
        previewCards
      };
    }));
    res.json({ balance: Number(userRow?.shell_balance ?? 0), packs: previews });
  });

  app.get("/api/asset-store/packs/:id", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=45");
    const [[pack], configuration] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>(`SELECT ${PUBLIC_PACK_COLUMNS} FROM asset_packs WHERE id = ? LIMIT 1`, [req.params.id]).then(([rows]) => rows),
      packConfiguration(req.params.id)
    ]);
    if (!pack || packStatus(pack) !== "on_sale") return sendError(res, 404, "卡包不存在或已下架");
    const type = packType(pack.pack_type);
    const [[pity], [usageRows], [userRows]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT * FROM asset_pity_progress WHERE user_id = ? AND pack_type = ? LIMIT 1", [user.id, type]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT used_count FROM asset_daily_free_usage WHERE user_id = ? AND pack_id = ? AND usage_date = ? LIMIT 1", [user.id, pack.id, beijingTaskDate()]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id = ? LIMIT 1", [user.id]).then(([rows]) => rows)
    ]);
    res.json({
      balance: Number(userRows?.shell_balance ?? 0),
      pack: {
        ...packPayload(pack, "cover"),
        probabilityNotice: probabilityDisclosure(configuration),
        freeDrawsRemaining: Math.max(0, Number(pack.daily_free_draws) - Number(usageRows?.used_count ?? 0)),
        pity: {
          rare: Number(pity?.rare_count ?? 0), epic: Number(pity?.epic_count ?? 0), legend: Number(pity?.legend_count ?? 0),
          rareLimit: PITY_LIMITS.rare, epicLimit: PITY_LIMITS.epic, legendLimit: PITY_LIMITS.legend
        },
        rarityProbabilities: configuration.rarityProbabilities,
        cards: configuration.enabled.map((card) => ({ ...cardPayload({ ...card, story: "" }, true), actualProbability: actualCardProbability(configuration, card) }))
      }
    });
  });

  app.post("/api/asset-store/packs/:id/draw", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const parsed = z.object({ mode: z.enum(["single", "ten"]), requestId: z.string().min(8).max(100) }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "抽卡请求无效");
    try {
      const order = await performDraw(user.id, req.params.id, parsed.data.mode, parsed.data.requestId);
      onBadgeProgress?.(user.id);
      res.json({ order });
    } catch (error) {
      const message = errorMessage(error);
      const status = message === "贝壳余额不足" ? 409 : message.includes("不存在") ? 404 : 400;
      sendError(res, status, message);
    }
  });

  app.get("/api/me/card-cabinet", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    res.json({ cabinet: await cabinetPayload(user.id, req.query.compact === "true") });
  });

  app.get("/api/me/card-cabinet/cards/:id/image", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [[card]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT c.id, c.updated_at
       FROM user_asset_cards uc INNER JOIN asset_cards c ON c.id = uc.card_id
       WHERE uc.user_id = ? AND uc.card_id = ? LIMIT 1`,
      [user.id, req.params.id]
    );
    if (!card) return sendError(res, 404, "卡牌不存在或尚未获得");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({ imageUrl: cardMediaUrl(card, "image") });
  });

  app.get("/api/me/profile-backgrounds", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 10));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const [[settings]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT profile_background_card_id, profile_background_crop_x, profile_background_crop_y,
        profile_background_zoom, profile_background IS NOT NULL AS has_profile_background
       FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    );
    const selectedCardId = settings?.has_profile_background && settings.profile_background_card_id
      ? String(settings.profile_background_card_id)
      : null;
    const [cards, [totalRow]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>(
        `SELECT c.id, c.card_no, c.name, c.rarity, c.updated_at,
          uc.star_level
         FROM user_asset_cards uc INNER JOIN asset_cards c ON c.id = uc.card_id
         WHERE uc.user_id = ? AND uc.star_level >= 1 AND c.rarity IN ('epic', 'legend')
         ORDER BY (c.id = ?) DESC, FIELD(c.rarity, 'legend', 'epic'), c.card_no ASC
         LIMIT ? OFFSET ?`,
        [user.id, selectedCardId, limit, offset]
      ).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS total
         FROM user_asset_cards uc INNER JOIN asset_cards c ON c.id = uc.card_id
         WHERE uc.user_id = ? AND uc.star_level >= 1 AND c.rarity IN ('epic', 'legend')`,
        [user.id]
      ).then(([rows]) => rows)
    ]);
    res.json({
      cards: cards.map((card) => ({
        id: String(card.id),
        cardNo: String(card.card_no),
        name: String(card.name),
        rarity: rarity(card.rarity),
        thumbnailUrl: cardMediaUrl(card, "thumbnail"),
        starLevel: Number(card.star_level)
      })),
      total: Number(totalRow?.total ?? 0),
      selectedCardId,
      crop: {
        x: Number(settings?.profile_background_crop_x ?? 50),
        y: Number(settings?.profile_background_crop_y ?? 50),
        zoom: Number(settings?.profile_background_zoom ?? 1)
      }
    });
  });

  app.patch("/api/me/profile-background", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const parsed = z.object({
      cardId: z.string().trim().min(1).max(64).nullable(),
      crop: z.object({
        x: z.coerce.number().min(0).max(100),
        y: z.coerce.number().min(0).max(100),
        zoom: z.coerce.number().min(1).max(3)
      }).optional()
    }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "主页背景设置无效");
    if (!parsed.data.cardId) {
      await pool.query(
        `UPDATE users SET profile_background = NULL, profile_background_card_id = NULL,
          profile_background_crop_x = 50, profile_background_crop_y = 50, profile_background_zoom = 1,
          profile_background_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [user.id]
      );
      return res.json({ profileBackgroundUrl: null });
    }
    const crop = parsed.data.crop ?? { x: 50, y: 50, zoom: 1 };
    const [[card]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT c.image_url
       FROM user_asset_cards uc INNER JOIN asset_cards c ON c.id = uc.card_id
       WHERE uc.user_id = ? AND uc.card_id = ? AND uc.star_level >= 1
         AND c.rarity IN ('epic', 'legend') LIMIT 1`,
      [user.id, parsed.data.cardId]
    );
    if (!card) return sendError(res, 403, "只能使用已达到一星的史诗或传说卡牌背景");
    const match = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(String(card.image_url));
    if (!match) return sendError(res, 422, "该卡牌原图暂时无法裁剪");
    try {
      const rotated = await sharp(Buffer.from(match[1], "base64")).rotate().toBuffer({ resolveWithObject: true });
      const sourceWidth = rotated.info.width;
      const sourceHeight = rotated.info.height;
      const targetRatio = 2.5;
      let cropWidth = sourceWidth;
      let cropHeight = cropWidth / targetRatio;
      if (cropHeight > sourceHeight) {
        cropHeight = sourceHeight;
        cropWidth = cropHeight * targetRatio;
      }
      cropWidth = Math.max(1, cropWidth / crop.zoom);
      cropHeight = Math.max(1, cropHeight / crop.zoom);
      const width = Math.max(1, Math.min(sourceWidth, Math.round(cropWidth)));
      const height = Math.max(1, Math.min(sourceHeight, Math.round(cropHeight)));
      const left = Math.max(0, Math.min(sourceWidth - width, Math.round((sourceWidth - width) * crop.x / 100)));
      const top = Math.max(0, Math.min(sourceHeight - height, Math.round((sourceHeight - height) * crop.y / 100)));
      const output = await sharp(rotated.data)
        .extract({ left, top, width, height })
        .resize(1200, 480, { fit: "cover" })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      const background = `data:image/webp;base64,${output.toString("base64")}`;
      await pool.query(
        `UPDATE users SET profile_background = ?, profile_background_card_id = ?,
          profile_background_crop_x = ?, profile_background_crop_y = ?, profile_background_zoom = ?,
          profile_background_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [background, parsed.data.cardId, crop.x, crop.y, crop.zoom, user.id]
      );
      const [[updated]] = await pool.query<mysql.RowDataPacket[]>("SELECT profile_background_updated_at FROM users WHERE id = ? LIMIT 1", [user.id]);
      res.json({
        profileBackgroundUrl: `/api/media/users/${encodeURIComponent(user.id)}/profile-background?v=${new Date(updated.profile_background_updated_at).getTime()}`
      });
    } catch {
      return sendError(res, 422, "该卡牌原图暂时无法裁剪");
    }
  });

  app.patch("/api/me/card-showcase", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const parsed = z.object({ cardIds: z.array(z.string().min(1).max(64)).max(6) }).safeParse(req.body);
    if (!parsed.success || new Set(parsed.data.cardIds).size !== parsed.data.cardIds.length) return sendError(res, 400, "陈列卡片无效");
    if (parsed.data.cardIds.length) {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT card_id FROM user_asset_cards WHERE user_id = ? AND card_id IN (${parsed.data.cardIds.map(() => "?").join(",")})`,
        [user.id, ...parsed.data.cardIds]
      );
      if (rows.length !== parsed.data.cardIds.length) return sendError(res, 403, "只能陈列自己已获得的卡片");
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("UPDATE user_asset_cards SET display_order = NULL WHERE user_id = ?", [user.id]);
      for (let index = 0; index < parsed.data.cardIds.length; index += 1) {
        await connection.query("UPDATE user_asset_cards SET display_order = ? WHERE user_id = ? AND card_id = ?", [index, user.id, parsed.data.cardIds[index]]);
      }
      await connection.commit();
      res.json({ cabinet: await cabinetPayload(user.id) });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  app.get("/api/users/:id/card-cabinet", async (req, res) => {
    if (!(await requireAuth(req, res))) return;
    const cabinet = await cabinetPayload(req.params.id, req.query.compact === "true");
    if (!cabinet) return sendError(res, 404, "用户不存在");
    res.json({ cabinet });
  });

  app.get("/api/users/:userId/card-cabinet/cards/:id/image", async (req, res) => {
    if (!(await requireAuth(req, res))) return;
    const [[card]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT c.id, c.updated_at
       FROM user_asset_cards uc INNER JOIN asset_cards c ON c.id = uc.card_id
       WHERE uc.user_id = ? AND uc.card_id = ? LIMIT 1`,
      [req.params.userId, req.params.id]
    );
    if (!card) return sendError(res, 404, "卡牌不存在或尚未获得");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({ imageUrl: cardMediaUrl(card, "image") });
  });

  app.get("/api/me/asset-draw-history", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    await pruneDrawHistory(user.id);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT o.id FROM asset_draw_orders o WHERE o.user_id = ? AND o.status = 'completed'
       ORDER BY o.created_at DESC, o.id DESC LIMIT 10`,
      [user.id]
    );
    res.json({ orders: await Promise.all(rows.map((row) => drawOrderPayload(String(row.id)))) });
  });

  app.get("/api/asset-rankings", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.nickname, u.avatar IS NOT NULL AS has_avatar, u.created_at,
        COALESCE(s.total_collection_value, 0) AS total_collection_value,
        COALESCE(s.unlocked_card_count, 0) AS unlocked_card_count,
        COALESCE(s.legendary_card_count, 0) AS legendary_card_count,
        COALESCE(s.score_reached_at, u.created_at) AS score_reached_at
       FROM users u LEFT JOIN user_asset_summaries s ON s.user_id = u.id
       WHERE u.role = 'user'
       ORDER BY total_collection_value DESC, score_reached_at ASC, u.created_at ASC, u.id ASC`
    );
    const allUsers = rows.map((row, index) => ({
      rank: index + 1, id: String(row.id), nickname: String(row.nickname), avatar: bool(row.has_avatar) ? `/api/media/users/${encodeURIComponent(String(row.id))}/avatar` : null,
      totalCollectionValue: Number(row.total_collection_value), unlockedCardCount: Number(row.unlocked_card_count),
      legendaryCardCount: Number(row.legendary_card_count)
    }));
    const ranking = allUsers.slice(0, 10);
    const own = allUsers.find((item) => item.id === user.id) ?? null;
    res.json({ ranking, own: own && !ranking.some((item) => item.id === own.id) ? own : null });
  });

  app.get("/api/admin/asset-stats", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [[cards], [packs], [orders], rarities] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM asset_cards").then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total, COALESCE(SUM(enabled = 1), 0) AS enabled FROM asset_packs").then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS total_orders, COALESCE(SUM(draw_count), 0) AS total_draws,
          COALESCE(SUM(shell_cost), 0) AS shell_spent,
          COALESCE((SELECT SUM(shell_refund) FROM asset_draw_results), 0) AS shell_refunded
         FROM asset_draw_orders WHERE status = 'completed'`
      ).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT rarity, COUNT(*) AS count FROM asset_draw_results GROUP BY rarity").then(([rows]) => rows)
    ]);
    res.json({
      cardCount: Number(cards?.total ?? 0), packCount: Number(packs?.total ?? 0), enabledPackCount: Number(packs?.enabled ?? 0),
      totalOrders: Number(orders?.total_orders ?? 0), totalDraws: Number(orders?.total_draws ?? 0),
      shellSpent: Number(orders?.shell_spent ?? 0), shellRefunded: Number(orders?.shell_refunded ?? 0),
      rarityCounts: Object.fromEntries(rarities.map((row) => [String(row.rarity), Number(row.count)]))
    });
  });

  app.get("/api/admin/asset-draw-records", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const keyword = String(req.query.keyword ?? "").trim();
    const where = keyword ? "WHERE u.nickname LIKE ? OR p.name LIKE ? OR c.name LIKE ?" : "";
    const params = keyword ? [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`] : [];
    const [[totalRow], rows] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM asset_draw_results r
         INNER JOIN asset_draw_orders o ON o.id = r.order_id INNER JOIN users u ON u.id = o.user_id
         INNER JOIN asset_packs p ON p.id = o.pack_id INNER JOIN asset_cards c ON c.id = r.card_id ${where}`,
        params
      ).then(([items]) => items),
      pool.query<mysql.RowDataPacket[]>(
        `SELECT r.id, r.draw_index, r.rarity, r.pity_type, r.star_before, r.star_after, r.first_obtained,
          r.star_upgraded, r.full_star_duplicate, r.shell_refund, r.created_at,
          o.id AS order_id, o.draw_mode, o.shell_cost, o.used_free_draw,
          u.id AS user_id, u.nickname, p.id AS pack_id, p.name AS pack_name,
          c.id AS card_id, c.card_no, c.name AS card_name
         FROM asset_draw_results r
         INNER JOIN asset_draw_orders o ON o.id = r.order_id INNER JOIN users u ON u.id = o.user_id
         INNER JOIN asset_packs p ON p.id = o.pack_id INNER JOIN asset_cards c ON c.id = r.card_id
         ${where} ORDER BY r.created_at DESC, r.order_id DESC, r.draw_index ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ).then(([items]) => items)
    ]);
    res.json({
      total: Number(totalRow?.total ?? 0),
      records: rows.map((row) => ({
        id: String(row.id), orderId: String(row.order_id), drawIndex: Number(row.draw_index), drawMode: String(row.draw_mode),
        shellCost: Number(row.shell_cost), usedFreeDraw: bool(row.used_free_draw), userId: String(row.user_id), nickname: String(row.nickname),
        packId: String(row.pack_id), packName: String(row.pack_name), cardId: String(row.card_id), cardNo: String(row.card_no), cardName: String(row.card_name),
        rarity: rarity(row.rarity), pityType: row.pity_type ? String(row.pity_type) : null,
        starBefore: row.star_before == null ? null : Number(row.star_before), starAfter: Number(row.star_after),
        firstObtained: bool(row.first_obtained), starUpgraded: bool(row.star_upgraded), fullStarDuplicate: bool(row.full_star_duplicate),
        shellRefund: Number(row.shell_refund), createdAt: iso(row.created_at)
      }))
    });
  });

  app.get("/api/admin/asset-cards", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows, packRows] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>(
        `SELECT c.id, c.card_no, c.name, c.rarity,
          '' AS image_url, '' AS thumbnail_url,
          NULL AS story, c.release_at, c.status, c.updated_at,
          COUNT(DISTINCT uc.user_id) AS owner_count, COALESCE(SUM(uc.total_obtained), 0) AS total_drawn,
          COALESCE(SUM(uc.star_level = 0), 0) AS star_0_count, COALESCE(SUM(uc.star_level = 1), 0) AS star_1_count,
          COALESCE(SUM(uc.star_level = 2), 0) AS star_2_count, COALESCE(SUM(uc.star_level = 3), 0) AS star_3_count
         FROM asset_cards c LEFT JOIN user_asset_cards uc ON uc.card_id = c.id
         GROUP BY c.id ORDER BY c.card_no ASC`
      ).then(([result]) => result),
      pool.query<mysql.RowDataPacket[]>("SELECT card_id, pack_id FROM asset_pack_cards").then(([result]) => result)
    ]);
    const packIdsByCard = new Map<string, string[]>();
    for (const row of packRows) {
      const cardId = String(row.card_id);
      packIdsByCard.set(cardId, [...(packIdsByCard.get(cardId) ?? []), String(row.pack_id)]);
    }
    res.json({ cards: rows.map((row) => ({ ...cardPayload(row, true), packIds: packIdsByCard.get(String(row.id)) ?? [], ownerCount: Number(row.owner_count), totalDrawn: Number(row.total_drawn), starCounts: [0, 1, 2, 3].map((star) => Number(row[`star_${star}_count`])) })) });
  });

  app.get("/api/admin/asset-cards/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [[row], [packRows]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT * FROM asset_cards WHERE id = ? LIMIT 1", [req.params.id]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT pack_id FROM asset_pack_cards WHERE card_id = ?", [req.params.id]).then(([rows]) => rows)
    ]);
    if (!row) return sendError(res, 404, "卡片不存在");
    res.json({ card: { ...cardPayload(row), packIds: packRows.map((item: mysql.RowDataPacket) => String(item.pack_id)) } });
  });

  app.post("/api/admin/asset-cards", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = cardSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "卡片资料无效");
    const id = nanoid();
    const { packIds, thumbnailUrl: _thumbnailUrl, ...value } = parsed.data;
    const optimizedImages = await optimizedAssetImages(value.imageUrl, 1200, 360);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO asset_cards
          (id, card_no, name, rarity, image_url, thumbnail_url, story, release_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, value.cardNo, value.name, value.rarity, optimizedImages.full, optimizedImages.thumbnail, value.story || null, value.releaseAt ? new Date(value.releaseAt) : null, value.status]
      );
      await syncCardPacks(id, packIds, connection);
      await assertCardHasPack(id, connection);
      await connection.commit();
      res.status(201).json({ id });
    } catch (error) {
      await connection.rollback();
      sendError(res, 409, errorMessage(error));
    } finally {
      connection.release();
    }
  });

  app.patch("/api/admin/asset-cards/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = cardSchema.partial().safeParse(req.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return sendError(res, 400, "卡片资料无效");
    const [[usage], currentRows] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM user_asset_cards WHERE card_id = ?", [req.params.id]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT card_no, rarity FROM asset_cards WHERE id = ? LIMIT 1", [req.params.id]).then(([rows]) => rows)
    ]);
    const current = currentRows[0];
    if (!current) return sendError(res, 404, "卡片不存在");
    const changesProtectedField = (parsed.data.rarity != null && parsed.data.rarity !== current.rarity)
      || (parsed.data.cardNo != null && parsed.data.cardNo !== current.card_no);
    if (Number(usage.count) > 0 && changesProtectedField) return sendError(res, 409, "已有用户获得的卡片不能修改编号或品质");
    const { packIds, thumbnailUrl: _thumbnailUrl, ...parsedChanges } = parsed.data;
    const changes: Record<string, unknown> = { ...parsedChanges };
    if (typeof changes.imageUrl === "string") {
      const optimizedImages = await optimizedAssetImages(String(changes.imageUrl), 1200, 360);
      changes.imageUrl = optimizedImages.full;
      changes.thumbnailUrl = optimizedImages.thumbnail;
    }
    const columns: Record<string, string> = { cardNo: "card_no", name: "name", rarity: "rarity", imageUrl: "image_url", thumbnailUrl: "thumbnail_url", story: "story", releaseAt: "release_at", status: "status" };
    const entries = Object.entries(changes);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (entries.length) {
        await connection.query(
          `UPDATE asset_cards SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`,
          [...entries.map(([key, value]) => key === "releaseAt" ? (value ? new Date(String(value)) : null) : ["thumbnailUrl", "story"].includes(key) && value === "" ? null : value), req.params.id]
        );
      }
      if (packIds !== undefined) await syncCardPacks(req.params.id, packIds, connection);
      await assertCardHasPack(req.params.id, connection);
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      sendError(res, 409, errorMessage(error));
    } finally {
      connection.release();
    }
  });

  app.get("/api/admin/asset-packs", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, name, '' AS cover_url, description, pack_story, pack_type,
        single_price, ten_price, daily_free_draws, sale_start_at, sale_end_at, enabled, sort_order,
        probability_notice, created_at, updated_at
       FROM asset_packs ORDER BY sort_order DESC, created_at DESC`
    );
    const packs = await Promise.all(rows.map(async (row) => {
      const config = await packConfiguration(String(row.id), pool, true);
      return { ...packPayload(row, "thumbnail"), probabilityNotice: probabilityDisclosure(config), rarityProbabilities: config.rarityProbabilities, probabilityTotal: config.probabilityTotal, configurationReady: config.ready, cards: config.cards.map((card) => ({ ...cardPayload(card, true), actualProbability: card.status === "active" ? actualCardProbability(config, card) : 0 })) };
    }));
    res.json({ packs });
  });

  app.get("/api/admin/asset-packs/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM asset_packs WHERE id = ? LIMIT 1", [req.params.id]);
    if (!row) return sendError(res, 404, "卡包不存在");
    res.json({ pack: packPayload(row) });
  });

  app.post("/api/admin/asset-packs", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = packSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "卡包资料无效");
    if (parsed.data.enabled) return sendError(res, 400, "新卡包需要先保存卡片和概率，再启用上架");
    const id = nanoid();
    const value = parsed.data;
    const optimizedCover = await optimizedAssetImages(value.coverUrl, 1280, 480);
    await pool.query(
      `INSERT INTO asset_packs
        (id, name, cover_url, cover_thumbnail, description, pack_story, pack_type, single_price, ten_price, daily_free_draws, sale_start_at, sale_end_at, enabled, sort_order, probability_notice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, value.name, optimizedCover.full, optimizedCover.thumbnail, value.description, value.packStory, value.packType, value.singlePrice, value.tenPrice, value.dailyFreeDraws, value.packType === "permanent" ? null : new Date(value.saleStartAt!), value.packType === "permanent" ? null : new Date(value.saleEndAt!), value.sortOrder, value.probabilityNotice]
    );
    res.status(201).json({ id });
  });

  app.patch("/api/admin/asset-packs/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = packSchemaObject.partial().safeParse(req.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return sendError(res, 400, "卡包资料无效");
    if (parsed.data.enabled) {
      const config = await packConfiguration(req.params.id);
      if (!config.ready) return sendError(res, 409, "概率必须合计100%，且至少包含稀有、史诗、传说保底卡片");
    }
    const [[currentPack], [orders]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT pack_type, sale_start_at, sale_end_at FROM asset_packs WHERE id = ? LIMIT 1", [req.params.id]).then(([rows]) => rows),
      pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM asset_draw_orders WHERE pack_id = ?", [req.params.id]).then(([rows]) => rows)
    ]);
    if (!currentPack) return sendError(res, 404, "卡包不存在");
    if (parsed.data.packType && parsed.data.packType !== currentPack.pack_type && Number(orders.count) > 0) return sendError(res, 409, "已有抽卡记录的卡包不能修改类型");
    const nextType = packType(parsed.data.packType ?? currentPack.pack_type);
    const nextStart = nextType === "permanent" ? null : parsed.data.saleStartAt === undefined ? iso(currentPack.sale_start_at) : parsed.data.saleStartAt;
    const nextEnd = nextType === "permanent" ? null : parsed.data.saleEndAt === undefined ? iso(currentPack.sale_end_at) : parsed.data.saleEndAt;
    if (nextType !== "permanent" && (!nextStart || !nextEnd)) return sendError(res, 400, "限定卡包和联名卡包必须设置起止时间");
    if (nextStart && nextEnd && nextEnd <= nextStart) return sendError(res, 400, "下架时间必须晚于上架时间");
    const columns: Record<string, string> = { name: "name", coverUrl: "cover_url", coverThumbnail: "cover_thumbnail", description: "description", packStory: "pack_story", packType: "pack_type", singlePrice: "single_price", tenPrice: "ten_price", dailyFreeDraws: "daily_free_draws", saleStartAt: "sale_start_at", saleEndAt: "sale_end_at", enabled: "enabled", sortOrder: "sort_order", probabilityNotice: "probability_notice" };
    const updateData: Record<string, unknown> = nextType === "permanent" ? { ...parsed.data, saleStartAt: null, saleEndAt: null } : { ...parsed.data };
    if (parsed.data.coverUrl) {
      const optimizedCover = await optimizedAssetImages(parsed.data.coverUrl, 1280, 480);
      updateData.coverUrl = optimizedCover.full;
      updateData.coverThumbnail = optimizedCover.thumbnail;
    }
    const entries = Object.entries(updateData);
    await pool.query(`UPDATE asset_packs SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([key, value]) => key === "saleStartAt" || key === "saleEndAt" ? (value ? new Date(String(value)) : null) : typeof value === "boolean" ? (value ? 1 : 0) : value), req.params.id]);
    res.json({ ok: true });
  });

  app.delete("/api/admin/asset-packs/:id", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[pack], [bindings], [orders]] = await Promise.all([
        connection.query<mysql.RowDataPacket[]>("SELECT id FROM asset_packs WHERE id = ? FOR UPDATE", [req.params.id]).then(([rows]) => rows),
        connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM asset_pack_cards WHERE pack_id = ?", [req.params.id]).then(([rows]) => rows),
        connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM asset_draw_orders WHERE pack_id = ?", [req.params.id]).then(([rows]) => rows)
      ]);
      if (!pack) throw new Error("ASSET_PACK_NOT_FOUND");
      if (Number(bindings?.count ?? 0) > 0) throw new Error("已绑定卡牌的卡包不能删除");
      if (Number(orders?.count ?? 0) > 0) throw new Error("已有抽卡记录的卡包不能删除");
      await connection.query("DELETE FROM asset_packs WHERE id = ?", [req.params.id]);
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      const message = errorMessage(error);
      sendError(res, message === "卡包不存在" ? 404 : 409, message);
    } finally {
      connection.release();
    }
  });

  app.put("/api/admin/asset-packs/:id/rarity-probabilities", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = rarityProbabilitiesSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "品质概率配置无效");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[pack]] = await connection.query<mysql.RowDataPacket[]>("SELECT enabled FROM asset_packs WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!pack) throw new Error("ASSET_PACK_NOT_FOUND");
      await connection.query("DELETE FROM asset_pack_rarity_probabilities WHERE pack_id = ?", [req.params.id]);
      for (const candidate of Object.keys(RARITY_RANK) as Rarity[]) {
        await connection.query(
          "INSERT INTO asset_pack_rarity_probabilities (pack_id, rarity, probability) VALUES (?, ?, ?)",
          [req.params.id, candidate, parsed.data.probabilities[candidate]]
        );
      }
      const config = await packConfiguration(req.params.id, connection);
      if (bool(pack?.enabled) && !config.ready) throw new Error("启用中的卡包必须保持100%概率及完整保底品质");
      await connection.commit();
      res.json({ rarityProbabilities: config.rarityProbabilities, probabilityTotal: config.probabilityTotal, configurationReady: config.ready });
    } catch (error) {
      await connection.rollback();
      sendError(res, 409, errorMessage(error));
    } finally {
      connection.release();
    }
  });
}

export const digitalAssetRules = {
  pityLimits: PITY_LIMITS,
  collectionValues: COLLECTION_VALUES,
  fullStarRefunds: FULL_STAR_REFUNDS,
  starForTotal,
  duplicateProgress,
  nextStarRequirement,
  pityTrigger,
  updatePity
};
