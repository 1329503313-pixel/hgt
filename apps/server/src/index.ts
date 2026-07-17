import "express-async-errors";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { z } from "zod";
import { config } from "./config.js";
import { initDatabase, pool } from "./db.js";
import gameRouter, { splitKeyFactsForSoup, forceReanalyzeKeyFacts, setBadgeProgressListener } from "./game.js";
import { reviewSoupContent, SoupReviewUnavailableError } from "./soupReview.js";
import { findHighlySimilarSoup, type SoupSimilarityInput } from "./soupSimilarity.js";
import { PublicUser } from "./types.js";
import { getSticker, stickerSeries } from "./stickers.js";
import { isAdminRelatedNickname } from "./nickname.js";
import { WebSocket, WebSocketServer } from "ws";
import onlineSoupRouter, { cleanupOnlineSoupStaleSeats, setOnlineSoupEventEmitter, setOnlineSoupLobbyEventEmitter } from "./onlineSoup.js";

const JWT_SECRET = process.env.JWT_SECRET;
const insecureJwtSecrets = new Set([
  "dev-jwt-fallback-not-for-production",
  "dev-session-secret-change-me",
  "change-me"
]);

if (config.nodeEnv === "production" && !JWT_SECRET) {
  console.error("FATAL: JWT_SECRET 未设置，服务拒绝启动。");
  process.exit(1);
}

if (!JWT_SECRET) {
  console.warn("⚠ 未设置 JWT_SECRET，使用开发 fallback。生产环境请务必设置 JWT_SECRET。");
} else if (JWT_SECRET.length < 32 || insecureJwtSecrets.has(JWT_SECRET)) {
  console.warn("⚠ JWT_SECRET 长度不足 32 位或为公开默认值；为保持现有会话暂不阻止启动。建议安排维护窗口后轮换。");
}

const JWT_SECRET_FINAL: string = JWT_SECRET || "dev-jwt-fallback-not-for-production";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const userEventClients = new Map<string, Set<Response>>();
const onlineSoupRoomSocketClients = new Map<string, Set<WebSocket>>();
const onlineSoupLobbySocketClients = new Set<WebSocket>();

function emitOnlineSoupSocketEvent(roomId: string, event: string, payload: unknown) {
  const clients = onlineSoupRoomSocketClients.get(roomId);
  if (!clients?.size) return;
  const message = JSON.stringify({ event, payload });
  for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(message);
}

setOnlineSoupEventEmitter(emitOnlineSoupSocketEvent);
setOnlineSoupLobbyEventEmitter((event, payload) => {
  if (!onlineSoupLobbySocketClients.size) return;
  const message = JSON.stringify({ event, payload });
  for (const client of onlineSoupLobbySocketClients) if (client.readyState === WebSocket.OPEN) client.send(message);
});

function emitUserEvent(userId: string, event: string, payload: unknown) {
  const clients = userEventClients.get(userId);
  if (!clients?.size) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(data);
}

function emitUnreadChanged(userId: string, source: string) {
  emitUserEvent(userId, "unread_changed", { source, at: new Date().toISOString() });
}

async function broadcastUnreadChanged(source: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users");
  for (const row of rows) emitUnreadChanged(String(row.id), source);
}

type RateLimitEntry = { count: number; resetAt: number };

function createRateLimiter(windowMs: number, maxRequests: number, keyFor: (req: Request) => string) {
  const entries = new Map<string, RateLimitEntry>();
  let requestsSinceCleanup = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (++requestsSinceCleanup >= 500) {
      requestsSinceCleanup = 0;
      for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
    }
    const key = keyFor(req);
    const current = entries.get(key);
    if (!current || current.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > maxRequests) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
      return sendError(res, 429, "请求过于频繁，请稍后再试");
    }
    next();
  };
}

const loginRateLimiter = createRateLimiter(15 * 60_000, 10, (req) => `login:${req.ip ?? "unknown"}`);
const registerRateLimiter = createRateLimiter(60 * 60_000, 10, (req) => `register:${req.ip ?? "unknown"}`);
const performanceRateLimiter = createRateLimiter(60_000, 120, (req) => `performance:${req.ip ?? "unknown"}`);

function setAuthCookie(res: Response, token: string) {
  res.cookie("hgt_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/"
  });
}

type AuthClaims = {
  id: string;
  tokenVersion: number;
};

type AuthenticatedUser = PublicUser & {
  tokenVersion: number;
};

// ---------- JWT 认证中间件 ----------
function signToken(payload: AuthClaims): string {
  return jwt.sign(payload, JWT_SECRET_FINAL, { expiresIn: "30d" });
}

function verifyToken(token: string): AuthClaims | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET_FINAL) as Partial<AuthClaims>;
    if (typeof payload.id !== "string") return null;
    // 兼容整改前签发的 Token；旧 Token 没有 tokenVersion，按数据库默认版本 0 处理。
    const tokenVersion = payload.tokenVersion == null ? 0 : Number(payload.tokenVersion);
    if (!Number.isInteger(tokenVersion)) return null;
    return { id: payload.id, tokenVersion };
  } catch {
    return null;
  }
}

// 从请求中提取签名声明；权限和用户状态必须从数据库实时读取。
function extractAuthClaims(req: Request): AuthClaims | null {
  // 方式 1: Cookie 中的 JWT
  const cookieToken = req.cookies?.hgt_token;
  if (cookieToken) return verifyToken(cookieToken);

  // 方式 2: Authorization 头 (Bearer)
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return verifyToken(auth.slice(7));
  }

  return null;
}

app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(compression({
  threshold: 1024,
  filter: (req, res) => req.path !== "/api/events" && compression.filter(req, res)
}));
app.use(express.json({ limit: "6mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = nanoid(10);
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 500) {
      console.warn(JSON.stringify({ kind: "slow_request", requestId, method: req.method, path: req.path, status: res.statusCode, durationMs }));
    }
  });
  next();
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// 生产环境：serve Vite 构建产物
if (config.nodeEnv === "production") {
  const path = await import("node:path");
  const frontendDist = path.resolve(process.cwd(), "apps/web/dist");
  app.use("/badges", express.static(path.resolve(frontendDist, "badges"), {
    index: false,
    maxAge: "1y",
    immutable: true
  }));
  app.use("/assets", express.static(path.resolve(frontendDist, "assets"), {
    index: false,
    maxAge: "1y",
    immutable: true
  }));
  app.use((req, res, next) => {
    if (req.path === "/turtle-avatar.png" || req.path === "/turtle-watermark.png") {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    next();
  });
  app.use(express.static(frontendDist, { index: false }));
  app.get("*", (_req, res, next) => {
    if (_req.path.startsWith("/api/")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile("index.html", { root: frontendDist });
  });
}

const text = z.string().trim().min(1);
const optionalText = z.string().trim().optional().default("");
const optionalTextList = z
  .array(z.string().trim().max(10000))
  .max(20)
  .optional()
  .default([])
  .transform((items) => items.filter(Boolean));
const score = z.coerce.number().min(1).max(5).multipleOf(0.5);
const activityConditionSchema = z.object({
  kind: z.enum(["login", "publish", "like_given", "comment_given", "favorite_given", "like_received", "comment_received", "favorite_received"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target: z.coerce.number().int().min(1).max(1_000_000)
}).refine((condition) => condition.endDate >= condition.startDate, {
  message: "结束日期不能早于开始日期",
  path: ["endDate"]
});
const activityConditionsSchema = z.array(activityConditionSchema).max(8);
type ActivityBadgeCondition = z.infer<typeof activityConditionSchema>;
type ActivityConditionKind = ActivityBadgeCondition["kind"];

function badgeActivityConditions(value: unknown): ActivityBadgeCondition[] {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    const parsed = activityConditionsSchema.safeParse(raw ?? []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function specialBadgeTier(value: unknown): "epic" | "legend" {
  return String(value) === "epic" ? "epic" : "legend";
}

const BADGE_OWNERSHIP_REFRESH_MS = 60 * 60 * 1000;
let badgeOwnershipRates: Record<string, number> = {};
let equippedSpecialBadgeMetadata: Record<string, { name: string; tier: "epic" | "legend" }> = {};

async function refreshEquippedSpecialBadgeMetadata() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id, name, tier FROM legendary_badges");
  equippedSpecialBadgeMetadata = Object.fromEntries(rows.map((row) => [
    `legendary:${row.id}`,
    { name: String(row.name), tier: specialBadgeTier(row.tier) }
  ]));
}

async function refreshBadgeOwnershipRates() {
  const [[[totalRow]], [ownerRows]] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM users WHERE role = 'user'"),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT ubu.badge_key, COUNT(DISTINCT ubu.user_id) AS owner_count
       FROM user_badge_unlocks ubu
       INNER JOIN users u ON u.id = ubu.user_id
       WHERE u.role = 'user'
       GROUP BY ubu.badge_key`
    )
  ]);
  const totalUsers = Number(totalRow?.total ?? 0);
  badgeOwnershipRates = Object.fromEntries(ownerRows.map((row) => [
    String(row.badge_key),
    totalUsers > 0 ? Number(((Number(row.owner_count ?? 0) / totalUsers) * 100).toFixed(1)) : 0
  ]));
}

function cachedBadgeOwnershipRates() {
  return badgeOwnershipRates;
}
const optionalScore = z
  .union([z.coerce.number().min(0).max(5).multipleOf(0.5), z.null(), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === 0 || value == null ? null : Number(value)));

const soupSchema = z.object({
  title: text.max(200),
  author: z.string().trim().max(100).optional().default(""),
  type: text.max(20),
  summary: z.string().trim().max(40, "摘要不超过 40 个字").optional().default(""),
  coverImage: z
    .string()
    .optional()
    .default("")
    .refine(
      (value) => !value || /^data:image\/(png|jpeg);base64,/.test(value) || /^\/api\/media\/soups\/[^/]+\/cover$/.test(value),
      "封面仅支持 JPG 或 PNG"
    ),
  isOriginal: z.boolean().default(true),
  isSensitive: z.boolean(),
  surface: text,
  supplementalSurfaces: optionalTextList,
  bottom: text,
  supplementalBottoms: optionalTextList,
  manual: optionalText,
  isSurfacePublic: z.boolean().default(true),
  isBottomPublic: z.boolean().default(false),
  enableAiGame: z.boolean().default(false),
  aiPrompt: z.string().trim().max(5000).optional().default(""),
  keyFacts: z
    .array(
      z.object({
        id: z.number(),
        content: z.string().trim().min(1).max(200),
        weight: z.number().int().min(1).max(99)
      })
    )
    .max(20)
    .optional()
    .default([]),
  keyFactsCustomized: z.boolean().optional().default(false)
});

const evaluationSchema = z.object({
  total: score,
  writing: optionalScore,
  logic: optionalScore,
  share: optionalScore,
  mechanism: optionalScore,
  twist: optionalScore,
  depth: optionalScore,
  content: z.string().trim().max(500, "评价内容不超过 500 字").optional().default("")
});

const excellentAuthorApplicationSchema = z.object({
  qualificationSoupIds: z.array(z.string().min(1)).length(5),
  primarySoupId: z.string().min(1)
});

const adminNoticeSchema = z.object({
  title: text.max(200),
  author: text.max(100),
  content: z.string().trim().min(1, "正文不能为空").max(5_000_000, "正文内容过大"),
  validDays: z.coerce.number().int().min(0).max(3650),
  validHours: z.coerce.number().int().min(0).max(23)
}).refine((value) => value.validDays > 0 || value.validHours > 0, {
  message: "有效时间至少为 1 小时"
});

function noticePayload(row: mysql.RowDataPacket) {
  const expiresAt = row.expires_at ? new Date(row.expires_at).toISOString() : null;
  const validDurationMinutes = Number(row.valid_duration_minutes ?? 0);
  return {
    id: String(row.id),
    title: String(row.title),
    author: String(row.author),
    ...(row.content == null ? {} : { content: String(row.content) }),
    publishedAt: new Date(row.published_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    expiresAt,
    validDurationMinutes,
    status: expiresAt && new Date(expiresAt).getTime() <= Date.now() ? "expired" : "published",
    readCount: Number(row.read_count ?? 0)
  };
}

function sendError(res: express.Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function avatarUrl(userId: unknown, stored: unknown, hasAvatar = false) {
  if (!stored && !hasAvatar) return null;
  const value = stored ? String(stored) : "";
  return value && !value.startsWith("data:image/") ? value : `/api/media/users/${encodeURIComponent(String(userId))}/avatar`;
}

function soupImageUrl(soupId: unknown, stored: unknown, variant: "thumbnail" | "cover") {
  if (!stored) return null;
  const value = String(stored);
  return value.startsWith("data:image/")
    ? `/api/media/soups/${encodeURIComponent(String(soupId))}/${variant}`
    : value;
}

function decodeDataImage(value: string) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([\s\S]+)$/i.exec(value);
  if (!match) return null;
  return { contentType: match[1].toLowerCase().replace("image/jpg", "image/jpeg"), buffer: Buffer.from(match[2], "base64") };
}

const optimizedImageCache = new Map<string, Buffer>();

async function sendStoredImage(req: express.Request, res: express.Response, value: unknown, maxWidth: number) {
  if (!value) return sendError(res, 404, "图片不存在");
  const stored = String(value);
  if (!stored.startsWith("data:image/")) return res.redirect(302, stored);
  const decoded = decodeDataImage(stored);
  if (!decoded) return sendError(res, 415, "图片格式不受支持");

  const etag = `\"${createHash("sha1").update(decoded.buffer).update(String(maxWidth)).digest("hex")}\"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  if (reqHeaderMatches(req.headers["if-none-match"], etag)) return res.status(304).end();
  let output = optimizedImageCache.get(etag);
  if (!output) {
    output = await sharp(decoded.buffer)
      .rotate()
      .resize({ width: maxWidth, height: maxWidth, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    optimizedImageCache.set(etag, output);
    if (optimizedImageCache.size > 200) optimizedImageCache.delete(optimizedImageCache.keys().next().value!);
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", output.length);
  return res.send(output);
}

function reqHeaderMatches(header: string | string[] | undefined, etag: string) {
  return typeof header === "string" && header.split(",").map((value) => value.trim()).some((value) => value === "*" || value === etag);
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function currentUser(req: express.Request): Promise<AuthenticatedUser | null> {
  const claims = extractAuthClaims(req);
  if (!claims) return null;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, username, nickname, role, token_version, created_at,
       equipped_badge_key, equipped_badge_icon_url, avatar IS NOT NULL AS has_avatar
     FROM users WHERE id = ? LIMIT 1`,
    [claims.id]
  );
  const row = rows[0];
  if (!row || Number(row.token_version ?? 0) !== claims.tokenVersion) return null;
  return { ...toUser(row), tokenVersion: Number(row.token_version ?? 0) };
}

function viewIdentifier(req: express.Request, user: PublicUser | null) {
  if (user) return `user:${user.id}`;
  const raw = `${req.ip ?? "0"}|${req.headers["user-agent"] ?? ""}`;
  return `guest:${createHash("sha256").update(raw).digest("hex")}`;
}

async function requireAuth(req: express.Request, res: express.Response): Promise<AuthenticatedUser | null> {
  const user = await currentUser(req);
  if (!user) {
    sendError(res, 401, "请先登录");
    return null;
  }
  return user;
}

async function requireAdmin(req: express.Request, res: express.Response): Promise<AuthenticatedUser | null> {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendError(res, 403, "需要管理员权限");
    return null;
  }
  return user;
}

function beijingDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function getSoupPublishUsage(userId: string) {
  const date = beijingDateString();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT published_count, auto_reject_count FROM soup_publish_daily_usage WHERE user_id = ? AND usage_date = ? LIMIT 1",
    [userId, date],
  );
  return {
    date,
    publishedCount: Number(rows[0]?.published_count ?? 0),
    autoRejectCount: Number(rows[0]?.auto_reject_count ?? 0),
  };
}

async function recordSoupAutoReject(userId: string, date: string) {
  await pool.query(
    `INSERT INTO soup_publish_daily_usage (user_id, usage_date, auto_reject_count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE auto_reject_count = auto_reject_count + 1`,
    [userId, date],
  );
}

function toUser(row: mysql.RowDataPacket): PublicUser {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar: avatarUrl(row.id, row.avatar, Boolean(row.has_avatar)),
    role: row.role,
    createdAt: new Date(row.created_at).toISOString(),
    equippedBadge: equippedBadge(row.equipped_badge_key, row.equipped_badge_icon_url)
  };
}

function withoutPrivateUsername(user: PublicUser) {
  const { username: _username, ...publicUser } = user;
  return publicUser;
}

function toJwtPayload(row: mysql.RowDataPacket) {
  return {
    id: row.id,
    tokenVersion: Number(row.token_version ?? 0)
  };
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(1)) : null;
}

function bool(value: unknown) {
  return Boolean(Number(value));
}

function equippedBadge(key: unknown, iconUrl: unknown): PublicUser["equippedBadge"] {
  if (!key || !iconUrl) return null;
  const badgeKey = String(key);
  const special = equippedSpecialBadgeMetadata[badgeKey];
  if (special) return { key: badgeKey, iconUrl: String(iconUrl), ...special };
  const rawTier = badgeKey.split(":").at(-1);
  const tier = rawTier === "rare" || rawTier === "epic" || rawTier === "legend" ? rawTier : "normal";
  return { key: badgeKey, iconUrl: String(iconUrl), name: badgeNotificationLabel(badgeKey), tier };
}

const SYSTEM_BADGE_ICON_BASE: Record<string, string> = {
  publish: "publish",
  insight: "insight",
  favorite: "favorite",
  like: "like",
  login: "login",
  creatorLike: "creator-like",
  creatorFavorite: "creator-favorite",
  receivedComment: "received-comment",
  commenter: "commenter",
  aiClear: "ai-clear",
  heat: "heat",
  excellentAuthor: "excellent-author"
};

async function ownedBadgeIconUrl(userId: string, badgeKey: string) {
  const [[unlock]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badge_key FROM user_badge_unlocks WHERE user_id = ? AND badge_key = ? LIMIT 1",
    [userId, badgeKey]
  );
  if (!unlock) return null;
  if (badgeKey.startsWith("legendary:")) {
    const [[badge]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT icon_url FROM legendary_badges WHERE id = ? LIMIT 1",
      [badgeKey.slice("legendary:".length)]
    );
    return badge?.icon_url ? String(badge.icon_url) : null;
  }
  const [series, tier] = badgeKey.split(":");
  const base = SYSTEM_BADGE_ICON_BASE[series];
  return base && ["normal", "rare", "epic", "legend"].includes(tier) ? `/badges/${base}-${tier}.webp` : null;
}

function jsonList(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
  } catch {
    return [];
  }
}

function safeParseJson(value: unknown) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function mapEvaluation(row: mysql.RowDataPacket) {
  return {
    id: row.id,
    soupId: row.soup_id,
    soupTitle: row.soup_title ? String(row.soup_title) : undefined,
    total: Number(row.total),
    reviewer: row.reviewer,
    reviewerId: row.reviewer_id,
    reviewerAvatar: avatarUrl(row.reviewer_id, row.reviewer_avatar),
    reviewerEquippedBadge: equippedBadge(row.reviewer_badge_key, row.reviewer_badge_icon_url),
    writing: num(row.writing),
    logic: num(row.logic),
    share: num(row.share),
    mechanism: num(row.mechanism),
    twist: num(row.twist),
    depth: num(row.depth),
    content: row.content ? String(row.content) : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function mapSoupSummary(row: mysql.RowDataPacket) {
  const comprehensiveScore = Number(row.average_total ?? 0);
  const views = Number(row.view_count ?? 0);
  const likes = Number(row.like_count ?? 0);
  const favorites = Number(row.favorite_count ?? 0);
  const evaluations = Number(row.evaluation_count ?? 0);
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    type: row.type,
    summary: row.summary ?? "",
    coverImage: soupImageUrl(row.id, row.cover_thumbnail, "thumbnail"),
    isOriginal: bool(row.is_original ?? 1),
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    creatorAvatar: avatarUrl(row.creator_id, row.creator_avatar),
    creatorEquippedBadge: equippedBadge(row.creator_badge_key, row.creator_badge_icon_url),
    isSurfacePublic: bool(row.is_surface_public),
    isBottomPublic: bool(row.is_bottom_public),
    viewCount: views,
    likeCount: likes,
    favoriteCount: favorites,
    isLiked: bool(row.is_liked),
    isFavorited: bool(row.is_favorited),
    createdAt: new Date(row.created_at).toISOString(),
    evaluationCount: evaluations,
    averageTotal: num(row.average_total),
    reviewStatus: String(row.review_status ?? "approved"),
    reviewReason: row.review_reason ? String(row.review_reason) : null,
    reviewVersion: Number(row.review_version ?? 1),
    heatValue: Math.round((comprehensiveScore + 1) * (views + (likes + 1) * 15 + (favorites + 1) * 20 + (evaluations + 1) * 25) - 61),
    radar: {
      writing: num(row.avg_writing),
      logic: num(row.avg_logic),
      share: num(row.avg_share),
      mechanism: num(row.avg_mechanism),
      twist: num(row.avg_twist),
      depth: num(row.avg_depth)
    }
  };
}

function mapSoupDetail(row: mysql.RowDataPacket) {
  return {
    ...mapSoupSummary(row),
    coverImage: soupImageUrl(row.id, row.cover_image, "cover")
  };
}

async function getSoupRaw(id: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM soups WHERE id = ? LIMIT 1", [id]);
  return rows[0] ?? null;
}

type CertificationSoupSummary = ReturnType<typeof mapSoupSummary> & { enableAiGame: boolean };

async function getSoupSummariesWhere(whereSql: string, params: unknown[]): Promise<CertificationSoupSummary[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.*, u.avatar AS creator_avatar,
      u.equipped_badge_key AS creator_badge_key, u.equipped_badge_icon_url AS creator_badge_icon_url,
      (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
      COUNT(e.id) AS evaluation_count,
      AVG(e.total) AS average_total,
      AVG(e.writing) AS avg_writing,
      AVG(e.logic) AS avg_logic,
      AVG(e.share) AS avg_share,
      AVG(e.mechanism) AS avg_mechanism,
      AVG(e.twist) AS avg_twist,
      AVG(e.depth) AS avg_depth
     FROM soups s
     LEFT JOIN evaluations e ON e.soup_id = s.id
     LEFT JOIN users u ON u.id = s.creator_id
     WHERE ${whereSql}
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    params
  );
  return rows.map((row) => ({ ...mapSoupSummary(row), enableAiGame: bool(row.enable_ai_game) }));
}

async function getCreatorCertificationSoups(userId: string) {
  return getSoupSummariesWhere("s.creator_id = ?", [userId]);
}

function isQualificationSoup(soup: CertificationSoupSummary) {
  return soup.isOriginal && soup.reviewStatus === "approved" && soup.heatValue >= 3000 && (soup.averageTotal ?? 0) >= 3.2;
}

function isPrimaryCertificationSoup(soup: CertificationSoupSummary) {
  return isQualificationSoup(soup) && (soup.averageTotal ?? 0) >= 3.5;
}

async function getExcellentAuthorApplicationDetail(applicationId: string) {
  const [[application]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM excellent_author_applications WHERE id = ? LIMIT 1",
    [applicationId]
  );
  if (!application) return null;
  const [selectedRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT soup_id FROM excellent_author_application_soups WHERE application_id = ? ORDER BY sort_order ASC",
    [applicationId]
  );
  const selectedIds = selectedRows.map((row) => String(row.soup_id));
  const soups = await getCreatorCertificationSoups(String(application.applicant_id));
  const byId = new Map(soups.map((soup) => [soup.id, soup]));
  return {
    id: String(application.id),
    applicationType: "申请认证优秀作者" as const,
    applicantId: String(application.applicant_id),
    applicantName: String(application.applicant_name),
    status: String(application.status),
    createdAt: new Date(application.created_at).toISOString(),
    handledAt: application.handled_at ? new Date(application.handled_at).toISOString() : null,
    handledBy: application.handled_by ? String(application.handled_by) : null,
    primarySoup: byId.get(String(application.primary_soup_id)) ?? null,
    qualificationSoups: selectedIds
      .map((id) => byId.get(id))
      .filter((soup): soup is CertificationSoupSummary => Boolean(soup))
  };
}

async function findDuplicateSoup(input: SoupSimilarityInput, excludedId?: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, title, surface, bottom
     FROM soups
     ${excludedId ? "WHERE id <> ?" : ""}`,
    excludedId ? [excludedId] : []
  );
  return findHighlySimilarSoup(
    input,
    rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      surface: String(row.surface),
      bottom: String(row.bottom)
    }))
  );
}

async function canViewFull(soup: mysql.RowDataPacket, user: PublicUser | null) {
  if (bool(soup.is_bottom_public)) return true;
  if (!user) return false;
  if (user.role === "admin" || user.id === soup.creator_id) return true;

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM soup_access_grants WHERE soup_id = ? AND user_id = ? LIMIT 1",
    [soup.id, user.id]
  );
  return rows.length > 0;
}

function canSeeSoupSurface(soup: mysql.RowDataPacket, user: PublicUser | null) {
  if (String(soup.review_status ?? "approved") !== "approved") {
    return Boolean(user && (user.role === "admin" || user.id === soup.creator_id));
  }
  if (bool(soup.is_surface_public)) return true;
  if (!user) return false;
  return user.role === "admin" || user.id === soup.creator_id;
}

async function notify(
  userId: string,
  type: string,
  title: string,
  content: string,
  relatedId: string | null,
  actorId: string | null = null
) {
  const [result] = await pool.query<mysql.ResultSetHeader>(
    "INSERT IGNORE INTO notifications (id, user_id, type, title, content, related_id, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [nanoid(), userId, type, title, content, relatedId, actorId]
  );
  if (result.affectedRows > 0) emitUnreadChanged(userId, type);
}

async function adminIds() {
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE role = 'admin'");
  return rows.map((row) => String(row.id));
}

async function recordLoginDay(userId: string) {
  await Promise.all([
    pool.query(
      `INSERT IGNORE INTO user_login_days (user_id, login_date)
       VALUES (?, DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)))`,
      [userId]
    ),
    pool.query("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [userId])
  ]);
  queueSystemBadgeSync([userId]);
}

type AchievementStats = {
  soupCount: number;
  favoriteCount: number;
  evaluationCount: number;
  likeCount: number;
  criticalHitCount: number;
  loginDayCount: number;
  receivedLikeCount: number;
  receivedFavoriteCount: number;
  receivedCommentCount: number;
  writtenCommentCount: number;
  aiCompletionCount: number;
  maxOriginalSoupHeat: number;
};

const BADGE_THRESHOLDS: Array<{ key: string; stat: keyof AchievementStats; target: number }> = [
  { key: "publish:normal", stat: "soupCount", target: 1 },
  { key: "publish:rare", stat: "soupCount", target: 10 },
  { key: "publish:epic", stat: "soupCount", target: 50 },
  { key: "insight:normal", stat: "criticalHitCount", target: 10 },
  { key: "insight:rare", stat: "criticalHitCount", target: 100 },
  { key: "insight:epic", stat: "criticalHitCount", target: 1000 },
  { key: "favorite:normal", stat: "favoriteCount", target: 3 },
  { key: "favorite:rare", stat: "favoriteCount", target: 20 },
  { key: "favorite:epic", stat: "favoriteCount", target: 100 },
  { key: "like:normal", stat: "likeCount", target: 3 },
  { key: "like:rare", stat: "likeCount", target: 20 },
  { key: "like:epic", stat: "likeCount", target: 100 },
  { key: "login:normal", stat: "loginDayCount", target: 3 },
  { key: "login:rare", stat: "loginDayCount", target: 20 },
  { key: "login:epic", stat: "loginDayCount", target: 100 },
  { key: "creatorLike:normal", stat: "receivedLikeCount", target: 10 },
  { key: "creatorLike:rare", stat: "receivedLikeCount", target: 100 },
  { key: "creatorLike:epic", stat: "receivedLikeCount", target: 1000 },
  { key: "creatorFavorite:normal", stat: "receivedFavoriteCount", target: 10 },
  { key: "creatorFavorite:rare", stat: "receivedFavoriteCount", target: 100 },
  { key: "creatorFavorite:epic", stat: "receivedFavoriteCount", target: 1000 },
  { key: "receivedComment:normal", stat: "receivedCommentCount", target: 5 },
  { key: "receivedComment:rare", stat: "receivedCommentCount", target: 50 },
  { key: "receivedComment:epic", stat: "receivedCommentCount", target: 300 },
  { key: "commenter:normal", stat: "writtenCommentCount", target: 5 },
  { key: "commenter:rare", stat: "writtenCommentCount", target: 50 },
  { key: "commenter:epic", stat: "writtenCommentCount", target: 300 },
  { key: "aiClear:normal", stat: "aiCompletionCount", target: 1 },
  { key: "aiClear:rare", stat: "aiCompletionCount", target: 10 },
  { key: "aiClear:epic", stat: "aiCompletionCount", target: 50 },
  { key: "heat:normal", stat: "maxOriginalSoupHeat", target: 10_000 },
  { key: "heat:rare", stat: "maxOriginalSoupHeat", target: 100_000 },
  { key: "heat:epic", stat: "maxOriginalSoupHeat", target: 300_000 },
  { key: "heat:legend", stat: "maxOriginalSoupHeat", target: 1_000_000 }
];

const SYSTEM_BADGE_ACHIEVEMENT_POINTS: Record<string, number> = {
  "publish:normal": 10, "publish:rare": 30, "publish:epic": 100,
  "insight:normal": 10, "insight:rare": 35, "insight:epic": 120,
  "favorite:normal": 10, "favorite:rare": 30, "favorite:epic": 100,
  "like:normal": 10, "like:rare": 30, "like:epic": 100,
  "login:normal": 10, "login:rare": 45, "login:epic": 100,
  "creatorLike:normal": 10, "creatorLike:rare": 40, "creatorLike:epic": 150,
  "creatorFavorite:normal": 10, "creatorFavorite:rare": 30, "creatorFavorite:epic": 120,
  "receivedComment:normal": 10, "receivedComment:rare": 40, "receivedComment:epic": 100,
  "commenter:normal": 10, "commenter:rare": 30, "commenter:epic": 100,
  "aiClear:normal": 10, "aiClear:rare": 35, "aiClear:epic": 120,
  "heat:normal": 20, "heat:rare": 50, "heat:epic": 150, "heat:legend": 450,
  "excellentAuthor:epic": 150
};

const BADGE_NOTIFICATION_LABELS: Record<string, string[]> = {
  publish: ["熬汤新秀", "熬汤达人", "熬汤大师"],
  insight: ["灵光乍现", "洞察之眼", "全知全能"],
  favorite: ["私藏一汤", "藏汤百味", "万汤宝库"],
  like: ["一点心意", "热情汤客", "点赞如潮"],
  login: ["三日来客", "一月常客", "百日不辍"],
  creatorLike: ["小有名气", "我是明星", "人气王"],
  creatorFavorite: ["值得珍藏", "收藏达人", "镇馆之汤"],
  receivedComment: ["初有回响", "热议之汤", "话题之王"],
  commenter: ["初次开麦", "评论达人", "妙语连珠"],
  aiClear: ["初识汤灵", "汤灵搭档", "AI破局王"],
  heat: ["热力小子", "炽热瞩目", "狂热巅峰", "登峰造极"],
  excellentAuthor: ["优秀作者", "优秀作者", "优秀作者"]
};

function badgeNotificationLabel(key: string) {
  const [series, tier] = key.split(":");
  const tierIndex = tier === "normal" ? 0 : tier === "rare" ? 1 : tier === "epic" ? 2 : 3;
  return BADGE_NOTIFICATION_LABELS[series]?.[tierIndex] ?? key;
}

async function getMaxOriginalSoupHeat(userId: string) {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(MAX(
       (COALESCE(e.comprehensive_score, 0) + 1) *
       (s.view_count + (COALESCE(l.like_count, 0) + 1) * 15 + (COALESCE(f.favorite_count, 0) + 1) * 20 + (COALESCE(e.evaluation_count, 0) + 1) * 25) - 61
     ), 0) AS max_heat
     FROM soups s
     LEFT JOIN (SELECT soup_id, COUNT(*) AS evaluation_count, AVG(total) AS comprehensive_score FROM evaluations GROUP BY soup_id) e ON e.soup_id = s.id
     LEFT JOIN (SELECT soup_id, COUNT(*) AS like_count FROM soup_likes GROUP BY soup_id) l ON l.soup_id = s.id
     LEFT JOIN (SELECT soup_id, COUNT(*) AS favorite_count FROM soup_favorites GROUP BY soup_id) f ON f.soup_id = s.id
     WHERE s.creator_id = ? AND s.is_original = TRUE`,
    [userId]
  );
  return Math.round(Number(row?.max_heat ?? 0));
}

async function getAchievementStats(userId: string): Promise<AchievementStats> {
  const [
    [soupRows],
    [favRows],
    [evalRows],
    [likeRows],
    [keyHitRows],
    [loginDayRows],
    [receivedLikeRows],
    [receivedFavoriteRows],
    [receivedCommentRows],
    [writtenCommentRows],
    [aiCompletionRows],
    maxOriginalSoupHeat
  ] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM soups WHERE creator_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM soup_favorites WHERE user_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(DISTINCT soup_id) AS count FROM evaluations WHERE reviewer_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM soup_likes WHERE user_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM game_key_hits WHERE user_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM user_login_days WHERE user_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM soup_like_history WHERE creator_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM soup_favorite_history WHERE creator_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM evaluation_comment_history WHERE creator_id = ? AND is_original = TRUE", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM evaluation_comment_history WHERE reviewer_id = ?", [userId]),
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM game_completions WHERE user_id = ?", [userId]),
    getMaxOriginalSoupHeat(userId)
  ]);

  return {
    soupCount: Number(soupRows[0]?.count ?? 0),
    favoriteCount: Number(favRows[0]?.count ?? 0),
    evaluationCount: Number(evalRows[0]?.count ?? 0),
    likeCount: Number(likeRows[0]?.count ?? 0),
    criticalHitCount: Number(keyHitRows[0]?.count ?? 0),
    loginDayCount: Number(loginDayRows[0]?.count ?? 0),
    receivedLikeCount: Number(receivedLikeRows[0]?.count ?? 0),
    receivedFavoriteCount: Number(receivedFavoriteRows[0]?.count ?? 0),
    receivedCommentCount: Number(receivedCommentRows[0]?.count ?? 0),
    writtenCommentCount: Number(writtenCommentRows[0]?.count ?? 0),
    aiCompletionCount: Number(aiCompletionRows[0]?.count ?? 0),
    maxOriginalSoupHeat
  };
}

async function activityConditionCount(userId: string, condition: ActivityBadgeCondition) {
  const dateParams = [userId, condition.startDate, condition.endDate];
  const queries: Record<ActivityConditionKind, string> = {
    login: "SELECT COUNT(*) AS count FROM user_login_days WHERE user_id = ? AND login_date BETWEEN ? AND ?",
    publish: "SELECT COUNT(*) AS count FROM soups WHERE creator_id = ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN ? AND ?",
    like_given: "SELECT COUNT(*) AS count FROM soup_like_history WHERE actor_id = ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN ? AND ?",
    comment_given: "SELECT COUNT(*) AS count FROM evaluation_comment_history WHERE reviewer_id = ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN ? AND ?",
    favorite_given: "SELECT COUNT(*) AS count FROM soup_favorite_history WHERE actor_id = ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN ? AND ?",
    like_received: "SELECT COUNT(*) AS count FROM soup_like_history WHERE creator_id = ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN ? AND ?",
    comment_received: "SELECT COUNT(*) AS count FROM evaluation_comment_history WHERE creator_id = ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN ? AND ?",
    favorite_received: "SELECT COUNT(*) AS count FROM soup_favorite_history WHERE creator_id = ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN ? AND ?"
  };
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(queries[condition.kind], dateParams);
  return Number(row?.count ?? 0);
}

async function syncActivityBadges(userId: string) {
  const [badgeRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, name, activity_conditions FROM legendary_badges WHERE badge_type = 'activity' AND activity_conditions IS NOT NULL"
  );
  if (badgeRows.length === 0) return [] as Array<{ key: string; name: string }>;
  const [unlockRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badge_key FROM user_badge_unlocks WHERE user_id = ?",
    [userId]
  );
  const owned = new Set(unlockRows.map((row) => String(row.badge_key)));
  const earned: Array<{ key: string; name: string }> = [];
  for (const badge of badgeRows) {
    const key = `legendary:${badge.id}`;
    if (owned.has(key)) continue;
    const conditions = badgeActivityConditions(badge.activity_conditions);
    if (conditions.length === 0) continue;
    const counts = await Promise.all(conditions.map((condition) => activityConditionCount(userId, condition)));
    if (conditions.every((condition, index) => counts[index] >= (condition.kind === "login" ? 1 : condition.target))) {
      const [result] = await pool.query<mysql.ResultSetHeader>(
        "INSERT IGNORE INTO user_badge_unlocks (user_id, badge_key, surfaced_at) VALUES (?, ?, NULL)",
        [userId, key]
      );
      if (result.affectedRows > 0) earned.push({ key, name: String(badge.name) });
    }
  }
  return earned;
}

async function notifyActivityBadgeUnlocks(userId: string, badges: Array<{ key: string; name: string }>) {
  await Promise.all(badges.map((badge) => (
    notify(userId, "badge_unlock", "获得活动徽章", `恭喜你获得活动徽章「${badge.name}」`, badge.key, userId)
  )));
}

async function syncSystemBadgeUnlocks(userId: string) {
  const stats = await getAchievementStats(userId);
  const earnedKeys = BADGE_THRESHOLDS
    .filter((badge) => stats[badge.stat] >= badge.target)
    .map((badge) => badge.key);
  const [unlockRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badge_key FROM user_badge_unlocks WHERE user_id = ?",
    [userId]
  );
  const unlocked = new Set(unlockRows.map((row) => String(row.badge_key)));
  const candidates = earnedKeys.filter((key) => !unlocked.has(key));
  const newKeys: string[] = [];
  for (const key of candidates) {
    const [result] = await pool.query<mysql.ResultSetHeader>(
      "INSERT IGNORE INTO user_badge_unlocks (user_id, badge_key, surfaced_at) VALUES (?, ?, NULL)",
      [userId, key]
    );
    if (result.affectedRows > 0) newKeys.push(key);
  }
  return { stats, newKeys };
}

async function markPendingBadgePopupsSurfaced(userId: string) {
  await pool.query(
    "UPDATE user_badge_unlocks SET surfaced_at = CURRENT_TIMESTAMP WHERE user_id = ? AND surfaced_at IS NULL",
    [userId]
  );
}

async function claimPendingBadgePopups(userId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT badge_key
       FROM user_badge_unlocks
       WHERE user_id = ? AND surfaced_at IS NULL
       ORDER BY unlocked_at ASC
       FOR UPDATE`,
      [userId]
    );
    const keys = rows.map((row) => String(row.badge_key));
    if (keys.length > 0) {
      const placeholders = keys.map(() => "?").join(", ");
      await connection.query(
        `UPDATE user_badge_unlocks
         SET surfaced_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND surfaced_at IS NULL AND badge_key IN (${placeholders})`,
        [userId, ...keys]
      );
    }
    await connection.commit();
    return keys;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getLegendaryBadgeUnlockDetails(userId: string, keys: string[]) {
  const legendaryKeys = keys.filter((key) => key.startsWith("legendary:"));
  if (legendaryKeys.length === 0) return [];
  const placeholders = legendaryKeys.map(() => "?").join(", ");
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT lb.id, lb.name, lb.description, lb.requirement, lb.icon_url,
      lb.achievement_points, lb.badge_type, lb.tier, lb.activity_conditions, ubu.unlocked_at
     FROM legendary_badges lb
     INNER JOIN user_badge_unlocks ubu ON ubu.badge_key = CONCAT('legendary:', lb.id)
     WHERE ubu.user_id = ? AND ubu.badge_key IN (${placeholders})`,
    [userId, ...legendaryKeys]
  );
  const byKey = new Map(rows.map((row) => [`legendary:${row.id}`, {
    id: String(row.id),
    key: `legendary:${row.id}`,
    name: String(row.name),
    description: String(row.description),
    requirement: row.requirement ? String(row.requirement) : null,
    iconUrl: String(row.icon_url),
    achievementPoints: Number(row.achievement_points ?? 0),
    badgeType: String(row.badge_type ?? "achievement") as "achievement" | "activity" | "limited",
    activityConditions: badgeActivityConditions(row.activity_conditions),
    unlockedAt: row.unlocked_at ? new Date(row.unlocked_at).toISOString() : null,
    tier: specialBadgeTier(row.tier)
  }]));
  return legendaryKeys.flatMap((key) => {
    const badge = byKey.get(key);
    return badge ? [badge] : [];
  });
}

const pendingBadgeSyncUsers = new Set<string>();
let badgeSyncTimer: NodeJS.Timeout | null = null;

function queueSystemBadgeSync(userIds: string[]) {
  userIds.filter(Boolean).forEach((userId) => pendingBadgeSyncUsers.add(userId));
  if (badgeSyncTimer) return;
  badgeSyncTimer = setTimeout(async () => {
    badgeSyncTimer = null;
    const batch = [...pendingBadgeSyncUsers];
    pendingBadgeSyncUsers.clear();
    for (let index = 0; index < batch.length; index += 5) {
      await Promise.all(batch.slice(index, index + 5).map(async (userId) => {
        try {
          const [rows] = await pool.query<mysql.RowDataPacket[]>(
            "SELECT badges_initialized FROM users WHERE id = ? LIMIT 1",
            [userId]
          );
          if (rows.length === 0) return;
          const wasInitialized = Boolean(rows[0].badges_initialized);
          const { newKeys } = await syncSystemBadgeUnlocks(userId);
          if (!wasInitialized) {
            await markPendingBadgePopupsSurfaced(userId);
            await pool.query("UPDATE users SET badges_initialized = 1 WHERE id = ?", [userId]);
          } else {
            await Promise.all(newKeys.map((key) => (
              notify(userId, "badge_unlock", "获得新徽章", `恭喜你获得徽章「${badgeNotificationLabel(key)}」`, key, userId)
            )));
          }
          await notifyActivityBadgeUnlocks(userId, await syncActivityBadges(userId));
        } catch (error) {
          console.error("badge event sync failed", { userId, error });
        }
      }));
    }
  }, 0);
}

const pendingActivityBadgeSyncUsers = new Set<string>();
let activityBadgeSyncTimer: NodeJS.Timeout | null = null;

function queueActivityBadgeSync(userIds: string[]) {
  userIds.filter(Boolean).forEach((userId) => pendingActivityBadgeSyncUsers.add(userId));
  if (activityBadgeSyncTimer) return;
  activityBadgeSyncTimer = setTimeout(async () => {
    activityBadgeSyncTimer = null;
    const users = [...pendingActivityBadgeSyncUsers];
    pendingActivityBadgeSyncUsers.clear();
    for (let index = 0; index < users.length; index += 5) {
      await Promise.all(users.slice(index, index + 5).map(async (userId) => {
        try {
          await notifyActivityBadgeUnlocks(userId, await syncActivityBadges(userId));
        } catch (error) {
          console.error("activity badge sync failed", { userId, error });
        }
      }));
    }
  }, 0);
}

setBadgeProgressListener((userId) => queueSystemBadgeSync([userId]));

async function optimizeCoverImage(base64: string): Promise<{ full: string; thumbnail: string } | null> {
  try {
    const buf = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const [full, thumbnail] = await Promise.all([
      sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer(),
      sharp(buf).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 76, effort: 4 }).toBuffer()
    ]);
    return {
      full: `data:image/webp;base64,${full.toString("base64")}`,
      thumbnail: `data:image/webp;base64,${thumbnail.toString("base64")}`
    };
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/stickers", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  res.json({ series: stickerSeries });
});

app.post("/api/auth/register", registerRateLimiter, async (req, res) => {
  const parsed = z
    .object({
      username: text.max(50),
      password: z.string().min(6).max(72),
      nickname: text.max(8, "昵称不超过 8 个字符")
    })
    .safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "注册信息不完整");

  const { username, password, nickname } = parsed.data;
  if (isAdminRelatedNickname(nickname)) return sendError(res, 400, "该昵称为管理员专用，请更换昵称");
  const [exists] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  if (exists.length) return sendError(res, 409, "账号已存在");

  const id = nanoid();
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users (id, username, password, nickname, role) VALUES (?, ?, ?, ?, 'user')", [
    id,
    username,
    hash,
    nickname
  ]);
  await recordLoginDay(id);

  const user: PublicUser = { id, username, nickname, avatar: null, role: "user", createdAt: new Date().toISOString(), equippedBadge: null };
  const token = signToken({ id, tokenVersion: 0 });
  setAuthCookie(res, token);
  res.json({ user, token });
});

app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
  const parsed = z.object({ username: text, password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "请输入账号和密码");

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM users WHERE username = ? LIMIT 1",
    [parsed.data.username]
  );
  const row = rows[0];
  if (!row) return sendError(res, 401, "账号或密码错误");

  const ok = await bcrypt.compare(parsed.data.password, row.password);
  if (!ok) return sendError(res, 401, "账号或密码错误");

  const user = toUser(row);
  await recordLoginDay(user.id);
  const token = signToken(toJwtPayload(row));
  setAuthCookie(res, token);
  res.json({ user, token });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("hgt_token", { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/" });
  res.json({ ok: true });
});

app.post("/api/auth/password", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = z
    .object({
      newPassword: z.string().min(6, "新密码至少 6 位").max(72)
    })
    .safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "密码信息不正确");

  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id, token_version FROM users WHERE id = ? LIMIT 1", [user.id]);
  const row = rows[0];
  if (!row) return sendError(res, 404, "用户不存在");
  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  const nextTokenVersion = Number(row.token_version ?? 0) + 1;
  await pool.query("UPDATE users SET password = ?, token_version = ? WHERE id = ?", [hash, nextTokenVersion, user.id]);
  setAuthCookie(res, signToken({ id: user.id, tokenVersion: nextTokenVersion }));
  res.json({ ok: true });
});

app.post("/api/telemetry/performance", performanceRateLimiter, (req, res) => {
  const parsed = z.object({
    name: z.enum(["navigation", "lcp", "long-task", "interaction"]),
    value: z.number().nonnegative().max(120_000),
    route: z.string().max(160)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(204).end();
  console.info(JSON.stringify({ kind: "web_performance", ...parsed.data }));
  res.status(204).end();
});

app.get("/api/media/users/:id/avatar", async (req, res) => {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT avatar FROM users WHERE id = ? LIMIT 1", [req.params.id]);
  if (!row) return sendError(res, 404, "用户不存在");
  return sendStoredImage(req, res, row.avatar, 160);
});

app.get("/api/media/soups/:id/thumbnail", async (req, res) => {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT cover_thumbnail, review_status, creator_id FROM soups WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  if (!row) return sendError(res, 404, "作品不存在");
  const viewer = row.review_status === "approved" ? null : await currentUser(req);
  if (row.review_status !== "approved" && viewer?.role !== "admin" && viewer?.id !== String(row.creator_id)) {
    return sendError(res, 404, "作品不存在");
  }
  return sendStoredImage(req, res, row.cover_thumbnail, 480);
});

app.get("/api/media/soups/:id/cover", async (req, res) => {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT cover_image, review_status, creator_id FROM soups WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  if (!row) return sendError(res, 404, "作品不存在");
  const viewer = row.review_status === "approved" ? null : await currentUser(req);
  if (row.review_status !== "approved" && viewer?.role !== "admin" && viewer?.id !== String(row.creator_id)) {
    return sendError(res, 404, "作品不存在");
  }
  return sendStoredImage(req, res, row.cover_image, 1280);
});

app.get("/api/auth/me", async (req, res) => {
  const user = await currentUser(req);
  if (user) {
    await recordLoginDay(user.id);
  }
  if (!user) return res.json({ user: null });
  const { tokenVersion: _tokenVersion, ...publicUser } = user;
  res.json({ user: publicUser });
});

app.get("/api/events", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const clients = userEventClients.get(user.id) ?? new Set<Response>();
  clients.add(res);
  userEventClients.set(user.id, clients);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0) userEventClients.delete(user.id);
  });
});

app.patch("/api/me/nickname", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = z.object({ nickname: text.max(8, "昵称不超过 8 个字符") }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "昵称信息不正确");
  if (user.role !== "admin" && isAdminRelatedNickname(parsed.data.nickname)) {
    return sendError(res, 400, "该昵称为管理员专用，请更换昵称");
  }

  // 更新用户昵称
  await pool.query("UPDATE users SET nickname = ? WHERE id = ?", [parsed.data.nickname, user.id]);

  // 同步更新该用户作为原创作者的 soups 中的 creator_name 和 author
  await pool.query(
    "UPDATE soups SET creator_name = ?, author = ? WHERE creator_id = ? AND is_original = TRUE",
    [parsed.data.nickname, parsed.data.nickname, user.id]
  );

  // 同步更新 evaluations 中的 reviewer
  await pool.query("UPDATE evaluations SET reviewer = ? WHERE reviewer_id = ?", [parsed.data.nickname, user.id]);

  res.json({ ok: true, nickname: parsed.data.nickname });
});

app.patch("/api/me/avatar", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = z
    .object({
      avatar: z
        .string()
        .optional()
        .default("")
        .refine((value) => !value || /^data:image\/(png|jpeg);base64,/.test(value), "头像仅支持 JPG 或 PNG")
    })
    .safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "头像格式不正确");

  let avatar = parsed.data.avatar || null;
  if (avatar) {
    const decoded = decodeDataImage(avatar);
    if (!decoded) return sendError(res, 400, "头像格式不正确");
    const optimized = await sharp(decoded.buffer)
      .rotate()
      .resize({ width: 256, height: 256, fit: "cover", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    avatar = `data:image/webp;base64,${optimized.toString("base64")}`;
  }
  await pool.query("UPDATE users SET avatar = ? WHERE id = ?", [avatar, user.id]);

  const token = signToken({ id: user.id, tokenVersion: user.tokenVersion });
  setAuthCookie(res, token);
  res.json({ ok: true, avatar: avatarUrl(user.id, avatar) });
});

app.get("/api/me/soup-publish-quota", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (user.role === "admin") return res.json({ allowed: true, publishedCount: 0, autoRejectCount: 0, remaining: null });
  const usage = await getSoupPublishUsage(user.id);
  const blockedByReview = usage.autoRejectCount >= 3;
  const blockedByLimit = usage.publishedCount >= 5;
  res.json({
    allowed: !blockedByReview && !blockedByLimit,
    publishedCount: usage.publishedCount,
    autoRejectCount: usage.autoRejectCount,
    remaining: Math.max(0, 5 - usage.publishedCount),
    reason: blockedByReview ? "今日自动审核未通过次数已达3次，请明天再试" : blockedByLimit ? "您今日已发布5篇海龟汤，明天再继续分享吧" : null,
  });
});

app.get("/api/me/content-counts", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM soups WHERE creator_id = ?) AS published_count,
       (SELECT COUNT(*) FROM soup_favorites f INNER JOIN soups s ON s.id = f.soup_id WHERE f.user_id = ? AND s.review_status = 'approved') AS favorite_count,
       (SELECT COUNT(*) FROM soup_likes lk INNER JOIN soups s ON s.id = lk.soup_id WHERE lk.user_id = ? AND s.review_status = 'approved') AS like_count`,
    [user.id, user.id, user.id]
  );
  res.json({
    published: Number(row?.published_count ?? 0),
    favorites: Number(row?.favorite_count ?? 0),
    likes: Number(row?.like_count ?? 0)
  });
});

app.get("/api/me/soups", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const limit = 10;
  const rawOffset = Number(req.query.offset ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM soups WHERE creator_id = ?", [user.id]);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u.avatar AS creator_avatar,
      u.equipped_badge_key AS creator_badge_key, u.equipped_badge_icon_url AS creator_badge_icon_url,
      (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
      COUNT(e.id) AS evaluation_count,
      AVG(e.total) AS average_total,
      AVG(e.writing) AS avg_writing,
      AVG(e.logic) AS avg_logic,
      AVG(e.share) AS avg_share,
      AVG(e.mechanism) AS avg_mechanism,
      AVG(e.twist) AS avg_twist,
      AVG(e.depth) AS avg_depth
    FROM soups s
    LEFT JOIN evaluations e ON e.soup_id = s.id
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.creator_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ? OFFSET ?
    `,
    [user.id, limit, offset]
  );
  const total = Number(totalRow.total ?? 0);
  res.json({ soups: rows.map(mapSoupSummary), total, hasMore: offset + rows.length < total });
});

app.get("/api/me/excellent-author-application", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const soups = await getCreatorCertificationSoups(user.id);
  const [[application]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, status, created_at, handled_at
     FROM excellent_author_applications
     WHERE applicant_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  );
  const [[badge]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badge_key FROM user_badge_unlocks WHERE user_id = ? AND badge_key = 'excellentAuthor:epic' LIMIT 1",
    [user.id]
  );
  res.json({
    eligibleSoups: soups.filter(isQualificationSoup),
    certified: Boolean(badge),
    application: application ? {
      id: String(application.id),
      status: String(application.status),
      createdAt: new Date(application.created_at).toISOString(),
      handledAt: application.handled_at ? new Date(application.handled_at).toISOString() : null
    } : null
  });
});

app.post("/api/me/excellent-author-application", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = excellentAuthorApplicationSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "请按要求选择5篇资格汤和1篇认证汤");
  const qualificationSoupIds = [...new Set(parsed.data.qualificationSoupIds)];
  if (qualificationSoupIds.length !== 5) return sendError(res, 400, "资格汤必须选择5篇，不能多也不能少");
  if (!qualificationSoupIds.includes(parsed.data.primarySoupId)) return sendError(res, 400, "认证汤必须从5篇资格汤中选择");

  const soups = await getCreatorCertificationSoups(user.id);
  const byId = new Map(soups.map((soup) => [soup.id, soup]));
  if (qualificationSoupIds.some((id) => {
    const soup = byId.get(id);
    return !soup || !isQualificationSoup(soup);
  })) {
    return sendError(res, 409, "所选资格汤已不满足原创、热力值或评分要求");
  }
  const primarySoup = byId.get(parsed.data.primarySoupId);
  if (!primarySoup || !isPrimaryCertificationSoup(primarySoup)) {
    return sendError(res, 409, "认证汤需达到3000热力值且综合评分不低于3.5");
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [[lock]] = await connection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 5) AS acquired", [`excellent-author:${user.id}`]);
    lockAcquired = Number(lock?.acquired) === 1;
    if (!lockAcquired) return sendError(res, 503, "申请提交繁忙，请稍后再试");
    const [existing] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT status FROM excellent_author_applications WHERE applicant_id = ? AND status IN ('pending','approved') LIMIT 1",
      [user.id]
    );
    if (existing.some((row) => row.status === "approved")) return sendError(res, 409, "你已通过优秀作者认证");
    if (existing.some((row) => row.status === "pending")) return sendError(res, 409, "已有待审核的优秀作者认证申请");

    const id = nanoid();
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO excellent_author_applications (id, applicant_id, applicant_name, primary_soup_id) VALUES (?, ?, ?, ?)",
      [id, user.id, user.nickname, parsed.data.primarySoupId]
    );
    for (const [index, soupId] of qualificationSoupIds.entries()) {
      await connection.query(
        "INSERT INTO excellent_author_application_soups (application_id, soup_id, sort_order) VALUES (?, ?, ?)",
        [id, soupId, index]
      );
    }
    await connection.commit();
    await Promise.all((await adminIds()).map((adminId) =>
      notify(adminId, "excellent_author_application", "新的优秀作者认证申请", `${user.nickname} 提交了优秀作者认证申请`, id, user.id)
    ));
    res.status(201).json({ id, status: "pending" });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", [`excellent-author:${user.id}`]).catch(() => {});
    connection.release();
  }
});

app.get("/api/me/stats", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  await recordLoginDay(user.id);
  res.json(await getAchievementStats(user.id));
});

app.get("/api/users/search", async (req, res) => {
  const keyword = String(req.query.keyword ?? "").trim();
  if (!keyword) return res.json({ users: [], total: 0 });
  if (keyword.length > 50) return sendError(res, 400, "搜索关键词过长");

  const requestedLimit = Number(req.query.limit ?? 20);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20));
  const escapedKeyword = escapeLikePattern(keyword);
  const likeKeyword = `%${escapedKeyword}%`;
  const prefixKeyword = `${escapedKeyword}%`;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, nickname, avatar, role, created_at, equipped_badge_key, equipped_badge_icon_url
     FROM users
     WHERE nickname LIKE ?
     ORDER BY CASE WHEN nickname = ? THEN 0 WHEN nickname LIKE ? THEN 1 ELSE 2 END, created_at DESC
     LIMIT ?`,
    [likeKeyword, keyword, prefixKeyword, limit]
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM users WHERE nickname LIKE ?",
    [likeKeyword]
  );
  res.json({
    total: Number(totalRow.total ?? 0),
    users: rows.map((row) => ({
      id: String(row.id),
      nickname: String(row.nickname),
      avatar: avatarUrl(row.id, row.avatar),
      role: String(row.role),
      createdAt: new Date(row.created_at).toISOString(),
      equippedBadge: equippedBadge(row.equipped_badge_key, row.equipped_badge_icon_url)
    }))
  });
});

app.get("/api/users/:id/profile", async (req, res) => {
  const viewer = await requireAuth(req, res);
  if (!viewer) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, username, nickname, role, created_at, equipped_badge_key, equipped_badge_icon_url,
       avatar IS NOT NULL AS has_avatar
     FROM users WHERE id = ? LIMIT 1`,
    [req.params.id]
  );
  const target = rows[0];
  if (!target) return sendError(res, 404, "用户不存在");
  const includeSoups = req.query.includeSoups !== "false";
  const soupPromise = includeSoups ? pool.query<mysql.RowDataPacket[]>(
      `SELECT s.*, u.avatar AS creator_avatar,
        u.equipped_badge_key AS creator_badge_key, u.equipped_badge_icon_url AS creator_badge_icon_url,
        (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
        (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
        EXISTS (SELECT 1 FROM soup_likes WHERE soup_id = s.id AND user_id = ?) AS is_liked,
        EXISTS (SELECT 1 FROM soup_favorites WHERE soup_id = s.id AND user_id = ?) AS is_favorited,
        COUNT(e.id) AS evaluation_count,
        AVG(e.total) AS average_total,
        AVG(e.writing) AS avg_writing,
        AVG(e.logic) AS avg_logic,
        AVG(e.share) AS avg_share,
        AVG(e.mechanism) AS avg_mechanism,
        AVG(e.twist) AS avg_twist,
        AVG(e.depth) AS avg_depth
       FROM soups s
       LEFT JOIN users u ON u.id = s.creator_id
       LEFT JOIN evaluations e ON e.soup_id = s.id
       WHERE s.creator_id = ? AND s.review_status = 'approved' AND s.is_surface_public = TRUE
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 10`,
      [viewer.id, viewer.id, req.params.id]
    ) : Promise.resolve([[], []] as unknown as [mysql.RowDataPacket[], mysql.FieldPacket[]]);
  const [[likeRows], [followRows], [soupRows]] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS received_like_count
       FROM soup_likes sl INNER JOIN soups s ON s.id = sl.soup_id
       WHERE s.creator_id = ?`,
      [req.params.id]
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS following_count,
         (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) AS follower_count,
         EXISTS (SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?) AS is_following`,
      [req.params.id, req.params.id, viewer.id, req.params.id]
    ),
    soupPromise
  ]);
  const follow = followRows[0] ?? {};
  res.json({
    profile: {
      ...withoutPrivateUsername(toUser(target)),
      receivedLikeCount: Number(likeRows[0]?.received_like_count ?? 0),
      followingCount: Number(follow.following_count ?? 0),
      followerCount: Number(follow.follower_count ?? 0),
      isFollowing: bool(follow.is_following),
      isSelf: viewer.id === req.params.id
    },
    soups: soupRows.map(mapSoupSummary)
  });
});

app.post("/api/users/:id/follow", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (user.id === req.params.id) return sendError(res, 400, "不能关注自己");
  const [targetRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id = ? LIMIT 1", [req.params.id]);
  if (!targetRows[0]) return sendError(res, 404, "用户不存在");
  const [existing] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT follower_id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
    [user.id, req.params.id]
  );
  if (existing[0]) {
    await pool.query("DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?", [user.id, req.params.id]);
    return res.json({ isFollowing: false });
  }
  await pool.query("INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)", [user.id, req.params.id]);
  await notify(req.params.id, "user_follow", "新增关注", `${user.nickname} 关注了你`, user.id, user.id);
  res.status(201).json({ isFollowing: true });
});

app.get("/api/users/:id/follows", async (req, res) => {
  const viewer = await requireAuth(req, res);
  if (!viewer) return;
  const type = req.query.type === "followers" ? "followers" : "following";
  const joinCondition = type === "followers" ? "u.id = f.follower_id" : "u.id = f.following_id";
  const whereColumn = type === "followers" ? "f.following_id" : "f.follower_id";
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT u.*,
       EXISTS (SELECT 1 FROM user_follows mine WHERE mine.follower_id = ? AND mine.following_id = u.id) AS is_following
     FROM user_follows f
     INNER JOIN users u ON ${joinCondition}
     WHERE ${whereColumn} = ?
     ORDER BY f.created_at DESC`,
    [viewer.id, req.params.id]
  );
  res.json({
    users: rows.map((row) => ({ ...withoutPrivateUsername(toUser(row)), isFollowing: bool(row.is_following), isSelf: row.id === viewer.id }))
  });
});

app.get("/api/me/received-interactions", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.id, s.title, s.cover_thumbnail,
       (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
       (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
       (SELECT COUNT(*) FROM evaluations WHERE soup_id = s.id) AS evaluation_count
     FROM soups s
     WHERE s.creator_id = ?
     ORDER BY s.created_at DESC`,
    [user.id]
  );
  res.json({ soups: rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    coverImage: soupImageUrl(row.id, row.cover_thumbnail, "thumbnail"),
    likeCount: Number(row.like_count ?? 0),
    favoriteCount: Number(row.favorite_count ?? 0),
    evaluationCount: Number(row.evaluation_count ?? 0)
  })) });
});

app.get("/api/me/soups/:id/interactions", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [soupRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, title FROM soups WHERE id = ? AND creator_id = ? LIMIT 1",
    [req.params.id, user.id]
  );
  if (!soupRows[0]) return sendError(res, 404, "作品不存在或无权查看");
  const type = String(req.query.type ?? "likes");
  let rows: mysql.RowDataPacket[] = [];
  if (type === "likes") {
    [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.nickname, u.avatar, sl.created_at
       FROM soup_likes sl INNER JOIN users u ON u.id = sl.user_id
       WHERE sl.soup_id = ? ORDER BY sl.created_at DESC`,
      [req.params.id]
    );
  } else if (type === "favorites") {
    [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.nickname, u.avatar, sf.created_at
       FROM soup_favorites sf INNER JOIN users u ON u.id = sf.user_id
       WHERE sf.soup_id = ? ORDER BY sf.created_at DESC`,
      [req.params.id]
    );
  } else if (type === "evaluations") {
    [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.nickname, u.avatar, e.total, e.content, e.created_at
       FROM evaluations e INNER JOIN users u ON u.id = e.reviewer_id
       WHERE e.soup_id = ? ORDER BY e.created_at DESC`,
      [req.params.id]
    );
  } else {
    return sendError(res, 400, "互动类型不正确");
  }
  res.json({
    title: String(soupRows[0].title),
    type,
    interactions: rows.map((row) => ({
      userId: String(row.id),
      nickname: String(row.nickname),
      avatar: avatarUrl(row.id, row.avatar),
      total: row.total == null ? null : Number(row.total),
      content: row.content ? String(row.content) : null,
      createdAt: new Date(row.created_at).toISOString()
    }))
  });
});

app.post("/api/conversations", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = z.object({ userId: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success || parsed.data.userId === user.id) return sendError(res, 400, "私信对象不正确");
  const [targetRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id = ? LIMIT 1", [parsed.data.userId]);
  if (!targetRows[0]) return sendError(res, 404, "用户不存在");
  const [userA, userB] = [user.id, parsed.data.userId].sort((a, b) => a.localeCompare(b));
  const [existing] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ? LIMIT 1",
    [userA, userB]
  );
  if (existing[0]) return res.json({ id: String(existing[0].id) });
  const [followRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT follower_id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
    [user.id, parsed.data.userId]
  );
  if (!followRows[0]) return sendError(res, 403, "关注对方后才能发起私信");
  const id = nanoid();
  try {
    await pool.query("INSERT INTO conversations (id, user_a_id, user_b_id) VALUES (?, ?, ?)", [id, userA, userB]);
    res.status(201).json({ id });
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ? LIMIT 1",
      [userA, userB]
    );
    res.json({ id: String(rows[0].id) });
  }
});

app.get("/api/conversations", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.id, c.last_message_at,
       u.id AS other_id, u.nickname AS other_nickname, u.avatar AS other_avatar,
       pm.content AS last_content, pm.message_type AS last_message_type, pm.sticker_id AS last_sticker_id,
       pm.sender_id AS last_sender_id, pm.created_at AS message_created_at,
       (SELECT COUNT(*) FROM private_messages unread
        WHERE unread.conversation_id = c.id AND unread.sender_id <> ? AND unread.read_at IS NULL) AS unread_count
     FROM conversations c
     INNER JOIN users u ON u.id = IF(c.user_a_id = ?, c.user_b_id, c.user_a_id)
     LEFT JOIN private_messages pm ON pm.id = (
       SELECT latest.id FROM private_messages latest
       WHERE latest.conversation_id = c.id
       ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
     )
     WHERE c.user_a_id = ? OR c.user_b_id = ?
     ORDER BY c.last_message_at DESC`,
    [user.id, user.id, user.id, user.id]
  );
  res.json({ conversations: rows.map((row) => ({
    id: String(row.id),
    otherUser: {
      id: String(row.other_id),
      nickname: String(row.other_nickname),
      avatar: avatarUrl(row.other_id, row.other_avatar)
    },
    lastMessage: row.last_content == null ? null : {
      content: String(row.last_content),
      type: row.last_message_type === "sticker" ? "sticker" : "text",
      stickerId: row.last_sticker_id ? String(row.last_sticker_id) : null,
      stickerName: row.last_sticker_id ? getSticker(String(row.last_sticker_id))?.name ?? null : null,
      isMine: String(row.last_sender_id) === user.id,
      createdAt: new Date(row.message_created_at).toISOString()
    },
    unreadCount: Number(row.unread_count ?? 0),
    updatedAt: new Date(row.last_message_at).toISOString()
  })) });
});

app.get("/api/messages/unread-counts", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const interactionTypes = ["soup_like", "soup_favorite", "soup_evaluation", "user_follow"];
  const placeholders = interactionTypes.map(() => "?").join(",");
  const requestWhere = user.role === "admin" ? "" : "AND owner_id = ?";
  const requestParams = user.role === "admin" ? [] : [user.id];
  const [[notificationCounts], [requestCounts], [noticeCounts], [privateMessageCounts]] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN is_read = 0 AND type <> 'view_request' AND type NOT IN (${placeholders}) THEN 1 ELSE 0 END) AS system_count,
         SUM(CASE WHEN is_read = 0 AND type IN (${placeholders}) THEN 1 ELSE 0 END) AS interaction_count
       FROM notifications WHERE user_id = ?`,
      [...interactionTypes, ...interactionTypes, user.id]
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS request_count FROM view_requests WHERE status = 'pending' ${requestWhere}`,
      requestParams
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS notice_count
       FROM admin_notices n
       WHERE (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)
         AND NOT EXISTS (
           SELECT 1 FROM admin_notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = ?
         )`,
      [user.id]
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS private_message_count
       FROM private_messages pm
       INNER JOIN conversations c ON c.id = pm.conversation_id
       WHERE (c.user_a_id = ? OR c.user_b_id = ?)
         AND pm.sender_id <> ? AND pm.read_at IS NULL`,
      [user.id, user.id, user.id]
    )
  ]);
  const counts = {
    system: Number(notificationCounts[0]?.system_count ?? 0),
    interactions: Number(notificationCounts[0]?.interaction_count ?? 0),
    requests: Number(requestCounts[0]?.request_count ?? 0),
    notices: Number(noticeCounts[0]?.notice_count ?? 0),
    privateMessages: Number(privateMessageCounts[0]?.private_message_count ?? 0)
  };
  res.json({ counts: { ...counts, total: counts.system + counts.interactions + counts.requests + counts.notices + counts.privateMessages } });
});

async function conversationForUser(conversationId: string, userId: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.*, u.id AS other_id, u.nickname AS other_nickname, u.avatar AS other_avatar
     FROM conversations c
     INNER JOIN users u ON u.id = IF(c.user_a_id = ?, c.user_b_id, c.user_a_id)
     WHERE c.id = ? AND (c.user_a_id = ? OR c.user_b_id = ?) LIMIT 1`,
    [userId, conversationId, userId, userId]
  );
  return rows[0] ?? null;
}

app.get("/api/conversations/:id/messages", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const conversation = await conversationForUser(req.params.id, user.id);
  if (!conversation) return sendError(res, 404, "会话不存在");
  const [readResult] = await pool.query<mysql.ResultSetHeader>(
    "UPDATE private_messages SET read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL",
    [req.params.id, user.id]
  );
  if (readResult.affectedRows > 0) emitUnreadChanged(user.id, "private_message_read");
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Math.min(100, Math.max(10, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));
  const before = String(req.query.before ?? "").trim();
  const params: unknown[] = [req.params.id];
  let beforeClause = "";
  if (before) {
    const [[cursor]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT created_at, id FROM private_messages WHERE id = ? AND conversation_id = ? LIMIT 1",
      [before, req.params.id]
    );
    if (!cursor) return sendError(res, 400, "消息游标无效");
    beforeClause = "AND (created_at < ? OR (created_at = ? AND id < ?))";
    params.push(cursor.created_at, cursor.created_at, cursor.id);
  }
  params.push(limit + 1);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, sender_id, content, message_type, sticker_id, read_at, created_at
     FROM private_messages WHERE conversation_id = ? ${beforeClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    params
  );
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  rows.reverse();
  res.json({
    conversation: {
      id: String(conversation.id),
      otherUser: {
        id: String(conversation.other_id),
        nickname: String(conversation.other_nickname), avatar: avatarUrl(conversation.other_id, conversation.other_avatar)
      }
    },
    messages: rows.map((row) => ({
      id: String(row.id), senderId: String(row.sender_id), content: String(row.content),
      type: row.message_type === "sticker" ? "sticker" : "text",
      stickerId: row.sticker_id ? String(row.sticker_id) : null,
      stickerName: row.sticker_id ? getSticker(String(row.sticker_id))?.name ?? null : null,
      isMine: String(row.sender_id) === user.id,
      isRead: Boolean(row.read_at), createdAt: new Date(row.created_at).toISOString()
    })),
    hasMore,
    nextCursor: hasMore && rows[0] ? String(rows[0].id) : null
  });
});

app.patch("/api/conversations/:id/read", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const conversation = await conversationForUser(req.params.id, user.id);
  if (!conversation) return sendError(res, 404, "会话不存在");
  const [result] = await pool.query<mysql.ResultSetHeader>(
    "UPDATE private_messages SET read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL",
    [req.params.id, user.id]
  );
  if (result.affectedRows > 0) emitUnreadChanged(user.id, "private_message_read");
  res.json({ ok: true, updated: result.affectedRows });
});

app.post("/api/conversations/:id/messages", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = z.object({
    content: text.max(1000, "单条消息不能超过1000字").optional(),
    stickerId: z.string().trim().min(1).max(64).optional()
  }).superRefine((value, ctx) => {
    if (Boolean(value.content) === Boolean(value.stickerId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "文本和表情必须且只能发送一种" });
    }
  }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "消息内容不正确");
  const sticker = parsed.data.stickerId ? getSticker(parsed.data.stickerId) : null;
  if (parsed.data.stickerId && !sticker) return sendError(res, 400, "表情不存在或已下架");
  const messageType = sticker ? "sticker" : "text";
  const content = parsed.data.content ?? "";
  const conversation = await conversationForUser(req.params.id, user.id);
  if (!conversation) return sendError(res, 404, "会话不存在");
  const id = nanoid();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO private_messages (id, conversation_id, sender_id, content, message_type, sticker_id) VALUES (?, ?, ?, ?, ?, ?)",
      [id, req.params.id, user.id, content, messageType, sticker?.id ?? null]
    );
    await connection.query("UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  const createdAt = new Date().toISOString();
  const message = {
    id,
    senderId: user.id,
    content,
    type: messageType,
    stickerId: sticker?.id ?? null,
    stickerName: sticker?.name ?? null,
    isMine: true,
    isRead: false,
    createdAt
  };
  emitUserEvent(String(conversation.other_id), "private_message", {
    conversationId: req.params.id,
    messageId: id,
    senderId: user.id,
    senderNickname: user.nickname,
    senderAvatar: user.avatar,
    content,
    type: messageType,
    stickerId: sticker?.id ?? null,
    stickerName: sticker?.name ?? null,
    createdAt,
    message: { ...message, isMine: false }
  });
  emitUnreadChanged(String(conversation.other_id), "private_message");
  res.status(201).json({ id, createdAt, message });
});

app.post("/api/me/badge-unlocks/sync", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  await recordLoginDay(user.id);

  const [userRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badges_initialized FROM users WHERE id = ? LIMIT 1",
    [user.id]
  );
  const wasInitialized = Boolean(userRows[0]?.badges_initialized);
  const { stats } = await syncSystemBadgeUnlocks(user.id);
  const activityBadges = await syncActivityBadges(user.id);
  await notifyActivityBadgeUnlocks(user.id, activityBadges);

  if (!wasInitialized) {
    await markPendingBadgePopupsSurfaced(user.id);
    await pool.query("UPDATE users SET badges_initialized = 1 WHERE id = ?", [user.id]);
  }

  const surfacedKeys = wasInitialized ? await claimPendingBadgePopups(user.id) : [];
  const systemSurfacedKeys = surfacedKeys.filter((key) => !key.startsWith("legendary:"));
  if (systemSurfacedKeys.length > 0) {
    await Promise.all(systemSurfacedKeys.map((key) =>
      notify(user.id, "badge_unlock", "获得新徽章", `恭喜你获得徽章「${badgeNotificationLabel(key)}」`, key, user.id)
    ));
  }
  const specialBadges = await getLegendaryBadgeUnlockDetails(user.id, surfacedKeys);
  res.json({ unlocks: surfacedKeys, specialBadges, stats });
});

app.get("/api/me/legendary-badges", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT lb.id, lb.name, lb.description, lb.requirement, lb.icon_url, lb.achievement_points,
       lb.badge_type, lb.tier, lb.activity_conditions, ubu.unlocked_at
     FROM legendary_badges lb
     INNER JOIN user_badge_unlocks ubu ON ubu.badge_key = CONCAT('legendary:', lb.id)
     WHERE ubu.user_id = ?
     ORDER BY ubu.unlocked_at DESC`,
    [user.id]
  );
  res.json({
    badges: rows.map((row) => ({
      id: String(row.id),
      key: `legendary:${row.id}`,
      name: String(row.name),
      description: String(row.description),
      requirement: row.requirement ? String(row.requirement) : null,
      iconUrl: String(row.icon_url),
      achievementPoints: Number(row.achievement_points ?? 0),
      badgeType: String(row.badge_type ?? "limited"),
      activityConditions: badgeActivityConditions(row.activity_conditions),
      unlockedAt: row.unlocked_at ? new Date(row.unlocked_at).toISOString() : null,
      tier: specialBadgeTier(row.tier)
    }))
  });
});

app.get("/api/me/badge-collection", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [unlockRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badge_key FROM user_badge_unlocks WHERE user_id = ? ORDER BY unlocked_at DESC",
    [user.id]
  );
  const [legendaryRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT lb.id, lb.name, lb.description, lb.requirement, lb.icon_url, lb.achievement_points,
       lb.badge_type, lb.tier, lb.activity_conditions, ubu.unlocked_at
     FROM legendary_badges lb
     INNER JOIN user_badge_unlocks ubu ON ubu.badge_key = CONCAT('legendary:', lb.id)
     WHERE ubu.user_id = ?
     ORDER BY ubu.unlocked_at DESC`,
    [user.id]
  );
  const [[freshUser]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT equipped_badge_key, equipped_badge_icon_url FROM users WHERE id = ? LIMIT 1",
    [user.id]
  );
  res.json({
    badgeKeys: unlockRows.map((row) => String(row.badge_key)),
    ownershipRates: cachedBadgeOwnershipRates(),
    legendaryBadges: legendaryRows.map((row) => ({
      id: String(row.id),
      key: `legendary:${row.id}`,
      name: String(row.name),
      description: String(row.description),
      requirement: row.requirement ? String(row.requirement) : null,
      iconUrl: String(row.icon_url),
      achievementPoints: Number(row.achievement_points ?? 0),
      badgeType: String(row.badge_type ?? "limited"),
      activityConditions: badgeActivityConditions(row.activity_conditions),
      unlockedAt: row.unlocked_at ? new Date(row.unlocked_at).toISOString() : null,
      tier: specialBadgeTier(row.tier)
    })),
    equippedBadge: equippedBadge(freshUser?.equipped_badge_key, freshUser?.equipped_badge_icon_url)
  });
});

app.patch("/api/me/equipped-badge", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = z.object({ badgeKey: z.string().min(1).max(128).nullable() }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "徽章参数不正确");
  if (parsed.data.badgeKey === null) {
    await pool.query(
      "UPDATE users SET equipped_badge_key = NULL, equipped_badge_icon_url = NULL WHERE id = ?",
      [user.id]
    );
    return res.json({ equippedBadge: null });
  }
  const iconUrl = await ownedBadgeIconUrl(user.id, parsed.data.badgeKey);
  if (!iconUrl) return sendError(res, 403, "只能装配自己已获得的徽章");
  await pool.query(
    "UPDATE users SET equipped_badge_key = ?, equipped_badge_icon_url = ? WHERE id = ?",
    [parsed.data.badgeKey, iconUrl, user.id]
  );
  res.json({ equippedBadge: equippedBadge(parsed.data.badgeKey, iconUrl) });
});

let rankingsCache: { expiresAt: number; payload: unknown } | null = null;

app.get("/api/rankings", async (req, res) => {
  if (!(await requireAuth(req, res))) return;
  if (rankingsCache && rankingsCache.expiresAt > Date.now()) return res.json(rankingsCache.payload);

  const [hotSoupRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.id, s.title, s.author, s.view_count,
       COALESCE(e.evaluation_count, 0) AS evaluation_count,
       COALESCE(e.comprehensive_score, 0) AS comprehensive_score,
       COALESCE(l.like_count, 0) AS like_count,
       COALESCE(f.favorite_count, 0) AS favorite_count,
       (COALESCE(e.comprehensive_score, 0) + 1) *
         (s.view_count + (COALESCE(l.like_count, 0) + 1) * 15 + (COALESCE(f.favorite_count, 0) + 1) * 20 + (COALESCE(e.evaluation_count, 0) + 1) * 25) - 61 AS heat_value
     FROM soups s
     LEFT JOIN (SELECT soup_id, COUNT(*) AS evaluation_count, AVG(total) AS comprehensive_score FROM evaluations GROUP BY soup_id) e ON e.soup_id = s.id
     LEFT JOIN (SELECT soup_id, COUNT(*) AS like_count FROM soup_likes GROUP BY soup_id) l ON l.soup_id = s.id
     LEFT JOIN (SELECT soup_id, COUNT(*) AS favorite_count FROM soup_favorites GROUP BY soup_id) f ON f.soup_id = s.id
      WHERE s.is_surface_public = TRUE AND s.review_status = 'approved'
     ORDER BY heat_value DESC, s.view_count DESC, evaluation_count DESC, s.created_at ASC
     LIMIT 10`
  );

  const [achievementRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT u.id, u.nickname, u.created_at, ubu.badge_key, ubu.unlocked_at,
       lb.achievement_points AS legendary_points
     FROM users u
     LEFT JOIN user_badge_unlocks ubu ON ubu.user_id = u.id
     LEFT JOIN legendary_badges lb ON ubu.badge_key = CONCAT('legendary:', lb.id)
     WHERE u.role = 'user'
     ORDER BY u.created_at ASC, ubu.unlocked_at ASC`
  );

  const users = new Map<string, { id: string; nickname: string; achievementPoints: number; reachedAt: number; createdAt: number }>();
  for (const row of achievementRows) {
    const id = String(row.id);
    const createdAt = new Date(row.created_at).getTime();
    const current = users.get(id) ?? { id, nickname: String(row.nickname), achievementPoints: 0, reachedAt: createdAt, createdAt };
    if (row.badge_key) {
      const key = String(row.badge_key);
      const points = key.startsWith("legendary:")
        ? Number(row.legendary_points ?? 0)
        : Number(SYSTEM_BADGE_ACHIEVEMENT_POINTS[key] ?? 0);
      if (points > 0) {
        current.achievementPoints += points;
        current.reachedAt = Math.max(current.reachedAt, new Date(row.unlocked_at).getTime());
      }
    }
    users.set(id, current);
  }

  const achievementUsers = [...users.values()]
    .sort((a, b) => b.achievementPoints - a.achievementPoints || a.reachedAt - b.reachedAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(0, 10)
    .map((item, index) => ({ rank: index + 1, id: item.id, nickname: item.nickname, achievementPoints: item.achievementPoints }));

  const payload = {
    hotSoups: hotSoupRows.map((row, index) => ({
      rank: index + 1,
      id: String(row.id),
      title: String(row.title),
      author: String(row.author),
      heatValue: Math.round(Number(row.heat_value ?? 0))
    })),
    achievementUsers
  };
  rankingsCache = { expiresAt: Date.now() + 60_000, payload };
  res.json(payload);
});

app.get("/api/me/favorites", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const limit = 10;
  const rawOffset = Number(req.query.offset ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM soup_favorites f INNER JOIN soups s ON s.id = f.soup_id WHERE f.user_id = ? AND s.review_status = 'approved'`,
    [user.id]
  );
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u.avatar AS creator_avatar,
      u.equipped_badge_key AS creator_badge_key, u.equipped_badge_icon_url AS creator_badge_icon_url,
      (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
      COUNT(e.id) AS evaluation_count,
      AVG(e.total) AS average_total,
      AVG(e.writing) AS avg_writing,
      AVG(e.logic) AS avg_logic,
      AVG(e.share) AS avg_share,
      AVG(e.mechanism) AS avg_mechanism,
      AVG(e.twist) AS avg_twist,
      AVG(e.depth) AS avg_depth
    FROM soups s
    INNER JOIN soup_favorites f ON f.soup_id = s.id
    LEFT JOIN evaluations e ON e.soup_id = s.id
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE f.user_id = ? AND s.review_status = 'approved'
    GROUP BY s.id
    ORDER BY f.created_at DESC, s.id DESC
    LIMIT ? OFFSET ?
    `,
    [user.id, limit, offset]
  );
  const total = Number(totalRow.total ?? 0);
  res.json({ soups: rows.map(mapSoupSummary), total, hasMore: offset + rows.length < total });
});

app.get("/api/me/evaluations", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u.avatar AS creator_avatar,
      u.equipped_badge_key AS creator_badge_key, u.equipped_badge_icon_url AS creator_badge_icon_url,
      (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
      COUNT(e2.id) AS evaluation_count,
      AVG(e2.total) AS average_total,
      AVG(e2.writing) AS avg_writing,
      AVG(e2.logic) AS avg_logic,
      AVG(e2.share) AS avg_share,
      AVG(e2.mechanism) AS avg_mechanism,
      AVG(e2.twist) AS avg_twist,
      AVG(e2.depth) AS avg_depth
    FROM soups s
    INNER JOIN evaluations my ON my.soup_id = s.id
    LEFT JOIN evaluations e2 ON e2.soup_id = s.id
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE my.reviewer_id = ? AND s.review_status = 'approved'
    GROUP BY s.id
    ORDER BY my.created_at DESC
    `,
    [user.id]
  );
  res.json({ soups: rows.map(mapSoupSummary) });
});

app.get("/api/soups", async (req, res) => {
  const user = await currentUser(req);
  const where: string[] = [];
  const params: unknown[] = [];
  const userParams: unknown[] = [];

  const requestedReviewStatus = String(req.query.reviewStatus ?? "");
  if (user?.role === "admin" && requestedReviewStatus === "all") {
    // 管理后台可查看全部审核状态。
  } else if (user?.role === "admin" && ["approved", "pending", "rejected"].includes(requestedReviewStatus)) {
    where.push("s.review_status = ?");
    params.push(requestedReviewStatus);
  } else {
    where.push("s.review_status = 'approved'");
  }

  if (!user || user.role !== "admin") {
    if (user) {
      where.push("(s.is_surface_public = TRUE OR s.creator_id = ?)");
      params.push(user.id);
    } else {
      where.push("s.is_surface_public = TRUE");
    }
  }

  if (req.query.keyword) {
    where.push("(s.title LIKE ? OR s.author LIKE ? OR s.summary LIKE ?)");
    const keyword = `%${String(req.query.keyword)}%`;
    params.push(keyword, keyword, keyword);
  }
  if (req.query.author) {
    where.push("s.author LIKE ?");
    params.push(`%${String(req.query.author)}%`);
  }
  if (req.query.type) {
    where.push("s.type = ?");
    params.push(String(req.query.type));
  }
  if (req.query.bottomPublic === "surface") where.push("s.is_surface_public = TRUE");
  if (req.query.bottomPublic === "bottom") where.push("s.is_bottom_public = TRUE");

  const having: string[] = [];
  if (["2", "3", "4"].includes(String(req.query.minRating ?? ""))) {
    having.push("AVG(e.total) >= ?");
    params.push(Number(req.query.minRating));
  }

  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  const offset = Number(req.query.offset ?? 0);
  const order = req.query.order === "asc" ? "ASC" : req.query.order === "desc" ? "DESC" : "RANDOM";
  const randomSeed = String(req.query.seed ?? new Date().toISOString().slice(0, 10)).slice(0, 32);
  const orderClause = order === "RANDOM" ? "CRC32(CONCAT(s.id, ?))" : `s.created_at ${order}`;

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.id, s.title, s.author, s.type, s.summary, s.cover_thumbnail, s.is_original,
      s.creator_id, s.creator_name, s.is_surface_public, s.is_bottom_public, s.view_count, s.created_at,
      s.review_status, s.review_reason, s.review_version,
      u.avatar AS creator_avatar,
      u.equipped_badge_key AS creator_badge_key, u.equipped_badge_icon_url AS creator_badge_icon_url,
      (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
      ${user ? `EXISTS(SELECT 1 FROM soup_likes WHERE soup_id = s.id AND user_id = ?) AS is_liked,` : "FALSE AS is_liked,"}
      ${user ? `EXISTS(SELECT 1 FROM soup_favorites WHERE soup_id = s.id AND user_id = ?) AS is_favorited,` : "FALSE AS is_favorited,"}
      COUNT(e.id) AS evaluation_count,
      AVG(e.total) AS average_total,
      AVG(e.writing) AS avg_writing,
      AVG(e.logic) AS avg_logic,
      AVG(e.share) AS avg_share,
      AVG(e.mechanism) AS avg_mechanism,
      AVG(e.twist) AS avg_twist,
      AVG(e.depth) AS avg_depth
    FROM soups s
    LEFT JOIN evaluations e ON e.soup_id = s.id
    LEFT JOIN users u ON u.id = s.creator_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY s.id
    ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
    ORDER BY ${orderClause}
    LIMIT ${limit + 1} OFFSET ${offset}
    `,
    [...(user ? [user.id, user.id] : []), ...params, ...(order === "RANDOM" ? [randomSeed] : [])]
  );

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (
      SELECT s.id
      FROM soups s
      LEFT JOIN evaluations e ON e.soup_id = s.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY s.id
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
    ) counted_soups`,
    params
  );
  res.json({ soups: rows.map(mapSoupSummary), total: Number(totalRow.total ?? 0), hasMore });
});

app.post("/api/soups", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = soupSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "请完整填写海龟汤信息");

  const id = nanoid();
  const soup = parsed.data;
  if (soup.isOriginal && !soup.author) return sendError(res, 400, "原创海龟汤需要填写作者");
  const duplicate = await findDuplicateSoup(soup);
  if (duplicate) return sendError(res, 409, "该海龟汤在平台上高度重复");
  const usage = user.role === "admin" ? null : await getSoupPublishUsage(user.id);
  if (usage && usage.autoRejectCount >= 3) return sendError(res, 429, "今日自动审核未通过次数已达3次，请明天再试");
  if (usage && usage.publishedCount >= 5) return sendError(res, 429, "您今日已发布5篇海龟汤，明天再继续分享吧");

  let review;
  try {
    review = await reviewSoupContent({ title: soup.title, surface: soup.surface, bottom: soup.bottom });
  } catch (error) {
    if (error instanceof SoupReviewUnavailableError) return sendError(res, 503, error.message);
    throw error;
  }
  if (review.decision === "rejected") {
    if (user.role !== "admin") await recordSoupAutoReject(user.id, usage!.date);
    return sendError(res, 422, review.reason ?? "内容未通过自动审核");
  }

  const author = soup.isOriginal ? soup.author : "佚名";
  const optimizedCover = soup.coverImage ? await optimizeCoverImage(soup.coverImage) : null;
  if (soup.coverImage && !optimizedCover) return sendError(res, 400, "封面图片无法处理");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (user.role !== "admin") {
      await connection.query(
        "INSERT IGNORE INTO soup_publish_daily_usage (user_id, usage_date) VALUES (?, ?)",
        [user.id, usage!.date],
      );
      const [quotaResult] = await connection.query<mysql.ResultSetHeader>(
        `UPDATE soup_publish_daily_usage SET published_count = published_count + 1
         WHERE user_id = ? AND usage_date = ? AND published_count < 5 AND auto_reject_count < 3`,
        [user.id, usage!.date],
      );
      if (quotaResult.affectedRows !== 1) throw new Error("SOUP_DAILY_QUOTA");
    }
    await connection.query(
      `INSERT INTO soups
        (id, title, author, type, summary, cover_image, cover_thumbnail, is_original, is_sensitive, surface, supplemental_surfaces, bottom, supplemental_bottoms, host_manual, is_surface_public, is_bottom_public, enable_ai_game, review_status, review_reason, review_version, ai_prompt, key_facts, key_facts_hash, key_facts_customized, creator_id, creator_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, soup.title, author, soup.type, soup.summary, optimizedCover?.full ?? null, optimizedCover?.thumbnail ?? null, soup.isOriginal, soup.isSensitive,
        soup.surface, JSON.stringify(soup.supplementalSurfaces), soup.bottom, JSON.stringify(soup.supplementalBottoms), soup.manual || null,
        soup.isSurfacePublic, soup.isBottomPublic, soup.enableAiGame, review.decision, review.reason, 1, soup.aiPrompt || null,
        soup.keyFacts.length > 0 ? JSON.stringify(soup.keyFacts) : null, null, soup.keyFactsCustomized ? 1 : 0, user.id, user.nickname]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error instanceof Error && error.message === "SOUP_DAILY_QUOTA") return sendError(res, 429, "您今日已发布5篇海龟汤，明天再继续分享吧");
    throw error;
  } finally {
    connection.release();
  }
  queueSystemBadgeSync([user.id]);
  res.status(201).json({ id, reviewStatus: review.decision });

  // 异步预拆分关键事实点（不阻塞响应）。用户已自定义则跳过
  if (soup.enableAiGame && !soup.keyFactsCustomized) {
    splitKeyFactsForSoup(id).catch(() => {});
  }
});

app.get("/api/soups/:id", async (req, res) => {
  const user = await currentUser(req);
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (!canSeeSoupSurface(soup, user)) return sendError(res, 403, "没有查看权限");

  const identifier = viewIdentifier(req, user);
  const [recent] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT viewed_at FROM soup_views WHERE soup_id = ? AND user_identifier = ? ORDER BY viewed_at DESC LIMIT 1",
    [req.params.id, identifier]
  );
  const lastView = recent[0]?.viewed_at ? new Date(recent[0].viewed_at).getTime() : 0;
  if (Date.now() - lastView > 60_000) {
    await pool.query(
      "INSERT INTO soup_views (id, soup_id, user_identifier) VALUES (?, ?, ?)",
      [nanoid(), req.params.id, identifier]
    );
    await pool.query("UPDATE soups SET view_count = view_count + 1 WHERE id = ?", [req.params.id]);
  }

  const [statsRows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u.avatar AS creator_avatar,
      u.equipped_badge_key AS creator_badge_key, u.equipped_badge_icon_url AS creator_badge_icon_url,
      (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
      COUNT(e.id) AS evaluation_count,
      AVG(e.total) AS average_total,
      AVG(e.writing) AS avg_writing,
      AVG(e.logic) AS avg_logic,
      AVG(e.share) AS avg_share,
      AVG(e.mechanism) AS avg_mechanism,
      AVG(e.twist) AS avg_twist,
      AVG(e.depth) AS avg_depth
    FROM soups s
    LEFT JOIN evaluations e ON e.soup_id = s.id
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.id = ?
    GROUP BY s.id
    LIMIT 1
    `,
    [req.params.id]
  );
  const [evalRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT e.*, reviewer.avatar AS reviewer_avatar,
       reviewer.equipped_badge_key AS reviewer_badge_key,
       reviewer.equipped_badge_icon_url AS reviewer_badge_icon_url
     FROM evaluations e
     LEFT JOIN users reviewer ON reviewer.id = e.reviewer_id
     WHERE e.soup_id = ? ORDER BY e.created_at DESC`,
    [req.params.id]
  );
  const full = await canViewFull(soup, user);
  const [requestRows] =
    user && !full
      ? await pool.query<mysql.RowDataPacket[]>(
          "SELECT id FROM view_requests WHERE soup_id = ? AND requester_id = ? AND status = 'pending' LIMIT 1",
          [req.params.id, user.id]
        )
      : [[] as mysql.RowDataPacket[]];
  const [favoriteRows] =
    user
      ? await pool.query<mysql.RowDataPacket[]>(
          "SELECT id FROM soup_favorites WHERE soup_id = ? AND user_id = ? LIMIT 1",
          [req.params.id, user.id]
        )
      : [[] as mysql.RowDataPacket[]];
  const [likeRows] =
    user
      ? await pool.query<mysql.RowDataPacket[]>(
          "SELECT id FROM soup_likes WHERE soup_id = ? AND user_id = ? LIMIT 1",
          [req.params.id, user.id]
        )
      : [[] as mysql.RowDataPacket[]];
  const canEdit = Boolean(user && (user.role === "admin" || user.id === soup.creator_id));

  res.json({
    soup: {
      ...mapSoupDetail(statsRows[0]),
      surface: soup.surface,
      supplementalSurfaces: full ? jsonList(soup.supplemental_surfaces) : [],
      bottom: full ? soup.bottom : null,
      supplementalBottoms: full ? jsonList(soup.supplemental_bottoms) : null,
      manual: full ? soup.host_manual : null,
      enableAiGame: bool(soup.enable_ai_game),
      aiPrompt: canEdit ? (soup.ai_prompt as string) || null : null,
      keyFacts: canEdit ? safeParseJson(soup.key_facts) : null,
      keyFactsCustomized: canEdit && (soup.key_facts_customized as number) === 1,
      canViewFull: full,
      canEdit,
      isFavorited: favoriteRows.length > 0,
      isLiked: likeRows.length > 0,
      pendingRequestId: requestRows[0]?.id ?? null,
      evaluations: evalRows.map(mapEvaluation)
    }
  });
});

app.post("/api/soups/:id/like", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (String(soup.review_status ?? "approved") !== "approved") return sendError(res, 409, "审核中的海龟汤暂不可点赞");
  if (!canSeeSoupSurface(soup, user)) return sendError(res, 403, "没有查看权限");

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM soup_likes WHERE soup_id = ? AND user_id = ? LIMIT 1",
    [req.params.id, user.id]
  );
  if (rows.length > 0) {
    await pool.query("DELETE FROM soup_likes WHERE soup_id = ? AND user_id = ?", [req.params.id, user.id]);
    const [[c]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS cnt FROM soup_likes WHERE soup_id = ?", [req.params.id]);
    res.json({ isLiked: false, likeCount: Number(c.cnt) });
    return;
  }

  await pool.query("INSERT INTO soup_likes (id, soup_id, user_id) VALUES (?, ?, ?)", [nanoid(), req.params.id, user.id]);
  if (Boolean(soup.is_original)) {
    await pool.query(
      "INSERT IGNORE INTO soup_like_history (soup_id, actor_id, creator_id) VALUES (?, ?, ?)",
      [req.params.id, user.id, soup.creator_id]
    );
  }
  if (String(soup.creator_id) !== user.id) {
    await notify(
      String(soup.creator_id),
      "soup_like",
      "收到新的点赞",
      `${user.nickname} 点赞了你的海龟汤《${soup.title}》`,
      req.params.id,
      user.id
    );
  }
  queueSystemBadgeSync([user.id, String(soup.creator_id)]);
  const [[c2]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS cnt FROM soup_likes WHERE soup_id = ?", [req.params.id]);
  res.status(201).json({ isLiked: true, likeCount: Number(c2.cnt) });
});

app.get("/api/me/likes", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const limit = 10;
  const rawOffset = Number(req.query.offset ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM soup_likes lk INNER JOIN soups s ON s.id = lk.soup_id WHERE lk.user_id = ? AND s.review_status = 'approved'`,
    [user.id]
  );
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u2.avatar AS creator_avatar,
      u2.equipped_badge_key AS creator_badge_key, u2.equipped_badge_icon_url AS creator_badge_icon_url,
      (SELECT COUNT(*) FROM soup_likes WHERE soup_id = s.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE soup_id = s.id) AS favorite_count,
      COUNT(e.id) AS evaluation_count,
      AVG(e.total) AS average_total,
      AVG(e.writing) AS avg_writing,
      AVG(e.logic) AS avg_logic,
      AVG(e.share) AS avg_share,
      AVG(e.mechanism) AS avg_mechanism,
      AVG(e.twist) AS avg_twist,
      AVG(e.depth) AS avg_depth
    FROM soups s
    INNER JOIN soup_likes lk ON lk.soup_id = s.id
    LEFT JOIN evaluations e ON e.soup_id = s.id
    LEFT JOIN users u2 ON u2.id = s.creator_id
    WHERE lk.user_id = ? AND s.review_status = 'approved'
    GROUP BY s.id
    ORDER BY lk.created_at DESC, s.id DESC
    LIMIT ? OFFSET ?
    `,
    [user.id, limit, offset]
  );
  const total = Number(totalRow.total ?? 0);
  res.json({ soups: rows.map(mapSoupSummary), total, hasMore: offset + rows.length < total });
});

app.post("/api/soups/:id/favorite", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (String(soup.review_status ?? "approved") !== "approved") return sendError(res, 409, "审核中的海龟汤暂不可收藏");
  if (!canSeeSoupSurface(soup, user)) return sendError(res, 403, "没有查看权限");

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM soup_favorites WHERE soup_id = ? AND user_id = ? LIMIT 1",
    [req.params.id, user.id]
  );
  if (rows.length > 0) {
    await pool.query("DELETE FROM soup_favorites WHERE soup_id = ? AND user_id = ?", [req.params.id, user.id]);
    const [[c]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS cnt FROM soup_favorites WHERE soup_id = ?", [req.params.id]);
    res.json({ isFavorited: false, favoriteCount: Number(c.cnt) });
    return;
  }

  await pool.query("INSERT INTO soup_favorites (id, soup_id, user_id) VALUES (?, ?, ?)", [nanoid(), req.params.id, user.id]);
  if (Boolean(soup.is_original)) {
    await pool.query(
      "INSERT IGNORE INTO soup_favorite_history (soup_id, actor_id, creator_id) VALUES (?, ?, ?)",
      [req.params.id, user.id, soup.creator_id]
    );
  }
  if (String(soup.creator_id) !== user.id) {
    await notify(
      String(soup.creator_id),
      "soup_favorite",
      "收到新的收藏",
      `${user.nickname} 收藏了你的海龟汤《${soup.title}》`,
      req.params.id,
      user.id
    );
  }
  queueSystemBadgeSync([user.id, String(soup.creator_id)]);
  const [[c2]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS cnt FROM soup_favorites WHERE soup_id = ?", [req.params.id]);
  res.status(201).json({ isFavorited: true, favoriteCount: Number(c2.cnt) });
});

app.put("/api/soups/:id", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (user.role !== "admin" && user.id !== soup.creator_id) return sendError(res, 403, "没有编辑权限");

  const parsed = soupSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "请完整填写海龟汤信息");
  const next = parsed.data;
  if (next.isOriginal && !next.author) return sendError(res, 400, "原创海龟汤需要填写作者");
  const duplicate = await findDuplicateSoup(next, req.params.id);
  if (duplicate) return sendError(res, 409, "该海龟汤在平台上高度重复");
  let review;
  try {
    review = await reviewSoupContent({ title: next.title, surface: next.surface, bottom: next.bottom });
  } catch (error) {
    if (error instanceof SoupReviewUnavailableError) return sendError(res, 503, error.message);
    throw error;
  }
  if (review.decision === "rejected") return sendError(res, 422, review.reason ?? "内容未通过自动审核");
  const author = next.isOriginal ? next.author : "佚名";
  const existingCoverSelected = next.coverImage.startsWith(`/api/media/soups/${req.params.id}/cover`);
  const optimizedCover = next.coverImage && !existingCoverSelected ? await optimizeCoverImage(next.coverImage) : null;
  if (next.coverImage && !existingCoverSelected && !optimizedCover) return sendError(res, 400, "封面图片无法处理");
  const coverImage = existingCoverSelected ? soup.cover_image : (optimizedCover?.full ?? null);
  const thumbnail = existingCoverSelected ? soup.cover_thumbnail : (optimizedCover?.thumbnail ?? null);
  await pool.query(
    `UPDATE soups
     SET title = ?, author = ?, type = ?, summary = ?, cover_image = ?, cover_thumbnail = ?, is_original = ?, is_sensitive = ?, surface = ?, supplemental_surfaces = ?, bottom = ?, supplemental_bottoms = ?, host_manual = ?,
         is_surface_public = ?, is_bottom_public = ?, enable_ai_game = ?, review_status = ?, review_reason = ?, review_version = review_version + 1,
         reviewed_at = NULL, reviewed_by = NULL, ai_prompt = ?, key_facts = ?, key_facts_hash = ?, key_facts_customized = ?
     WHERE id = ?`,
    [
      next.title,
      author,
      next.type,
      next.summary,
      coverImage,
      thumbnail,
      next.isOriginal,
      next.isSensitive,
      next.surface,
      JSON.stringify(next.supplementalSurfaces),
      next.bottom,
      JSON.stringify(next.supplementalBottoms),
      next.manual || null,
      next.isSurfacePublic,
      next.isBottomPublic,
      next.enableAiGame,
      review.decision,
      review.reason,
      next.aiPrompt || null,
      next.keyFacts.length > 0 ? JSON.stringify(next.keyFacts) : null,
      null,
      next.keyFactsCustomized ? 1 : 0,
      req.params.id
    ]
  );
  res.json({ ok: true, reviewStatus: review.decision });

  // 异步预拆分关键事实点（不阻塞响应）。用户已自定义则跳过
  if (next.enableAiGame && !next.keyFactsCustomized) {
    splitKeyFactsForSoup(req.params.id).catch(() => {});
  } else if (!next.enableAiGame) {
    // 关闭 AI 玩汤时清空缓存
    pool.query("UPDATE soups SET key_facts = NULL, key_facts_hash = NULL, ai_prompt = NULL, key_facts_customized = 0 WHERE id = ?", [req.params.id]).catch(() => {});
  }
});

// 强制 AI 重新解析关键点（清除自定义标记后重拆）
app.post("/api/soups/:id/reanalyze-keyfacts", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (user.role !== "admin" && user.id !== soup.creator_id) return sendError(res, 403, "没有编辑权限");

  forceReanalyzeKeyFacts(req.params.id).catch(() => {});
  res.json({ ok: true });
});

app.delete("/api/soups/:id", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (user.role !== "admin" && user.id !== soup.creator_id) return sendError(res, 403, "没有删除权限");
  await pool.query("DELETE FROM soups WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/admin/soups/:id/review", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const parsed = z.object({
    decision: z.enum(["approved", "rejected"]),
    reviewVersion: z.number().int().positive(),
    reason: z.string().trim().max(500).optional().default(""),
  }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "审核参数不正确");
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id, title, creator_id, review_status, review_version FROM soups WHERE id = ? LIMIT 1", [req.params.id]);
  const soup = rows[0];
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (String(soup.review_status) !== "pending") return sendError(res, 409, "该审核已取消或处理完成");
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE soups SET review_status = ?, review_reason = ?, reviewed_at = NOW(), reviewed_by = ?
     WHERE id = ? AND review_status = 'pending' AND review_version = ?`,
    [parsed.data.decision, parsed.data.reason || (parsed.data.decision === "approved" ? null : "内容未通过人工审核"), admin.id, req.params.id, parsed.data.reviewVersion],
  );
  if (result.affectedRows !== 1) return sendError(res, 409, "内容已被作者修改，本次审核已自动取消");
  await notify(
    String(soup.creator_id),
    "soup_review",
    parsed.data.decision === "approved" ? "海龟汤审核通过" : "海龟汤审核未通过",
    `《${soup.title}》${parsed.data.decision === "approved" ? "已通过管理员审核并公开" : "未通过管理员审核，可修改后重新提交"}`,
    req.params.id,
    admin.id,
  );
  res.json({ ok: true });
});

app.post("/api/soups/:id/evaluations", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (String(soup.review_status ?? "approved") !== "approved") return sendError(res, 409, "审核中的海龟汤暂不可评价");
  if (!canSeeSoupSurface(soup, user)) return sendError(res, 403, "不能评价未公开内容");

  const parsed = evaluationSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "评分必须在 1-5 之间，步长 0.5");

  const exists = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM evaluations WHERE soup_id = ? AND reviewer_id = ? LIMIT 1",
    [req.params.id, user.id]
  );
  const existing = exists[0][0];
  const data = parsed.data;

  if (existing) {
    await pool.query(
      `UPDATE evaluations
       SET total = ?, reviewer = ?, writing = ?, logic = ?, share = ?, mechanism = ?, twist = ?, depth = ?, content = ?
       WHERE id = ?`,
      [
        data.total,
        user.nickname,
        data.writing,
        data.logic,
        data.share,
        data.mechanism,
        data.twist,
        data.depth,
        data.content || null,
        existing.id
      ]
    );
    if (data.content?.trim()) {
      await pool.query(
        "INSERT IGNORE INTO evaluation_comment_history (soup_id, reviewer_id, creator_id, is_original) VALUES (?, ?, ?, ?)",
        [req.params.id, user.id, soup.creator_id, Boolean(soup.is_original)]
      );
    }
    queueSystemBadgeSync([user.id, String(soup.creator_id)]);
    return res.json({ id: existing.id });
  }

  const id = nanoid();
  await pool.query(
    `INSERT INTO evaluations
      (id, soup_id, total, reviewer, reviewer_id, writing, logic, share, mechanism, twist, depth, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.params.id,
      data.total,
      user.nickname,
      user.id,
      data.writing,
      data.logic,
      data.share,
      data.mechanism,
      data.twist,
      data.depth,
      data.content || null
    ]
  );
  if (data.content?.trim()) {
    await pool.query(
      "INSERT IGNORE INTO evaluation_comment_history (soup_id, reviewer_id, creator_id, is_original) VALUES (?, ?, ?, ?)",
      [req.params.id, user.id, soup.creator_id, Boolean(soup.is_original)]
    );
  }
  if (String(soup.creator_id) !== user.id) {
    await notify(
      String(soup.creator_id),
      "soup_evaluation",
      "收到新的评价",
      `${user.nickname} 评价了你的海龟汤《${soup.title}》，评分 ${data.total} 分`,
      req.params.id,
      user.id
    );
  }
  queueSystemBadgeSync([user.id, String(soup.creator_id)]);
  res.status(201).json({ id });
});

app.delete("/api/evaluations/:id", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM evaluations WHERE id = ? LIMIT 1", [
    req.params.id
  ]);
  const evaluation = rows[0];
  if (!evaluation) return sendError(res, 404, "评价不存在");
  if (user.role !== "admin" && user.id !== evaluation.reviewer_id) return sendError(res, 403, "没有删除权限");
  await pool.query("DELETE FROM evaluations WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/soups/:id/access-requests", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (String(soup.review_status ?? "approved") !== "approved") return sendError(res, 409, "审核中的海龟汤暂不可申请查看");
  if (!canSeeSoupSurface(soup, user)) return sendError(res, 403, "不能申请未公开汤面");
  if (await canViewFull(soup, user)) return sendError(res, 409, "已经拥有查看权限");

  const [pending] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM view_requests WHERE soup_id = ? AND requester_id = ? AND status = 'pending' LIMIT 1",
    [req.params.id, user.id]
  );
  if (pending.length) return sendError(res, 409, "已有待处理申请");

  const id = nanoid();
  await pool.query(
    "INSERT INTO view_requests (id, soup_id, requester_id, requester_name, owner_id) VALUES (?, ?, ?, ?, ?)",
    [id, req.params.id, user.id, user.nickname, soup.creator_id]
  );

  const recipients = new Set([soup.creator_id, ...(await adminIds())]);
  await Promise.all(
    [...recipients].map((recipient) =>
      notify(recipient, "view_request", "新的查看申请", `${user.nickname} 申请查看《${soup.title}》的汤底和主持人手册`, id)
    )
  );
  for (const recipient of recipients) {
    emitUserEvent(String(recipient), "view_request", {
      requestId: id,
      soupId: req.params.id,
      soupTitle: String(soup.title),
      requesterId: user.id,
      requesterName: user.nickname,
      requesterAvatar: user.avatar
    });
  }
  res.status(201).json({ id });
});

app.get("/api/access-requests", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const params: unknown[] = [];
  let where = "";
  if (user.role !== "admin") {
    where = "WHERE vr.owner_id = ?";
    params.push(user.id);
  }
  const requestedLimit = Number(req.query.limit);
  const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : null;
  const requestedOffset = Number(req.query.offset ?? 0);
  const offset = Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT vr.*, s.title AS soup_title
    FROM view_requests vr
    JOIN soups s ON s.id = vr.soup_id
    ${where}
    ORDER BY vr.created_at DESC
    ${limit ? "LIMIT ? OFFSET ?" : ""}
    `,
    limit ? [...params, limit, offset] : params
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM view_requests vr ${where}`,
    params
  );
  res.json({
    total: Number(totalRow.total ?? 0),
    requests: rows.map((row) => ({
      id: row.id,
      applicationType: "申请汤底",
      soupId: row.soup_id,
      soupTitle: row.soup_title,
      requesterId: row.requester_id,
      requesterName: row.requester_name,
      ownerId: row.owner_id,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      handledAt: row.handled_at ? new Date(row.handled_at).toISOString() : null,
      handledBy: row.handled_by
    }))
  });
});

app.post("/api/access-requests/:id/decision", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "审批结果不正确");

  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM view_requests WHERE id = ? LIMIT 1", [
    req.params.id
  ]);
  const request = rows[0];
  if (!request) return sendError(res, 404, "申请不存在");
  if (request.status !== "pending") return sendError(res, 409, "申请已处理");
  if (user.role !== "admin" && user.id !== request.owner_id) return sendError(res, 403, "没有审批权限");

  await pool.query(
    "UPDATE view_requests SET status = ?, handled_at = NOW(), handled_by = ? WHERE id = ?",
    [parsed.data.decision, user.id, req.params.id]
  );
  if (parsed.data.decision === "approved") {
    await pool.query(
      "INSERT IGNORE INTO soup_access_grants (id, soup_id, user_id, granted_by) VALUES (?, ?, ?, ?)",
      [nanoid(), request.soup_id, request.requester_id, user.id]
    );
  }

  await notify(
    request.requester_id,
    "view_request_result",
    parsed.data.decision === "approved" ? "查看申请已通过" : "查看申请已拒绝",
    `你对该海龟汤完整内容的查看申请已${parsed.data.decision === "approved" ? "通过" : "拒绝"}`,
    request.soup_id
  );
  const requestRecipients = new Set([String(request.owner_id), ...(await adminIds())]);
  for (const recipient of requestRecipients) emitUnreadChanged(recipient, "view_request_decision");
  res.json({ ok: true });
});

app.get("/api/admin/excellent-author-applications", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const requestedLimit = Number(req.query.limit);
  const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : 10;
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id FROM excellent_author_applications
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM excellent_author_applications");
  const applications = (await Promise.all(rows.map((row) => getExcellentAuthorApplicationDetail(String(row.id)))))
    .filter((item) => item !== null)
    .map((item) => ({
      id: item.id,
      applicationType: item.applicationType,
      applicantId: item.applicantId,
      applicantName: item.applicantName,
      primarySoupId: item.primarySoup?.id ?? null,
      primarySoupTitle: item.primarySoup?.title ?? "海龟汤已删除",
      heatValue: item.primarySoup?.heatValue ?? 0,
      averageTotal: item.primarySoup?.averageTotal ?? null,
      status: item.status,
      createdAt: item.createdAt,
      handledAt: item.handledAt,
      handledBy: item.handledBy
    }));
  res.json({ applications, total: Number(totalRow.total ?? 0) });
});

app.get("/api/admin/excellent-author-applications/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const application = await getExcellentAuthorApplicationDetail(req.params.id);
  if (!application) return sendError(res, 404, "优秀作者认证申请不存在");
  res.json({ application });
});

app.post("/api/admin/excellent-author-applications/:id/decision", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "审批结果不正确");
  const application = await getExcellentAuthorApplicationDetail(req.params.id);
  if (!application) return sendError(res, 404, "优秀作者认证申请不存在");
  if (application.status !== "pending") return sendError(res, 409, "申请已处理");

  if (parsed.data.decision === "approved") {
    const currentSoups = await getCreatorCertificationSoups(application.applicantId);
    const currentById = new Map(currentSoups.map((soup) => [soup.id, soup]));
    const qualificationIds = application.qualificationSoups.map((soup) => soup.id);
    const qualificationsStillValid = qualificationIds.length === 5 && qualificationIds.every((id) => {
      const soup = currentById.get(id);
      return soup ? isQualificationSoup(soup) : false;
    });
    const primarySoup = application.primarySoup ? currentById.get(application.primarySoup.id) : null;
    if (!qualificationsStillValid || !primarySoup || !qualificationIds.includes(primarySoup.id) || !isPrimaryCertificationSoup(primarySoup)) {
      return sendError(res, 409, "申请作品当前已不满足优秀作者认证条件，无法通过");
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [updated] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE excellent_author_applications
       SET status = ?, handled_at = NOW(), handled_by = ?
       WHERE id = ? AND status = 'pending'`,
      [parsed.data.decision, admin.id, req.params.id]
    );
    if (updated.affectedRows !== 1) {
      await connection.rollback();
      return sendError(res, 409, "申请已处理");
    }
    if (parsed.data.decision === "approved") {
      await connection.query(
        "INSERT IGNORE INTO user_badge_unlocks (user_id, badge_key, surfaced_at) VALUES (?, 'excellentAuthor:epic', NULL)",
        [application.applicantId]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await notify(
    application.applicantId,
    "excellent_author_result",
    parsed.data.decision === "approved" ? "优秀作者认证已通过" : "优秀作者认证未通过",
    parsed.data.decision === "approved" ? "恭喜你通过优秀作者认证，已获得优秀作者徽章" : "你的优秀作者认证申请已被驳回，可调整作品后重新申请",
    application.id,
    admin.id
  );
  res.json({ ok: true });
});

app.get("/api/notifications", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT n.*,
      CASE
           WHEN n.type = 'badge_unlock' THEN NULL
           WHEN n.type = 'view_request' OR n.type = 'view_request_result' THEN vr.soup_id
           ELSE n.related_id
       END AS soup_id
     FROM notifications n
     LEFT JOIN view_requests vr ON n.type IN ('view_request','view_request_result') AND n.related_id = vr.id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC
     LIMIT 50`,
    [user.id]
  );
  res.json({
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      relatedId: row.soup_id,
      link: row.type === "badge_unlock"
        ? "/mine/achievements"
        : row.type === "user_follow" && row.actor_id
          ? `/users/${row.actor_id}`
        : row.type === "excellent_author_result"
          ? "/mine/excellent-author"
          : row.type === "excellent_author_application"
            ? "/admin"
          : row.soup_id ? `/soup/${row.soup_id}` : null,
      isRead: bool(row.is_read),
      createdAt: new Date(row.created_at).toISOString()
    }))
  });
});

app.patch("/api/notifications/read-all", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE", [user.id]);
  emitUnreadChanged(user.id, "notifications_read");
  res.json({ ok: true });
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?", [req.params.id, user.id]);
  emitUnreadChanged(user.id, "notification_read");
  res.json({ ok: true });
});

app.get("/api/notices", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 50));
  const requestedOffset = Number(req.query.offset ?? 0);
  const offset = Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT n.id, n.title, n.author, n.published_at, n.updated_at, n.expires_at, n.valid_duration_minutes,
       EXISTS (
         SELECT 1 FROM admin_notice_reads nr
         WHERE nr.notice_id = n.id AND nr.user_id = ?
       ) AS is_read
     FROM admin_notices n
     WHERE n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP
     ORDER BY n.published_at DESC, n.id DESC
     LIMIT ? OFFSET ?`,
    [user.id, limit, offset]
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM admin_notices WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP"
  );
  res.json({
    total: Number(totalRow.total ?? 0),
    notices: rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      author: String(row.author),
      publishedAt: new Date(row.published_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      isRead: bool(row.is_read)
    }))
  });
});

app.get("/api/notices/:id", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, title, author, content, published_at, updated_at, expires_at, valid_duration_minutes
     FROM admin_notices
     WHERE id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     LIMIT 1`,
    [req.params.id]
  );
  if (!rows[0]) return sendError(res, 404, "通知不存在");
  const [noticeReadResult] = await pool.query<mysql.ResultSetHeader>(
    "INSERT IGNORE INTO admin_notice_reads (notice_id, user_id) VALUES (?, ?)",
    [req.params.id, user.id]
  );
  if (noticeReadResult.affectedRows > 0) emitUnreadChanged(user.id, "notice_read");
  res.json({ notice: { ...noticePayload(rows[0]), isRead: true } });
});

const DASHBOARD_DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const dashboardRanges = { "7d": 7, "15d": 15, "30d": 30, "90d": 90 } as const;
type DashboardRange = keyof typeof dashboardRanges;

type DashboardGrowthMetric = {
  total: number;
  today: { current: number; previous: number; changePercent: number | null };
  week: { current: number; previous: number; changePercent: number | null };
};

const dashboardCache = new Map<DashboardRange, { expiresAt: number; payload: unknown }>();

function startOfChinaDay(date: Date): Date {
  const shifted = new Date(date.getTime() + DASHBOARD_CHINA_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - DASHBOARD_CHINA_OFFSET_MS);
}

function startOfChinaWeek(date: Date): Date {
  const dayStart = startOfChinaDay(date);
  const shifted = new Date(dayStart.getTime() + DASHBOARD_CHINA_OFFSET_MS);
  const day = shifted.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return new Date(dayStart.getTime() - daysSinceMonday * DASHBOARD_DAY_MS);
}

function chinaDateKey(date: Date): string {
  return new Date(date.getTime() + DASHBOARD_CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

function dashboardChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function loadDashboardMetric(
  table: "users" | "soups" | "evaluations",
  now: Date,
  todayStart: Date,
  weekStart: Date
): Promise<DashboardGrowthMetric> {
  const todayElapsed = now.getTime() - todayStart.getTime();
  const yesterdayStart = new Date(todayStart.getTime() - DASHBOARD_DAY_MS);
  const yesterdaySameTime = new Date(yesterdayStart.getTime() + todayElapsed);
  const weekElapsed = now.getTime() - weekStart.getTime();
  const previousWeekStart = new Date(weekStart.getTime() - 7 * DASHBOARD_DAY_MS);
  const previousWeekSameTime = new Date(previousWeekStart.getTime() + weekElapsed);
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
      COUNT(*) AS total,
      COALESCE(SUM(created_at >= ? AND created_at < ?), 0) AS today_count,
      COALESCE(SUM(created_at >= ? AND created_at < ?), 0) AS yesterday_count,
      COALESCE(SUM(created_at >= ? AND created_at < ?), 0) AS week_count,
      COALESCE(SUM(created_at >= ? AND created_at < ?), 0) AS previous_week_count
     FROM ${table}`,
    [todayStart, now, yesterdayStart, yesterdaySameTime, weekStart, now, previousWeekStart, previousWeekSameTime]
  );
  const today = Number(row.today_count ?? 0);
  const yesterday = Number(row.yesterday_count ?? 0);
  const week = Number(row.week_count ?? 0);
  const previousWeek = Number(row.previous_week_count ?? 0);
  return {
    total: Number(row.total ?? 0),
    today: { current: today, previous: yesterday, changePercent: dashboardChange(today, yesterday) },
    week: { current: week, previous: previousWeek, changePercent: dashboardChange(week, previousWeek) }
  };
}

app.get("/api/admin/dashboard", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const parsedRange = z.enum(["7d", "15d", "30d", "90d"]).safeParse(req.query.range ?? "30d");
  if (!parsedRange.success) return sendError(res, 400, "统计时间范围不正确");
  const range = parsedRange.data as DashboardRange;
  const cached = dashboardCache.get(range);
  if (req.query.refresh !== "1" && cached && cached.expiresAt > Date.now()) return res.json(cached.payload);

  const now = new Date();
  const todayStart = startOfChinaDay(now);
  const weekStart = startOfChinaWeek(now);
  const rangeDays = dashboardRanges[range];
  const rangeStart = new Date(todayStart.getTime() - (rangeDays - 1) * DASHBOARD_DAY_MS);
  const rangeStartKey = chinaDateKey(rangeStart);
  const todayKey = chinaDateKey(now);
  const last7StartKey = chinaDateKey(new Date(todayStart.getTime() - 6 * DASHBOARD_DAY_MS));

  const [
    userMetric,
    soupMetric,
    evaluationMetric,
    [trendRows],
    [activityRows],
    [activityDailyRows],
    [typeRows],
    [soupStateRows],
    [topSoupRows],
    [evaluationRows]
  ] = await Promise.all([
    loadDashboardMetric("users", now, todayStart, weekStart),
    loadDashboardMetric("soups", now, todayStart, weekStart),
    loadDashboardMetric("evaluations", now, todayStart, weekStart),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT day_key,
        SUM(user_count) AS user_count,
        SUM(soup_count) AS soup_count,
        SUM(evaluation_count) AS evaluation_count
       FROM (
         SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL 8 HOUR), '%Y-%m-%d') AS day_key, COUNT(*) AS user_count, 0 AS soup_count, 0 AS evaluation_count
         FROM users WHERE created_at >= ? AND created_at < ? GROUP BY day_key
         UNION ALL
         SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL 8 HOUR), '%Y-%m-%d') AS day_key, 0, COUNT(*), 0
         FROM soups WHERE created_at >= ? AND created_at < ? GROUP BY day_key
         UNION ALL
         SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL 8 HOUR), '%Y-%m-%d') AS day_key, 0, 0, COUNT(*)
         FROM evaluations WHERE created_at >= ? AND created_at < ? GROUP BY day_key
       ) daily
       GROUP BY day_key ORDER BY day_key`,
      [rangeStart, now, rangeStart, now, rangeStart, now]
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
        COUNT(DISTINCT CASE WHEN login_date = ? THEN user_id END) AS today_active,
        COUNT(DISTINCT CASE WHEN login_date >= ? AND login_date <= ? THEN user_id END) AS last7_active
       FROM user_login_days`,
      [todayKey, last7StartKey, todayKey]
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT DATE_FORMAT(login_date, '%Y-%m-%d') AS day_key, COUNT(DISTINCT user_id) AS active_count
       FROM user_login_days WHERE login_date >= ? AND login_date <= ?
       GROUP BY login_date ORDER BY login_date`,
      [rangeStartKey, todayKey]
    ),
    pool.query<mysql.RowDataPacket[]>(
      "SELECT type AS name, COUNT(*) AS count FROM soups GROUP BY type ORDER BY count DESC, type ASC"
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(is_original = TRUE), 0) AS original_count,
        COALESCE(SUM(is_original = FALSE), 0) AS non_original_count,
        COALESCE(SUM(is_surface_public = TRUE), 0) AS public_surface_count,
        COALESCE(SUM(is_bottom_public = TRUE), 0) AS public_bottom_count,
        COALESCE(SUM(enable_ai_game = TRUE), 0) AS ai_enabled_count,
        COALESCE(SUM(is_sensitive = TRUE), 0) AS sensitive_count
       FROM soups`
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT s.id, s.title, s.view_count,
        COALESCE(e.evaluation_count, 0) AS evaluation_count,
        COALESCE(e.comprehensive_score, 0) AS comprehensive_score,
        COALESCE(l.like_count, 0) AS like_count,
        COALESCE(f.favorite_count, 0) AS favorite_count,
        (COALESCE(e.comprehensive_score, 0) + 1) *
          (s.view_count + (COALESCE(l.like_count, 0) + 1) * 15 + (COALESCE(f.favorite_count, 0) + 1) * 20 + (COALESCE(e.evaluation_count, 0) + 1) * 25) - 61 AS heat_value
       FROM soups s
       LEFT JOIN (SELECT soup_id, COUNT(*) AS evaluation_count, AVG(total) AS comprehensive_score FROM evaluations GROUP BY soup_id) e ON e.soup_id = s.id
       LEFT JOIN (SELECT soup_id, COUNT(*) AS like_count FROM soup_likes GROUP BY soup_id) l ON l.soup_id = s.id
       LEFT JOIN (SELECT soup_id, COUNT(*) AS favorite_count FROM soup_favorites GROUP BY soup_id) f ON f.soup_id = s.id
       ORDER BY heat_value DESC, s.view_count DESC, evaluation_count DESC
       LIMIT 10`
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
        AVG(total) AS average_total,
        AVG(CASE WHEN content IS NOT NULL AND TRIM(content) <> '' THEN 1 ELSE 0 END) AS with_content_rate,
        COALESCE(SUM(total < 2), 0) AS score_1_2,
        COALESCE(SUM(total >= 2 AND total < 3), 0) AS score_2_3,
        COALESCE(SUM(total >= 3 AND total < 4), 0) AS score_3_4,
        COALESCE(SUM(total >= 4), 0) AS score_4_5,
        AVG(writing) AS writing, AVG(logic) AS logic, AVG(share) AS share,
        AVG(mechanism) AS mechanism, AVG(twist) AS twist, AVG(depth) AS depth
       FROM evaluations`
    )
  ]);

  const trendByDate = new Map(trendRows.map((row) => [String(row.day_key), row]));
  const activityByDate = new Map(activityDailyRows.map((row) => [String(row.day_key), Number(row.active_count ?? 0)]));
  const trend = Array.from({ length: rangeDays }, (_, index) => {
    const date = chinaDateKey(new Date(rangeStart.getTime() + index * DASHBOARD_DAY_MS));
    const row = trendByDate.get(date);
    return {
      date,
      users: Number(row?.user_count ?? 0),
      soups: Number(row?.soup_count ?? 0),
      evaluations: Number(row?.evaluation_count ?? 0)
    };
  });
  const activityDaily = trend.map(({ date }) => ({ date, users: activityByDate.get(date) ?? 0 }));
  const activity = activityRows[0] ?? {};
  const soupState = soupStateRows[0] ?? {};
  const evaluation = evaluationRows[0] ?? {};
  const payload = {
    generatedAt: now.toISOString(),
    timezone: "Asia/Shanghai" as const,
    range,
    summary: { users: userMetric, soups: soupMetric, evaluations: evaluationMetric },
    trend,
    userActivity: {
      today: Number(activity.today_active ?? 0),
      last7Days: Number(activity.last7_active ?? 0),
      todayRate: userMetric.total > 0 ? Number((Number(activity.today_active ?? 0) / userMetric.total * 100).toFixed(1)) : null,
      daily: activityDaily
    },
    soups: {
      byType: typeRows.map((row) => ({ name: String(row.name || "未分类"), count: Number(row.count ?? 0) })),
      original: Number(soupState.original_count ?? 0),
      nonOriginal: Number(soupState.non_original_count ?? 0),
      publicSurface: Number(soupState.public_surface_count ?? 0),
      publicBottom: Number(soupState.public_bottom_count ?? 0),
      aiEnabled: Number(soupState.ai_enabled_count ?? 0),
      sensitive: Number(soupState.sensitive_count ?? 0),
      top: topSoupRows.map((row) => ({
        id: String(row.id), title: String(row.title), views: Number(row.view_count ?? 0),
        evaluations: Number(row.evaluation_count ?? 0),
        comprehensiveScore: Number(Number(row.comprehensive_score ?? 0).toFixed(1)),
        likes: Number(row.like_count ?? 0), favorites: Number(row.favorite_count ?? 0),
        heatValue: Number(Number(row.heat_value ?? 0).toFixed(1))
      }))
    },
    evaluations: {
      averageTotal: evaluation.average_total == null ? null : Number(Number(evaluation.average_total).toFixed(1)),
      withContentRate: evaluation.with_content_rate == null ? null : Number((Number(evaluation.with_content_rate) * 100).toFixed(1)),
      scoreBuckets: [
        { label: "1–2", count: Number(evaluation.score_1_2 ?? 0) },
        { label: "2–3", count: Number(evaluation.score_2_3 ?? 0) },
        { label: "3–4", count: Number(evaluation.score_3_4 ?? 0) },
        { label: "4–5", count: Number(evaluation.score_4_5 ?? 0) }
      ],
      dimensions: {
        writing: evaluation.writing == null ? null : Number(Number(evaluation.writing).toFixed(1)),
        logic: evaluation.logic == null ? null : Number(Number(evaluation.logic).toFixed(1)),
        share: evaluation.share == null ? null : Number(Number(evaluation.share).toFixed(1)),
        mechanism: evaluation.mechanism == null ? null : Number(Number(evaluation.mechanism).toFixed(1)),
        twist: evaluation.twist == null ? null : Number(Number(evaluation.twist).toFixed(1)),
        depth: evaluation.depth == null ? null : Number(Number(evaluation.depth).toFixed(1))
      }
    }
  };
  dashboardCache.set(range, { expiresAt: Date.now() + 45_000, payload });
  res.json(payload);
});

app.get("/api/admin/badges", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT lb.id, lb.name, lb.description, lb.requirement, lb.icon_url, lb.achievement_points,
      lb.badge_type, lb.tier, lb.activity_conditions,
      COUNT(ubu.user_id) AS owner_count
     FROM legendary_badges lb
     LEFT JOIN user_badge_unlocks ubu ON ubu.badge_key = CONCAT('legendary:', lb.id)
     GROUP BY lb.id
     ORDER BY lb.created_at ASC`
  );
  res.json({
    badges: rows.map((row) => ({
      id: String(row.id),
      key: `legendary:${row.id}`,
      name: String(row.name),
      description: String(row.description),
      requirement: row.requirement ? String(row.requirement) : null,
      iconUrl: String(row.icon_url),
      achievementPoints: Number(row.achievement_points ?? 0),
      badgeType: String(row.badge_type ?? "limited"),
      activityConditions: badgeActivityConditions(row.activity_conditions),
      tier: specialBadgeTier(row.tier),
      ownerCount: Number(row.owner_count ?? 0)
    }))
  });
});

app.get("/api/admin/badges/users", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const keyword = req.query.keyword ? String(req.query.keyword).trim() : "";
  const requestedLimit = Number(req.query.limit ?? 10);
  const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : 10;
  const rawOffset = Number(req.query.offset ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const where = keyword ? "WHERE u.nickname LIKE ? OR u.username LIKE ?" : "";
  const params = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT u.id, u.username, u.nickname, u.avatar,
      COUNT(ubu.badge_key) AS badge_count,
      COALESCE(SUM(ubu.badge_key LIKE '%:normal'), 0) AS normal_count,
      COALESCE(SUM(ubu.badge_key LIKE '%:rare'), 0) AS rare_count,
      COALESCE(SUM(ubu.badge_key LIKE '%:epic' OR lb.tier = 'epic'), 0) AS epic_count,
      COALESCE(SUM(ubu.badge_key LIKE '%:legend' OR lb.tier = 'legend'), 0) AS legend_count
     FROM users u
     LEFT JOIN user_badge_unlocks ubu ON ubu.user_id = u.id
     LEFT JOIN legendary_badges lb ON ubu.badge_key = CONCAT('legendary:', lb.id)
     ${where}
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
  res.json({
    total: Number(totalRow.total ?? 0),
    users: rows.map((row) => ({
      id: String(row.id), username: String(row.username), nickname: String(row.nickname),
      avatar: avatarUrl(row.id, row.avatar),
      badgeCount: Number(row.badge_count ?? 0),
      normalCount: Number(row.normal_count ?? 0), rareCount: Number(row.rare_count ?? 0),
      epicCount: Number(row.epic_count ?? 0), legendCount: Number(row.legend_count ?? 0)
    }))
  });
});

app.get("/api/admin/badges/users/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const [userRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, username, nickname, avatar FROM users WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  if (userRows.length === 0) return sendError(res, 404, "用户不存在");
  const [badgeRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badge_key FROM user_badge_unlocks WHERE user_id = ? ORDER BY unlocked_at DESC",
    [req.params.id]
  );
  const row = userRows[0];
  res.json({
    user: { id: String(row.id), username: String(row.username), nickname: String(row.nickname), avatar: avatarUrl(row.id, row.avatar) },
    badgeKeys: badgeRows.map((badge) => String(badge.badge_key))
  });
});

app.patch("/api/admin/badges/:id/activity-conditions", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const parsed = z.object({ conditions: activityConditionsSchema }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "活动条件不正确");
  const [[badge]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, badge_type FROM legendary_badges WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  if (!badge) return sendError(res, 404, "徽章不存在");
  if (String(badge.badge_type) !== "activity") return sendError(res, 403, "只有活动徽章可以设置发放条件");
  await pool.query(
    "UPDATE legendary_badges SET activity_conditions = ? WHERE id = ?",
    [parsed.data.conditions.length > 0 ? JSON.stringify(parsed.data.conditions) : null, req.params.id]
  );
  if (parsed.data.conditions.length > 0) {
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE role = 'user'");
    queueActivityBadgeSync(users.map((user) => String(user.id)));
  }
  res.json({ ok: true, conditions: parsed.data.conditions });
});

app.get("/api/admin/badges/:id/owners", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const [badgeRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id, name FROM legendary_badges WHERE id = ? LIMIT 1", [req.params.id]);
  if (badgeRows.length === 0) return sendError(res, 404, "传说徽章不存在");
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT u.id, u.username, u.nickname, u.avatar
     FROM user_badge_unlocks ubu
     INNER JOIN users u ON u.id = ubu.user_id
     WHERE ubu.badge_key = ?
     ORDER BY ubu.unlocked_at DESC`,
    [`legendary:${req.params.id}`]
  );
  res.json({
    badge: { id: String(badgeRows[0].id), name: String(badgeRows[0].name) },
    users: rows.map((row) => ({ id: String(row.id), username: String(row.username), nickname: String(row.nickname), avatar: avatarUrl(row.id, row.avatar) }))
  });
});

app.post("/api/admin/badges/users/:userId/legendary/:badgeId", async (req, res) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const [[target]] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id = ? LIMIT 1", [req.params.userId]);
  if (!target) return sendError(res, 404, "用户不存在");
  const [[badge]] = await pool.query<mysql.RowDataPacket[]>("SELECT id, name, badge_type FROM legendary_badges WHERE id = ? LIMIT 1", [req.params.badgeId]);
  if (!badge) return sendError(res, 404, "传说徽章不存在");
  if (String(badge.badge_type) !== "limited") return sendError(res, 403, "只有限定徽章支持管理员直接发放");
  const key = `legendary:${badge.id}`;
  const [result] = await pool.query<mysql.ResultSetHeader>(
    "INSERT IGNORE INTO user_badge_unlocks (user_id, badge_key, surfaced_at) VALUES (?, ?, NULL)",
    [req.params.userId, key]
  );
  if (result.affectedRows > 0) {
    await notify(req.params.userId, "badge_unlock", "获得传说徽章", `恭喜你获得传说徽章「${badge.name}」`, key, actor.id);
  }
  res.status(result.affectedRows > 0 ? 201 : 200).json({ ok: true, granted: result.affectedRows > 0 });
});

app.delete("/api/admin/badges/users/:userId/legendary/:badgeId", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const [result] = await pool.query<mysql.ResultSetHeader>(
    "DELETE FROM user_badge_unlocks WHERE user_id = ? AND badge_key = ?",
    [req.params.userId, `legendary:${req.params.badgeId}`]
  );
  if (result.affectedRows === 0) return sendError(res, 404, "该用户未拥有此传说徽章");
  await pool.query(
    "UPDATE users SET equipped_badge_key = NULL, equipped_badge_icon_url = NULL WHERE id = ? AND equipped_badge_key = ?",
    [req.params.userId, `legendary:${req.params.badgeId}`]
  );
  res.json({ ok: true });
});

app.get("/api/admin/notices", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const keyword = req.query.keyword ? String(req.query.keyword).trim().slice(0, 200) : "";
  const requestedLimit = Number(req.query.limit ?? 10);
  const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : 10;
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const where = keyword ? "WHERE (n.title LIKE ? OR n.author LIKE ?)" : "";
  const params = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT n.id, n.title, n.author, n.published_at, n.updated_at, n.expires_at, n.valid_duration_minutes,
       (SELECT COUNT(*) FROM admin_notice_reads nr WHERE nr.notice_id = n.id) AS read_count
     FROM admin_notices n
     ${where}
     ORDER BY n.published_at DESC, n.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM admin_notices n ${where}`,
    params
  );
  res.json({ notices: rows.map(noticePayload), total: Number(totalRow.total ?? 0) });
});

app.post("/api/admin/notices", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const parsed = adminNoticeSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "通知内容不正确");
  const id = nanoid();
  const validDurationMinutes = parsed.data.validDays * 1440 + parsed.data.validHours * 60;
  await pool.query(
    `INSERT INTO admin_notices
       (id, title, author, content, created_by, valid_duration_minutes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))`,
    [id, parsed.data.title, parsed.data.author, parsed.data.content, admin.id, validDurationMinutes, validDurationMinutes]
  );
  await broadcastUnreadChanged("notice_created");
  res.status(201).json({ id });
});

app.post("/api/admin/notices/bulk-delete", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const parsed = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "请选择要删除的通知");
  const ids = [...new Set(parsed.data.ids)];
  const placeholders = ids.map(() => "?").join(",");
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `DELETE FROM admin_notices WHERE id IN (${placeholders})`,
    ids
  );
  if (result.affectedRows > 0) await broadcastUnreadChanged("notice_deleted");
  res.json({ ok: true, deleted: result.affectedRows });
});

app.get("/api/admin/notices/:id/readers", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const [noticeRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, title FROM admin_notices WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  if (!noticeRows[0]) return sendError(res, 404, "通知不存在");
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT u.id, u.nickname, u.username, nr.read_at
     FROM admin_notice_reads nr
     INNER JOIN users u ON u.id = nr.user_id
     WHERE nr.notice_id = ?
     ORDER BY nr.read_at DESC`,
    [req.params.id]
  );
  res.json({
    title: String(noticeRows[0].title),
    readers: rows.map((row) => ({
      id: String(row.id),
      nickname: String(row.nickname),
      username: String(row.username),
      readAt: new Date(row.read_at).toISOString()
    }))
  });
});

app.get("/api/admin/notices/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT n.*,
       (SELECT COUNT(*) FROM admin_notice_reads nr WHERE nr.notice_id = n.id) AS read_count
     FROM admin_notices n WHERE n.id = ? LIMIT 1`,
    [req.params.id]
  );
  if (!rows[0]) return sendError(res, 404, "通知不存在");
  if (req.query.trackRead !== "false") {
    await pool.query(
      "INSERT IGNORE INTO admin_notice_reads (notice_id, user_id) VALUES (?, ?)",
      [req.params.id, admin.id]
    );
  }
  const [[countRow]] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS read_count FROM admin_notice_reads WHERE notice_id = ?",
    [req.params.id]
  );
  rows[0].read_count = countRow.read_count;
  res.json({ notice: noticePayload(rows[0]) });
});

app.put("/api/admin/notices/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const parsed = adminNoticeSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "通知内容不正确");
  const validDurationMinutes = parsed.data.validDays * 1440 + parsed.data.validHours * 60;
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE admin_notices
     SET title = ?, author = ?, content = ?, valid_duration_minutes = ?,
         expires_at = DATE_ADD(published_at, INTERVAL ? MINUTE)
     WHERE id = ?`,
    [parsed.data.title, parsed.data.author, parsed.data.content, validDurationMinutes, validDurationMinutes, req.params.id]
  );
  if (result.affectedRows === 0) return sendError(res, 404, "通知不存在");
  await broadcastUnreadChanged("notice_updated");
  res.json({ ok: true });
});

app.delete("/api/admin/notices/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const [result] = await pool.query<mysql.ResultSetHeader>(
    "DELETE FROM admin_notices WHERE id = ?",
    [req.params.id]
  );
  if (result.affectedRows === 0) return sendError(res, 404, "通知不存在");
  await broadcastUnreadChanged("notice_deleted");
  res.json({ ok: true });
});

app.get("/api/admin/users", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const keyword = req.query.keyword ? String(req.query.keyword).trim() : "";
  const loggedToday = req.query.loggedToday === "yes" || req.query.loggedToday === "no"
    ? String(req.query.loggedToday)
    : "all";
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    conditions.push("(u.nickname LIKE ? OR u.username LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (loggedToday !== "all") {
    conditions.push(`${loggedToday === "yes" ? "" : "NOT "}EXISTS (
      SELECT 1 FROM user_login_days uld
      WHERE uld.user_id = u.id
        AND uld.login_date = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))
    )`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const requestedLimit = Number(req.query.limit ?? 10);
  const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : 10;
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const sortColumns: Record<string, string> = {
    createdAt: "u.created_at",
    lastLoginAt: "u.last_login_at",
    soupCount: "soup_count",
    evaluationCount: "evaluation_count",
    likeCount: "like_count",
    favoriteCount: "favorite_count"
  };
  const sortColumn = sortColumns[String(req.query.sortBy ?? "createdAt")] ?? sortColumns.createdAt;
  const sortOrder = req.query.sortOrder === "asc" ? "ASC" : "DESC";
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT u.id, u.username, u.nickname, u.avatar, u.role, u.created_at, u.last_login_at,
      EXISTS (
        SELECT 1 FROM user_login_days uld
        WHERE uld.user_id = u.id
          AND uld.login_date = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))
      ) AS logged_in_today,
      (SELECT COUNT(*) FROM soups WHERE creator_id = u.id) AS soup_count,
      (SELECT COUNT(*) FROM evaluations WHERE reviewer_id = u.id) AS evaluation_count,
      (SELECT COUNT(*) FROM soup_likes WHERE user_id = u.id) AS like_count,
      (SELECT COUNT(*) FROM soup_favorites WHERE user_id = u.id) AS favorite_count
     FROM users u
     ${where}
     ORDER BY ${sortColumn} ${sortOrder}, u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
  res.json({
    total: Number(totalRow.total ?? 0),
    users: rows.map((row) => ({
      ...toUser(row),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      loggedInToday: Boolean(row.logged_in_today),
      stats: {
        soupCount: Number(row.soup_count ?? 0),
        evaluationCount: Number(row.evaluation_count ?? 0),
        likeCount: Number(row.like_count ?? 0),
        favoriteCount: Number(row.favorite_count ?? 0)
      }
    }))
  });
});

app.patch("/api/admin/users/:id", async (req, res) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const parsed = z.object({ nickname: text.max(50), role: z.enum(["admin", "user"]) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "用户信息不正确");
  if (parsed.data.role === "user" && isAdminRelatedNickname(parsed.data.nickname)) {
    return sendError(res, 400, "普通用户不能使用管理员相关昵称");
  }
  if (actor.id === req.params.id && parsed.data.role !== "admin") return sendError(res, 400, "不能取消自己的管理员权限");
  const [targetRows] = await pool.query<mysql.RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [req.params.id]);
  if (!targetRows[0]) return sendError(res, 404, "用户不存在");
  const tokenVersionIncrement = targetRows[0].role === parsed.data.role ? 0 : 1;
  await pool.query("UPDATE users SET nickname = ?, role = ?, token_version = token_version + ? WHERE id = ?", [
    parsed.data.nickname,
    parsed.data.role,
    tokenVersionIncrement,
    req.params.id
  ]);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (user.id === req.params.id) return sendError(res, 400, "不能删除自己");
  await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/reset-password", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const parsed = z.object({ newPassword: z.string().min(6, "新密码至少 6 位").max(72) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "密码格式不正确");
  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await pool.query("UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?", [hash, req.params.id]);
  res.json({ ok: true });
});

app.get("/api/admin/evaluations", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const offset = Number(req.query.offset ?? 0);
  const keyword = req.query.keyword ? String(req.query.keyword).trim() : "";

  const where = keyword
    ? "WHERE (e.reviewer LIKE ? OR e.content LIKE ? OR s.title LIKE ?)"
    : "";
  const searchParams = keyword ? [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`] : [];

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT e.*, s.title AS soup_title
    FROM evaluations e
    JOIN soups s ON e.soup_id = s.id
    ${where}
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
    `,
    [...searchParams, limit + 1, offset]
  );
  const [[totalRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM evaluations e JOIN soups s ON e.soup_id = s.id ${where}`,
    searchParams
  );

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  res.json({
    evaluations: rows.map(mapEvaluation),
    total: Number(totalRow.total),
    hasMore
  });
});

// ---------- AI 游戏路由 ----------
app.use("/api/game", async (req, _res, next) => {
  (req as any).user = await currentUser(req);
  next();
}, gameRouter);

// ---------- 多人在线玩汤路由（独立于 AI 玩汤） ----------
app.use("/api/online-soup", async (req, _res, next) => {
  (req as any).user = await currentUser(req);
  next();
}, onlineSoupRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((err as { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ error: "请求内容不是有效的 JSON" });
  }
  console.error(err);
  res.status(500).json({ error: "服务暂时不可用" });
});

if (config.runDatabaseMigrations) await initDatabase();
else await pool.query("SELECT 1");
await cleanupOnlineSoupStaleSeats();
const onlineSoupSeatCleanupTimer = setInterval(() => {
  cleanupOnlineSoupStaleSeats().catch((error) => console.error("Online soup stale seat cleanup failed:", error));
}, 60_000);
onlineSoupSeatCleanupTimer.unref();
await refreshEquippedSpecialBadgeMetadata();
await refreshBadgeOwnershipRates();
const badgeOwnershipRefreshTimer = setInterval(() => {
  refreshBadgeOwnershipRates().catch((error) => console.error("Badge ownership rate refresh failed:", error));
}, BADGE_OWNERSHIP_REFRESH_MS);
badgeOwnershipRefreshTimer.unref();
const server = app.listen(config.port, () => {
  console.log(`HGT API listening on http://localhost:${config.port}`);
});

const onlineSoupWebSocketServer = new WebSocketServer({ noServer: true });

function cookieValue(header: string | undefined, name: string) {
  if (!header) return null;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/ws/online-soup-lobby") {
      onlineSoupWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        (webSocket as any).onlineSoupLobby = true;
        onlineSoupWebSocketServer.emit("connection", webSocket, request);
      });
      return;
    }
    if (url.pathname !== "/ws/online-soup") return socket.destroy();
    const roomId = url.searchParams.get("roomId");
    const token = cookieValue(request.headers.cookie, "hgt_token");
    const claims = token ? verifyToken(token) : null;
    if (!roomId || !claims) return socket.destroy();
    const [[user], [members]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>("SELECT id, token_version FROM users WHERE id = ? LIMIT 1", [claims.id]),
      pool.query<mysql.RowDataPacket[]>(
        `SELECT m.user_id, r.host_id FROM online_soup_members m
         JOIN online_soup_rooms r ON r.id = m.room_id
         WHERE m.room_id = ? AND m.user_id = ? AND m.is_active = 1 AND r.status <> 'closed' LIMIT 1`,
        [roomId, claims.id]
      )
    ]);
    if (!user[0] || Number(user[0].token_version ?? 0) !== claims.tokenVersion || !members[0]) return socket.destroy();
    onlineSoupWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      (webSocket as any).onlineSoupUserId = claims.id;
      (webSocket as any).onlineSoupRoomId = roomId;
      (webSocket as any).onlineSoupIsHost = String(members[0].host_id) === String(claims.id);
      onlineSoupWebSocketServer.emit("connection", webSocket, request);
    });
  } catch {
    socket.destroy();
  }
});

onlineSoupWebSocketServer.on("connection", (socket) => {
  if ((socket as any).onlineSoupLobby) {
    onlineSoupLobbySocketClients.add(socket);
    socket.send(JSON.stringify({ event: "connected", payload: { scope: "lobby" } }));
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message?.type === "ping") {
          socket.send(JSON.stringify({ event: "pong", payload: { at: new Date().toISOString() } }));
        }
      } catch { /* Ignore malformed client frames. */ }
    });
    socket.on("close", () => onlineSoupLobbySocketClients.delete(socket));
    return;
  }
  const userId = String((socket as any).onlineSoupUserId);
  const roomId = String((socket as any).onlineSoupRoomId);
  const isHost = Boolean((socket as any).onlineSoupIsHost);
  let lastPresencePersistedAt = Date.now();
  const clients = onlineSoupRoomSocketClients.get(roomId) ?? new Set<WebSocket>();
  clients.add(socket);
  onlineSoupRoomSocketClients.set(roomId, clients);
  socket.send(JSON.stringify({ event: "connected", payload: { roomId } }));
  void pool.query("UPDATE online_soup_members SET last_seen_at = NOW() WHERE room_id = ? AND user_id = ?", [roomId, userId]);
  if (isHost) void pool.query("UPDATE online_soup_rooms SET host_last_seen_at = NOW() WHERE id = ? AND host_id = ?", [roomId, userId]);

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message?.type !== "ping") return;
      socket.send(JSON.stringify({ event: "pong", payload: { at: new Date().toISOString() } }));
      if (Date.now() - lastPresencePersistedAt < 60_000) return;
      lastPresencePersistedAt = Date.now();
      void pool.query("UPDATE online_soup_members SET last_seen_at = NOW() WHERE room_id = ? AND user_id = ?", [roomId, userId]);
      if (isHost) void pool.query("UPDATE online_soup_rooms SET host_last_seen_at = NOW() WHERE id = ? AND host_id = ?", [roomId, userId]);
    } catch { /* Ignore malformed client frames. */ }
  });
  socket.on("close", () => {
    clients.delete(socket);
    if (clients.size === 0) onlineSoupRoomSocketClients.delete(roomId);
  });
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} already in use, please close the other process first.`);
    process.exit(1);
  } else {
    throw error;
  }
});
