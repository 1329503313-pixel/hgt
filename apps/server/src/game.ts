import { Router } from "express";
import { z } from "zod";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { createHash } from "crypto";
import { pool } from "./db.js";

import { config } from "./config.js";

const DEEPSEEK_API_KEY = config.deepseekApiKey;
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const gameRouter = Router();
let badgeProgressListener: ((userId: string) => void) | null = null;

export function setBadgeProgressListener(listener: (userId: string) => void) {
  badgeProgressListener = listener;
}

function reportBadgeProgress(userId: string) {
  badgeProgressListener?.(userId);
}

// ---------- 类型 ----------
interface KeyFact {
  id: number;
  content: string;
  weight: number;
}

function normalizeKeyFacts(value: unknown): KeyFact[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap((fact: any) => {
    const id = Number(fact?.id);
    const weight = Number(fact?.weight);
    const content = typeof fact?.content === "string" ? fact.content.trim() : "";
    if (!Number.isInteger(id) || seen.has(id) || !Number.isFinite(weight) || weight <= 0 || !content) return [];
    seen.add(id);
    return [{ id, content, weight }];
  });
}

function isRevealedFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "yes";
}

function parseKeyIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(Number.isInteger))];
}

interface GameSessionRow extends mysql.RowDataPacket {
  id: string;
  soup_id: number;
  user_id: string;
  messages: any;
  revealed_keys: any;
  revealed_supplements: any;
  content_hash: string | null;
  progress: number;
}

function parseJson<T>(val: any): T {
  if (val === null || val === undefined) return null as unknown as T;
  if (typeof val === "string") {
    try { return JSON.parse(val) as T; } catch { return null as unknown as T; }
  }
  return val as T;
}

type GameUser = { id: string; role: "admin" | "user" };
type GameSoupData = {
  surface: string;
  bottom: string;
  manual: string;
  supplementalSurfaces: string[];
  supplementalBottoms: string[];
  keyFacts: KeyFact[];
  aiPrompt: string | null;
  creatorId: string;
  isSurfacePublic: boolean;
  enableAiGame: boolean;
};

const AI_MINUTE_LIMIT = 30;
const AI_DAILY_LIMIT = 300;

async function consumeAiQuota(userId: string): Promise<{ allowed: boolean; dailyExceeded: boolean }> {
  await pool.query(
    `INSERT INTO ai_game_usage
      (user_id, minute_window_start, minute_request_count, daily_date, daily_request_count)
     VALUES (?, NOW(), 1, CURRENT_DATE(), 1)
     ON DUPLICATE KEY UPDATE
       minute_request_count = IF(minute_window_start <= NOW() - INTERVAL 1 MINUTE, 1, minute_request_count + 1),
       minute_window_start = IF(minute_window_start <= NOW() - INTERVAL 1 MINUTE, NOW(), minute_window_start),
       daily_request_count = IF(daily_date <> CURRENT_DATE(), 1, daily_request_count + 1),
       daily_date = CURRENT_DATE()`,
    [userId],
  );
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT minute_request_count, daily_request_count FROM ai_game_usage WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const minuteCount = Number(rows[0]?.minute_request_count ?? 0);
  const dailyCount = Number(rows[0]?.daily_request_count ?? 0);
  return {
    allowed: minuteCount <= AI_MINUTE_LIMIT && dailyCount <= AI_DAILY_LIMIT,
    dailyExceeded: dailyCount > AI_DAILY_LIMIT,
  };
}

async function aiRateLimiter(req: any, res: any, next: any) {
  const user = req.user as GameUser | undefined;
  if (!user) return res.status(401).json({ error: "请先登录" });
  try {
    const quota = await consumeAiQuota(user.id);
    if (!quota.allowed) {
      res.setHeader("Retry-After", quota.dailyExceeded ? 86400 : 60);
      return res.status(429).json({ error: quota.dailyExceeded ? "今日 AI 玩汤次数已达上限" : "AI 请求过于频繁，请稍后再试" });
    }
    next();
  } catch (error) {
    console.error("AI quota check failed:", error);
    return res.status(503).json({ error: "AI 配额服务暂时不可用，请稍后再试" });
  }
}

async function recordKeyHits(userId: string, soupId: string, keyIds: unknown[], db: mysql.Pool | mysql.PoolConnection = pool) {
  const uniqueIds = Array.from(new Set(
    keyIds.map((id) => Number(id)).filter((id) => Number.isInteger(id))
  ));
  if (uniqueIds.length === 0) return;

  const placeholders = uniqueIds.map(() => "(?, ?, ?)").join(", ");
  const values = uniqueIds.flatMap((keyId) => [userId, soupId, keyId]);
  await db.query(
    `INSERT IGNORE INTO game_key_hits (user_id, soup_id, key_id) VALUES ${placeholders}`,
    values
  );
}

// ---------- 构建 System Prompt ----------
function buildSystemPrompt(
  surface: string,
  bottom: string,
  manual: string,
  supplementalSurfaces: string[],
  supplementalBottoms: string[],
  revealedSurfaces: number[],
  revealedBottoms: number[],
  preSplitKeyFacts?: KeyFact[] | null,
  customAiPrompt?: string | null,
  revealedKeys?: number[],
): string {
  const hasPreSplitKeyFacts = Array.isArray(preSplitKeyFacts) && preSplitKeyFacts.length > 0;
  const suppSurfacesText = supplementalSurfaces.length > 0
    ? supplementalSurfaces.map((s, i) => `[${i}] ${s}`).join("\n")
    : "(无)";
  const suppBottomsText = supplementalBottoms.length > 0
    ? supplementalBottoms.map((s, i) => `[${i}] ${s}`).join("\n")
    : "(无)";
  const revealedSurfacesInfo = revealedSurfaces.length > 0
    ? `已揭示补充汤面: [${revealedSurfaces.join(",")}]`
    : "尚未揭示补充汤面";
  const revealedBottomsInfo = revealedBottoms.length > 0
    ? `已揭示补充汤底: [${revealedBottoms.join(",")}]`
    : "尚未揭示补充汤底";

  return String.raw`${customAiPrompt ? customAiPrompt + "\n\n" : ""}你是海龟汤主持人。玩家知道汤面，不知道汤底。你的任务是用"是/不是/是也不是/不知道/不重要"回应推理，引导玩家逐步接近真相。

========================================
一、汤面（玩家可见）
========================================
${surface}

========================================
二、汤底（绝密！通关前绝不透露）
========================================
${bottom}

========================================
三、主持人手册
========================================
${customAiPrompt || manual || "按常规海龟汤主持方式。"}

========================================
四、补充内容
========================================
补充汤面:
${suppSurfacesText}

补充汤底:
${suppBottomsText}

${revealedSurfacesInfo}
${revealedBottomsInfo}

========================================
五、关键事实点（已经预先拆分好，你不需要重新拆分）
========================================

以下事实点已经拆分并分配权重，所有权重总和为 100。你只需根据它们判断进度：

${hasPreSplitKeyFacts ? preSplitKeyFacts.map(kf => `  [${kf.id}] ${kf.content}（权重 ${kf.weight}）`).join("\n") : "(无预拆分，你需要自己拆解)"}

【服务端已揭示状态——CRITICAL：这是累积状态，不要重置】
${revealedKeys && revealedKeys.length > 0
  ? `以下事实点已在之前的对话中被揭示（revealed: true），你必须继承这个状态，只能在此基础上追加新的揭示：
  ${revealedKeys.map(id => `  [${id}] — 已揭示 ✓`).join("\n")}
  未揭示的事实点: [${hasPreSplitKeyFacts ? preSplitKeyFacts.filter(kf => !revealedKeys.includes(kf.id)).map(kf => kf.id).join(", ") : "需要自己推导"}]
  `
  : "目前尚无已揭示的事实点。"}

【每轮更新 progress——宽松语义命中】
每轮根据玩家提问的语义方向判断触及了哪些事实点，不要求玩家说出与关键点完全一致的措辞或全部细节。
只要玩家大概猜到、问到或推理到某个关键点的核心方向，就算命中，该关键点 revealed=true 并获得完整权重。例如：
  - 说中了相关人物、事件、关系、动机、手法、时间、地点或关键物品中的核心方向
  - 猜测不够完整、细节略有偏差，但已经明显接近该关键点
  - 以疑问句提出了与关键点核心内容高度接近的具体猜测，即使还没有说全最终答案
  - 回答为"是也不是"，但玩家已经触及关键点的核心语义
只有完全无关、方向相反，或仅重复汤面而没有形成任何新推理时才不命中。

计分规则：
  - 大概命中或完整命中 → 该事实点 100% 得分并设为 revealed=true
  - 未命中（完全无关、方向相反、"不知道"或"不重要"）→ 0%
  - 同一轮可以命中多个关键点；应当偏宽松判断，不要因为措辞或不影响核心语义的小细节不精确而拒绝给分
  - 仅仅泛问“动机是什么”“手法是什么”“时间重要吗”等抽象维度不算命中；玩家仍需提出与事实内容大致接近的猜测
  - progress = 所有 revealed=true 事实点权重的总和（四舍五入取整）
  - 已得分的事实点不会重复计分
  - 服务端已揭示的事实点是累积的，你必须在 keyFacts 中把它们的 revealed 设为 true
  - matchedKeyIds 必须列出本轮大概命中或完整命中的关键点 ID；只要 answer 是"是"或"是也不是"且问题触及关键点，matchedKeyIds 就不能漏掉对应 ID

示例计算：
  事实点 [20,18,15,12,10,10,8,7]，当前触及:
  - #1（权重20）→ 完整命中 → 得分20
  - #3（权重15）→ 大概命中，虽然细节不完整或回答为"是也不是" → 仍得分15
  - #4（权重12）→ 用疑问句提出了接近该关键点内容的具体猜测 → 得分12
  总 progress = 20 + 15 + 12 = 47

CRITICAL: progress 必须只增不减。只能累积，不能倒退。${hasPreSplitKeyFacts ? "" : "\n\n如果没有预拆分结果，先阅读汤底，拆解 N 个关键事实点（5-15 个），每个分配整数权重，总权重=100。然后在后续轮次中按上述规则更新 progress。"}

========================================
六、回答规则
========================================

【输出格式——CRITICAL】
你的每一轮回复都必须是一个完整的 JSON 对象，不能只输出纯文本。
answer 字段按以下规则填写：

【普通模式】（默认）
answer 必须是以下五个值之一：
  "是" — 完全正确，与汤底吻合
  "不是" — 与汤底矛盾
  "是也不是" — 部分正确但不完全
  "不知道" — 超出汤面信息范围
  "不重要" — 与真相核心无关
answer 不能包含括号、换行、进度百分比等额外文字。progress 和 keyFacts 照常在 JSON 中输出。

【提示模式】（仅消息含"提示"或"方向性指引"时触发）
answer 可以多写（2-4段），给方向性指引。

CRITICAL 提示生成与筛选规则：
- revealed:true 的事实点是可以直接引用的已知信息，可以用它们作为提示的上下文
- revealed:false 的事实点只允许在内部用于选择“下一步应该思考的维度”，绝不能输出其中的具体答案、专有名词、物品、动作、原因或结论
- 输出前必须把未揭示事实点抽象成问题维度，例如：人物关系、动机、作案手法、工具、时间、地点、因果或行为目的
- 提示应告诉玩家“接下来问什么/关注什么”，而不是告诉玩家“答案是什么”；优先使用问句或方向句
- 可以把已知事实与一个未揭示维度连接起来，但必须删除会直接命中汤底的未知答案词
- 不能暗示未揭示的补充汤面/汤底，不能透露汤底原文

筛选示例：
  已知事实：A 杀了 B。未揭示事实：A 用刀杀了 B。
  允许："可以关注一下 A 杀害 B 时采用了什么手法。"
  允许："这件事的作案工具是否重要？"
  禁止："想想 A 为什么用刀杀了 B。"——“刀”是未揭示的具体答案，已经泄露汤底

如果玩家还未命中任何关键点，只能基于汤面选择一个抽象维度，例如人物关系、时间或动机，不得带出任何未揭示事实的具体内容。不要返回与当前推理无关的固定兜底句，应直接输出经过上述去答案化筛选的有效提示。

【补充内容揭示】
按主持人手册条件执行。无明确规定则：
  补充汤面约30-60%进度时揭示，补充汤底约60-85%时揭示
  每次最多1条，自然融入回答

========================================
七、通关流程
========================================
progress >= 90%：邀请玩家复述完整故事
复述基本正确(80%+) → 输出完整汤底原文 + completed:true
复述有偏差 → 指出问题，progress保持85-90%，completed:false
复述错误 → 引导，progress回退到约80%，completed:false

========================================
八、JSON 格式（每轮必须输出 JSON）
========================================

{"answer":"是","progress":40,"matchedKeyIds":[1],"keyFacts":[{"id":1,"content":"凶手是父亲","weight":20,"revealed":true},{"id":2,"content":"动机是复仇","weight":18,"revealed":false}],"revealedSupplementSurfaces":[],"revealedSupplementBottoms":[],"completed":false}

字段说明：
- answer: 五选一；提示模式下可多写
- progress: 整数 0-100，按关键事实点权重计算
- matchedKeyIds: 本轮新命中的关键点 ID 数组；大概命中也必须列入
- keyFacts: 完整的关键事实点清单，每轮都输出，revealed 标记是否已被触及
- revealedSupplementSurfaces: 已揭示的补充汤面索引数组
- revealedSupplementBottoms: 已揭示的补充汤底索引数组
- completed: 仅通关时 true

CRITICAL: 必须输出 JSON。answer 是五选一纯文本也必须有 progress 和 keyFacts。`;
}

// ---------- 修复 JSON ----------
function repairJson(raw: string): any {
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return null;
  }
}

// ---------- 修复数组 JSON ----------
function repairArrayJson(raw: string): any[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  // 尝试提取数组
  const m = raw.match(/\[[\s\S]*\]/);
  if (m) {
    try { const parsed = JSON.parse(m[0]); if (Array.isArray(parsed)) return parsed; } catch { /* fall through */ }
  }
  return null;
}

// ---------- 调用 DeepSeek ----------
class AiServiceError extends Error {
  constructor(public readonly status: 502 | 503, message: string) {
    super(message);
    this.name = "AiServiceError";
  }
}

function sendAiServiceError(res: any, error: unknown) {
  if (error instanceof AiServiceError) return res.status(error.status).json({ error: error.message });
  console.error("Unexpected AI service error:", error);
  return res.status(502).json({ error: "AI 服务返回异常，请稍后重试" });
}

async function callDeepSeek(systemPrompt: string, messages: { role: string; content: string }[]): Promise<{
  answer: string;
  progress: number | null;
  keyFacts: any[];
  matchedKeyIds: number[];
  revealedSupplementSurfaces: number[];
  revealedSupplementBottoms: number[];
  completed: boolean;
}> {
  if (!DEEPSEEK_API_KEY) {
    throw new AiServiceError(503, "服务未配置 AI 接口，请联系管理员设置 DEEPSEEK_API_KEY");
  }

  let resp: globalThis.Response;
  try {
    resp = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-60).map((m) => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content }))
        ],
        max_tokens: 4000,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    console.error("DeepSeek request failed:", error instanceof Error ? error.message : error);
    throw new AiServiceError(503, "AI 服务暂时不可用，请稍后再试");
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("DeepSeek API error:", resp.status, text);
    throw new AiServiceError(resp.status >= 500 ? 503 : 502, "AI 服务请求失败，请稍后再试");
  }

  let raw = "";
  try {
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    raw = data.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new AiServiceError(502, "AI 服务返回了无效响应，请稍后重试");
  }
  console.error("DeepSeek raw:", raw.slice(0, 500));

  try {
    const parsed = repairJson(raw) || {};
    const allowedWords = ["是也不是", "不重要", "不知道", "不是", "是"];

    let answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : "";
    if (!answer) {
      const cleaned = raw.replace(/\s+/g, "").replace(/[（(].*?[)）]/g, "");
      for (const w of allowedWords) { if (cleaned.startsWith(w)) { answer = w; break; } }
      if (!answer) {
        // JSON 解析完全失败，原始输出作为 answer 可能泄露汤底。用安全通用回复替代。
        console.error("DeepSeek unparseable output, suppressing raw text (length %d)", raw.length);
        throw new AiServiceError(502, "AI 返回了无法解析的内容，请重试");
      }
    }
    // 裁剪多余文字
    for (const w of allowedWords) { if (answer.startsWith(w) && answer.length > w.length) { answer = w; break; } }

    const progress = typeof parsed.progress === "number" && parsed.progress >= 0 && parsed.progress <= 100
      ? Math.round(parsed.progress) : null;

    const keyFacts = Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [];
    const matchedKeyIds = parseKeyIds(parsed.matchedKeyIds ?? parsed.matchedKeys ?? parsed.revealedKeyIds);

    const revealedSupplementSurfaces = Array.isArray(parsed.revealedSupplementSurfaces)
      ? parsed.revealedSupplementSurfaces.filter((n: unknown) => typeof n === "number" && Number.isInteger(n)) : [];
    const revealedSupplementBottoms = Array.isArray(parsed.revealedSupplementBottoms)
      ? parsed.revealedSupplementBottoms.filter((n: unknown) => typeof n === "number" && Number.isInteger(n)) : [];
    const completed = typeof parsed.completed === "boolean" ? parsed.completed : false;

    return { answer, progress, keyFacts, matchedKeyIds, revealedSupplementSurfaces, revealedSupplementBottoms, completed };
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    console.error("DeepSeek JSON parse error, suppressing raw output (length %d)", raw.length);
    throw new AiServiceError(502, "AI 返回了无法解析的内容，请重试");
  }
}

async function recoverMatchedKeyIds(question: string, keyFacts: KeyFact[], savedKeys: number[]): Promise<number[]> {
  if (!DEEPSEEK_API_KEY || keyFacts.length === 0) return [];
  const saved = new Set(parseKeyIds(savedKeys));
  const candidates = keyFacts.filter((fact) => !saved.has(fact.id));
  if (candidates.length === 0) return [];

  const prompt = `你是海龟汤关键点命中校验器。主回答已经判断玩家的提问为“是”或“是也不是”，但遗漏了命中 ID。
请按宽松语义判断：只要玩家的具体猜测大概触及关键点核心内容，即使措辞或次要细节不完整，也算命中；仅泛问抽象维度不算。

玩家提问：${question}

尚未命中的关键点：
${candidates.map((fact) => `[${fact.id}] ${fact.content}`).join("\n")}

只输出 JSON：{"matchedKeyIds":[1,2]}。没有命中则输出 {"matchedKeyIds":[]}。`;

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return [];
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const parsed = repairJson(data.choices?.[0]?.message?.content ?? "");
    const validIds = new Set(candidates.map((fact) => fact.id));
    return parseKeyIds(parsed?.matchedKeyIds).filter((id) => validIds.has(id));
  } catch (error) {
    console.error("Key fact match recovery failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

// ---------- 获取汤底数据 ----------
async function getSoupGameData(soupId: string): Promise<GameSoupData | null> {
  const [rows] = await pool.query<any[]>(
    "SELECT surface, bottom, host_manual, supplemental_surfaces, supplemental_bottoms, key_facts, ai_prompt, creator_id, is_surface_public, enable_ai_game FROM soups WHERE id = ? LIMIT 1", [soupId]
  );
  if (rows.length === 0) return null;
  return {
    surface: rows[0].surface,
    bottom: rows[0].bottom,
    manual: rows[0].host_manual ?? "",
    supplementalSurfaces: parseJson<string[]>(rows[0].supplemental_surfaces) ?? [],
    supplementalBottoms: parseJson<string[]>(rows[0].supplemental_bottoms) ?? [],
    keyFacts: normalizeKeyFacts(parseJson<unknown>(rows[0].key_facts)),
    aiPrompt: (rows[0].ai_prompt as string) || null,
    creatorId: String(rows[0].creator_id),
    isSurfacePublic: Boolean(Number(rows[0].is_surface_public)),
    enableAiGame: Boolean(Number(rows[0].enable_ai_game)),
  };
}

async function ensureSoupKeyFacts(soupId: string, soupData: GameSoupData): Promise<GameSoupData> {
  if (soupData.keyFacts.length > 0) return soupData;
  await splitKeyFactsForSoup(soupId);
  return (await getSoupGameData(soupId)) ?? soupData;
}

function canPlaySoup(soup: GameSoupData, user: GameUser) {
  return soup.enableAiGame && (soup.isSurfacePublic || user.role === "admin" || soup.creatorId === user.id);
}

type TurnResult = Awaited<ReturnType<typeof callDeepSeek>>;

function normalizeTurnResult(
  result: TurnResult,
  soupData: GameSoupData,
  savedKeys: number[],
  savedSupplements: { surfaces: number[]; bottoms: number[] },
  existingProgress: number,
) {
  const canonicalFacts = new Map(soupData.keyFacts.map((fact) => [fact.id, fact]));
  const validSavedKeys = parseKeyIds(savedKeys).filter((id) => canonicalFacts.has(id));
  const aiRevealedKeysFromFacts = result.keyFacts
    .filter((fact: any) => isRevealedFlag(fact?.revealed ?? fact?.matched ?? fact?.isRevealed))
    .map((fact: any) => Number(fact.id))
    .filter((id: number) => Number.isInteger(id) && canonicalFacts.has(id));
  const explicitMatchedKeys = parseKeyIds(result.matchedKeyIds).filter((id) => canonicalFacts.has(id));
  const revealedKeys = [...new Set([...validSavedKeys, ...aiRevealedKeysFromFacts, ...explicitMatchedKeys])].sort((a, b) => a - b);
  const revealedKeySet = new Set(revealedKeys);
  const canonicalProgress = Math.round(Math.min(100, soupData.keyFacts.reduce(
    (sum, fact) => sum + (revealedKeySet.has(fact.id) ? fact.weight : 0),
    0,
  )));
  const revealedSupplements = mergeSupplements(savedSupplements, {
    surfaces: result.revealedSupplementSurfaces.filter((index) => index >= 0 && index < soupData.supplementalSurfaces.length),
    bottoms: result.revealedSupplementBottoms.filter((index) => index >= 0 && index < soupData.supplementalBottoms.length),
  });

  // 通关必须建立在上一轮已经达到复述门槛的基础上，AI 不能在同一轮伪造进度并直接授权。
  const completed = result.completed && existingProgress >= 90 && canonicalProgress >= 90;
  const progress = completed
    ? 100
    : Math.min(99, Math.max(existingProgress, canonicalProgress));
  const answer = result.completed && !completed
    ? "请继续推理，达到复述门槛后再尝试还原完整故事。"
    : result.answer;
  const keyFacts = soupData.keyFacts.map((fact) => ({ ...fact, revealed: revealedKeySet.has(fact.id) }));

  return {
    answer,
    progress,
    keyFacts,
    revealedKeys,
    newlyRevealedKeys: revealedKeys.filter((id) => !validSavedKeys.includes(id)),
    revealedSupplements,
    completed,
  };
}

function serializeAssistantTurn(turn: ReturnType<typeof normalizeTurnResult>) {
  return JSON.stringify({
    answer: turn.answer,
    progress: turn.progress,
    keyFacts: turn.keyFacts,
    revealedSupplementSurfaces: turn.revealedSupplements.surfaces,
    revealedSupplementBottoms: turn.revealedSupplements.bottoms,
    completed: turn.completed,
  });
}

function createHintTurn(result: TurnResult, soupData: GameSoupData, savedKeys: number[], savedSupplements: { surfaces: number[]; bottoms: number[] }, progress: number) {
  const validKeys = parseKeyIds(savedKeys).filter((id) => soupData.keyFacts.some((fact) => fact.id === id));
  const revealedKeySet = new Set(validKeys);
  return {
    answer: result.answer,
    progress,
    keyFacts: soupData.keyFacts.map((fact) => ({ ...fact, revealed: revealedKeySet.has(fact.id) })),
    revealedKeys: validKeys,
    newlyRevealedKeys: [] as number[],
    revealedSupplements: savedSupplements,
    completed: false,
  };
}

// ---------- 从存档消息中重算进度 ----------
function recalculateProgressFromMessages(messagesJson: any): { progress: number; revealedSupplements: { surfaces: number[]; bottoms: number[] } } {
  const messages: { role: string; content: string }[] = parseJson(messagesJson) ?? [];
  const assistantMsgs = messages.filter(m => m.role === "assistant");

  let bestProgress = 0;
  let bestSupp: { surfaces: number[]; bottoms: number[] } = { surfaces: [], bottoms: [] };

  for (const msg of assistantMsgs) {
    const parsed = repairJson(msg.content);
    if (!parsed) continue;

    // 从 keyFacts 重算
    const keyFacts = Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [];
    if (keyFacts.length > 0) {
      const calculated = keyFacts.reduce((sum: number, kf: any) => {
        if (kf.revealed) return sum + (kf.weight || 0);
        return sum;
      }, 0);
      const p = Math.round(Math.min(100, calculated));
      if (p > bestProgress) bestProgress = p;
    }

    // 收集最新的 revealedSupplement
    const surfs = Array.isArray(parsed.revealedSupplementSurfaces)
      ? parsed.revealedSupplementSurfaces.filter((n: unknown) => typeof n === "number" && Number.isInteger(n)) : [];
    const bots = Array.isArray(parsed.revealedSupplementBottoms)
      ? parsed.revealedSupplementBottoms.filter((n: unknown) => typeof n === "number" && Number.isInteger(n)) : [];
    const merged = mergeSupplements(bestSupp, { surfaces: surfs, bottoms: bots });
    bestSupp = merged;
  }

  return { progress: bestProgress, revealedSupplements: bestSupp };
}

function mergeSupplements(saved: { surfaces: number[]; bottoms: number[] }, ai: { surfaces: number[]; bottoms: number[] }) {
  return {
    surfaces: [...new Set([...saved.surfaces, ...ai.surfaces])].sort((a, b) => a - b),
    bottoms: [...new Set([...saved.bottoms, ...ai.bottoms])].sort((a, b) => a - b)
  };
}

// ---------- 内容哈希 ----------
function contentHash(data: { surface: string; bottom: string; manual: string; supplementalSurfaces: string[]; supplementalBottoms: string[] }): string {
  const input = `${data.surface}|${data.bottom}|${data.manual}|${JSON.stringify(data.supplementalSurfaces)}|${JSON.stringify(data.supplementalBottoms)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function sessionContentHash(data: GameSoupData): string {
  const input = `${contentHash(data)}|${JSON.stringify(data.keyFacts)}|${data.aiPrompt ?? ""}`;
  return createHash("sha256").update(input).digest("hex");
}

function trimConversationMessages(messages: { role: string; content: string }[], limit = 60) {
  return messages.filter((message) => message.role !== "system").slice(-limit);
}

function sessionMatchesSoup(session: GameSessionRow, soupData: GameSoupData) {
  return Boolean(session.content_hash) && session.content_hash === sessionContentHash(soupData);
}

// ---------- 大模型预拆分关键事实点 ----------
export async function splitKeyFactsForSoup(soupId: string): Promise<void> {
  if (!DEEPSEEK_API_KEY) return;

  try {
    const soupData = await getSoupGameData(soupId);
    if (!soupData) return;

    // 检查是否已经有匹配的缓存
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT key_facts, key_facts_hash, key_facts_customized FROM soups WHERE id = ? LIMIT 1", [soupId]
    );
    if (rows.length === 0) return;

    const newHash = contentHash(soupData);
    const existingHash = rows[0].key_facts_hash as string | null;
    const existingFacts = parseJson<KeyFact[]>(rows[0].key_facts);
    const isCustomized = (rows[0].key_facts_customized as number) === 1;

    // 用户已自定义关键点，不覆盖
    if (isCustomized) return;

    // 哈希匹配且有数据，不需要重新拆分
    if (existingHash === newHash && existingFacts && existingFacts.length > 0) return;

    const prompt = `你是一个海龟汤分析专家。请仔细阅读以下汤底，将完整真相拆解成 N 个关键事实点（5-15 个）。

每个关键事实点是一个独立的"必须知道的事"：
  例如——凶手是谁、动机是什么、手法是什么、关键道具、人物关系、时间线、反转点、隐藏信息等

权重分配原则：
  - 核心（凶手身份、动机、核心诡计、因果关键）→ 高权重，如 12-20
  - 重要（人物关系、关键道具、时间节点）→ 中等权重，如 8-12
  - 次要（边缘细节、配角身份、无关事件）→ 低权重，如 3-7
  - 所有权重加起来必须等于 100

---
汤面（参考）:
${soupData.surface}

汤底:
${soupData.bottom}

主持人手册:
${soupData.manual || "无"}

补充汤面:
${soupData.supplementalSurfaces.length > 0 ? soupData.supplementalSurfaces.map((s, i) => `[${i}] ${s}`).join("\n") : "无"}

补充汤底:
${soupData.supplementalBottoms.length > 0 ? soupData.supplementalBottoms.map((s, i) => `[${i}] ${s}`).join("\n") : "无"}
---

请直接输出 JSON 数组，不要任何代码块标记或额外文字，仅输出[开头的数组：
[{"id":1,"content":"凶手是父亲","weight":20},{"id":2,"content":"动机是复仇","weight":18},...]

注意：content 字段必须是中文。`;

    const resp = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 3000,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(30_000)
    });

    if (!resp.ok) {
      console.error("splitKeyFacts API error:", resp.status);
      return;
    }

    const data = await resp.json() as { choices: { message: { content: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "";
    console.error("splitKeyFacts raw:", raw.slice(0, 500));

    const parsed = repairArrayJson(raw);
    if (!parsed || parsed.length === 0) {
      console.error("splitKeyFacts: invalid response", raw.slice(0, 300));
      return;
    }

    // 验证权重总和
    const totalWeight = parsed.reduce((sum: number, kf: any) => sum + (kf.weight || 0), 0);
    if (Math.abs(totalWeight - 100) > 5) {
      console.error(`splitKeyFacts: weight sum ${totalWeight} not 100, normalizing`);
      // 归一化
      const factor = 100 / totalWeight;
      parsed.forEach((kf: any) => { kf.weight = Math.round(kf.weight * factor); });
      // 修正舍入误差，调整最大权重的
      const adjusted = Math.round(parsed.reduce((sum: number, kf: any) => sum + kf.weight, 0));
      if (adjusted !== 100 && parsed.length > 0) {
        parsed[0].weight += (100 - adjusted);
      }
    }

    await pool.query(
      "UPDATE soups SET key_facts = ?, key_facts_hash = ?, ai_prompt = ? WHERE id = ?",
      [JSON.stringify(parsed), newHash, "", soupId]
    );
    console.error(`splitKeyFacts: saved ${parsed.length} facts for soup ${soupId}`);
  } catch (err) {
    console.error("splitKeyFacts error:", err);
  }
}

// ---------- 强制重新拆分（清除自定义标记） ----------
export async function forceReanalyzeKeyFacts(soupId: string): Promise<void> {
  await pool.query(
    "UPDATE soups SET key_facts_customized = 0, key_facts_hash = NULL WHERE id = ?",
    [soupId]
  );
  await splitKeyFactsForSoup(soupId);
}

// ================ 路由 ================

gameRouter.post("/:soupId/start", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });
  let soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });
  soupData = await ensureSoupKeyFacts(req.params.soupId, soupData);
  if (soupData.keyFacts.length === 0) {
    return res.status(503).json({ error: "AI 关键点尚未解析完成，请稍后重试或联系作者配置关键点" });
  }

  const [existing] = await pool.query<GameSessionRow[]>(
    "SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]
  );
  let staleSessionId: string | null = null;
  if (existing.length > 0) {
    const s = existing[0];
    if (!sessionMatchesSoup(s, soupData)) {
      staleSessionId = s.id;
    } else {
    const msgs: { role: string; content: string }[] = parseJson(s.messages) ?? [];
    const recalculated = recalculateProgressFromMessages(s.messages);
    const supp = recalculated.revealedSupplements.surfaces.length > 0 || recalculated.revealedSupplements.bottoms.length > 0
      ? recalculated.revealedSupplements
      : (parseJson<{ surfaces: number[]; bottoms: number[] }>(s.revealed_supplements) ?? { surfaces: [], bottoms: [] });
    const progress = Math.max(s.progress ?? 0, recalculated.progress);
    const revealedKeys = parseJson<number[]>(s.revealed_keys) ?? [];
    return res.json({
      sessionId: s.id,
      messages: trimConversationMessages(msgs),
      progress,
      completed: progress >= 100,
      revealedKeys,
      revealedSupplements: supp,
    });
    }
  }

  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, [], [], soupData.keyFacts, soupData.aiPrompt, []);
  const initialMsg = { role: "assistant", content: "欢迎来到海龟汤！请提出你的推理和猜测，我会用\"是\"\"不是\"\"是也不是\"\"不知道\"\"不重要\"来回应。需要提示时点左下角灯泡按钮。开始吧！" };
  const messages = JSON.stringify([{ role: "system", content: systemPrompt }, initialMsg]);
  const id = nanoid(24);

  if (staleSessionId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("DELETE FROM game_sessions WHERE id = ?", [staleSessionId]);
      await connection.query(
        "INSERT INTO game_sessions (id, soup_id, user_id, messages, revealed_keys, revealed_supplements, content_hash, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, req.params.soupId, user.id, messages, "[]", JSON.stringify({ surfaces: [], bottoms: [] }), sessionContentHash(soupData), 0]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } else {
    await pool.query(
      "INSERT INTO game_sessions (id, soup_id, user_id, messages, revealed_keys, revealed_supplements, content_hash, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, req.params.soupId, user.id, messages, "[]", JSON.stringify({ surfaces: [], bottoms: [] }), sessionContentHash(soupData), 0]
    );
  }
  res.json({ sessionId: id, messages: [initialMsg], progress: 0, completed: false, revealedKeys: [], revealedSupplements: { surfaces: [], bottoms: [] } });
});

gameRouter.post("/:soupId/ask", aiRateLimiter, async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });
  const parsed = z.object({ question: z.string().trim().min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "请输入有效问题" });

  let soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });
  soupData = await ensureSoupKeyFacts(req.params.soupId, soupData);
  if (soupData.keyFacts.length === 0) {
    return res.status(503).json({ error: "AI 关键点尚未解析完成，请稍后重试或联系作者配置关键点" });
  }

  const [sessions] = await pool.query<GameSessionRow[]>(
    "SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]
  );
  if (sessions.length === 0) return res.status(400).json({ error: "请先开始游戏" });

  const session = sessions[0];
  if (!sessionMatchesSoup(session, soupData)) return res.status(409).json({ error: "海龟汤内容已更新，请重新开始本局" });
  if ((session.progress ?? 0) >= 100) return res.status(409).json({ error: "本局已经通关，如需再玩请重新开始" });
  const messages: { role: string; content: string }[] = parseJson(session.messages) ?? [];
  const savedSupp = parseJson<{ surfaces: number[]; bottoms: number[] }>(session.revealed_supplements) ?? { surfaces: [], bottoms: [] };
  const existingProgress = Math.max(recalculateProgressFromMessages(session.messages).progress, session.progress ?? 0);

  const savedKeys: number[] = parseJson<number[]>(session.revealed_keys) ?? [];
  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, savedSupp.surfaces, savedSupp.bottoms, soupData.keyFacts, soupData.aiPrompt, savedKeys);
  const history = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content
  }));
  history.push({ role: "user", content: parsed.data.question });

  let result: TurnResult;
  try {
    result = await callDeepSeek(systemPrompt, history);
  } catch (error) {
    return sendAiServiceError(res, error);
  }

  let turn = normalizeTurnResult(result, soupData, savedKeys, savedSupp, existingProgress);
  if ((result.answer === "是" || result.answer === "是也不是") && turn.newlyRevealedKeys.length === 0) {
    const recoveryQuota = await consumeAiQuota(user.id).catch(() => ({ allowed: false, dailyExceeded: false }));
    const recoveredIds = recoveryQuota.allowed
      ? await recoverMatchedKeyIds(parsed.data.question, soupData.keyFacts, savedKeys)
      : [];
    if (recoveredIds.length > 0) {
      result.matchedKeyIds = [...new Set([...result.matchedKeyIds, ...recoveredIds])];
      turn = normalizeTurnResult(result, soupData, savedKeys, savedSupp, existingProgress);
    }
  }

  const newMessages = trimConversationMessages([...messages, { role: "user", content: parsed.data.question }, { role: "assistant", content: serializeAssistantTurn(turn) }]);
  const fullMessages = [{ role: "system", content: systemPrompt }, ...newMessages];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (turn.completed) {
      await connection.query("INSERT IGNORE INTO soup_access_grants (id, soup_id, user_id, granted_by) VALUES (?, ?, ?, ?)",
        [nanoid(), req.params.soupId, user.id, "system"]);
      await connection.query(
        "INSERT IGNORE INTO game_completions (session_id, user_id, soup_id) VALUES (?, ?, ?)",
        [session.id, user.id, req.params.soupId]
      );
    }
    await recordKeyHits(user.id, req.params.soupId, turn.newlyRevealedKeys, connection);
    await connection.query("UPDATE game_sessions SET messages = ?, revealed_supplements = ?, progress = ?, revealed_keys = ?, content_hash = ? WHERE id = ?",
      [JSON.stringify(fullMessages), JSON.stringify(turn.revealedSupplements), turn.progress, JSON.stringify(turn.revealedKeys), sessionContentHash(soupData), session.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  reportBadgeProgress(user.id);
  res.json({ answer: turn.answer, progress: turn.progress, revealedKeys: turn.revealedKeys, revealedSupplements: turn.revealedSupplements, completed: turn.completed });
});

gameRouter.post("/:soupId/hint", aiRateLimiter, async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });
  let soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });
  soupData = await ensureSoupKeyFacts(req.params.soupId, soupData);
  if (soupData.keyFacts.length === 0) {
    return res.status(503).json({ error: "AI 关键点尚未解析完成，请稍后重试或联系作者配置关键点" });
  }

  const [sessions] = await pool.query<GameSessionRow[]>(
    "SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]
  );
  if (sessions.length === 0) return res.status(400).json({ error: "请先开始游戏" });

  const session = sessions[0];
  if (!sessionMatchesSoup(session, soupData)) return res.status(409).json({ error: "海龟汤内容已更新，请重新开始本局" });
  if ((session.progress ?? 0) >= 100) return res.status(409).json({ error: "本局已经通关，如需再玩请重新开始" });
  const messages: { role: string; content: string }[] = parseJson(session.messages) ?? [];
  const savedSupp = parseJson<{ surfaces: number[]; bottoms: number[] }>(session.revealed_supplements) ?? { surfaces: [], bottoms: [] };
  const existingProgress = Math.max(recalculateProgressFromMessages(session.messages).progress, session.progress ?? 0);

  // 推理进度 < 20% 不允许使用提示
  if (existingProgress < 20) {
    return res.status(400).json({ error: "推理进度不足 20%，请先自己探索一下再来获取提示吧！" });
  }

  const savedKeysHint: number[] = parseJson<number[]>(session.revealed_keys) ?? [];
  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, savedSupp.surfaces, savedSupp.bottoms, soupData.keyFacts, soupData.aiPrompt, savedKeysHint);
  const history = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content
  }));
  history.push({ role: "user", content: "请从未揭示关键点中选择一个与当前已知事实相邻的推理维度，先在内部删掉该关键点的具体答案词，再直接输出玩家下一步可以追问或关注的方向。可以引用已揭示事实，但不能说出任何未揭示事实的具体人物关系、动机、手法、工具、时间、地点或结论。不要返回固定兜底提示。" });

  let result: TurnResult;
  try {
    result = await callDeepSeek(systemPrompt, history);
  } catch (error) {
    return sendAiServiceError(res, error);
  }

  // 提示只提供方向，不新增关键点、不改变进度，也不能触发通关。
  const turn = createHintTurn(result, soupData, savedKeysHint, savedSupp, existingProgress);

  const newMessages = trimConversationMessages([...messages, { role: "user", content: "🔔 请求提示" }, { role: "assistant", content: serializeAssistantTurn(turn) }]);
  const fullMessages = [{ role: "system", content: systemPrompt }, ...newMessages];

  await pool.query("UPDATE game_sessions SET messages = ?, content_hash = ? WHERE id = ?",
    [JSON.stringify(fullMessages), sessionContentHash(soupData), session.id]);

  res.json({ answer: turn.answer, progress: turn.progress, revealedKeys: turn.revealedKeys, revealedSupplements: turn.revealedSupplements, completed: turn.completed });
});

gameRouter.post("/:soupId/restart", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });

  let soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });
  soupData = await ensureSoupKeyFacts(req.params.soupId, soupData);
  if (soupData.keyFacts.length === 0) {
    return res.status(503).json({ error: "AI 关键点尚未解析完成，请稍后重试或联系作者配置关键点" });
  }

  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, [], [], soupData.keyFacts, soupData.aiPrompt, []);
  const initialMsg = { role: "assistant", content: "欢迎来到海龟汤！请提出你的推理和猜测，我会用\"是\"\"不是\"\"是也不是\"\"不知道\"\"不重要\"来回应。需要提示时点左下角灯泡按钮。开始吧！" };
  const messages = JSON.stringify([{ role: "system", content: systemPrompt }, initialMsg]);
  const id = nanoid(24);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM game_sessions WHERE soup_id = ? AND user_id = ?", [req.params.soupId, user.id]);
    await connection.query(
      "INSERT INTO game_sessions (id, soup_id, user_id, messages, revealed_keys, revealed_supplements, content_hash, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, req.params.soupId, user.id, messages, "[]", JSON.stringify({ surfaces: [], bottoms: [] }), sessionContentHash(soupData), 0]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ sessionId: id, messages: [initialMsg], progress: 0, completed: false, revealedKeys: [], revealedSupplements: { surfaces: [], bottoms: [] } });
});

gameRouter.get("/:soupId/status", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });

  const soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });

  const [sessions] = await pool.query<GameSessionRow[]>(
    "SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]
  );
  if (sessions.length === 0) return res.json({ exists: false });

  const session = sessions[0];
  if (!sessionMatchesSoup(session, soupData)) return res.json({ exists: false, stale: true });
  const recalculated = recalculateProgressFromMessages(session.messages);
  const supp = recalculated.revealedSupplements.surfaces.length > 0 || recalculated.revealedSupplements.bottoms.length > 0
    ? recalculated.revealedSupplements
    : (parseJson<{ surfaces: number[]; bottoms: number[] }>(session.revealed_supplements) ?? { surfaces: [], bottoms: [] });
  const progress = Math.max(session.progress ?? 0, recalculated.progress);
  const revealedKeys = parseJson<number[]>(session.revealed_keys) ?? [];
  res.json({
    exists: true, sessionId: session.id,
    messages: trimConversationMessages(parseJson<any[]>(session.messages) ?? []),
    progress, completed: progress >= 100, revealedKeys, revealedSupplements: supp
  });
});

export default gameRouter;
