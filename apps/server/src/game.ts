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

// ---------- 类型 ----------
interface KeyFact {
  id: number;
  content: string;
  weight: number;
}

interface GameSessionRow extends mysql.RowDataPacket {
  id: string;
  soup_id: number;
  user_id: string;
  messages: any;
  revealed_keys: any;
  revealed_supplements: any;
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

const aiRateBuckets = new Map<string, { count: number; resetAt: number }>();
function aiRateLimiter(req: any, res: any, next: any) {
  const user = req.user as GameUser | undefined;
  const key = user?.id ?? req.ip ?? "unknown";
  const now = Date.now();
  const bucket = aiRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    aiRateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > 30) {
    res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ error: "AI 请求过于频繁，请稍后再试" });
  }
  next();
}

async function recordKeyHits(userId: string, soupId: string, keyIds: unknown[]) {
  const uniqueIds = Array.from(new Set(
    keyIds.map((id) => Number(id)).filter((id) => Number.isInteger(id))
  ));
  if (uniqueIds.length === 0) return;

  const placeholders = uniqueIds.map(() => "(?, ?, ?)").join(", ");
  const values = uniqueIds.flatMap((keyId) => [userId, soupId, keyId]);
  await pool.query(
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

${preSplitKeyFacts ? preSplitKeyFacts.map(kf => `  [${kf.id}] ${kf.content}（权重 ${kf.weight}）`).join("\n") : "(无预拆分，你需要自己拆解)"}

【服务端已揭示状态——CRITICAL：这是累积状态，不要重置】
${revealedKeys && revealedKeys.length > 0
  ? `以下事实点已在之前的对话中被揭示（revealed: true），你必须继承这个状态，只能在此基础上追加新的揭示：
  ${revealedKeys.map(id => `  [${id}] — 已揭示 ✓`).join("\n")}
  未揭示的事实点: [${preSplitKeyFacts ? preSplitKeyFacts.filter(kf => !revealedKeys.includes(kf.id)).map(kf => kf.id).join(", ") : "需要自己推导"}]
  `
  : "目前尚无已揭示的事实点。"}

【每轮更新 progress】
每轮根据玩家提问，判断触及了哪些事实点：
  - 命中（回答"是"）→ 该事实点 100% 得分
  - 部分命中（回答"是也不是"）→ 该事实点 50% 得分
  - 未命中（"不是"/"不知道"/"不重要"）→ 0%
  - progress = 所有已触及事实点得分的总和（四舍五入取整）
  - 已得分的事实点不会重复计分
  - 服务端已揭示的事实点是累积的，你必须在 keyFacts 中把它们的 revealed 设为 true

示例计算：
  事实点 [20,18,15,12,10,10,8,7]，当前触及:
  - #1（权重20）→ 命中"是" → 得分20
  - #3（权重15）→ 部分命中"是也不是" → 得分7.5
  - #4（权重12）→ 命中"是" → 得分12
  总 progress = 20 + 7.5 + 12 = 39.5 → 四舍五入 = 40

CRITICAL: progress 必须只增不减。只能累积，不能倒退。${preSplitKeyFacts ? "" : "\n\n如果没有预拆分结果，先阅读汤底，拆解 N 个关键事实点（5-15 个），每个分配整数权重，总权重=100。然后在后续轮次中按上述规则更新 progress。"}

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

CRITICAL 提示约束：
- 只能基于 keyFacts 中 revealed:true 的事实点给出指引，帮玩家串联已发现的线索
- 绝不能提及任何 revealed:false 的事实点内容
- 不能暗示未揭示的补充汤面/汤底
- 不能透露汤底原文
- 如果玩家还未触及任何事实点（progress 很低），给出非常笼统的方向（如"试着从人物关系入手"），不要涉及任何具体事实

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

{"answer":"是","progress":40,"keyFacts":[{"id":1,"content":"凶手是父亲","weight":20,"revealed":true},{"id":2,"content":"动机是复仇","weight":18,"revealed":false}],"revealedSupplementSurfaces":[],"revealedSupplementBottoms":[],"completed":false}

字段说明：
- answer: 五选一；提示模式下可多写
- progress: 整数 0-100，按关键事实点权重计算
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
async function callDeepSeek(systemPrompt: string, messages: { role: string; content: string }[]): Promise<{
  answer: string;
  progress: number | null;
  keyFacts: any[];
  revealedSupplementSurfaces: number[];
  revealedSupplementBottoms: number[];
  completed: boolean;
}> {
  const empty = {
    answer: "", progress: null, keyFacts: [] as any[],
    revealedSupplementSurfaces: [] as number[], revealedSupplementBottoms: [] as number[], completed: false
  };

  if (!DEEPSEEK_API_KEY) {
    return { ...empty, answer: "服务未配置 AI 接口，请联系管理员设置 DEEPSEEK_API_KEY。" };
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
    return { ...empty, answer: "AI 服务暂时不可用，请稍后再试。" };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("DeepSeek API error:", resp.status, text);
    return { ...empty, answer: "AI 服务暂时不可用，请稍后再试。" };
  }

  const data = await resp.json() as { choices: { message: { content: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "";
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
        answer = "AI 返回了异常内容，请重试。";
      }
    }
    // 裁剪多余文字
    for (const w of allowedWords) { if (answer.startsWith(w) && answer.length > w.length) { answer = w; break; } }

    const progress = typeof parsed.progress === "number" && parsed.progress >= 0 && parsed.progress <= 100
      ? Math.round(parsed.progress) : null;

    const keyFacts = Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [];

    const revealedSupplementSurfaces = Array.isArray(parsed.revealedSupplementSurfaces)
      ? parsed.revealedSupplementSurfaces.filter((n: unknown) => typeof n === "number" && Number.isInteger(n)) : [];
    const revealedSupplementBottoms = Array.isArray(parsed.revealedSupplementBottoms)
      ? parsed.revealedSupplementBottoms.filter((n: unknown) => typeof n === "number" && Number.isInteger(n)) : [];
    const completed = typeof parsed.completed === "boolean" ? parsed.completed : false;

    return { answer, progress, keyFacts, revealedSupplementSurfaces, revealedSupplementBottoms, completed };
  } catch {
    console.error("DeepSeek JSON parse error, suppressing raw output (length %d)", raw.length);
    return { ...empty, answer: "AI 返回了无法解析的内容，请重试。" };
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
    keyFacts: parseJson<KeyFact[]>(rows[0].key_facts) ?? [],
    aiPrompt: (rows[0].ai_prompt as string) || null,
    creatorId: String(rows[0].creator_id),
    isSurfacePublic: Boolean(Number(rows[0].is_surface_public)),
    enableAiGame: Boolean(Number(rows[0].enable_ai_game)),
  };
}

function canPlaySoup(soup: GameSoupData, user: GameUser) {
  return soup.enableAiGame && (soup.isSurfacePublic || user.role === "admin" || soup.creatorId === user.id);
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
  const soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });

  const [existing] = await pool.query<GameSessionRow[]>(
    "SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]
  );
  if (existing.length > 0) {
    const s = existing[0];
    const msgs: { role: string; content: string }[] = parseJson(s.messages) ?? [];
    const recalculated = recalculateProgressFromMessages(s.messages);
    const supp = recalculated.revealedSupplements.surfaces.length > 0 || recalculated.revealedSupplements.bottoms.length > 0
      ? recalculated.revealedSupplements
      : (parseJson<{ surfaces: number[]; bottoms: number[] }>(s.revealed_supplements) ?? { surfaces: [], bottoms: [] });
    const progress = Math.max(s.progress ?? 0, recalculated.progress);
    return res.json({ sessionId: s.id, messages: msgs.filter(m => m.role !== "system"), progress, revealedKeys: [], revealedSupplements: supp });
  }

  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, [], [], soupData.keyFacts, soupData.aiPrompt, []);
  const initialMsg = { role: "assistant", content: "欢迎来到海龟汤！请提出你的推理和猜测，我会用\"是\"\"不是\"\"是也不是\"\"不知道\"\"不重要\"来回应。需要提示时点左下角灯泡按钮。开始吧！" };
  const messages = JSON.stringify([{ role: "system", content: systemPrompt }, initialMsg]);
  const id = nanoid(24);

  await pool.query(
    "INSERT INTO game_sessions (id, soup_id, user_id, messages, revealed_keys, revealed_supplements, progress) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, req.params.soupId, user.id, messages, "[]", JSON.stringify({ surfaces: [], bottoms: [] }), 0]
  );
  res.json({ sessionId: id, messages: [initialMsg], progress: 0, revealedKeys: [], revealedSupplements: { surfaces: [], bottoms: [] } });
});

gameRouter.post("/:soupId/ask", aiRateLimiter, async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });
  const parsed = z.object({ question: z.string().trim().min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "请输入有效问题" });

  const soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });

  const [sessions] = await pool.query<GameSessionRow[]>(
    "SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]
  );
  if (sessions.length === 0) return res.status(400).json({ error: "请先开始游戏" });

  const session = sessions[0];
  const messages: { role: string; content: string }[] = parseJson(session.messages);
  const savedSupp = parseJson<{ surfaces: number[]; bottoms: number[] }>(session.revealed_supplements) ?? { surfaces: [], bottoms: [] };
  let existingProgress: number = recalculateProgressFromMessages(session.messages).progress;
  if (existingProgress === 0 && (session.progress ?? 0) > 0) existingProgress = session.progress ?? 0;

  const savedKeys: number[] = parseJson<number[]>(session.revealed_keys) ?? [];
  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, savedSupp.surfaces, savedSupp.bottoms, soupData.keyFacts, soupData.aiPrompt, savedKeys);
  const history = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content
  }));
  history.push({ role: "user", content: parsed.data.question });

  const result = await callDeepSeek(systemPrompt, history);

  // 如果有 keyFacts，从 keyFacts 重新计算 progress
  let aiProgress = result.progress;
  if (result.keyFacts.length > 0) {
    const calculated = result.keyFacts.reduce((sum: number, kf: any) => {
      if (kf.revealed) return sum + (kf.weight || 0);
      return sum;
    }, 0);
    aiProgress = Math.round(Math.min(100, calculated));
  }

  const mergedSupp = mergeSupplements(savedSupp, { surfaces: result.revealedSupplementSurfaces, bottoms: result.revealedSupplementBottoms });
  let mergedProgress = Math.max(existingProgress, aiProgress ?? existingProgress);

  if (result.completed) {
    mergedProgress = 100;
    await pool.query("INSERT IGNORE INTO soup_access_grants (id, soup_id, user_id, granted_by) VALUES (?, ?, ?, ?)",
      [nanoid(), req.params.soupId, user.id, "system"]);
    await pool.query(
      "INSERT IGNORE INTO game_completions (session_id, user_id, soup_id) VALUES (?, ?, ?)",
      [session.id, user.id, req.params.soupId]
    );
  } else {
    mergedProgress = Math.min(mergedProgress, 99);
  }

  const newMessages = [...messages.filter(m => m.role !== "system"), { role: "user", content: parsed.data.question }, { role: "assistant", content: result.answer }];
  const fullMessages = [{ role: "system", content: systemPrompt }, ...newMessages];

  // 从 AI 返回的 keyFacts 中提取本轮新揭示的事实点 ID，合并到 revealedKeys
  const newRevealedIds = result.keyFacts.filter((kf: any) => kf.revealed).map((kf: any) => kf.id);
  const mergedKeys = [...new Set([...savedKeys, ...newRevealedIds])].sort((a, b) => a - b);
  await recordKeyHits(user.id, req.params.soupId, newRevealedIds);

  await pool.query("UPDATE game_sessions SET messages = ?, revealed_supplements = ?, progress = ?, revealed_keys = ? WHERE id = ?",
    [JSON.stringify(fullMessages), JSON.stringify(mergedSupp), mergedProgress, JSON.stringify(mergedKeys), session.id]);

  res.json({ answer: result.answer, progress: mergedProgress, revealedKeys: mergedKeys, revealedSupplements: mergedSupp, completed: result.completed });
});

gameRouter.post("/:soupId/hint", aiRateLimiter, async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });
  const soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });

  const [sessions] = await pool.query<GameSessionRow[]>(
    "SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]
  );
  if (sessions.length === 0) return res.status(400).json({ error: "请先开始游戏" });

  const session = sessions[0];
  const messages: { role: string; content: string }[] = parseJson(session.messages);
  const savedSupp = parseJson<{ surfaces: number[]; bottoms: number[] }>(session.revealed_supplements) ?? { surfaces: [], bottoms: [] };
  let existingProgress: number = recalculateProgressFromMessages(session.messages).progress;
  if (existingProgress === 0 && (session.progress ?? 0) > 0) existingProgress = session.progress ?? 0;

  // 推理进度 < 20% 不允许使用提示
  if (existingProgress < 20) {
    return res.status(400).json({ error: "推理进度不足 20%，请先自己探索一下再来获取提示吧！" });
  }

  const savedKeysHint: number[] = parseJson<number[]>(session.revealed_keys) ?? [];
  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, savedSupp.surfaces, savedSupp.bottoms, soupData.keyFacts, soupData.aiPrompt, savedKeysHint);
  const history = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content
  }));
  history.push({ role: "user", content: "请给我一个方向性的提示，指出我可能忽略了的推理方向或线索。不要直接揭示答案，而是给我指引。" });

  const result = await callDeepSeek(systemPrompt, history);

  let aiProgress = result.progress;
  if (result.keyFacts.length > 0) {
    const calculated = result.keyFacts.reduce((sum: number, kf: any) => {
      if (kf.revealed) return sum + (kf.weight || 0);
      return sum;
    }, 0);
    aiProgress = Math.round(Math.min(100, calculated));
  }

  const mergedSupp = mergeSupplements(savedSupp, { surfaces: result.revealedSupplementSurfaces, bottoms: result.revealedSupplementBottoms });
  let mergedProgress = Math.max(existingProgress, aiProgress ?? existingProgress);

  if (result.completed) {
    mergedProgress = 100;
    await pool.query("INSERT IGNORE INTO soup_access_grants (id, soup_id, user_id, granted_by) VALUES (?, ?, ?, ?)",
      [nanoid(), req.params.soupId, user.id, "system"]);
    await pool.query(
      "INSERT IGNORE INTO game_completions (session_id, user_id, soup_id) VALUES (?, ?, ?)",
      [session.id, user.id, req.params.soupId]
    );
  } else {
    mergedProgress = Math.min(mergedProgress, 99);
  }

  const newMessages = [...messages.filter(m => m.role !== "system"), { role: "user", content: "🔔 请求提示" }, { role: "assistant", content: result.answer }];
  const fullMessages = [{ role: "system", content: systemPrompt }, ...newMessages];

  // 从 AI 返回的 keyFacts 中提取本轮新揭示的事实点 ID，合并到 revealedKeys
  const newRevealedIdsHint = result.keyFacts.filter((kf: any) => kf.revealed).map((kf: any) => kf.id);
  const mergedKeysHint = [...new Set([...savedKeysHint, ...newRevealedIdsHint])].sort((a, b) => a - b);
  await recordKeyHits(user.id, req.params.soupId, newRevealedIdsHint);

  await pool.query("UPDATE game_sessions SET messages = ?, revealed_supplements = ?, progress = ?, revealed_keys = ? WHERE id = ?",
    [JSON.stringify(fullMessages), JSON.stringify(mergedSupp), mergedProgress, JSON.stringify(mergedKeysHint), session.id]);

  res.json({ answer: result.answer, progress: mergedProgress, revealedKeys: mergedKeysHint, revealedSupplements: mergedSupp, completed: result.completed });
});

gameRouter.post("/:soupId/restart", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "请先登录" });

  const soupData = await getSoupGameData(req.params.soupId);
  if (!soupData) return res.status(404).json({ error: "海龟汤不存在" });
  if (!canPlaySoup(soupData, user)) return res.status(403).json({ error: "该海龟汤未开放 AI 游戏或你没有查看权限" });

  await pool.query("DELETE FROM game_sessions WHERE soup_id = ? AND user_id = ?", [req.params.soupId, user.id]);

  const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, soupData.supplementalSurfaces, soupData.supplementalBottoms, [], [], soupData.keyFacts, soupData.aiPrompt, []);
  const initialMsg = { role: "assistant", content: "欢迎来到海龟汤！请提出你的推理和猜测，我会用\"是\"\"不是\"\"是也不是\"\"不知道\"\"不重要\"来回应。需要提示时点左下角灯泡按钮。开始吧！" };
  const messages = JSON.stringify([{ role: "system", content: systemPrompt }, initialMsg]);
  const id = nanoid(24);

  await pool.query(
    "INSERT INTO game_sessions (id, soup_id, user_id, messages, revealed_keys, revealed_supplements, progress) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, req.params.soupId, user.id, messages, "[]", JSON.stringify({ surfaces: [], bottoms: [] }), 0]
  );
  res.json({ sessionId: id, messages: [initialMsg], progress: 0, revealedKeys: [], revealedSupplements: { surfaces: [], bottoms: [] } });
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
  const recalculated = recalculateProgressFromMessages(session.messages);
  const supp = recalculated.revealedSupplements.surfaces.length > 0 || recalculated.revealedSupplements.bottoms.length > 0
    ? recalculated.revealedSupplements
    : (parseJson<{ surfaces: number[]; bottoms: number[] }>(session.revealed_supplements) ?? { surfaces: [], bottoms: [] });
  const progress = Math.max(session.progress ?? 0, recalculated.progress);
  res.json({
    exists: true, sessionId: session.id,
    messages: (parseJson<any[]>(session.messages) ?? []).filter((m: any) => m.role !== "system"),
    progress, revealedKeys: [], revealedSupplements: supp
  });
});

export default gameRouter;
