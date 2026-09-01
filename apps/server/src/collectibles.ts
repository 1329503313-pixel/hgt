import express from "express";
import type mysql from "mysql2/promise";
import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { z } from "zod";
import { pool } from "./db.js";
import type { UserRole } from "./roles.js";
import { ossConfigured, storeMediaBuffer } from "./ossStorage.js";
import {
  finishCardMotionWebm, processCardMotionPrimary, removeCardMotionFiles, sendAssetVideo,
  stageCardMotionVideo, uploadCardMotionPrimary, uploadCardMotionWebm
} from "./assetVideos.js";
import { vipGrowthSnapshot } from "./vipGrowth.js";
import { COLLECTIBLE_RANKING_ELIGIBLE_ROLES_SQL, CURRENT_COLLECTIBLE_HOLDINGS_SQL } from "./collectibleRankings.js";

type RouteUser = { id: string; role: UserRole };
type Dependencies = {
  requireAuth: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  requireAdmin: (req: express.Request, res: express.Response) => Promise<RouteUser | null>;
  sendError: (res: express.Response, status: number, message: string) => express.Response;
  sendStoredImage: (req: express.Request, res: express.Response, value: unknown, maxWidth: number, cacheControl?: string) => Promise<express.Response | void>;
  emitUserEvent: (userId: string, event: string, payload: unknown) => void;
  emitUnreadChanged: (userId: string, source: string) => void;
  broadcastEvent: (event: string, payload: unknown) => void;
  onBadgeProgress?: (userId: string) => void;
};

export type CollectibleAward = ReturnType<typeof collectiblePayload> & { drawIndex: number; probability: number };
const rarityLabels = { limited: "限定", collaboration: "联动", legend: "传说", epic: "史诗" } as const;
const collectibleTypeLabels = { treasure: "珍宝", commemorative: "纪念", honor: "荣耀" } as const;
const statusLabels = { unowned: "无主", owned: "被拥有", auction_pending: "待拍卖", auction_active: "拍卖中", draw_linked: "已关联抽卡" } as const;
const jobs = new Map<string, Promise<void>>();

const collectibleSchema = z.object({
  name: z.string().trim().min(1, "请填写收藏品名称").max(120),
  rarity: z.enum(["epic", "legend"], { message: "收藏品品质只能设置为史诗或传说" }),
  collectibleType: z.enum(["treasure", "commemorative", "honor"]),
  collectibleValue: z.number().int().positive("收藏品价值必须是正整数"),
  description: z.string().max(10_000).optional().default(""),
  imageUrl: z.string().trim().min(1, "请上传收藏品封面").max(8_000_000),
  collectibleNo: z.string().trim().regex(/^\d+$/, "收藏品编号只能使用数字").max(32).optional()
});

function iso(value: unknown) { return value ? new Date(value as string | Date).toISOString() : null; }
function bool(value: unknown) { return Boolean(Number(value)); }
function imageUrl(id: string, thumbnail = false) { return `/api/media/collectibles/${encodeURIComponent(id)}/${thumbnail ? "thumbnail" : "image"}`; }
function motionUrl(row: mysql.RowDataPacket, type: "mp4" | "webm") {
  const version = row.motion_version ? `?v=${encodeURIComponent(String(row.motion_version))}` : "";
  return row[`motion_${type}_path`] ? `/api/media/collectibles/${encodeURIComponent(String(row.id))}/motion/${type}${version}` : null;
}
function collectiblePayload(row: mysql.RowDataPacket) {
  return {
    id: String(row.id), collectibleNo: String(row.collectible_no), name: String(row.name),
    rarity: String(row.rarity), rarityLabel: rarityLabels[row.rarity as keyof typeof rarityLabels] ?? String(row.rarity),
    collectibleType: String(row.collectible_type ?? "treasure"), collectibleTypeLabel: collectibleTypeLabels[row.collectible_type as keyof typeof collectibleTypeLabels] ?? "珍宝",
    collectibleValue: Number(row.collectible_value ?? 1),
    description: String(row.description ?? ""), imageUrl: imageUrl(String(row.id)), thumbnailUrl: imageUrl(String(row.id), true),
    motionMp4Url: motionUrl(row, "mp4"), motionWebmUrl: motionUrl(row, "webm"),
    motionPosterUrl: row.motion_poster_path ? imageUrl(String(row.id), true) : null,
    motionStatus: String(row.motion_status ?? "idle"), motionError: row.motion_error ? String(row.motion_error) : null,
    owner: row.owner_user_id ? { id: String(row.owner_user_id), nickname: String(row.owner_nickname ?? ""), username: String(row.owner_username ?? "") } : null,
    status: String(row.status), statusLabel: statusLabels[row.status as keyof typeof statusLabels] ?? String(row.status),
    packBinding: row.pack_id ? { packId: String(row.pack_id), packName: String(row.pack_name ?? ""), probability: Number(row.draw_probability) } : null,
    auction: row.auction_id ? { id: String(row.auction_id), startingPrice: Number(row.starting_price), currentPrice: row.current_price == null ? null : Number(row.current_price), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at) } : null,
    acquiredAt: iso(row.acquired_at), followed: bool(row.followed), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

export async function optimizeCollectibleImages(value: string, id: string, mediaStorageConfigured = ossConfigured()) {
  if (!value.startsWith("data:image/")) return { full: value, thumbnail: value };
  const encoded = value.slice(value.indexOf(",") + 1);
  const source = Buffer.from(encoded, "base64");
  const [full, thumbnail] = await Promise.all([
    sharp(source).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 88, effort: 4 }).toBuffer(),
    sharp(source).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer()
  ]);
  if (!mediaStorageConfigured) {
    return {
      full: `data:image/webp;base64,${full.toString("base64")}`,
      thumbnail: `data:image/webp;base64,${thumbnail.toString("base64")}`
    };
  }
  const [storedFull, storedThumbnail] = await Promise.all([
    storeMediaBuffer(full, { category: "assets/collectibles", entityId: id, variant: "image", contentType: "image/webp", extension: "webp" }),
    storeMediaBuffer(thumbnail, { category: "assets/collectibles", entityId: id, variant: "thumbnail", contentType: "image/webp", extension: "webp" })
  ]);
  return { full: storedFull, thumbnail: storedThumbnail };
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

function snapshot(row: mysql.RowDataPacket) {
  return JSON.stringify({ id: String(row.id), collectibleNo: String(row.collectible_no), name: String(row.name), rarity: String(row.rarity), collectibleType: String(row.collectible_type ?? "treasure"), collectibleValue: Number(row.collectible_value ?? 1) });
}

async function recordValueEvent(connection: mysql.PoolConnection, row: mysql.RowDataPacket, userId: string, amount: number, eventType: "grant" | "reclaim" | "auction" | "draw" | "adjustment", relatedType: string, relatedId: string) {
  await connection.query(
    "INSERT INTO collectible_value_events (id,collectible_id,user_id,amount,event_type,related_type,related_id) VALUES (?,?,?,?,?,?,?)",
    [nanoid(), row.id, userId, amount, eventType, relatedType, relatedId]
  );
}

export async function insertNotification(connection: mysql.PoolConnection, userId: string, type: string, title: string, content: string, relatedId: string) {
  await connection.query(
    `INSERT INTO notifications (id, user_id, type, title, content, related_id, actor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title=VALUES(title), content=VALUES(content), is_read=FALSE, created_at=CURRENT_TIMESTAMP`,
    [nanoid(), userId, type, title, content, relatedId, userId]
  );
}

async function nextNumber(connection: mysql.PoolConnection) {
  const [[row]] = await connection.query<mysql.RowDataPacket[]>("SELECT next_value FROM collectible_number_sequences WHERE sequence_key = 'collectible' FOR UPDATE");
  const value = Number(row?.next_value ?? 1);
  await connection.query("UPDATE collectible_number_sequences SET next_value = ? WHERE sequence_key = 'collectible'", [value + 1]);
  return String(value).padStart(3, "0");
}

async function advanceNumberSequence(connection: mysql.PoolConnection, collectibleNo: string) {
  const numeric = Number(collectibleNo);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return;
  await connection.query(
    "UPDATE collectible_number_sequences SET next_value=GREATEST(next_value, ?) WHERE sequence_key='collectible'",
    [numeric + 1]
  );
}

export function collectibleProbabilityWins(probability: number, roll: number) {
  return roll < Math.round(probability * 1_000_000);
}

export function collectibleProbabilityDetails(baseProbability: number, completedDrawCount: number) {
  const boostLevel = Math.min(4, Math.max(0, Math.floor(completedDrawCount / 100)));
  const probabilityBoost = boostLevel * 0.01;
  const probability = Math.min(100, Math.round((baseProbability + probabilityBoost) * 100_000_000) / 100_000_000);
  return { baseProbability, probability, probabilityBoost, probabilityBoostLevel: boostLevel };
}

export function collectibleAuctionEndAfterBid(currentEnd: Date, bidAt: Date) {
  return currentEnd.getTime() - bidAt.getTime() <= 60_000
    ? new Date(bidAt.getTime() + 60_000)
    : currentEnd;
}

function queueMotion(id: string, staged: Awaited<ReturnType<typeof stageCardMotionVideo>>, previous: unknown[]) {
  const key = `${id}:${staged.version}`;
  if (jobs.has(key)) return;
  const job = (async () => {
    try {
      const processed = await processCardMotionPrimary(staged);
      const uploaded = await uploadCardMotionPrimary(`collectible-${id}`, processed);
      const [result] = await pool.query<mysql.ResultSetHeader>(
        `UPDATE collectibles SET motion_mp4_path=?, motion_webm_path=NULL, motion_poster_path=?, motion_version=?, motion_processing_version=NULL, motion_status='ready', motion_error=NULL
         WHERE id=? AND motion_processing_version=?`,
        [uploaded.mp4Path, uploaded.posterPath, uploaded.version, id, uploaded.version]
      );
      if (!result.affectedRows) return;
      await removeCardMotionFiles(previous);
      try {
        const webm = await finishCardMotionWebm(processed);
        if (webm) await pool.query("UPDATE collectibles SET motion_webm_path=? WHERE id=? AND motion_version=?", [await uploadCardMotionWebm(`collectible-${id}`, processed.version, webm), id, processed.version]);
      } catch { /* MP4 remains the required primary format. */ }
    } catch {
      await pool.query("UPDATE collectibles SET motion_processing_version=NULL, motion_status='failed', motion_error='视频转码失败，请检查素材格式' WHERE id=? AND motion_processing_version=?", [id, staged.version]).catch(() => undefined);
    } finally {
      await removeCardMotionFiles([staged.mp4Path, staged.posterPath, staged.webmPath]).catch(() => undefined);
      jobs.delete(key);
    }
  })();
  jobs.set(key, job);
}

export async function awardCollectiblesForDraw(connection: mysql.PoolConnection, userId: string, packId: string, orderId: string, drawIndex: number, completedDrawCount: number): Promise<CollectibleAward[]> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT c.*, b.probability AS draw_probability FROM collectibles c
     INNER JOIN collectible_pack_bindings b ON b.collectible_id=c.id
     WHERE b.pack_id=? AND c.status='draw_linked' AND c.owner_user_id IS NULL AND c.deleted_at IS NULL
     ORDER BY c.id FOR UPDATE`, [packId]
  );
  const awarded: CollectibleAward[] = [];
  for (const row of rows) {
    const { probability } = collectibleProbabilityDetails(Number(row.draw_probability), completedDrawCount);
    if (!collectibleProbabilityWins(probability, randomInt(100_000_000))) continue;
    await connection.query("UPDATE collectibles SET owner_user_id=?, status='owned' WHERE id=? AND status='draw_linked'", [userId, row.id]);
    await connection.query("DELETE FROM collectible_pack_bindings WHERE collectible_id=?", [row.id]);
    await connection.query("INSERT INTO collectible_draw_awards (id,collectible_id,order_id,draw_index,user_id,probability_snapshot) VALUES (?,?,?,?,?,?)", [nanoid(), row.id, orderId, drawIndex, userId, probability]);
    await connection.query("INSERT INTO collectible_transfers (id,collectible_id,to_user_id,transfer_type,related_type,related_id,collectible_snapshot) VALUES (?,?,?,'draw','asset_draw_order',?,?)", [nanoid(), row.id, userId, orderId, snapshot(row)]);
    await recordValueEvent(connection, row, userId, Number(row.collectible_value ?? 1), "draw", "asset_draw_order", orderId);
    awarded.push({ ...collectiblePayload({ ...row, owner_user_id: userId, status: "owned" }), drawIndex, probability });
  }
  return awarded;
}

export async function collectiblesForPack(packId: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.*, u.nickname AS owner_nickname,u.username AS owner_username,
       b.probability AS draw_probability, FALSE AS acquired,
       NULL AS acquired_at
     FROM collectible_pack_bindings b
     INNER JOIN collectibles c ON c.id=b.collectible_id
     LEFT JOIN users u ON u.id=c.owner_user_id
     WHERE b.pack_id=? AND c.status='draw_linked' AND c.owner_user_id IS NULL AND c.deleted_at IS NULL
     UNION ALL
     SELECT c.*,u.nickname AS owner_nickname,u.username AS owner_username,
       a.probability_snapshot AS draw_probability, TRUE AS acquired,
       a.created_at AS acquired_at
     FROM collectible_draw_awards a
     INNER JOIN asset_draw_orders o ON o.id=a.order_id
     INNER JOIN collectibles c ON c.id=a.collectible_id
     LEFT JOIN users u ON u.id=c.owner_user_id
     WHERE o.pack_id=? AND c.deleted_at IS NULL
     ORDER BY FIELD(rarity,'limited','collaboration','legend','epic'),CAST(collectible_no AS UNSIGNED),collectible_no`,
    [packId, packId]
  );
  return rows.map((row) => ({ ...collectiblePayload(row), probability: Number(row.draw_probability), acquired: bool(row.acquired) }));
}

export async function collectiblePackCounts(packIds: string[]) {
  if (!packIds.length) return new Map<string, { available: number; total: number }>();
  const placeholders = packIds.map(() => "?").join(",");
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT pack_id,SUM(acquired=0) AS available_count,COUNT(*) AS total_count FROM (
       SELECT b.pack_id,c.id,FALSE AS acquired FROM collectible_pack_bindings b INNER JOIN collectibles c ON c.id=b.collectible_id WHERE b.pack_id IN (${placeholders}) AND c.status='draw_linked' AND c.owner_user_id IS NULL AND c.deleted_at IS NULL
       UNION ALL
       SELECT o.pack_id,c.id,TRUE AS acquired FROM collectible_draw_awards a INNER JOIN asset_draw_orders o ON o.id=a.order_id INNER JOIN collectibles c ON c.id=a.collectible_id WHERE o.pack_id IN (${placeholders}) AND c.deleted_at IS NULL
     ) linked GROUP BY pack_id`,
    [...packIds, ...packIds]
  );
  return new Map(rows.map((row) => [String(row.pack_id), { available: Number(row.available_count), total: Number(row.total_count) }]));
}

export async function collectibleAwardsForOrder(orderId: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.*,a.draw_index,a.probability_snapshot FROM collectible_draw_awards a
     INNER JOIN collectibles c ON c.id=a.collectible_id WHERE a.order_id=? ORDER BY a.draw_index,c.collectible_no`, [orderId]
  );
  return rows.map((row) => ({ ...collectiblePayload(row), drawIndex: Number(row.draw_index), probability: Number(row.probability_snapshot) }));
}

async function auctionPayload(id: string, userId?: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT a.*, c.collectible_no,c.name,c.rarity,c.collectible_type,c.collectible_value,c.description,c.image_url,c.thumbnail_url,c.motion_mp4_path,c.motion_webm_path,c.motion_poster_path,c.motion_version,c.motion_status,c.status AS collectible_status,
      u.nickname AS highest_nickname, EXISTS(SELECT 1 FROM collectible_follows f WHERE f.collectible_id=c.id AND f.user_id=?) AS followed
     FROM collectible_auctions a INNER JOIN collectibles c ON c.id=a.collectible_id LEFT JOIN users u ON u.id=a.highest_bidder_id WHERE a.id=?`, [userId ?? "", id]
  );
  if (!row) return null;
  return {
    id: String(row.id), collectible: collectiblePayload({ ...row, id: row.collectible_id, status: row.collectible_status }),
    startingPrice: Number(row.starting_price), currentPrice: row.current_price == null ? null : Number(row.current_price),
    highestBidder: row.highest_bidder_id ? { id: String(row.highest_bidder_id), nickname: String(row.highest_nickname ?? "") } : null,
    isHighestBidder: Boolean(userId && String(row.highest_bidder_id) === userId), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
    status: String(row.status), settledAt: iso(row.settled_at)
  };
}

export function registerCollectibleRoutes(app: express.Express, deps: Dependencies) {
  app.get("/api/media/collectibles/:id/:variant", async (req, res) => {
    if (!["image", "thumbnail"].includes(req.params.variant)) return deps.sendError(res, 404, "图片不存在");
    const column = req.params.variant === "thumbnail" ? "COALESCE(motion_poster_path,thumbnail_url,image_url)" : "image_url";
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(`SELECT ${column} AS image FROM collectibles WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
    if (!row) return deps.sendError(res, 404, "收藏品不存在");
    return deps.sendStoredImage(req, res, row.image, req.params.variant === "thumbnail" ? 480 : 1200, "private, max-age=31536000, immutable");
  });
  app.get("/api/media/collectibles/:id/motion/:variant", async (req, res) => {
    if (!["mp4", "webm"].includes(req.params.variant)) return deps.sendError(res, 404, "视频不存在");
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(`SELECT motion_${req.params.variant}_path AS path FROM collectibles WHERE id=?`, [req.params.id]);
    if (!row?.path) return deps.sendError(res, 404, "视频不存在");
    await sendAssetVideo(req, res, String(row.path));
  });

  app.get("/api/collectible-auctions", async (req, res) => {
    const user = await deps.requireAuth(req, res); if (!user) return;
    const tab = String(req.query.tab ?? "active");
    const statusSql = tab === "upcoming" ? "a.status='pending'" : tab === "history" ? "a.status IN ('sold','unsold','cancelled')" : "a.status='active'";
    const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT a.id FROM collectible_auctions a WHERE ${statusSql} ORDER BY ${tab === "history" ? "a.settled_at DESC" : "a.starts_at ASC"},a.id DESC LIMIT 100`);
    res.json({ auctions: (await Promise.all(rows.map((row) => auctionPayload(String(row.id), user.id)))).filter(Boolean) });
  });
  app.get("/api/collectible-auctions/:id", async (req, res) => {
    const user = await deps.requireAuth(req, res); if (!user) return;
    const auction = await auctionPayload(req.params.id, user.id); if (!auction) return deps.sendError(res, 404, "拍卖不存在");
    res.json({ auction });
  });
  app.get("/api/collectibles/:id", async (req, res) => {
    if (!(await deps.requireAuth(req, res))) return;
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT c.*,u.nickname AS owner_nickname,u.username AS owner_username,
        (SELECT t.created_at FROM collectible_transfers t
         WHERE t.collectible_id=c.id AND t.to_user_id=c.owner_user_id
         ORDER BY t.created_at DESC,t.id DESC LIMIT 1) AS acquired_at
       FROM collectibles c LEFT JOIN users u ON u.id=c.owner_user_id
       WHERE c.id=? AND c.deleted_at IS NULL LIMIT 1`,
      [req.params.id]
    );
    if (!row) return deps.sendError(res, 404, "收藏品不存在");
    res.json({ collectible: collectiblePayload(row) });
  });
  app.get("/api/collectible-rankings", async (req, res) => {
    const user = await deps.requireAuth(req, res); if (!user) return;
    const [accounts] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id,u.nickname,u.role,u.vip_growth_value,u.vip_expires_at,u.vip_legacy_active,
        u.avatar IS NOT NULL AS has_avatar,u.created_at,
        COALESCE(owned.collectible_value,0) AS current_value,
        COALESCE(owned.collectible_count,0) AS collectible_count,
        COALESCE(owned.reached_at,u.created_at) AS reached_at
       FROM users u LEFT JOIN (${CURRENT_COLLECTIBLE_HOLDINGS_SQL}) owned ON owned.user_id=u.id
       WHERE u.role IN (${COLLECTIBLE_RANKING_ELIGIBLE_ROLES_SQL})`
    );
    const all = accounts.map((row) => {
      const vip = vipGrowthSnapshot(row);
      return { id:String(row.id),nickname:String(row.nickname),avatar:bool(row.has_avatar)?`/api/media/users/${encodeURIComponent(String(row.id))}/avatar`:null,
        collectibleValue:Number(row.current_value),collectibleCount:Number(row.collectible_count),vipLevel:vip.level,vipActive:vip.active,
        reachedAt:new Date(row.reached_at).getTime(),createdAt:new Date(row.created_at).getTime() };
    }).filter((item)=>item.collectibleValue>0).sort((a,b)=>b.collectibleValue-a.collectibleValue||a.reachedAt-b.reachedAt||a.createdAt-b.createdAt||a.id.localeCompare(b.id)).map(({reachedAt:_reachedAt,createdAt:_createdAt,...item},index)=>({...item,rank:index+1}));
    const ranking=all.slice(0,10),own=all.find((item)=>item.id===user.id)??null;
    res.json({ranking,own:own&&!ranking.some((item)=>item.id===own.id)?own:null});
  });
  app.post("/api/collectibles/:id/follow", async (req, res) => {
    const user = await deps.requireAuth(req, res); if (!user) return;
    const [result] = await pool.query<mysql.ResultSetHeader>("DELETE FROM collectible_follows WHERE collectible_id=? AND user_id=?", [req.params.id, user.id]);
    if (result.affectedRows) return res.json({ followed: false });
    await pool.query("INSERT IGNORE INTO collectible_follows (collectible_id,user_id) VALUES (?,?)", [req.params.id, user.id]);
    res.json({ followed: true });
  });
  app.post("/api/collectible-auctions/:id/bids", async (req, res) => {
    const user = await deps.requireAuth(req, res); if (!user) return;
    const parsed = z.object({ amount: z.number().int().positive(), requestId: z.string().min(8).max(100) }).safeParse(req.body);
    if (!parsed.success) return deps.sendError(res, 400, "出价参数无效");
    const connection = await pool.getConnection(); let previousUserId: string | null = null;
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM collectible_auction_bids WHERE request_id=? FOR UPDATE", [parsed.data.requestId]);
      if (existing) {
        const [[balanceRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT shell_balance FROM users WHERE id=?", [user.id]);
        await connection.commit();
        return res.json({ auction: await auctionPayload(req.params.id, user.id), balance: Number(balanceRow?.shell_balance ?? 0) });
      }
      const [[auction]] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectible_auctions WHERE id=? FOR UPDATE", [req.params.id]);
      if (!auction || auction.status !== "active" || new Date(auction.ends_at).getTime() <= Date.now()) throw new Error("拍卖已经结束");
      if (String(auction.highest_bidder_id ?? "") === user.id) throw new Error("你已经是当前最高出价者");
      const minimum = auction.current_price == null ? Number(auction.starting_price) : Number(auction.current_price) + 10;
      if (parsed.data.amount < minimum) throw new Error(`本次出价不能低于 ${minimum} 贝壳`);
      previousUserId = auction.highest_bidder_id ? String(auction.highest_bidder_id) : null;
      const userIds = [...new Set([user.id, previousUserId].filter(Boolean) as string[])].sort();
      const [users] = await connection.query<mysql.RowDataPacket[]>(`SELECT id,shell_balance FROM users WHERE id IN (${userIds.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, userIds);
      const bidder = users.find((row) => String(row.id) === user.id); if (!bidder || Number(bidder.shell_balance) < parsed.data.amount) throw new Error("可用贝壳不足");
      if (previousUserId) {
        await connection.query("UPDATE users SET shell_balance=shell_balance+? WHERE id=?", [auction.current_price, previousUserId]);
        await connection.query("INSERT INTO shell_transactions (id,user_id,transaction_type,amount,balance_after,related_type,related_id,remark,idempotency_key) SELECT ?,id,'collectible_bid_release',?,shell_balance,'collectible_auction',?,'竞拍出价被超过，解除冻结',? FROM users WHERE id=?", [nanoid(), auction.current_price, auction.id, `collectible-auction:${auction.id}:release:${parsed.data.requestId}`, previousUserId]);
        await insertNotification(connection, previousUserId, "collectible_outbid", "藏品竞拍出价被超过", `${auction.current_price} 贝壳已退回余额`, String(auction.id));
      }
      await connection.query("UPDATE users SET shell_balance=shell_balance-? WHERE id=?", [parsed.data.amount, user.id]);
      await connection.query("INSERT INTO shell_transactions (id,user_id,transaction_type,amount,balance_after,related_type,related_id,remark,idempotency_key) SELECT ?,id,'collectible_bid_hold',?,shell_balance,'collectible_auction',?,'藏品竞拍冻结',? FROM users WHERE id=?", [nanoid(), -parsed.data.amount, auction.id, `collectible-auction:${auction.id}:hold:${parsed.data.requestId}`, user.id]);
      await connection.query("INSERT INTO collectible_auction_bids (id,request_id,auction_id,bidder_id,amount) VALUES (?,?,?,?,?)", [nanoid(), parsed.data.requestId, auction.id, user.id, parsed.data.amount]);
      const bidAt = new Date();
      const nextEnd = collectibleAuctionEndAfterBid(new Date(auction.ends_at), bidAt);
      await connection.query("UPDATE collectible_auctions SET current_price=?,highest_bidder_id=?,ends_at=? WHERE id=?", [parsed.data.amount, user.id, nextEnd, auction.id]);
      const [balanceRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id,shell_balance FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
        userIds
      );
      const balances = new Map(balanceRows.map((row) => [String(row.id), Number(row.shell_balance ?? 0)]));
      await connection.commit();
      const payload = await auctionPayload(req.params.id, user.id); deps.broadcastEvent("collectible_auction_changed", { auctionId: req.params.id, reason: "bid", auction: payload });
      if (previousUserId) {
        deps.emitUserEvent(previousUserId, "shell_balance_changed", { balance: balances.get(previousUserId) ?? 0, source: "collectible_bid_release", auctionId: req.params.id, at: new Date().toISOString() });
        deps.emitUnreadChanged(previousUserId, "collectible_outbid");
      }
      deps.emitUserEvent(user.id, "shell_balance_changed", { balance: balances.get(user.id) ?? 0, source: "collectible_bid_hold", auctionId: req.params.id, at: new Date().toISOString() });
      deps.emitUnreadChanged(user.id, "collectible_bid");
      res.json({ auction: payload, balance: balances.get(user.id) ?? 0 });
    } catch (error) { await connection.rollback(); deps.sendError(res, 409, error instanceof Error ? error.message : "出价失败"); }
    finally { connection.release(); }
  });

  app.get("/api/me/collectibles", async (req, res) => {
    const user = await deps.requireAuth(req, res); if (!user) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT c.* FROM collectibles c WHERE c.owner_user_id=? AND c.deleted_at IS NULL ORDER BY c.collectible_no", [user.id]);
    res.json({ collectibles: rows.map(collectiblePayload) });
  });
  app.get("/api/me/collectibles/:id", async (req, res) => {
    const user = await deps.requireAuth(req, res); if (!user) return;
    const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT c.* FROM collectibles c WHERE c.id=? AND c.owner_user_id=? AND c.deleted_at IS NULL", [req.params.id, user.id]);
    if (!row) return deps.sendError(res, 404, "收藏品不存在"); res.json({ collectible: collectiblePayload(row) });
  });

  app.get("/api/admin/collectibles", async (req, res) => {
    if (!(await deps.requireAdmin(req, res))) return;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT c.*,u.nickname owner_nickname,u.username owner_username,b.pack_id,b.probability draw_probability,p.name pack_name,a.id auction_id,a.starting_price,a.current_price,a.starts_at,a.ends_at FROM collectibles c LEFT JOIN users u ON u.id=c.owner_user_id LEFT JOIN collectible_pack_bindings b ON b.collectible_id=c.id LEFT JOIN asset_packs p ON p.id=b.pack_id LEFT JOIN collectible_auctions a ON a.collectible_id=c.id AND a.status IN ('pending','active') WHERE c.deleted_at IS NULL ORDER BY CAST(c.collectible_no AS UNSIGNED),c.collectible_no`);
    const [[sequence]] = await pool.query<mysql.RowDataPacket[]>("SELECT next_value FROM collectible_number_sequences WHERE sequence_key='collectible'");
    res.json({ collectibles: rows.map(collectiblePayload), nextCollectibleNo: String(Number(sequence?.next_value ?? 1)).padStart(3, "0") });
  });
  app.get("/api/admin/collectibles/users/search", async (req, res) => {
    if (!(await deps.requireAdmin(req, res))) return; const keyword = `%${String(req.query.keyword ?? "").trim()}%`;
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id,username,nickname FROM users WHERE username LIKE ? OR nickname LIKE ? ORDER BY nickname LIMIT 20", [keyword, keyword]); res.json({ users: rows });
  });
  app.post("/api/admin/collectibles", async (req, res) => {
    const admin = await deps.requireAdmin(req, res); if (!admin) return; const parsed = collectibleSchema.safeParse(req.body); if (!parsed.success) return deps.sendError(res, 400, parsed.error.issues[0]?.message ?? "资料无效");
    const id = nanoid(); const connection = await pool.getConnection();
    try { await connection.beginTransaction(); const no = parsed.data.collectibleNo || await nextNumber(connection); if (parsed.data.collectibleNo) await advanceNumberSequence(connection, no); const media = await optimizeCollectibleImages(parsed.data.imageUrl, id); await connection.query("INSERT INTO collectibles (id,collectible_no,name,rarity,collectible_type,collectible_value,description,image_url,thumbnail_url) VALUES (?,?,?,?,?,?,?,?,?)", [id,no,parsed.data.name,parsed.data.rarity,parsed.data.collectibleType,parsed.data.collectibleValue,parsed.data.description,media.full,media.thumbnail]); await connection.commit(); res.status(201).json({ id }); }
    catch (error) {
      await connection.rollback();
      if (databaseErrorCode(error) === "ER_DUP_ENTRY") return deps.sendError(res, 409, "收藏品编号已存在");
      console.error("Failed to save collectible", { code: databaseErrorCode(error) || "UNKNOWN" });
      return deps.sendError(res, 500, "保存失败");
    } finally { connection.release(); }
  });
  app.patch("/api/admin/collectibles/:id", async (req, res) => {
    if (!(await deps.requireAdmin(req, res))) return; const parsed = collectibleSchema.partial().safeParse(req.body); if (!parsed.success) return deps.sendError(res, 400, "资料无效");
    const [[current]] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM collectibles WHERE id=? AND deleted_at IS NULL", [req.params.id]); if (!current) return deps.sendError(res, 404, "收藏品不存在");
    if (parsed.data.collectibleNo && parsed.data.collectibleNo !== current.collectible_no) { const [[flow]] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM collectible_transfers WHERE collectible_id=? LIMIT 1", [req.params.id]); if (flow) return deps.sendError(res, 409, "已经流转的收藏品不能修改编号"); }
    const data: Record<string,unknown> = { ...parsed.data }; if (parsed.data.imageUrl) { const media=await optimizeCollectibleImages(parsed.data.imageUrl,req.params.id); data.imageUrl=media.full; data.thumbnailUrl=media.thumbnail; }
    const columns: Record<string,string>={name:"name",rarity:"rarity",collectibleType:"collectible_type",collectibleValue:"collectible_value",description:"description",imageUrl:"image_url",thumbnailUrl:"thumbnail_url",collectibleNo:"collectible_no"}; const entries=Object.entries(data);const connection=await pool.getConnection();try{await connection.beginTransaction();if(entries.length)await connection.query(`UPDATE collectibles SET ${entries.map(([k])=>`${columns[k]}=?`).join(",")} WHERE id=?`,[...entries.map(([,v])=>v),req.params.id]);const previousValue=Number(current.collectible_value??1),nextValue=parsed.data.collectibleValue??previousValue;if(current.owner_user_id&&nextValue!==previousValue)await recordValueEvent(connection,current,String(current.owner_user_id),nextValue-previousValue,"adjustment","admin",req.params.id);await connection.commit();res.json({ok:true});}catch(error){await connection.rollback();deps.sendError(res,409,error instanceof Error?error.message:"保存失败");}finally{connection.release();}
  });
  app.post("/api/admin/collectibles/:id/grant", async (req,res)=>{
    const admin=await deps.requireAdmin(req,res); if(!admin)return; const userId=String(req.body?.userId??""); const connection=await pool.getConnection();
    try{await connection.beginTransaction();const [[item]] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectibles WHERE id=? FOR UPDATE",[req.params.id]);if(!item||item.status!=="unowned")throw new Error("只有无主收藏品可以赠送");const [[target]]=await connection.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id=?",[userId]);if(!target)throw new Error("用户不存在");await connection.query("UPDATE collectibles SET owner_user_id=?,status='owned' WHERE id=?",[userId,item.id]);await connection.query("INSERT INTO collectible_transfers (id,collectible_id,to_user_id,transfer_type,related_type,related_id,operator_id,collectible_snapshot) VALUES (?,?,?,'grant','admin',?,?,?)",[nanoid(),item.id,userId,admin.id,admin.id,snapshot(item)]);await recordValueEvent(connection,item,userId,Number(item.collectible_value??1),"grant","admin",admin.id);await insertNotification(connection,userId,"collectible_granted","获得收藏品",`你获得了收藏品“${item.name}”`,String(item.id));await connection.commit();deps.emitUnreadChanged(userId,"collectible_granted");deps.onBadgeProgress?.(userId);res.json({ok:true});}catch(e){await connection.rollback();deps.sendError(res,409,(e as Error).message);}finally{connection.release();}
  });
  app.post("/api/admin/collectibles/:id/reclaim", async (req,res)=>{
    const admin=await deps.requireAdmin(req,res);if(!admin)return;const connection=await pool.getConnection();try{await connection.beginTransaction();const [[item]]=await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectibles WHERE id=? FOR UPDATE",[req.params.id]);if(!item||item.status!=="owned"||!item.owner_user_id)throw new Error("该收藏品当前没有主人");await connection.query("UPDATE collectibles SET owner_user_id=NULL,status='unowned' WHERE id=?",[item.id]);await connection.query("INSERT INTO collectible_transfers (id,collectible_id,from_user_id,transfer_type,related_type,related_id,operator_id,collectible_snapshot) VALUES (?,?,?,'reclaim','admin',?,?,?)",[nanoid(),item.id,item.owner_user_id,admin.id,admin.id,snapshot(item)]);await recordValueEvent(connection,item,String(item.owner_user_id),-Number(item.collectible_value??1),"reclaim","admin",admin.id);await insertNotification(connection,String(item.owner_user_id),"collectible_reclaimed","收藏品已收回",`收藏品“${item.name}”已由系统收回`,String(item.id));await connection.commit();deps.emitUnreadChanged(String(item.owner_user_id),"collectible_reclaimed");deps.onBadgeProgress?.(String(item.owner_user_id));res.json({ok:true});}catch(e){await connection.rollback();deps.sendError(res,409,(e as Error).message);}finally{connection.release();}
  });
  app.get("/api/admin/collectibles/:id/transfers",async(req,res)=>{if(!(await deps.requireAdmin(req,res)))return;const[rows]=await pool.query<mysql.RowDataPacket[]>(`SELECT t.*,fu.nickname from_nickname,tu.nickname to_nickname,op.nickname operator_nickname FROM collectible_transfers t LEFT JOIN users fu ON fu.id=t.from_user_id LEFT JOIN users tu ON tu.id=t.to_user_id LEFT JOIN users op ON op.id=t.operator_id WHERE t.collectible_id=? ORDER BY t.created_at DESC`,[req.params.id]);res.json({transfers:rows.map(r=>({id:String(r.id),from:r.from_user_id?String(r.from_nickname??r.from_user_id):"系统",to:r.to_user_id?String(r.to_nickname??r.to_user_id):"系统",type:String(r.transfer_type),operator:r.operator_nickname?String(r.operator_nickname):null,createdAt:iso(r.created_at)}))});});
  app.put("/api/admin/asset-packs/:id/collectibles", async (req, res) => {
    if (!(await deps.requireAdmin(req, res))) return;
    const parsed = z.object({ bindings: z.array(z.object({ collectibleId: z.string().min(1).max(64), probability: z.number().gt(0).lte(100) })).max(500) }).safeParse(req.body);
    if (!parsed.success) return deps.sendError(res, 400, "收藏品关联参数无效");
    const bindings = [...new Map(parsed.data.bindings.map((binding) => [binding.collectibleId, binding])).values()];
    const selectedIds = bindings.map((binding) => binding.collectibleId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[pack]] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM asset_packs WHERE id=? FOR UPDATE", [req.params.id]);
      if (!pack) throw new Error("卡包不存在");
      const [currentRows] = await connection.query<mysql.RowDataPacket[]>("SELECT collectible_id FROM collectible_pack_bindings WHERE pack_id=? FOR UPDATE", [req.params.id]);
      const currentIds = currentRows.map((row) => String(row.collectible_id));
      let selectedRows: mysql.RowDataPacket[] = [];
      if (selectedIds.length) {
        [selectedRows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT c.id,c.status,c.owner_user_id,b.pack_id FROM collectibles c
           LEFT JOIN collectible_pack_bindings b ON b.collectible_id=c.id
           WHERE c.id IN (${selectedIds.map(() => "?").join(",")}) AND c.deleted_at IS NULL FOR UPDATE`,
          selectedIds
        );
        if (selectedRows.length !== selectedIds.length) throw new Error("选择的收藏品不存在");
        for (const row of selectedRows) {
          const existingPackId = row.pack_id ? String(row.pack_id) : null;
          const alreadyHere = existingPackId === req.params.id;
          if (row.owner_user_id || (!alreadyHere && row.status !== "unowned") || (existingPackId && !alreadyHere)) {
            throw new Error("只有无主且未关联其他业务的收藏品可以加入卡包");
          }
        }
      }
      const removedIds = currentIds.filter((id) => !selectedIds.includes(id));
      if (removedIds.length) {
        await connection.query(`DELETE FROM collectible_pack_bindings WHERE pack_id=? AND collectible_id IN (${removedIds.map(() => "?").join(",")})`, [req.params.id, ...removedIds]);
        await connection.query(`UPDATE collectibles SET status='unowned' WHERE status='draw_linked' AND id IN (${removedIds.map(() => "?").join(",")})`, removedIds);
      }
      for (const binding of bindings) {
        await connection.query(
          "INSERT INTO collectible_pack_bindings (collectible_id,pack_id,probability) VALUES (?,?,?) ON DUPLICATE KEY UPDATE probability=VALUES(probability)",
          [binding.collectibleId, req.params.id, binding.probability]
        );
        await connection.query("UPDATE collectibles SET status='draw_linked' WHERE id=?", [binding.collectibleId]);
      }
      await connection.commit();
      res.json({ ok: true, count: bindings.length });
    } catch (error) {
      await connection.rollback();
      deps.sendError(res, 409, error instanceof Error ? error.message : "保存收藏品关联失败");
    } finally {
      connection.release();
    }
  });
  app.post("/api/admin/collectibles/:id/auction",async(req,res)=>{const admin=await deps.requireAdmin(req,res);if(!admin)return;const parsed=z.object({startingPrice:z.number().int().positive(),startsAt:z.string().datetime(),endsAt:z.string().datetime()}).safeParse(req.body);if(!parsed.success||new Date(parsed.data.endsAt)<=new Date(parsed.data.startsAt))return deps.sendError(res,400,"拍卖时间或价格无效");const connection=await pool.getConnection();let followers:mysql.RowDataPacket[]=[];try{await connection.beginTransaction();const [[item]]=await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectibles WHERE id=? FOR UPDATE",[req.params.id]);if(!item||item.status!=="unowned")throw new Error("只有无主收藏品可以拍卖");const status=new Date(parsed.data.startsAt)<=new Date()?"active":"pending";const id=nanoid();await connection.query("INSERT INTO collectible_auctions (id,collectible_id,starting_price,starts_at,ends_at,original_ends_at,status,created_by) VALUES (?,?,?,?,?,?,?,?)",[id,item.id,parsed.data.startingPrice,new Date(parsed.data.startsAt),new Date(parsed.data.endsAt),new Date(parsed.data.endsAt),status,admin.id]);await connection.query("UPDATE collectibles SET status=? WHERE id=?",[status==="active"?"auction_active":"auction_pending",item.id]);if(status==="active"){[followers]=await connection.query<mysql.RowDataPacket[]>("SELECT user_id FROM collectible_follows WHERE collectible_id=?",[item.id]);for(const follower of followers)await insertNotification(connection,String(follower.user_id),"collectible_auction_started","关注的藏品开始拍卖",`你关注的藏品“${item.name}”已经开始拍卖`,id);}await connection.commit();for(const follower of followers)deps.emitUnreadChanged(String(follower.user_id),"collectible_auction_started");deps.broadcastEvent("collectible_auction_changed",{auctionId:id,reason:"created"});res.status(201).json({id});}catch(e){await connection.rollback();deps.sendError(res,409,(e as Error).message);}finally{connection.release();}});
  app.delete("/api/admin/collectible-auctions/:id",async(req,res)=>{if(!(await deps.requireAdmin(req,res)))return;const connection=await pool.getConnection();try{await connection.beginTransaction();const [[a]]=await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectible_auctions WHERE id=? FOR UPDATE",[req.params.id]);if(!a||!["pending","active"].includes(a.status))throw new Error("拍卖不可下架");const [[bid]]=await connection.query<mysql.RowDataPacket[]>("SELECT id FROM collectible_auction_bids WHERE auction_id=? LIMIT 1",[a.id]);if(bid)throw new Error("已经有人出价，拍卖不可下架");await connection.query("UPDATE collectible_auctions SET status='cancelled',settled_at=CURRENT_TIMESTAMP WHERE id=?",[a.id]);await connection.query("UPDATE collectibles SET status='unowned' WHERE id=?",[a.collectible_id]);await connection.commit();deps.broadcastEvent("collectible_auction_changed",{auctionId:a.id,reason:"cancelled"});res.json({ok:true});}catch(e){await connection.rollback();deps.sendError(res,409,(e as Error).message);}finally{connection.release();}});
  app.delete("/api/admin/collectibles/:id",async(req,res)=>{if(!(await deps.requireAdmin(req,res)))return;const [[item]]=await pool.query<mysql.RowDataPacket[]>("SELECT status FROM collectibles WHERE id=?",[req.params.id]);if(!item)return deps.sendError(res,404,"收藏品不存在");if(item.status!=="unowned")return deps.sendError(res,409,"只有无主且未关联业务的收藏品可以删除");await pool.query("UPDATE collectibles SET deleted_at=CURRENT_TIMESTAMP WHERE id=?",[req.params.id]);res.json({ok:true});});

  app.put("/api/admin/collectibles/:id/motion",express.raw({type:["video/*","application/octet-stream"],limit:"200mb"}),async(req,res)=>{if(!(await deps.requireAdmin(req,res)))return;const [[item]]=await pool.query<mysql.RowDataPacket[]>("SELECT * FROM collectibles WHERE id=?",[req.params.id]);if(!item)return deps.sendError(res,404,"收藏品不存在");if(!Buffer.isBuffer(req.body))return deps.sendError(res,400,"视频文件无效");try{const staged=await stageCardMotionVideo(`collectible-${req.params.id}`,req.body,String(req.headers["content-type"]??"application/octet-stream"));await pool.query("UPDATE collectibles SET motion_processing_version=?,motion_status='processing',motion_error=NULL WHERE id=?",[staged.version,req.params.id]);queueMotion(req.params.id,staged,[item.motion_mp4_path,item.motion_webm_path,item.motion_poster_path]);res.status(202).json({status:"processing",version:staged.version});}catch{return deps.sendError(res,422,"视频转码失败，请检查文件格式");}});
  app.get("/api/admin/collectibles/:id/motion/status",async(req,res)=>{if(!(await deps.requireAdmin(req,res)))return;const [[row]]=await pool.query<mysql.RowDataPacket[]>("SELECT motion_status,motion_error FROM collectibles WHERE id=?",[req.params.id]);if(!row)return deps.sendError(res,404,"收藏品不存在");res.json({status:String(row.motion_status),error:row.motion_error?String(row.motion_error):null});});
}

export function startCollectibleAuctionScheduler(deps: Pick<Dependencies,"emitUserEvent"|"emitUnreadChanged"|"broadcastEvent"|"onBadgeProgress">) {
  let running=false;
  const run=async()=>{if(running)return;running=true;try{
    const [pending]=await pool.query<mysql.RowDataPacket[]>("SELECT id FROM collectible_auctions WHERE status='pending' AND starts_at<=UTC_TIMESTAMP() ORDER BY starts_at LIMIT 100");
    for(const row of pending){const connection=await pool.getConnection();try{await connection.beginTransaction();const [[a]]=await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectible_auctions WHERE id=? FOR UPDATE",[row.id]);if(!a||a.status!=="pending"||new Date(a.starts_at)>new Date()){await connection.rollback();continue;}await connection.query("UPDATE collectible_auctions SET status='active' WHERE id=?",[a.id]);await connection.query("UPDATE collectibles SET status='auction_active' WHERE id=?",[a.collectible_id]);const[followers]=await connection.query<mysql.RowDataPacket[]>("SELECT user_id FROM collectible_follows WHERE collectible_id=?",[a.collectible_id]);for(const f of followers)await insertNotification(connection,String(f.user_id),"collectible_auction_started","关注的藏品开始拍卖","你关注的藏品已经开始拍卖",String(a.id));await connection.commit();for(const f of followers)deps.emitUnreadChanged(String(f.user_id),"collectible_auction_started");deps.broadcastEvent("collectible_auction_changed",{auctionId:String(a.id),reason:"started"});}catch{await connection.rollback();}finally{connection.release();}}
    const[due]=await pool.query<mysql.RowDataPacket[]>("SELECT id FROM collectible_auctions WHERE status='active' AND ends_at<=UTC_TIMESTAMP() ORDER BY ends_at LIMIT 100");
    for(const row of due){const connection=await pool.getConnection();let winner:string|null=null;try{await connection.beginTransaction();const [[a]]=await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectible_auctions WHERE id=? FOR UPDATE",[row.id]);if(!a||a.status!=="active"||new Date(a.ends_at)>new Date()){await connection.rollback();continue;}const [[item]]=await connection.query<mysql.RowDataPacket[]>("SELECT * FROM collectibles WHERE id=? FOR UPDATE",[a.collectible_id]);winner=a.highest_bidder_id?String(a.highest_bidder_id):null;if(winner){await connection.query("UPDATE collectible_auctions SET status='sold',settled_at=CURRENT_TIMESTAMP WHERE id=?",[a.id]);await connection.query("UPDATE collectibles SET status='owned',owner_user_id=? WHERE id=?",[winner,item.id]);await connection.query("INSERT INTO collectible_transfers (id,collectible_id,to_user_id,transfer_type,related_type,related_id,collectible_snapshot) VALUES (?,?,?,'auction','collectible_auction',?,?)",[nanoid(),item.id,winner,a.id,snapshot(item)]);await recordValueEvent(connection,item,winner,Number(item.collectible_value??1),"auction","collectible_auction",String(a.id));await insertNotification(connection,winner,"collectible_auction_won","竞拍成功",`你以 ${a.current_price} 贝壳拍得“${item.name}”`,String(a.id));}else{await connection.query("UPDATE collectible_auctions SET status='unsold',settled_at=CURRENT_TIMESTAMP WHERE id=?",[a.id]);await connection.query("UPDATE collectibles SET status='unowned' WHERE id=?",[item.id]);}await connection.commit();if(winner){deps.emitUnreadChanged(winner,"collectible_auction_won");deps.onBadgeProgress?.(winner);}deps.broadcastEvent("collectible_auction_changed",{auctionId:String(a.id),reason:winner?"sold":"unsold"});}catch{await connection.rollback();}finally{connection.release();}}
  }finally{running=false;}};
  void run();const timer=setInterval(()=>void run(),10_000);timer.unref();return()=>clearInterval(timer);
}
