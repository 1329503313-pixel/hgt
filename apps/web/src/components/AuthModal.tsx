import { FormEvent, useState } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal";
import { useApp } from "../context/AppContext";
import { api, MeResponse } from "../api";
import {
  ACCOUNT_NICKNAME_MAX_LENGTH,
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  ACCOUNT_USERNAME_MAX_LENGTH,
  ACCOUNT_USERNAME_MIN_LENGTH,
  accountNicknameError,
  accountPasswordError,
  accountUsernameError
} from "../shared/accountRules";

export function AuthModal() {
  const { authMode, closeAuth, switchAuthMode, authError, setAuthError, setUser, triggerRefresh } = useApp();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  // authMode is already guaranteed not null by the parent calling this

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    if (authMode === "register") {
      const validationError = accountNicknameError(String(payload.nickname ?? ""))
        || accountUsernameError(String(payload.username ?? ""))
        || accountPasswordError(String(payload.password ?? ""));
      if (validationError) {
        setAuthError(validationError);
        return;
      }
    }
    setSubmitting(true);
    try {
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api<MeResponse>(path, { method: "POST", body: payload });
      const verified = await api<MeResponse>("/api/auth/me", { bypassCache: true, dedupe: false });
      if (!verified.user) throw new Error("登录状态未能保存，请刷新页面后重试");
      if (!data.user || verified.user.id !== data.user.id) {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        setUser(null);
        throw new Error("登录账号校验不一致，旧会话已清除，请重新登录");
      }
      setUser(verified.user);
      setAuthError("");
      closeAuth();
      triggerRefresh();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败，请检查账号和密码");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={closeAuth}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <h2 className="text-xl font-black text-ink">{authMode === "login" ? "登录" : "注册"}</h2>
          <p className="mt-1 text-sm text-muted">登录状态将持久化 30 天。</p>
        </div>
        {authMode === "register" && (
          <label className="block space-y-2">
            <span className="label">昵称</span>
            <input className="field" name="nickname" maxLength={ACCOUNT_NICKNAME_MAX_LENGTH} autoComplete="nickname" aria-describedby="register-nickname-help" required />
            <span id="register-nickname-help" className="block text-xs text-muted">1 至 8 个字符，不可与其他用户重复</span>
          </label>
        )}
        <label className="block space-y-2">
          <span className="label">账号</span>
          <input
            className="field"
            name="username"
            autoComplete="username"
            maxLength={authMode === "register" ? ACCOUNT_USERNAME_MAX_LENGTH : undefined}
            aria-describedby={authMode === "register" ? "register-username-help" : undefined}
            required
          />
          {authMode === "register" && <span id="register-username-help" className="block text-xs text-muted">{ACCOUNT_USERNAME_MIN_LENGTH} 至 {ACCOUNT_USERNAME_MAX_LENGTH} 位，仅支持大小写英文、数字和符号，不可重复</span>}
        </label>
        <label className="block space-y-2">
          <span className="label">密码</span>
          <input
            className="field"
            name="password"
            type="password"
            autoComplete={authMode === "register" ? "new-password" : "current-password"}
            minLength={authMode === "register" ? ACCOUNT_PASSWORD_MIN_LENGTH : undefined}
            maxLength={authMode === "register" ? ACCOUNT_PASSWORD_MAX_LENGTH : undefined}
            aria-describedby={authMode === "register" ? "register-password-help" : undefined}
            required
          />
          {authMode === "register" && <span id="register-password-help" className="block text-xs text-muted">密码至少 {ACCOUNT_PASSWORD_MIN_LENGTH} 位</span>}
        </label>
        {authMode === "register" && (
          <div>
            <input
              className="field uppercase"
              name="invitationCode"
              placeholder="邀请码（选填，5位）"
              maxLength={5}
              autoComplete="off"
              pattern="[A-Za-z0-9]{5}"
              onInput={(event) => {
                event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
              }}
            />
            <p className="mt-1.5 text-xs text-muted">邀请码仅可在注册账号时填写，注册后不可补填或修改。</p>
          </div>
        )}
        {authMode === "login" && (
          <button
            className="w-full text-right text-sm font-bold text-primary"
            type="button"
            onClick={() => {
              closeAuth();
              navigate("/forgot-password");
            }}
          >
            忘记密码？
          </button>
        )}
        {authError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger" role="alert">{authError}</div>}
        <button className="btn btn-primary w-full" disabled={submitting}>{submitting ? "提交中……" : authMode === "login" ? "登录" : "注册并登录"}</button>
        <button className="btn btn-secondary w-full" type="button" onClick={switchAuthMode}>
          {authMode === "login" ? "没有账号，去注册" : "已有账号，去登录"}
        </button>
      </form>
    </Modal>
  );
}

export function ExportPreview() {
  const { exportReady, setExportReady } = useApp();
  if (!exportReady) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/45 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-24px)] w-full max-w-lg overflow-auto overscroll-contain rounded-2xl bg-white p-4 shadow-soft">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-black text-ink">图片已生成</div>
            <div className="mt-1 truncate text-xs text-muted">{exportReady.name} · 长按或右键保存图片</div>
          </div>
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-50 text-muted" onClick={() => setExportReady(null)} aria-label="关闭导出预览">
            <X size={18} />
          </button>
        </div>
        <img className="w-full rounded-xl border border-line bg-page" src={exportReady.url} alt="导出预览" />
      </div>
    </div>
  );
}
