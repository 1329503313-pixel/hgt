import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
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
import gameRouter, { splitKeyFactsForSoup, forceReanalyzeKeyFacts } from "./game.js";
import { PublicUser } from "./types.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (config.nodeEnv === "production") {
    console.error("FATAL: JWT_SECRET 环境变量未设置，服务拒绝启动。请设置一个随机长字符串。");
    process.exit(1);
  }
  console.warn("⚠ 未设置 JWT_SECRET，使用开发 fallback。生产环境请务必设置 JWT_SECRET。");
}

const JWT_SECRET_FINAL: string = JWT_SECRET || "dev-jwt-fallback-not-for-production";

const app = express();
app.set("trust proxy", 1);

// ---------- JWT 认证中间件 ----------
function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET_FINAL, { expiresIn: "30d" });
}

function verifyToken(token: string): PublicUser | null {
  try {
    return jwt.verify(token, JWT_SECRET_FINAL) as PublicUser;
  } catch {
    return null;
  }
}

// 从请求中提取用户身份
function extractAuth(req: Request): PublicUser | null {
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
app.use(express.json({ limit: "6mb" }));
app.use(cookieParser());

// 生产环境：serve Vite 构建产物
if (config.nodeEnv === "production") {
  const path = await import("node:path");
  const frontendDist = path.resolve(process.cwd(), "apps/web/dist");
  app.use(express.static(frontendDist, { index: false }));
  app.get("*", (_req, res, next) => {
    if (_req.path.startsWith("/api/")) return next();
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
    .refine((value) => !value || /^data:image\/(png|jpeg);base64,/.test(value), "封面仅支持 JPG 或 PNG"),
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

function sendError(res: express.Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function currentUser(req: express.Request): PublicUser | null {
  return extractAuth(req);
}

function viewIdentifier(req: express.Request, user: PublicUser | null) {
  if (user) return `user:${user.id}`;
  const raw = `${req.ip ?? "0"}|${req.headers["user-agent"] ?? ""}`;
  return `guest:${createHash("sha256").update(raw).digest("hex")}`;
}

function requireAuth(req: express.Request, res: express.Response): PublicUser | null {
  const user = currentUser(req);
  if (!user) {
    sendError(res, 401, "请先登录");
    return null;
  }
  return user;
}

function requireAdmin(req: express.Request, res: express.Response): PublicUser | null {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendError(res, 403, "需要管理员权限");
    return null;
  }
  return user;
}

function toUser(row: mysql.RowDataPacket): PublicUser {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar: row.avatar ? String(row.avatar) : null,
    role: row.role,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function toJwtPayload(row: mysql.RowDataPacket) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    createdAt: new Date(row.created_at).toISOString()
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
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    type: row.type,
    summary: row.summary ?? "",
    coverImage: row.cover_thumbnail ? String(row.cover_thumbnail) : null,
    isOriginal: bool(row.is_original ?? 1),
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    creatorAvatar: row.creator_avatar ? String(row.creator_avatar) : null,
    isSurfacePublic: bool(row.is_surface_public),
    isBottomPublic: bool(row.is_bottom_public),
    viewCount: Number(row.view_count ?? 0),
    likeCount: Number(row.like_count ?? 0),
    favoriteCount: Number(row.favorite_count ?? 0),
    isLiked: bool(row.is_liked),
    isFavorited: bool(row.is_favorited),
    createdAt: new Date(row.created_at).toISOString(),
    evaluationCount: Number(row.evaluation_count ?? 0),
    averageTotal: num(row.average_total),
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
    coverImage: row.cover_image ? String(row.cover_image) : null
  };
}

async function getSoupRaw(id: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM soups WHERE id = ? LIMIT 1", [id]);
  return rows[0] ?? null;
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
  if (bool(soup.is_surface_public)) return true;
  if (!user) return false;
  return user.role === "admin" || user.id === soup.creator_id;
}

async function notify(userId: string, type: string, title: string, content: string, relatedId: string | null) {
  await pool.query(
    "INSERT INTO notifications (id, user_id, type, title, content, related_id) VALUES (?, ?, ?, ?, ?, ?)",
    [nanoid(), userId, type, title, content, relatedId]
  );
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
  { key: "aiClear:epic", stat: "aiCompletionCount", target: 50 }
];

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
    [aiCompletionRows]
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
    pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM game_completions WHERE user_id = ?", [userId])
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
    aiCompletionCount: Number(aiCompletionRows[0]?.count ?? 0)
  };
}

async function generateThumbnail(base64: string): Promise<string | null> {
  try {
    const buf = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const thumb = await sharp(buf).resize(400, undefined, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return `data:image/jpeg;base64,${thumb.toString("base64")}`;
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/register", async (req, res) => {
  const parsed = z
    .object({
      username: text.max(50),
      password: z.string().min(6).max(72),
      nickname: text.max(8, "昵称不超过 8 个字符")
    })
    .safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "注册信息不完整");

  const { username, password, nickname } = parsed.data;
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

  const user: PublicUser = { id, username, nickname, avatar: null, role: "user", createdAt: new Date().toISOString() };
  const token = signToken(user);
  res.cookie("hgt_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/"
  });
  res.json({ user, token });
});

app.post("/api/auth/login", async (req, res) => {
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
  res.cookie("hgt_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/"
  });
  res.json({ user, token });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("hgt_token");
  res.json({ ok: true });
});

app.post("/api/auth/password", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const parsed = z
    .object({
      newPassword: z.string().min(6, "新密码至少 6 位").max(72)
    })
    .safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "密码信息不正确");

  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id = ? LIMIT 1", [user.id]);
  const row = rows[0];
  if (!row) return sendError(res, 404, "用户不存在");
  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await pool.query("UPDATE users SET password = ? WHERE id = ?", [hash, user.id]);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const user = currentUser(req);
  if (user) {
    await recordLoginDay(user.id);
    // JWT 不再包含 avatar（缩小 token 体积），需要从数据库查
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT avatar FROM users WHERE id = ? LIMIT 1",
      [user.id]
    );
    if (rows.length) {
      user.avatar = rows[0].avatar ? String(rows[0].avatar) : null;
    }
  }
  res.json({ user });
});

app.patch("/api/me/nickname", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const parsed = z.object({ nickname: text.max(8, "昵称不超过 8 个字符") }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "昵称信息不正确");

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
  const user = requireAuth(req, res);
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

  const avatar = parsed.data.avatar || null;
  await pool.query("UPDATE users SET avatar = ? WHERE id = ?", [avatar, user.id]);

  const updated = { id: user.id, username: user.username, nickname: user.nickname, avatar, role: user.role, createdAt: user.createdAt };
  const token = signToken(updated);
  res.cookie("hgt_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/"
  });
  res.json({ ok: true, avatar });
});

app.get("/api/me/soups", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u.avatar AS creator_avatar,
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
    ORDER BY s.created_at DESC
    `,
    [user.id]
  );
  res.json({ soups: rows.map(mapSoupSummary) });
});

app.get("/api/me/stats", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  await recordLoginDay(user.id);
  res.json(await getAchievementStats(user.id));
});

app.post("/api/me/badge-unlocks/sync", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  await recordLoginDay(user.id);

  const [userRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badges_initialized FROM users WHERE id = ? LIMIT 1",
    [user.id]
  );
  const wasInitialized = Boolean(userRows[0]?.badges_initialized);
  const stats = await getAchievementStats(user.id);
  const earnedKeys = BADGE_THRESHOLDS
    .filter((badge) => stats[badge.stat] >= badge.target)
    .map((badge) => badge.key);

  const [unlockRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT badge_key FROM user_badge_unlocks WHERE user_id = ?",
    [user.id]
  );
  const unlocked = new Set(unlockRows.map((row) => String(row.badge_key)));
  const newKeys = earnedKeys.filter((key) => !unlocked.has(key));

  if (newKeys.length > 0) {
    const placeholders = newKeys.map(() => "(?, ?)").join(", ");
    const values = newKeys.flatMap((key) => [user.id, key]);
    await pool.query(
      `INSERT IGNORE INTO user_badge_unlocks (user_id, badge_key) VALUES ${placeholders}`,
      values
    );
  }

  if (!wasInitialized) {
    await pool.query("UPDATE users SET badges_initialized = 1 WHERE id = ?", [user.id]);
  }

  res.json({ unlocks: wasInitialized ? newKeys : [], stats });
});

app.get("/api/me/favorites", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u.avatar AS creator_avatar,
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
    WHERE f.user_id = ?
    GROUP BY s.id
    ORDER BY f.created_at DESC
    `,
    [user.id]
  );
  res.json({ soups: rows.map(mapSoupSummary) });
});

app.get("/api/me/evaluations", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u.avatar AS creator_avatar,
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
    WHERE my.reviewer_id = ?
    GROUP BY s.id
    ORDER BY my.created_at DESC
    `,
    [user.id]
  );
  res.json({ soups: rows.map(mapSoupSummary) });
});

app.get("/api/soups", async (req, res) => {
  const user = currentUser(req);
  const where: string[] = [];
  const params: unknown[] = [];
  const userParams: unknown[] = [];

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
  const order = req.query.order === "asc" ? "ASC" : req.query.order === "desc" ? "DESC" : "RAND";

  const orderClause = order === "RAND" ? "RAND()" : `s.created_at ${order}`;

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.id, s.title, s.author, s.type, s.summary, s.cover_thumbnail, s.is_original,
      s.creator_id, s.creator_name, s.is_surface_public, s.is_bottom_public, s.view_count, s.created_at,
      u.avatar AS creator_avatar,
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
    [...(user ? [user.id, user.id] : []), ...params]
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
  const user = requireAuth(req, res);
  if (!user) return;
  const parsed = soupSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "请完整填写海龟汤信息");

  const id = nanoid();
  const soup = parsed.data;
  if (soup.isOriginal && !soup.author) return sendError(res, 400, "原创海龟汤需要填写作者");
  const author = soup.isOriginal ? soup.author : "佚名";
  const thumbnail = soup.coverImage ? await generateThumbnail(soup.coverImage) : null;
  await pool.query(
    `INSERT INTO soups
      (id, title, author, type, summary, cover_image, cover_thumbnail, is_original, is_sensitive, surface, supplemental_surfaces, bottom, supplemental_bottoms, host_manual, is_surface_public, is_bottom_public, enable_ai_game, ai_prompt, key_facts, key_facts_hash, key_facts_customized, creator_id, creator_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      soup.title,
      author,
      soup.type,
      soup.summary,
      soup.coverImage || null,
      thumbnail,
      soup.isOriginal,
      soup.isSensitive,
      soup.surface,
      JSON.stringify(soup.supplementalSurfaces),
      soup.bottom,
      JSON.stringify(soup.supplementalBottoms),
      soup.manual || null,
      soup.isSurfacePublic,
      soup.isBottomPublic,
      soup.enableAiGame,
      soup.aiPrompt || null,
      soup.keyFacts.length > 0 ? JSON.stringify(soup.keyFacts) : null,
      null,
      soup.keyFactsCustomized ? 1 : 0,
      user.id,
      user.nickname
    ]
  );
  res.status(201).json({ id });

  // 异步预拆分关键事实点（不阻塞响应）。用户已自定义则跳过
  if (soup.enableAiGame && !soup.keyFactsCustomized) {
    splitKeyFactsForSoup(id).catch(() => {});
  }
});

app.get("/api/soups/:id", async (req, res) => {
  const user = currentUser(req);
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
    "SELECT * FROM evaluations WHERE soup_id = ? ORDER BY created_at DESC",
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

  res.json({
    soup: {
      ...mapSoupDetail(statsRows[0]),
      surface: soup.surface,
      supplementalSurfaces: full ? jsonList(soup.supplemental_surfaces) : [],
      bottom: full ? soup.bottom : null,
      supplementalBottoms: full ? jsonList(soup.supplemental_bottoms) : null,
      manual: full ? soup.host_manual : null,
      enableAiGame: bool(soup.enable_ai_game),
      aiPrompt: (soup.ai_prompt as string) || null,
      keyFacts: safeParseJson(soup.key_facts),
      keyFactsCustomized: (soup.key_facts_customized as number) === 1,
      canViewFull: full,
      canEdit: Boolean(user && (user.role === "admin" || user.id === soup.creator_id)),
      isFavorited: favoriteRows.length > 0,
      isLiked: likeRows.length > 0,
      pendingRequestId: requestRows[0]?.id ?? null,
      evaluations: evalRows.map(mapEvaluation)
    }
  });
});

app.post("/api/soups/:id/like", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
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
  const [[c2]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS cnt FROM soup_likes WHERE soup_id = ?", [req.params.id]);
  res.status(201).json({ isLiked: true, likeCount: Number(c2.cnt) });
});

app.get("/api/me/likes", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*, u2.avatar AS creator_avatar,
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
    WHERE lk.user_id = ?
    GROUP BY s.id
    ORDER BY lk.created_at DESC
    `,
    [user.id]
  );
  res.json({ soups: rows.map(mapSoupSummary) });
});

app.post("/api/soups/:id/favorite", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
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
  const [[c2]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS cnt FROM soup_favorites WHERE soup_id = ?", [req.params.id]);
  res.status(201).json({ isFavorited: true, favoriteCount: Number(c2.cnt) });
});

app.put("/api/soups/:id", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (user.role !== "admin" && user.id !== soup.creator_id) return sendError(res, 403, "没有编辑权限");

  const parsed = soupSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "请完整填写海龟汤信息");
  const next = parsed.data;
  if (next.isOriginal && !next.author) return sendError(res, 400, "原创海龟汤需要填写作者");
  const author = next.isOriginal ? next.author : "佚名";
  const thumbnail = next.coverImage ? await generateThumbnail(next.coverImage) : null;
  await pool.query(
    `UPDATE soups
     SET title = ?, author = ?, type = ?, summary = ?, cover_image = ?, cover_thumbnail = ?, is_original = ?, is_sensitive = ?, surface = ?, supplemental_surfaces = ?, bottom = ?, supplemental_bottoms = ?, host_manual = ?,
         is_surface_public = ?, is_bottom_public = ?, enable_ai_game = ?, ai_prompt = ?, key_facts = ?, key_facts_hash = ?, key_facts_customized = ?
     WHERE id = ?`,
    [
      next.title,
      author,
      next.type,
      next.summary,
      next.coverImage || null,
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
      next.aiPrompt || null,
      next.keyFacts.length > 0 ? JSON.stringify(next.keyFacts) : null,
      null,
      next.keyFactsCustomized ? 1 : 0,
      req.params.id
    ]
  );
  res.json({ ok: true });

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
  const user = requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (user.role !== "admin" && user.id !== soup.creator_id) return sendError(res, 403, "没有编辑权限");

  forceReanalyzeKeyFacts(req.params.id).catch(() => {});
  res.json({ ok: true });
});

app.delete("/api/soups/:id", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (user.role !== "admin" && user.id !== soup.creator_id) return sendError(res, 403, "没有删除权限");
  await pool.query("DELETE FROM soups WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/soups/:id/evaluations", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
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
  res.status(201).json({ id });
});

app.delete("/api/evaluations/:id", async (req, res) => {
  const user = requireAuth(req, res);
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
  const user = requireAuth(req, res);
  if (!user) return;
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
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
  res.status(201).json({ id });
});

app.get("/api/access-requests", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const params: unknown[] = [];
  let where = "";
  if (user.role !== "admin") {
    where = "WHERE vr.owner_id = ?";
    params.push(user.id);
  }
  const requestedLimit = Number(req.query.limit);
  const limit = [10, 20, 50].includes(requestedLimit) ? requestedLimit : null;
  const offset = Math.max(0, Number(req.query.offset ?? 0));
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
  const user = requireAuth(req, res);
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
  res.json({ ok: true });
});

app.get("/api/notifications", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT n.*,
      CASE WHEN n.type = 'view_request' OR n.type = 'view_request_result'
           THEN vr.soup_id
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
      isRead: bool(row.is_read),
      createdAt: new Date(row.created_at).toISOString()
    }))
  });
});

app.patch("/api/notifications/read-all", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE", [user.id]);
  res.json({ ok: true });
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?", [req.params.id, user.id]);
  res.json({ ok: true });
});

app.get("/api/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
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
  if (!requireAdmin(req, res)) return;
  const parsed = z.object({ nickname: text.max(50), role: z.enum(["admin", "user"]) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "用户信息不正确");
  await pool.query("UPDATE users SET nickname = ?, role = ? WHERE id = ?", [
    parsed.data.nickname,
    parsed.data.role,
    req.params.id
  ]);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;
  if (user.id === req.params.id) return sendError(res, 400, "不能删除自己");
  await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/reset-password", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = z.object({ newPassword: z.string().min(6, "新密码至少 6 位").max(72) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "密码格式不正确");
  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await pool.query("UPDATE users SET password = ? WHERE id = ?", [hash, req.params.id]);
  res.json({ ok: true });
});

app.get("/api/admin/evaluations", async (req, res) => {
  if (!requireAdmin(req, res)) return;
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
app.use("/api/game", (req, _res, next) => {
  (req as any).user = extractAuth(req);
  next();
}, gameRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "服务暂时不可用" });
});

await initDatabase();
const server = app.listen(config.port, () => {
  console.log(`HGT API listening on http://localhost:${config.port}`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} already in use, please close the other process first.`);
    process.exit(1);
  } else {
    throw error;
  }
});
