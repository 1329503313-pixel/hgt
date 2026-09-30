import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AccountUser, SoupDetail, KeyFact } from "../shared/types";
import { api, BadgeUnlocksResponse, clearApiCache, MeResponse, SpecialBadgeUnlock, StatsResponse } from "../api";
import { resetServerEventConnection, subscribeServerEvent } from "../shared/serverEvents";
import { removeSessionCachePrefix } from "../shared/sessionCache";

export type BadgeUnlockEvent = { key: string; stats: StatsResponse; specialBadge?: SpecialBadgeUnlock };
export type PhoneStatus = { bound: boolean; phone: string | null; legacyLoginEnabled: boolean; superAdminExempt: boolean };

// ---------- 常量 ----------
export const soupTypes = ["本格清汤", "本格红汤", "本格黑汤", "变格清汤", "变格红汤", "变格黑汤", "纯机制汤", "王八汤", "其他"];
export const soupDifficulties = ["简单", "普通", "困难", "地狱"] as const;
export function formatViews(value: number) {
  if (value >= 10000) return `${Number((value / 10000).toFixed(value >= 100000 ? 0 : 1))}w`;
  return value.toLocaleString();
}

// ---------- 表单类型 ----------
export type SoupForm = {
  title: string;
  author: string;
  type: string;
  difficulty: "简单" | "普通" | "困难" | "地狱";
  topicId: string;
  topicName: string;
  topicIsActive: boolean;
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
  canConfigureAiGame: boolean;
  enableAiGame: boolean;
  keyFacts: KeyFact[];
  keyFactsCustomized: boolean;
  keyFactsGenerationIssue?: string | null;
};

export type EvalForm = {
  isAnonymous: boolean;
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
  difficulty: "普通",
  topicId: "",
  topicName: "",
  topicIsActive: false,
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
  canConfigureAiGame: false,
  enableAiGame: false,
  keyFacts: [],
  keyFactsCustomized: false,
  keyFactsGenerationIssue: null
};

export const emptyEval: EvalForm = {
  isAnonymous: false,
  total: "",
  writing: "",
  logic: "",
  share: "",
  mechanism: "",
  twist: "",
  depth: "",
  content: ""
};

function createFormStore<T>(initialValue: T) {
  let value = initialValue;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (next: T) => {
      value = next;
      for (const listener of listeners) listener();
    }
  };
}

const soupFormStore = createFormStore<SoupForm>(emptySoup);
const evalFormStore = createFormStore<EvalForm>(emptyEval);

export function useSoupForm() {
  return [useSyncExternalStore(soupFormStore.subscribe, soupFormStore.getSnapshot), soupFormStore.set] as const;
}

export function useEvalForm() {
  return [useSyncExternalStore(evalFormStore.subscribe, evalFormStore.getSnapshot), evalFormStore.set] as const;
}

// ---------- Context 类型 ----------
type AppContextValue = {
  // 用户
  user: AccountUser | null;
  setUser: (u: AccountUser | null) => void;
  loadingUser: boolean;

  // Toast
  toast: string;
  showToast: (msg: string) => void;

  // 全局刷新 key
  refreshKey: number;
  triggerRefresh: () => void;

  // 全局新徽章通知
  badgeUnlock: BadgeUnlockEvent | null;
  checkBadgeUnlocks: () => Promise<void>;
  dismissBadgeUnlock: () => void;

  // 认证模态框
  authMode: "login" | "register" | null;
  authError: string;
  setAuthError: (e: string) => void;
  openAuth: () => void;
  closeAuth: () => void;
  switchAuthMode: () => void;
  phoneStatus: PhoneStatus | null;
  phoneBindingOpen: boolean;
  openPhoneBinding: () => void;
  closePhoneBinding: () => void;
  completePhoneBinding: (phone: string) => void;
  refreshPhoneStatus: () => Promise<void>;

  // SoupEditor 模态框
  showSoupForm: boolean;
  editingSoupId: string | null;
  openSoupEditor: (soup?: SoupDetail) => void;
  closeSoupEditor: () => void;

  // EvalEditor 模态框
  showEvalForm: boolean;
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
  const [user, setUserState] = useState<AccountUser | null>(null);
  const userIdRef = useRef<string | null>(null);
  const [loadingUser, setLoadingUser] = useState(true); // 初始 true，等待 /me 返回
  const [toast, setToastRaw] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [badgeUnlockQueue, setBadgeUnlockQueue] = useState<BadgeUnlockEvent[]>([]);

  // 认证模态框
  const [authMode, setAuthModeRaw] = useState<"login" | "register" | null>(null);
  const [authError, setAuthError] = useState("");
  const [phoneStatusState, setPhoneStatusState] = useState<{ userId: string; status: PhoneStatus } | null>(null);
  const [phoneBindingRequested, setPhoneBindingRequested] = useState(false);
  const [phoneBindingDismissedUserId, setPhoneBindingDismissedUserId] = useState<string | null>(null);
  const phoneStatusRequestRef = useRef(0);

  // SoupEditor 模态框
  const [showSoupForm, setShowSoupForm] = useState(false);
  const [editingSoupId, setEditingSoupId] = useState<string | null>(null);

  // EvalEditor 模态框
  const [showEvalForm, setShowEvalForm] = useState(false);
  const [soupIdForEval, setSoupIdForEval] = useState("");

  // 导出预览
  const [exportReady, setExportReady] = useState<{ url: string; name: string } | null>(null);

  const submittingSoupRef = useRef(false);
  const submittingEvalRef = useRef(false);
  const badgeCheckInFlightRef = useRef(false);
  const badgeLastCheckedAtRef = useRef(0);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToastRaw(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((msg: string) => setToastRaw(msg), []);
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const setUser = useCallback((nextUser: AccountUser | null) => {
    const nextUserId = nextUser?.id ?? null;
    if (userIdRef.current !== nextUserId) {
      clearApiCache();
      removeSessionCachePrefix("hgt:");
      resetServerEventConnection();
      ++phoneStatusRequestRef.current;
      if (!nextUserId) setPhoneBindingDismissedUserId(null);
    }
    userIdRef.current = nextUserId;
    setUserState(nextUser);
  }, []);
  const refreshPhoneStatus = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) { setPhoneStatusState(null); return; }
    const requestId = ++phoneStatusRequestRef.current;
    const status = await api<PhoneStatus>("/api/auth/phone/status", { bypassCache: true, dedupe: false });
    if (userIdRef.current === userId && phoneStatusRequestRef.current === requestId) setPhoneStatusState({ userId, status });
  }, []);
  useEffect(() => {
    setPhoneBindingRequested(false);
    setPhoneStatusState(null);
    if (user?.id) void refreshPhoneStatus().catch(() => undefined);
  }, [user?.id, refreshPhoneStatus]);
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible" || !userIdRef.current) return;
      setPhoneBindingDismissedUserId(null);
      void refreshPhoneStatus().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [refreshPhoneStatus]);
  const phoneStatus = phoneStatusState && phoneStatusState.userId === user?.id ? phoneStatusState.status : null;
  const phoneBindingOpen = Boolean(user && phoneStatus && !phoneStatus.bound && !phoneStatus.superAdminExempt &&
    (phoneBindingRequested || phoneBindingDismissedUserId !== user.id));
  const openPhoneBinding = useCallback(() => setPhoneBindingRequested(true), []);
  const closePhoneBinding = useCallback(() => {
    setPhoneBindingDismissedUserId(userIdRef.current);
    setPhoneBindingRequested(false);
  }, []);
  const completePhoneBinding = useCallback((phone: string) => {
    const userId = userIdRef.current;
    if (!userId) return;
    ++phoneStatusRequestRef.current;
    setPhoneStatusState({ userId, status: {
      bound: true, phone: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
      legacyLoginEnabled: false, superAdminExempt: false,
    } });
    setPhoneBindingDismissedUserId(userId);
    setPhoneBindingRequested(false);
  }, []);
  const checkBadgeUnlocks = useCallback(async (force = false) => {
    if (badgeCheckInFlightRef.current) return;
    if (!force && Date.now() - badgeLastCheckedAtRef.current < 60_000) return;
    badgeCheckInFlightRef.current = true;
    try {
      const data = await api<BadgeUnlocksResponse>("/api/me/badge-unlocks/sync", { method: "POST" });
      if (data.unlocks.length > 0) {
        const specialBadges = new Map(data.specialBadges.map((badge) => [badge.key, badge]));
        setBadgeUnlockQueue((queue) => [
          ...queue,
          ...data.unlocks.map((key) => ({ key, stats: data.stats, specialBadge: specialBadges.get(key) })),
        ]);
      }
    } catch {
      // 未登录或服务暂时不可用时不影响当前操作
    } finally {
      badgeLastCheckedAtRef.current = Date.now();
      badgeCheckInFlightRef.current = false;
    }
  }, []);
  const dismissBadgeUnlock = useCallback(() => {
    setBadgeUnlockQueue((queue) => queue.slice(1));
  }, []);

  // 页面加载时读取登录状态
  useEffect(() => {
    api<MeResponse>("/api/auth/me", { bypassCache: true, dedupe: false })
      .then((data) => {
        userIdRef.current = data.user?.id ?? null;
        setUserState(data.user);
      })
      .catch(() => undefined)
      .finally(() => setLoadingUser(false));
  }, []);

  const badgeSyncedUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) {
      badgeSyncedUserRef.current = null;
      setBadgeUnlockQueue([]);
      return;
    }
    if (badgeSyncedUserRef.current === user.id) return;
    badgeSyncedUserRef.current = user.id;
    const run = () => void checkBadgeUnlocks(true);
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(run, { timeout: 2_000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = setTimeout(run, 1_000);
    return () => clearTimeout(timer);
  }, [user, checkBadgeUnlocks]);

  // 徽章由业务事件实时计算；收到解锁事件时立即领取弹窗，低频轮询只作断线兜底。
  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeServerEvent("unread_changed", (event) => {
      try {
        const payload = JSON.parse(event.data) as { source?: string };
        if (payload.source === "badge_unlock") void checkBadgeUnlocks(true);
      } catch {
        // 忽略格式异常的事件，兜底轮询仍会恢复状态。
      }
    });
    const unsubscribeOwnership = subscribeServerEvent("badge_ownership_changed", () => {
      void checkBadgeUnlocks(true);
      void api<MeResponse>("/api/auth/me", { bypassCache: true, dedupe: false })
        .then((data) => {
          setUserState(data.user);
          triggerRefresh();
        })
        .catch(() => undefined);
    });
    const timer = window.setInterval(() => void checkBadgeUnlocks(), 5 * 60_000);
    const handleFocus = () => void checkBadgeUnlocks();
    window.addEventListener("focus", handleFocus);
    return () => {
      unsubscribe();
      unsubscribeOwnership();
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [user, checkBadgeUnlocks, triggerRefresh]);

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
      soupFormStore.set({
        title: soup.title,
        author: soup.author,
        type: soup.type,
        difficulty: soup.difficulty,
        topicId: soup.topic?.id ?? "",
        topicName: soup.topic?.name ?? "",
        topicIsActive: soup.topic?.isActive ?? false,
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
        canConfigureAiGame: soup.canConfigureAiGame,
        enableAiGame: (soup as any).enableAiGame ?? false,
        keyFacts: (soup.keyFacts ?? []).map((fact) => ({ ...fact, hintContent: fact.hintContent ?? "" })),
        keyFactsCustomized: soup.keyFactsCustomized ?? false,
        keyFactsGenerationIssue: soup.keyFactsGenerationIssue ?? null
      });
    } else {
      setEditingSoupId(null);
      soupFormStore.set({ ...emptySoup, author: "" });
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
      evalFormStore.set({
        isAnonymous: Boolean(ownEval.isAnonymous),
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
      evalFormStore.set(emptyEval);
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
    badgeUnlock: badgeUnlockQueue[0] ?? null,
    checkBadgeUnlocks,
    dismissBadgeUnlock,
    authMode,
    authError,
    setAuthError,
    openAuth,
    closeAuth,
    switchAuthMode,
    phoneStatus,
    phoneBindingOpen,
    openPhoneBinding,
    closePhoneBinding,
    completePhoneBinding,
    refreshPhoneStatus,
    showSoupForm,
    editingSoupId,
    openSoupEditor,
    closeSoupEditor,
    showEvalForm,
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
