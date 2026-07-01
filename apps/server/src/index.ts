import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import mysqlSessionFactory from "express-mysql-session";
import session from "express-session";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "./config.js";
import { initDatabase, pool } from "./db.js";
import type { PublicUser } from "./types.js";

const app = express();
const MySQLStore = mysqlSessionFactory(session);
const maxAge = 1000 * 60 * 60 * 24 * 30;

const sessionStore = new MySQLStore({
  ...config.db,
  createDatabaseTable: true,
  schema: {
    tableName: "sessions",
    columnNames: {
      session_id: "sid",
      expires: "expired",
      data: "sess"
    }
  }
});

app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(express.json({ limit: "6mb" }));
app.use(
  session({
    name: "hgt.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: config.nodeEnv === "production" ? "none" : "lax",
      secure: config.nodeEnv === "production",
      maxAge
    }
  })
);

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
  surface: text,
  supplementalSurfaces: optionalTextList,
  bottom: text,
  supplementalBottoms: optionalTextList,
  manual: optionalText,
  isSurfacePublic: z.boolean().default(true),
  isBottomPublic: z.boolean().default(false)
});

const evaluationSchema = z.object({
  total: score,
  writing: optionalScore,
  logic: optionalScore,
  share: optionalScore,
  mechanism: optionalScore,
  twist: optionalScore,
  depth: optionalScore
});

function sendError(res: express.Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function currentUser(req: express.Request): PublicUser | null {
  return req.session.user ?? null;
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

function mapEvaluation(row: mysql.RowDataPacket) {
  return {
    id: row.id,
    soupId: row.soup_id,
    total: Number(row.total),
    reviewer: row.reviewer,
    reviewerId: row.reviewer_id,
    writing: num(row.writing),
    logic: num(row.logic),
    share: num(row.share),
    mechanism: num(row.mechanism),
    twist: num(row.twist),
    depth: num(row.depth),
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
    coverImage: row.cover_image ? String(row.cover_image) : null,
    isOriginal: bool(row.is_original ?? 1),
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    isSurfacePublic: bool(row.is_surface_public),
    isBottomPublic: bool(row.is_bottom_public),
    viewCount: Number(row.view_count ?? 0),
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

  const user: PublicUser = { id, username, nickname, role: "user", createdAt: new Date().toISOString() };
  req.session.user = user;
  res.json({ user });
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
  req.session.user = user;
  res.json({ user });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("hgt.sid");
    res.json({ ok: true });
  });
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

app.get("/api/auth/me", (req, res) => {
  res.json({ user: currentUser(req) });
});

app.get("/api/me/soups", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*,
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
    WHERE s.creator_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
    `,
    [user.id]
  );
  res.json({ soups: rows.map(mapSoupSummary) });
});

app.get("/api/soups", async (req, res) => {
  const user = currentUser(req);
  const where: string[] = [];
  const params: unknown[] = [];

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

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT s.*,
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
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY s.id
    ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
    ORDER BY s.created_at DESC
    LIMIT ${limit + 1} OFFSET ${offset}
    `,
    params
  );

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  res.json({ soups: rows.map(mapSoupSummary), hasMore });
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
  await pool.query(
    `INSERT INTO soups
      (id, title, author, type, summary, cover_image, is_original, surface, supplemental_surfaces, bottom, supplemental_bottoms, host_manual, is_surface_public, is_bottom_public, creator_id, creator_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      soup.title,
      author,
      soup.type,
      soup.summary,
      soup.coverImage || null,
      soup.isOriginal,
      soup.surface,
      JSON.stringify(soup.supplementalSurfaces),
      soup.bottom,
      JSON.stringify(soup.supplementalBottoms),
      soup.manual || null,
      soup.isSurfacePublic,
      soup.isBottomPublic,
      user.id,
      user.nickname
    ]
  );
  res.status(201).json({ id });
});

app.get("/api/soups/:id", async (req, res) => {
  const user = currentUser(req);
  const soup = await getSoupRaw(req.params.id);
  if (!soup) return sendError(res, 404, "海龟汤不存在");
  if (!canSeeSoupSurface(soup, user)) return sendError(res, 403, "没有查看权限");

  const identifier = user?.id ?? `${req.ip ?? "0"}|${(req.headers["user-agent"] ?? "").slice(0, 120)}`;
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
    SELECT s.*,
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

  res.json({
    soup: {
      ...mapSoupSummary(statsRows[0]),
      surface: soup.surface,
      supplementalSurfaces: jsonList(soup.supplemental_surfaces),
      bottom: full ? soup.bottom : null,
      supplementalBottoms: full ? jsonList(soup.supplemental_bottoms) : null,
      manual: full ? soup.host_manual : null,
      canViewFull: full,
      canEdit: Boolean(user && (user.role === "admin" || user.id === soup.creator_id)),
      pendingRequestId: requestRows[0]?.id ?? null,
      evaluations: evalRows.map(mapEvaluation)
    }
  });
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
  await pool.query(
    `UPDATE soups
     SET title = ?, author = ?, type = ?, summary = ?, cover_image = ?, is_original = ?, surface = ?, supplemental_surfaces = ?, bottom = ?, supplemental_bottoms = ?, host_manual = ?,
         is_surface_public = ?, is_bottom_public = ?
     WHERE id = ?`,
    [
      next.title,
      author,
      next.type,
      next.summary,
      next.coverImage || null,
      next.isOriginal,
      next.surface,
      JSON.stringify(next.supplementalSurfaces),
      next.bottom,
      JSON.stringify(next.supplementalBottoms),
      next.manual || null,
      next.isSurfacePublic,
      next.isBottomPublic,
      req.params.id
    ]
  );
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
       SET total = ?, reviewer = ?, writing = ?, logic = ?, share = ?, mechanism = ?, twist = ?, depth = ?
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
        existing.id
      ]
    );
    return res.json({ id: existing.id });
  }

  const id = nanoid();
  await pool.query(
    `INSERT INTO evaluations
      (id, soup_id, total, reviewer, reviewer_id, writing, logic, share, mechanism, twist, depth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      data.depth
    ]
  );
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
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `
    SELECT vr.*, s.title AS soup_title
    FROM view_requests vr
    JOIN soups s ON s.id = vr.soup_id
    ${where}
    ORDER BY vr.created_at DESC
    `,
    params
  );
  res.json({
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
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    [user.id]
  );
  res.json({
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      relatedId: row.related_id,
      isRead: bool(row.is_read),
      createdAt: new Date(row.created_at).toISOString()
    }))
  });
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?", [req.params.id, user.id]);
  res.json({ ok: true });
});

app.get("/api/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, username, nickname, role, created_at FROM users ORDER BY created_at DESC"
  );
  res.json({ users: rows.map(toUser) });
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
