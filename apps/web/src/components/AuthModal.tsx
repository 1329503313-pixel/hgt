import { FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal";
import { useApp } from "../context/AppContext";
import { api, MeResponse } from "../api";
import {
  ACCOUNT_NICKNAME_MAX_LENGTH,
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  accountNicknameError,
  accountPasswordError
} from "../shared/accountRules";
import { registrationErrorMessage } from "../shared/registrationErrors";

export function AuthModal() {
  const { authMode, closeAuth, switchAuthMode, authError, setAuthError, setUser, triggerRefresh } = useApp();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loginType, setLoginType] = useState<"phone" | "legacy">("phone");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    if (sending || cooldown > 0) return;
    setSending(true);
    setAuthError("");
    try {
      await api("/api/auth/phone/code", {
        method: "POST",
        body: {
          phone,
          purpose: "register",
        },
      });
      setCooldown(60);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "发送短信失败，请稍后再试");
    } finally { setSending(false); }
  }

  async function finishLogin(data: MeResponse) {
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
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (authMode === "register") {
      const validationError = accountNicknameError(nickname)
        || accountPasswordError(password)
        || (password !== confirmPassword ? "两次输入的密码不一致" : "")
        || (!/^\d{6}$/.test(code) ? "请输入 6 位短信验证码" : "");
      if (validationError) {
        setAuthError(validationError);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (authMode === "register") {
        const data = await api<MeResponse>("/api/auth/register", {
          method: "POST", body: { phone, code, password, nickname, invitationCode },
        });
        await finishLogin(data);
      } else {
        const data = await api<MeResponse>("/api/auth/login", {
          method: "POST", body: { loginType, identifier, password },
        });
        await finishLogin(data);
      }
    } catch (error) {
      setAuthError(authMode === "register"
        ? registrationErrorMessage(error)
        : error instanceof Error ? error.message : "登录失败，请检查账号和密码");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={closeAuth}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <h2 className="text-xl font-black text-ink">{authMode === "login" ? "登录" : "注册账号"}</h2>
          <p className="mt-1 text-sm text-muted">{authMode === "login" ? "登录状态将持久化 30 天。" : "通过手机号验证后创建账号。"}</p>
        </div>
        {authMode === "login" && (
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" aria-selected={loginType === "phone"} className={`btn ${loginType === "phone" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setLoginType("phone"); setIdentifier(""); setAuthError(""); }}>手机号登录</button>
            <button type="button" role="tab" aria-selected={loginType === "legacy"} className={`btn ${loginType === "legacy" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setLoginType("legacy"); setIdentifier(""); setAuthError(""); }}>原始账号登录</button>
          </div>
        )}
        {authMode === "register" && (
          <label className="block space-y-2">
            <span className="label">昵称</span>
            <input className="field" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={ACCOUNT_NICKNAME_MAX_LENGTH} autoComplete="nickname" aria-describedby="register-nickname-help" required />
            <span id="register-nickname-help" className="block text-xs text-muted">1 至 8 个字符，不可与其他用户重复</span>
          </label>
        )}
        {authMode === "login" ? <label className="block space-y-2">
          <span className="label">{loginType === "phone" ? "手机号" : "原始账号"}</span>
          <input
            className="field"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete={loginType === "phone" ? "tel" : "username"}
            inputMode={loginType === "phone" ? "tel" : "text"}
            required
          />
          {loginType === "phone" && <span className="block text-xs text-muted">仅支持中国大陆手机号；超级管理员可在此输入原始账号。</span>}
        </label> : <div className="space-y-2">
          <label className="label block" htmlFor="auth-phone">手机号</label>
          <input id="auth-phone" className="field" value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" required />
          <label className="label block" htmlFor="auth-code">短信验证码</label>
          <div className="flex gap-2"><input id="auth-code" className="field min-w-0 flex-1" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required /><button type="button" className="btn btn-secondary shrink-0" disabled={sending || cooldown > 0 || !phone} onClick={() => void sendCode()}>{sending ? "发送中…" : cooldown > 0 ? `${cooldown}秒` : "发送短信"}</button></div>
        </div>}
        <label className="block space-y-2">
          <span className="label">{authMode === "register" ? "设置密码" : "密码"}</span>
          <input
            className="field"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={authMode === "register" ? "new-password" : "current-password"}
            minLength={authMode === "register" ? ACCOUNT_PASSWORD_MIN_LENGTH : undefined}
            maxLength={authMode === "register" ? ACCOUNT_PASSWORD_MAX_LENGTH : undefined}
            required
          />
          {authMode === "register" && <span className="block text-xs text-muted">密码至少 {ACCOUNT_PASSWORD_MIN_LENGTH} 位</span>}
        </label>
        {authMode === "register" && <label className="block space-y-2"><span className="label">确认密码</span><input className="field" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>}
        {authMode === "register" && (
          <div>
            <input
              className="field uppercase"
              value={invitationCode}
              onChange={(event) => setInvitationCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="邀请码（选填，5位）"
              maxLength={5}
              autoComplete="off"
              pattern="[A-Za-z0-9]{5}"
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
          {authMode === "login" ? "注册账号" : "已有账号，去登录"}
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
