import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { useApp } from "../context/AppContext";
import { ACCOUNT_PASSWORD_MAX_LENGTH, ACCOUNT_PASSWORD_MIN_LENGTH } from "../shared/accountRules";

const RESET_TOKEN_STORAGE_KEY = "hgt_password_reset_token";
type RecoveryMode = "phone" | "email";

function resetTokenFromLocation() {
  const incoming = new URLSearchParams(window.location.search).get("token")
    ?? new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  if (incoming) return incoming;
  if (!window.location.pathname.endsWith("/reset-password")) return "";
  try { return window.sessionStorage.getItem(RESET_TOKEN_STORAGE_KEY) ?? ""; } catch { return ""; }
}

export default function ForgotPasswordPage() {
  const { openAuth, showToast } = useApp();
  const navigate = useNavigate();
  const [token] = useState(resetTokenFromLocation);
  const [mode, setMode] = useState<RecoveryMode>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState({ next: "", confirm: "" });
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: "contact" | "code" | "next" | "confirm" | "form"; message: string } | null>(null);
  const [cooldowns, setCooldowns] = useState<Record<RecoveryMode, number>>({ phone: 0, email: 0 });
  const cooldown = cooldowns[mode];

  useEffect(() => {
    if (!token) return;
    try { window.sessionStorage.setItem(RESET_TOKEN_STORAGE_KEY, token); } catch { /* 会话存储可能不可用。 */ }
    window.history.replaceState(window.history.state, "", "/reset-password");
  }, [token]);

  useEffect(() => {
    if (cooldowns.phone <= 0 && cooldowns.email <= 0) return;
    const timer = window.setTimeout(() => setCooldowns((current) => ({
      phone: Math.max(0, current.phone - 1), email: Math.max(0, current.email - 1),
    })), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldowns]);

  async function sendCode() {
    if (saving || cooldown > 0) return;
    const requestMode = mode;
    if (requestMode === "phone" && !/^1[3-9]\d{9}$/.test(phone.trim())) return setError({ field: "contact", message: "请输入正确的中国大陆手机号" });
    if (requestMode === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError({ field: "contact", message: "请输入正确的绑定邮箱" });
    setError(null);
    setSaving(true);
    try {
      if (requestMode === "phone") {
        await api("/api/auth/phone/code", { method: "POST", body: { phone: phone.trim(), purpose: "recover" } });
        showToast("如该手机号已绑定账号，短信验证码将发送到手机");
      } else {
        await api("/api/auth/email/recover/request", { method: "POST", body: { email: email.trim() } });
        showToast("如该邮箱已绑定账号，验证码将发送到邮箱");
      }
      setCooldowns((current) => ({ ...current, [requestMode]: 60 }));
    } catch (error) { setError({ field: "form", message: (error as Error).message }); }
    finally { setSaving(false); }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!token && mode === "phone" && !/^1[3-9]\d{9}$/.test(phone.trim())) return setError({ field: "contact", message: "请输入正确的中国大陆手机号" });
    if (!token && mode === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError({ field: "contact", message: "请输入正确的绑定邮箱" });
    if (!token && !/^\d{6}$/.test(code)) return setError({ field: "code", message: "请输入 6 位验证码" });
    if (password.next.length < ACCOUNT_PASSWORD_MIN_LENGTH) return setError({ field: "next", message: `新密码至少需要 ${ACCOUNT_PASSWORD_MIN_LENGTH} 位` });
    if (password.next !== password.confirm) return setError({ field: "confirm", message: "两次输入的新密码不一致" });
    setError(null);
    setSaving(true);
    try {
      if (token) {
        await api("/api/auth/password/reset/confirm", { method: "POST", body: { token, newPassword: password.next } });
        try { window.sessionStorage.removeItem(RESET_TOKEN_STORAGE_KEY); } catch { /* 会话存储可能不可用。 */ }
      } else if (mode === "phone") {
        await api("/api/auth/phone/reset", { method: "POST", body: { phone: phone.trim(), code, newPassword: password.next } });
      } else {
        await api("/api/auth/email/recover/confirm", { method: "POST", body: { email: email.trim(), code, newPassword: password.next } });
      }
      setCompleted(true);
    } catch (error) { setError({ field: "form", message: (error as Error).message }); }
    finally { setSaving(false); }
  }

  function goToLogin() {
    navigate("/", { replace: true });
    window.setTimeout(openAuth, 0);
  }

  return (
    <section className="space-y-4">
      <PageTopBar title="找回密码" />
      <MineBackButton to="/" />
      <div className="card p-4">
        {completed ? (
          <div className="space-y-4 text-center">
            <h1 className="text-lg font-black text-ink">密码已重置</h1>
            <p className="text-sm text-muted">请使用新密码重新登录，其他设备上的旧登录状态将失效。</p>
            <button type="button" className="btn btn-primary w-full" onClick={goToLogin}>返回登录</button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={resetPassword} noValidate>
            <div>
              <h1 className="text-lg font-black text-ink">{token ? "设置新密码" : "找回密码"}</h1>
              <p className="mt-1 text-sm text-muted">{token ? "请设置新密码。" : "使用已绑定的手机号或邮箱验证身份后设置新密码。"}</p>
            </div>
            {!token && (
              <>
                <div className="flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="找回密码方式">
                  <button type="button" role="tab" aria-selected={mode === "phone"} className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-bold ${mode === "phone" ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => { setMode("phone"); setCode(""); setError(null); }}>手机号验证码</button>
                  <button type="button" role="tab" aria-selected={mode === "email"} className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-bold ${mode === "email" ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => { setMode("email"); setCode(""); setError(null); }}>邮箱验证码</button>
                </div>
                <label className="block space-y-2">
                  <span className="label">{mode === "phone" ? "手机号" : "绑定邮箱"}</span>
                  <input className="field" type={mode === "phone" ? "tel" : "email"} inputMode={mode === "phone" ? "tel" : "email"} autoComplete={mode === "phone" ? "tel" : "email"} maxLength={mode === "phone" ? 11 : 255} value={mode === "phone" ? phone : email} onChange={(event) => { mode === "phone" ? setPhone(event.target.value) : setEmail(event.target.value); if (error?.field === "contact") setError(null); }} aria-invalid={error?.field === "contact"} placeholder={mode === "phone" ? "请输入中国大陆手机号" : "name@example.com"} required />
                  {error?.field === "contact" && <span role="alert" className="block text-sm text-danger">{error.message}</span>}
                </label>
                <div className="space-y-2">
                  <label className="label" htmlFor="recovery-code">{mode === "phone" ? "短信验证码" : "邮箱验证码"}</label>
                  <div className="flex gap-2">
                    <input id="recovery-code" className="field min-w-0 flex-1" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); if (error?.field === "code") setError(null); }} aria-invalid={error?.field === "code"} aria-describedby={error?.field === "code" ? "recovery-code-error" : undefined} placeholder="6 位验证码" required />
                    <button type="button" className="btn btn-secondary shrink-0" disabled={saving || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown} 秒` : mode === "phone" ? "发送短信" : "发送邮件"}</button>
                  </div>
                  {error?.field === "code" && <p id="recovery-code-error" role="alert" className="text-sm text-danger">{error.message}</p>}
                </div>
              </>
            )}
            <label className="block space-y-2">
              <span className="label">新密码</span>
              <input className="field" type="password" autoComplete="new-password" minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} value={password.next} onChange={(event) => { setPassword((current) => ({ ...current, next: event.target.value })); if (error?.field === "next") setError(null); }} aria-invalid={error?.field === "next"} required />
              <span className="block text-xs text-muted">密码至少 {ACCOUNT_PASSWORD_MIN_LENGTH} 位</span>
              {error?.field === "next" && <span role="alert" className="block text-sm text-danger">{error.message}</span>}
            </label>
            <label className="block space-y-2">
              <span className="label">再次输入新密码</span>
              <input className="field" type="password" autoComplete="new-password" minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} value={password.confirm} onChange={(event) => { setPassword((current) => ({ ...current, confirm: event.target.value })); if (error?.field === "confirm") setError(null); }} aria-invalid={error?.field === "confirm"} required />
              {error?.field === "confirm" && <span role="alert" className="block text-sm text-danger">{error.message}</span>}
            </label>
            {error?.field === "form" && <p role="alert" className="text-sm text-danger">{error.message}</p>}
            <button className="btn btn-primary w-full" disabled={saving}>{saving ? "重置中……" : "确认重置密码"}</button>
            {!token && <p className="text-xs leading-relaxed text-muted">未绑定手机号或邮箱、又忘记原始密码的历史用户，请联系平台人工核实身份。验证码仅发送到已绑定的联系方式。</p>}
          </form>
        )}
      </div>
    </section>
  );
}
