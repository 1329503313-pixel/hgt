import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const gameRouter = Router();
// mysql2 会自定将 JSON 列解析为对象，但也可能是 string，统一处理
function parseJson(val) {
    if (typeof val === "string")
        return parseJson(val);
    return val;
}
// ---------- 构建 System Prompt ----------
function buildSystemPrompt(surface, bottom, manual, keyPoints) {
    const pointsText = keyPoints.map((p, i) => `${i + 1}. ${p.key}：${p.description}`).join("\n");
    return `你是一个海龟汤（情境谜题）的主持人。玩家知道"汤面"（故事的表象），不知道"汤底"（故事的真相）。你需要根据玩家的提问引导他们推理出真相。

## 汤面（玩家已经看到的内容）
${surface}

## 汤底（主持人专用，绝对保密——不要直接告诉玩家）
${bottom}

## 主持人手册（引导指南）
${manual || "无特殊指引，按常规海龟汤主持方式进行。"}

## 关键线索点（用于追踪玩家还原进度）
${pointsText}

## 规则
1. 对玩家的提问回答"是""否""无关"，或给出简短的方向性提示
2. 绝对不要主动透露汤底的具体内容，即使玩家猜对了一个线索也不要直接说"你猜对了，事实就是..."
3. 回答使用温暖但不剧透的语气，像一位引导者而非考官
4. 如果玩家的提问方向完全偏离，温和地引导他们回到正轨
5. **重要：即使是第一个回答，也必须使用 JSON 格式输出，禁止输出纯文本**

## 关键线索点（用于追踪玩家还原进度）
${pointsText}

## 规则
1. 对玩家的提问回答"是""否""无关"，或给出简短的方向性提示
2. 绝对不要主动透露汤底的具体内容
3. 回答使用温暖但不剧透的语气
4. 如果玩家的提问方向完全偏离，温和地引导他们回到正轨
5. **重要：必须使用 JSON 格式输出**

## 输出格式
请只输出一行合法的 JSON：
{"answer":"回答内容","newlyRevealed":[],"hint":""}
- answer: 你的回答
- newlyRevealed: 本轮提问中新触及的关键线索点 key（空数组 = 未触及新线索）
- hint: 如果玩家请求提示且你给出提示，把提示内容放这里

注意：
- 只把本轮提问**新**触及的线索放入 newlyRevealed，不要重复之前已揭示的
- 不要输出 progress 字段——系统会自动计算
- 答案中禁止包含汤底原文`;
}
// ---------- 调用 DeepSeek API ----------
async function callDeepSeek(systemPrompt, messages) {
    if (!DEEPSEEK_API_KEY) {
        return { answer: "服务未配置 AI 接口，请联系管理员设置 DEEPSEEK_API_KEY。", hint: "", newlyRevealed: [] };
    }
    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
    ];
    const resp = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: "deepseek-v4-flash",
            messages: apiMessages,
            max_tokens: 1200,
            temperature: 0.7
        })
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("DeepSeek API error:", resp.status, text);
        return { answer: "AI 服务暂时不可用，请稍后再试。", hint: "", newlyRevealed: [] };
    }
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    console.error("DeepSeek raw response:", raw.slice(0, 300));
    try {
        const parsed = JSON.parse(raw);
        return {
            answer: typeof parsed.answer === "string" ? parsed.answer : String(parsed.answer ?? ""),
            hint: typeof parsed.hint === "string" ? parsed.hint : "",
            newlyRevealed: Array.isArray(parsed.newlyRevealed) ? parsed.newlyRevealed.filter((k) => typeof k === "string") : []
        };
    }
    catch {
        console.error("DeepSeek JSON parse error:", raw.slice(0, 200));
        return { answer: raw.slice(0, 500) || "AI 返回了无法解析的内容，请重试。", hint: "", newlyRevealed: [] };
    }
}
// ---------- 获取汤底数据用于游戏 ----------
async function getSoupGameData(soupId) {
    const [rows] = await pool.query("SELECT surface, bottom, host_manual FROM soups WHERE id = ? LIMIT 1", [soupId]);
    if (rows.length === 0)
        return null;
    return {
        surface: rows[0].surface,
        bottom: rows[0].bottom,
        manual: rows[0].host_manual ?? ""
    };
}
// 默认关键线索点（当汤没有自定义 key_points 时由 AI 自行判断）
const DEFAULT_KEY_POINTS = [
    { key: "凶手身份", description: "事件的主要责任人/造成者是谁" },
    { key: "作案动机", description: "造成事件的原因或动机" },
    { key: "作案手法", description: "事件发生的具体方式或手段" },
    { key: "关键证据", description: "能揭示真相的关键线索或物证" },
    { key: "时间线", description: "事件发生的准确时间和顺序" }
];
// ================ 路由 ================
// 开始/继续游戏
gameRouter.post("/:soupId/start", async (req, res) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ error: "请先登录" });
    const soupData = await getSoupGameData(req.params.soupId);
    if (!soupData)
        return res.status(404).json({ error: "海龟汤不存在" });
    // 检查已有存档
    const [existing] = await pool.query("SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]);
    if (existing.length > 0) {
        // 返回已有存档
        const session = existing[0];
        const msgs = parseJson(session.messages);
        return res.json({
            sessionId: session.id,
            messages: msgs,
            progress: session.progress,
            revealedKeys: parseJson(session.revealed_keys)
        });
    }
    // 新建存档
    const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, DEFAULT_KEY_POINTS);
    const initialMsg = { role: "assistant", content: "欢迎来到海龟汤！我已经准备好了，请输入你对这个谜题的推理和提问，我会以\"是\"\"否\"\"无关\"或提示来引导你逐步接近真相。你可以随时问我\"我还忽略了什么\"来获取提示。开始吧！🔍" };
    const id = nanoid(24);
    const messages = JSON.stringify([initialMsg]);
    await pool.query("INSERT INTO game_sessions (id, soup_id, user_id, messages, revealed_keys, progress) VALUES (?, ?, ?, ?, ?, ?)", [id, req.params.soupId, user.id, messages, "[]", 0]);
    res.json({
        sessionId: id,
        messages: [initialMsg],
        progress: 0,
        revealedKeys: []
    });
});
// 提问
gameRouter.post("/:soupId/ask", async (req, res) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ error: "请先登录" });
    const parsed = z.object({ question: z.string().trim().min(1).max(500) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "请输入有效问题" });
    const soupData = await getSoupGameData(req.params.soupId);
    if (!soupData)
        return res.status(404).json({ error: "海龟汤不存在" });
    // 获取或创建存档
    let [sessions] = await pool.query("SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]);
    if (sessions.length === 0)
        return res.status(400).json({ error: "请先开始游戏" });
    const session = sessions[0];
    const messages = parseJson(session.messages);
    const savedRevealed = parseJson(session.revealed_keys);
    // 计算当前进度 (保护下限: 不大于当前的 revealedKeys.length)
    const currentProgress = Math.round((savedRevealed.length / DEFAULT_KEY_POINTS.length) * 100);
    // 构建 prompt
    const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, DEFAULT_KEY_POINTS);
    // 已有线索上下文 (让 AI 知道已有进度)
    const historyCtx = `[当前已揭示的线索: ${savedRevealed.length > 0 ? savedRevealed.join("、") : "暂无"}]`;
    const history = messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content
    }));
    // 添加玩家提问
    const question = parsed.data.question;
    history.push({ role: "user", content: `${historyCtx}\n${question}` });
    // 调用 AI
    const result = await callDeepSeek(systemPrompt, history);
    // 合并新揭示的线索——只增不减
    const newRevealed = result.newlyRevealed.filter((k) => !savedRevealed.includes(k));
    const mergedRevealed = [...savedRevealed, ...newRevealed];
    // 保护: mergedRevealed 至少保留 savedRevealed (bot不能减少)
    const finalProgress = Math.round((mergedRevealed.length / DEFAULT_KEY_POINTS.length) * 100);
    // 检查是否是完成标志——progress >= 90 表示接近完成
    const answer = finalProgress >= 90
        ? result.answer + "\n\n🎉 你已经接近真相了！试着把你推理出的完整故事复述一遍吧。如果正确，就通关了！"
        : result.answer;
    // 保存到数据库
    const newMessages = [
        ...messages,
        { role: "user", content: question },
        { role: "assistant", content: answer }
    ];
    await pool.query("UPDATE game_sessions SET messages = ?, revealed_keys = ?, progress = ? WHERE id = ?", [JSON.stringify(newMessages), JSON.stringify(mergedRevealed), finalProgress, session.id]);
    res.json({
        answer,
        hint: result.hint,
        progress: finalProgress,
        revealedKeys: mergedRevealed
    });
});
// 请求提示
gameRouter.post("/:soupId/hint", async (req, res) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ error: "请先登录" });
    const soupData = await getSoupGameData(req.params.soupId);
    if (!soupData)
        return res.status(404).json({ error: "海龟汤不存在" });
    const [sessions] = await pool.query("SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]);
    if (sessions.length === 0)
        return res.status(400).json({ error: "请先开始游戏" });
    const session = sessions[0];
    const messages = parseJson(session.messages);
    const savedRevealed = parseJson(session.revealed_keys);
    const systemPrompt = buildSystemPrompt(soupData.surface, soupData.bottom, soupData.manual, DEFAULT_KEY_POINTS);
    const historyCtx = `[当前已揭示的线索: ${savedRevealed.length > 0 ? savedRevealed.join("、") : "暂无"}]`;
    const history = messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content
    }));
    history.push({ role: "user", content: `${historyCtx}\n请给我一个提示，指出我可能忽略了什么。不要直接揭示答案，而是给我方向性指引。` });
    const result = await callDeepSeek(systemPrompt, history);
    // 合并新揭示的线索
    const newRevealed = result.newlyRevealed.filter((k) => !savedRevealed.includes(k));
    const mergedRevealed = [...savedRevealed, ...newRevealed];
    const finalProgress = Math.round((mergedRevealed.length / DEFAULT_KEY_POINTS.length) * 100);
    const newMessages = [
        ...messages,
        { role: "user", content: "🔔 请求提示" },
        { role: "assistant", content: result.answer }
    ];
    await pool.query("UPDATE game_sessions SET messages = ?, revealed_keys = ?, progress = ? WHERE id = ?", [JSON.stringify(newMessages), JSON.stringify(mergedRevealed), finalProgress, session.id]);
    res.json({
        answer: result.answer,
        hint: result.hint,
        progress: finalProgress,
        revealedKeys: mergedRevealed
    });
});
// 获取游戏状态
gameRouter.get("/:soupId/status", async (req, res) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ error: "请先登录" });
    const [sessions] = await pool.query("SELECT * FROM game_sessions WHERE soup_id = ? AND user_id = ? LIMIT 1", [req.params.soupId, user.id]);
    if (sessions.length === 0)
        return res.json({ exists: false });
    const session = sessions[0];
    res.json({
        exists: true,
        sessionId: session.id,
        messages: parseJson(session.messages),
        progress: session.progress,
        revealedKeys: parseJson(session.revealed_keys)
    });
});
export default gameRouter;
