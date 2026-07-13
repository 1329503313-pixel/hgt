import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Lightbulb, Sparkles, ChevronDown, ChevronUp, RotateCcw, Menu } from "lucide-react";
import type { SoupDetail } from "../shared/types";
import { api } from "../api";

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
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入时自动开始/载入游戏
  useEffect(() => {
    api<{
      sessionId: string;
      messages: ChatMessage[];
      progress: number;
      revealedSupplements: { surfaces: number[]; bottoms: number[] };
    }>(`/api/game/${soup.id}/start`, { method: "POST" })
      .then((data) => {
        setState({ messages: data.messages, progress: data.progress, revealedSupplements: data.revealedSupplements, completed: false, loading: false });
      })
      .catch(() => {
        setState((s) => ({ ...s, loading: false }));
      });
  }, [soup.id]);

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
    } catch {
      setState((s) => ({
        ...s,
        loading: false,
        messages: [...s.messages, { role: "assistant", content: "网络错误，请重试。" }]
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
    } catch {
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
        revealedSupplements: { surfaces: number[]; bottoms: number[] };
      }>(`/api/game/${soup.id}/restart`, { method: "POST" });
      setState({
        messages: data.messages,
        progress: data.progress,
        revealedSupplements: data.revealedSupplements,
        completed: false,
        loading: false
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-page">
      {/* 顶栏 */}
      <header className="top-nav-shell shrink-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5">
          <button
            className="flex min-h-10 items-center gap-2 text-left text-base font-black text-ink"
            onClick={onBack}
          >
            <ArrowLeft size={18} />
            <span>返回详情</span>
          </button>
          <span className="text-sm font-bold text-muted">AI 玩汤</span>
          <div className="w-16" />
        </div>
      </header>

      {/* 上半部分：汤面 + 进度条（最高不超过屏幕一半，进度条始终可见） */}
      <div className="shrink-0 border-b border-line bg-white pt-[52px] max-h-[50vh] flex flex-col">
        <div className="mx-auto max-w-3xl px-4 pt-3 w-full space-y-3 flex flex-col min-h-0 flex-1">
          {/* 汤面卡片 — 卡片始终完整显示在画面内，内容超出时在卡片内部滚动 */}
          <div className="card p-3 flex flex-col min-h-0 flex-1">
            <div className="flex items-start justify-between gap-2 shrink-0">
              <h2 className="font-black text-ink">{soup.title}</h2>
              <button
                className="shrink-0 mt-1 grid h-7 w-7 place-items-center rounded-md bg-slate-100 text-muted"
                onClick={() => setInfoExpanded(!infoExpanded)}
              >
                {infoExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            <div
              className={`text-[14px] leading-6 text-ink content-block mt-3 overflow-auto min-h-0 flex-1 ${infoExpanded ? "" : "line-clamp-2 overflow-hidden"}`}
              dangerouslySetInnerHTML={{ __html: soup.surface }}
            />
          </div>

          {/* 进度条 — 始终可见，不参与滚动 */}
          <div className="shrink-0 pb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-bold text-muted">推理进度</span>
              <span className="text-sm font-black text-primary">{state.progress}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
                style={{ width: `${Math.max(3, state.progress)}%` }}
              />
            </div>
            {state.revealedSupplements.surfaces.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {state.revealedSupplements.surfaces.map((idx) => (
                  <span key={`s${idx}`} className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    <Sparkles size={11} className="mr-1" />补充汤面 #{idx + 1}
                  </span>
                ))}
                {state.revealedSupplements.bottoms.map((idx) => (
                  <span key={`b${idx}`} className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    <Sparkles size={11} className="mr-1" />补充汤底 #{idx + 1}
                  </span>
                ))}
              </div>
            )}
            {state.completed && (
              <div className="mt-2 rounded-md bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700">
                🎉 恭喜通关！
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 下半部分：聊天对话 */}
      <div
        ref={chatRef}
        className="relative flex-1 overflow-auto"
      >
        <div className="mx-auto max-w-3xl px-4 py-3 space-y-3">
          {state.messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-7 ${
                  msg.role === "user"
                    ? "bg-primary text-white"
                    : "border border-line bg-white text-ink"
                }`}
              >
                <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: msg.content }} />
              </div>
            </div>
          ))}
          {state.loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-line bg-white px-4 py-2.5 text-[15px] text-muted">
                推理中<DotDots />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 底部操作栏：菜单 + 输入 */}
      <div className="shrink-0 border-t border-line bg-white/95 backdrop-blur">
        {state.completed ? (
          <div className="mx-auto max-w-3xl px-4 py-4 text-center text-sm font-bold text-muted">
            🎉 游戏已通关！返回详情页查看完整汤底。
          </div>
        ) : (
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          {/* 菜单按钮 */}
          <div className="relative shrink-0">
            <button
              className="btn btn-secondary px-3"
              onClick={() => setMenuOpen(!menuOpen)}
              disabled={state.loading}
              title="菜单"
            >
              <Menu size={18} />
            </button>
            {menuOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-44 rounded-xl border border-line bg-white shadow-lg py-1.5 z-20">
                <button
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-bold text-ink hover:bg-slate-50 transition-colors"
                  onClick={() => { handleHint(); setMenuOpen(false); }}
                  disabled={state.loading}
                >
                  <Lightbulb size={16} className="text-amber-500" />
                  获取提示
                </button>
                <button
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-bold text-ink hover:bg-red-50 hover:text-red-600 transition-colors"
                  onClick={() => { setRestartConfirmOpen(true); setMenuOpen(false); }}
                  disabled={state.loading}
                >
                  <RotateCcw size={16} className="text-muted" />
                  重新开始
                </button>
              </div>
            )}
          </div>
          <input
            ref={inputRef}
            className="field flex-1"
            placeholder="输入你的推理或提问…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            disabled={state.loading}
          />
          <button
            className="btn btn-primary shrink-0 px-4"
            onClick={handleSend}
            disabled={state.loading || !input.trim()}
          >
            <Send size={18} />
          </button>
        </div>
        )}
      </div>

      {/* 重新开始确认弹窗 */}
      {restartConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/35 p-0 sm:items-center sm:justify-center sm:p-4">
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
    </div>
  );
}

function DotDots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => (n + 1) % 4), 400);
    return () => clearInterval(t);
  }, []);
  return <span className="inline-block w-8 text-left">{Array.from({ length: n }, () => ".").join("")}</span>;
}
