import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Bot, Send, Lightbulb, Sparkles, ChevronDown, ChevronUp, RotateCcw, Menu } from "lucide-react";
import { ChatComposerIconButton } from "./ChatComposerIconButton";
import type { SoupDetail } from "../shared/types";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { sanitizeHtml } from "../sanitizeHtml";

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

type GameState = {
  messages: ChatMessage[];
  progress: number;
  revealedSupplements: { surfaces: number[]; bottoms: number[] };
  completed: boolean;
  loading: boolean;
};

export function GameModal({
  soup,
  onBack
}: {
  soup: SoupDetail;
  onBack: () => void;
}) {
  const { checkBadgeUnlocks, showToast } = useApp();
  const [state, setState] = useState<GameState>({
    messages: [],
    progress: 0,
    revealedSupplements: { surfaces: [], bottoms: [] },
    completed: false,
    loading: true
  });
  const [input, setInput] = useState("");
  const [infoExpanded, setInfoExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // AI 玩汤是独立工作区。锁定背景滚动，并通过 Portal 脱离详情页的层叠上下文。
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // 进入时自动开始/载入游戏
  useEffect(() => {
    api<{
      sessionId: string;
      messages: ChatMessage[];
      progress: number;
      completed: boolean;
      revealedSupplements: { surfaces: number[]; bottoms: number[] };
    }>(`/api/game/${soup.id}/start`, { method: "POST" })
      .then((data) => {
        setState({ messages: data.messages, progress: data.progress, revealedSupplements: data.revealedSupplements, completed: data.completed, loading: false });
      })
      .catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : "游戏加载失败，请稍后重试");
        setState((s) => ({ ...s, loading: false }));
      });
  }, [soup.id, showToast]);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  async function handleSend() {
    const q = input.trim();
    if (!q || state.loading) return;
    setInput("");
    setState((s) => ({
      ...s,
      loading: true,
      messages: [...s.messages, { role: "user", content: q }]
    }));

    try {
      const data = await api<{
        answer: string;
        progress: number;
        revealedSupplements: { surfaces: number[]; bottoms: number[] };
        completed: boolean;
      }>(`/api/game/${soup.id}/ask`, { method: "POST", body: { question: q } });
      setState((s) => ({
        ...s,
        loading: false,
        progress: data.progress,
        revealedSupplements: data.revealedSupplements,
        completed: data.completed,
        messages: [...s.messages, { role: "assistant", content: data.answer }]
      }));
      await checkBadgeUnlocks();
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 服务暂时不可用，请稍后重试";
      setState((s) => ({
        ...s,
        loading: false,
        messages: [...s.messages, { role: "assistant", content: `发送失败：${message}` }]
      }));
    }
  }

  async function handleHint() {
    if (state.loading) return;
    setState((s) => ({ ...s, loading: true }));

    try {
      const data = await api<{
        answer: string;
        progress: number;
        revealedSupplements: { surfaces: number[]; bottoms: number[] };
        completed: boolean;
      }>(`/api/game/${soup.id}/hint`, { method: "POST" });
      setState((s) => ({
        ...s,
        loading: false,
        progress: data.progress,
        revealedSupplements: data.revealedSupplements,
        completed: data.completed,
        messages: [
          ...s.messages,
          { role: "user", content: "🔔 请求提示" },
          { role: "assistant", content: data.answer }
        ]
      }));
      await checkBadgeUnlocks();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "提示获取失败，请稍后重试");
      setState((s) => ({ ...s, loading: false }));
    }
  }

  async function handleRestart() {
    if (state.loading) return;
    setState((s) => ({ ...s, loading: true, messages: [] }));
    try {
      const data = await api<{
        sessionId: string;
        messages: ChatMessage[];
        progress: number;
        completed: boolean;
        revealedSupplements: { surfaces: number[]; bottoms: number[] };
      }>(`/api/game/${soup.id}/restart`, { method: "POST" });
      setState({
        messages: data.messages,
        progress: data.progress,
        revealedSupplements: data.revealedSupplements,
        completed: data.completed,
        loading: false
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "重新开始失败，请稍后重试");
      setState((s) => ({ ...s, loading: false }));
    }
  }

  const progressHint = state.completed
    ? "真相已经揭晓"
    : state.progress >= 90
      ? "已接近真相，可以继续确认剩余关键信息"
      : state.progress < 20
        ? "进度达到20%后可获取提示"
        : "已解锁方向性提示";

  return createPortal(
    <div className="ai-game-workspace" role="dialog" aria-modal="true" aria-label={`AI 玩汤：${soup.title}`}>
      <header className="ai-game-header">
        <div className="ai-game-header-inner">
          <button className="ai-game-back" onClick={onBack} aria-label="返回海龟汤详情">
            <ArrowLeft size={19} />
            <span>返回详情</span>
          </button>
          <div className="ai-game-brand">
            <span className="ai-game-brand-icon"><Sparkles size={17} /></span>
            <span><strong>AI 玩汤</strong><small>沉浸式推理</small></span>
          </div>
          <span className="ai-game-header-title" title={soup.title}>{soup.title}</span>
        </div>
      </header>

      <main className="ai-game-main">
        <aside className="ai-game-case-panel">
          <div className="ai-game-case-heading">
            <span>CASE FILE</span>
            <h1>{soup.title}</h1>
            <p>阅读汤面，向 AI 主持人提出只能用“是 / 否 / 无关”回答的问题。</p>
          </div>

          <section className={`ai-game-surface-card ${infoExpanded ? "is-expanded" : ""}`}>
            <div className="ai-game-card-title">
              <span><Sparkles size={15} />汤面</span>
              <button
                type="button"
                onClick={() => setInfoExpanded(!infoExpanded)}
                aria-expanded={infoExpanded}
                aria-label={infoExpanded ? "收起汤面" : "展开汤面"}
              >
                {infoExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </button>
            </div>
            <div
              className="ai-game-surface-content content-block"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(soup.surface) }}
            />
          </section>

          <section className="ai-game-progress-card" aria-label={`推理进度 ${state.progress}%`}>
            <div className="ai-game-progress-title">
              <div className="ai-game-progress-label">
                <span>推理进度</span>
                <small>{progressHint}</small>
              </div>
              <strong>{state.progress}%</strong>
            </div>
            <div className="ai-game-progress-track">
              <div style={{ width: `${Math.max(3, state.progress)}%` }} />
            </div>
          </section>

          {(state.revealedSupplements.surfaces.length > 0 || state.revealedSupplements.bottoms.length > 0) && (
            <section className="ai-game-clues" aria-label="已解锁内容">
              <h2>已解锁内容</h2>
              <div>
                {state.revealedSupplements.surfaces.map((idx) => (
                  <span key={`s${idx}`}><Sparkles size={12} />补充汤面 #{idx + 1}</span>
                ))}
                {state.revealedSupplements.bottoms.map((idx) => (
                  <span key={`b${idx}`} className="is-bottom"><Sparkles size={12} />补充汤底 #{idx + 1}</span>
                ))}
              </div>
            </section>
          )}

          {state.completed && <div className="ai-game-complete">🎉 恭喜通关！返回详情页即可查看完整汤底。</div>}
        </aside>

        <section className="ai-game-chat-panel">
          <header className="ai-game-chat-header">
            <span className="ai-game-host-avatar"><Bot size={23} /></span>
            <span><strong>AI 主持人</strong><small><i />正在主持本局游戏</small></span>
          </header>

          <div ref={chatRef} className="ai-game-messages" aria-live="polite">
            <div className="ai-game-message-list">
              {state.messages.length === 0 && !state.loading && (
                <div className="ai-game-empty">
                  <span><Bot size={26} /></span>
                  <strong>准备好开始推理了吗？</strong>
                  <p>从人物、时间、地点或异常行为入手，试着提出你的第一个问题。</p>
                </div>
              )}
              {state.messages.map((msg, i) => (
                <div key={i} className={`ai-game-message ${msg.role === "user" ? "is-user" : "is-assistant"}`}>
                  {msg.role === "assistant" && <span className="ai-game-message-avatar"><Bot size={17} /></span>}
                  <div>
                    <small>{msg.role === "user" ? "我" : "AI 主持人"}</small>
                    <div
                      className="ai-game-bubble"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(extractDisplayContent(msg.content, msg.role)) }}
                    />
                  </div>
                </div>
              ))}
              {state.loading && (
                <div className="ai-game-message is-assistant">
                  <span className="ai-game-message-avatar"><Bot size={17} /></span>
                  <div><small>AI 主持人</small><div className="ai-game-bubble is-loading">推理中<DotDots /></div></div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <footer className="ai-game-composer-shell">
            {state.completed ? (
              <div className="ai-game-finished">🎉 游戏已通关，返回详情页查看完整汤底</div>
            ) : (
              <div className="ai-game-composer">
                <div className="ai-game-menu-wrap">
                  <ChatComposerIconButton
                    onClick={() => setMenuOpen(!menuOpen)}
                    disabled={state.loading}
                    aria-label="游戏菜单"
                    title="游戏菜单"
                  >
                    <Menu size={22} />
                  </ChatComposerIconButton>
                  {menuOpen && (
                    <div className="ai-game-menu">
                      <button
                        onClick={() => { if (state.progress >= 20) { void handleHint(); setMenuOpen(false); } }}
                        disabled={state.loading || state.progress < 20}
                        title={state.progress < 20 ? "推理进度需达到 20% 后才能使用提示" : "获取提示"}
                      >
                        <Lightbulb size={17} />获取提示{state.progress < 20 ? `（${state.progress}%）` : ""}
                      </button>
                      <button onClick={() => { setRestartConfirmOpen(true); setMenuOpen(false); }} disabled={state.loading}>
                        <RotateCcw size={17} />重新开始
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder="输入你的推理或提问…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  disabled={state.loading}
                  aria-label="推理问题"
                />
                <ChatComposerIconButton
                  tone="send"
                  onClick={() => void handleSend()}
                  disabled={state.loading || !input.trim()}
                  aria-label="发送"
                  title="发送"
                >
                  <Send size={22} />
                </ChatComposerIconButton>
              </div>
            )}
            {!state.completed && <p className="ai-game-composer-tip">Enter 发送 · Shift + Enter 换行</p>}
          </footer>
        </section>
      </main>

      {/* 重新开始确认弹窗 */}
      {restartConfirmOpen && (
        <div className="ai-game-confirm-backdrop">
          <div className="w-full max-w-sm rounded-t-xl bg-white p-5 shadow-soft sm:rounded-[20px]">
            <h3 className="text-base font-black text-ink">是否重新开始 AI 盘汤？</h3>
            <p className="mt-2 text-sm text-muted leading-6">重新开始将会重置进度。</p>
            <div className="mt-4 flex gap-3">
              <button
                className="btn btn-secondary flex-1"
                onClick={() => setRestartConfirmOpen(false)}
              >
                否
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={() => { setRestartConfirmOpen(false); handleRestart(); }}
              >
                是
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

/** 从 assistant 消息中提取显示内容：如果是完整 JSON，提取 answer 字段；否则直接显示 */
function extractDisplayContent(content: string, role: string): string {
  if (role !== "assistant") return content;
  try {
    const parsed = JSON.parse(content);
    if (parsed.answer && typeof parsed.answer === "string") return parsed.answer;
  } catch {
    // 不是 JSON，直接显示
  }
  return content;
}

function DotDots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => (n + 1) % 4), 400);
    return () => clearInterval(t);
  }, []);
  return <span className="inline-block w-8 text-left">{Array.from({ length: n }, () => ".").join("")}</span>;
}
