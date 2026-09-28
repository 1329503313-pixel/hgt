import { FormEvent, useEffect, useState } from "react";
import { api, MeResponse } from "../api";
import { useApp } from "../context/AppContext";
import { ACCOUNT_PASSWORD_MAX_LENGTH, ACCOUNT_PASSWORD_MIN_LENGTH, accountPasswordError } from "../shared/accountRules";
import { Modal } from "./Modal";

export function PhoneBindingModal() {
  const { user, closePhoneBinding, completePhoneBinding, refreshPhoneStatus, setUser, showToast } = useApp();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    if (sending || cooldown > 0) return;
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError("请输入有效的中国大陆手机号"); return; }
    setSending(true);
    setError("");
    try {
      await api("/api/auth/phone/code", { method: "POST", body: { phone, purpose: "upgrade" } });
      setCooldown(60);
      showToast("验证码已发送");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送短信失败，请稍后再试");
    } finally { setSending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const validationError = !/^1[3-9]\d{9}$/.test(phone) ? "请输入有效的中国大陆手机号"
      : !/^\d{6}$/.test(code) ? "请输入 6 位短信验证码"
      : accountPasswordError(password) || (password !== confirmPassword ? "两次输入的密码不一致" : "");
    if (validationError) { setError(validationError); return; }
    setSubmitting(true);
    setError("");
    try {
      const result = await api<MeResponse>("/api/auth/phone/upgrade", {
        method: "POST", body: { phone, code, newPassword: password },
      });
      if (!result.user || result.user.id !== user?.id) throw new Error("绑定账号校验失败，请刷新后重试");
      setUser(result.user);
      completePhoneBinding(phone);
      void refreshPhoneStatus().catch(() => undefined);
      showToast("手机号绑定成功，请使用手机号和新密码登录");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "绑定失败，请稍后再试");
    } finally { setSubmitting(false); }
  }

  return <Modal onClose={closePhoneBinding} hideCloseButton>
    <div role="dialog" aria-modal="true" aria-labelledby="phone-binding-title" aria-describedby="phone-binding-description">
      <h2 id="phone-binding-title" className="text-xl font-black text-ink">绑定手机号</h2>
      <p id="phone-binding-description" className="mt-2 text-sm leading-6 text-muted">为保护您的账号安全，请您绑定手机号，后续将以手机号为唯一登录账号，本登录账号将失效。</p>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <label className="block space-y-2"><span className="label">手机号</span><input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value.trim())} maxLength={11} required /></label>
        <div className="space-y-2"><label className="label block" htmlFor="binding-code">验证码</label><div className="flex gap-2"><input id="binding-code" className="field min-w-0 flex-1" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} maxLength={6} required /><button type="button" className="btn btn-secondary min-h-11 shrink-0" disabled={sending || cooldown > 0 || submitting} onClick={() => void sendCode()}>{sending ? "发送中…" : cooldown > 0 ? `${cooldown}秒` : "发送短信"}</button></div></div>
        <label className="block space-y-2"><span className="label">密码</span><input className="field" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} required /><span className="block text-xs text-muted">请设置新密码，至少 {ACCOUNT_PASSWORD_MIN_LENGTH} 位</span></label>
        <label className="block space-y-2"><span className="label">确认密码</span><input className="field" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger" role="alert">{error}</p>}
        <div className="grid grid-cols-2 gap-3 pt-1"><button type="button" className="btn btn-secondary min-h-11" onClick={closePhoneBinding} disabled={submitting}>稍后</button><button type="submit" className="btn btn-primary min-h-11" disabled={submitting}>{submitting ? "绑定中…" : "确定"}</button></div>
      </form>
    </div>
  </Modal>;
}
