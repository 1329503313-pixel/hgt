import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PublicUser, SoupDetail, KeyFact } from "../shared/types";
import { api, MeResponse } from "../api";

// ---------- 常量 ----------
export const soupTypes = ["本格清汤", "本格红汤", "本格黑汤", "变格清汤", "变格红汤", "变格黑汤", "纯机制汤", "其他"];
export function formatViews(value: number) {
  if (value >= 10000) return `${Number((value / 10000).toFixed(value >= 100000 ? 0 : 1))}w`;
  return value.toLocaleString();
}

// ---------- 表单类型 ----------
export type SoupForm = {
  title: string;
  author: string;
  type: string;
  summary: string;
  coverImage: string;
  isOriginal: boolean;
  isSensitive: boolean;
  surface: string;
  supplementalSurfaces: string[];
  bottom: string;
  supplementalBottoms: string[];
  manual: string;
  isSurfacePublic: boolean;
  isBottomPublic: boolean;
  enableAiGame: boolean;
  aiPrompt: string;
  keyFacts: KeyFact[];
  keyFactsCustomized: boolean;
};

export type EvalForm = {
  total: string;
  writing: string;
  logic: string;
  share: string;
  mechanism: string;
  twist: string;
  depth: string;
  content: string;
};

export const emptySoup: SoupForm = {
  title: "",
  author: "",
  type: "本格清汤",
  summary: "",
  coverImage: "",
  isOriginal: true,
  isSensitive: false,
  surface: "",
  supplementalSurfaces: [],
  bottom: "",
  supplementalBottoms: [],
  manual: "",
  isSurfacePublic: true,
  isBottomPublic: false,
  enableAiGame: false,
  aiPrompt: "",
  keyFacts: [],
  keyFactsCustomized: false
};

export const emptyEval: EvalForm = {
  total: "4",
  writing: "",
  logic: "",
  share: "",
  mechanism: "",
  twist: "",
  depth: "",
  content: ""
};

// ---------- Context 类型 ----------
type AppContextValue = {
  // 用户
  user: PublicUser | null;
  setUser: (u: PublicUser | null) => void;
  loadingUser: boolean;

  // Toast
  toast: string;
  showToast: (msg: string) => void;

  // 全局刷新 key
  refreshKey: number;
  triggerRefresh: () => void;

  // 认证模态框
  authMode: "login" | "register" | null;
  authError: string;
  setAuthError: (e: string) => void;
  openAuth: () => void;
  closeAuth: () => void;
  switchAuthMode: () => void;

  // SoupEditor 模态框
  showSoupForm: boolean;
  editingSoupId: string | null;
  soupForm: SoupForm;
  setSoupForm: (next: SoupForm) => void;
  openSoupEditor: (soup?: SoupDetail) => void;
  closeSoupEditor: () => void;

  // EvalEditor 模态框
  showEvalForm: boolean;
  evalForm: EvalForm;
  setEvalForm: (next: EvalForm) => void;
  soupIdForEval: string;
  setSoupIdForEval: (id: string) => void;
  openEvalEditor: (soupId: string, ownEval?: any) => void;
  closeEvalEditor: () => void;

  // 导出预览
  exportReady: { url: string; name: string } | null;
  setExportReady: (v: { url: string; name: string } | null) => void;

  // 并发保护 refs
  submittingSoupRef: React.RefObject<boolean>;
  submittingEvalRef: React.RefObject<boolean>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

// ---------- Provider ----------
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true); // 初始 true，等待 /me 返回
  const [toast, setToastRaw] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // 认证模态框
  const [authMode, setAuthModeRaw] = useState<"login" | "register" | null>(null);
  const [authError, setAuthError] = useState("");

  // SoupEditor 模态框
  const [showSoupForm, setShowSoupForm] = useState(false);
  const [editingSoupId, setEditingSoupId] = useState<string | null>(null);
  const [soupForm, setSoupForm] = useState<SoupForm>(emptySoup);

  // EvalEditor 模态框
  const [showEvalForm, setShowEvalForm] = useState(false);
  const [evalForm, setEvalForm] = useState<EvalForm>(emptyEval);
  const [soupIdForEval, setSoupIdForEval] = useState("");

  // 导出预览
  const [exportReady, setExportReady] = useState<{ url: string; name: string } | null>(null);

  const submittingSoupRef = useRef(false);
  const submittingEvalRef = useRef(false);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToastRaw(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((msg: string) => setToastRaw(msg), []);
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // 页面加载时读取登录状态
  useEffect(() => {
    api<MeResponse>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => undefined)
      .finally(() => setLoadingUser(false));
  }, []);

  const openAuth = useCallback(() => {
    setAuthError("");
    setAuthModeRaw("login");
  }, []);
  const closeAuth = useCallback(() => {
    setAuthError("");
    setAuthModeRaw(null);
  }, []);
  const switchAuthMode = useCallback(() => {
    setAuthError("");
    setAuthModeRaw((m) => (m === "login" ? "register" : "login"));
  }, []);

  const openSoupEditor = useCallback((soup?: SoupDetail) => {
    if (soup) {
      setEditingSoupId(soup.id);
      setSoupForm({
        title: soup.title,
        author: soup.author,
        type: soup.type,
        summary: soup.summary,
        coverImage: soup.coverImage ?? "",
        isOriginal: soup.isOriginal,
        isSensitive: (soup as any).isSensitive ?? false,
        surface: soup.surface,
        supplementalSurfaces: soup.supplementalSurfaces,
        bottom: soup.bottom ?? "",
        supplementalBottoms: soup.supplementalBottoms ?? [],
        manual: soup.manual ?? "",
        isSurfacePublic: soup.isSurfacePublic,
        isBottomPublic: soup.isBottomPublic,
        enableAiGame: (soup as any).enableAiGame ?? false,
        aiPrompt: soup.aiPrompt ?? "",
        keyFacts: soup.keyFacts ?? [],
        keyFactsCustomized: soup.keyFactsCustomized ?? false
      });
    } else {
      setEditingSoupId(null);
      setSoupForm({ ...emptySoup, author: "" });
    }
    setShowSoupForm(true);
  }, []);
  const closeSoupEditor = useCallback(() => {
    setShowSoupForm(false);
    setEditingSoupId(null);
  }, []);

  const openEvalEditor = useCallback((soupId: string, ownEval?: any) => {
    setSoupIdForEval(soupId);
    if (ownEval) {
      setEvalForm({
        total: String(ownEval.total),
        writing: ownEval.writing?.toString() ?? "",
        logic: ownEval.logic?.toString() ?? "",
        share: ownEval.share?.toString() ?? "",
        mechanism: ownEval.mechanism?.toString() ?? "",
        twist: ownEval.twist?.toString() ?? "",
        depth: ownEval.depth?.toString() ?? "",
        content: ownEval.content ?? ""
      });
    } else {
      setEvalForm(emptyEval);
    }
    setShowEvalForm(true);
  }, []);
  const closeEvalEditor = useCallback(() => setShowEvalForm(false), []);

  const value: AppContextValue = {
    user,
    setUser,
    loadingUser,
    toast,
    showToast,
    refreshKey,
    triggerRefresh,
    authMode,
    authError,
    setAuthError,
    openAuth,
    closeAuth,
    switchAuthMode,
    showSoupForm,
    editingSoupId,
    soupForm,
    setSoupForm,
    openSoupEditor,
    closeSoupEditor,
    showEvalForm,
    evalForm,
    setEvalForm,
    soupIdForEval,
    setSoupIdForEval,
    openEvalEditor,
    closeEvalEditor,
    exportReady,
    setExportReady,
    submittingSoupRef,
    submittingEvalRef
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
