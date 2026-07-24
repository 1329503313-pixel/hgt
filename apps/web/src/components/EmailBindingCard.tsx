import { FormEvent, useEffect, useState } from "react";
import { Mail, ShieldCheck, Unlink } from "lucide-react";
import { api, EmailStatusResponse } from "../api";
import { useApp } from "../context/AppContext";
import { Modal } from "./Modal";

type DialogMode = "bind" | "change" | "unbind" | null;
type VerificationStep = "request" | "confirm";

export function EmailBindingCard() {
  const { user, showToast } = useApp();
  const [status, setStatus] = useState<EmailStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [step, setStep] = useState<VerificationStep>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [maskedTarget, setMaskedTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  async function loadStatus() {
    if (!user) return;
    setLoading(true);
    try {
      setStatus(await api<EmailStatusResponse>("/api/auth/email/status", { bypassCache: true }));
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [user?.id]);

  useEffect(() => {
    if (!resendAt) {
      setSecondsLeft(0);
      return;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  function openDialog(mode: Exclude<DialogMode, null>) {
    setDialog(mode);
    setStep("request");
    setEmail("");
    setPassword("");
    setCode("");
    setMaskedTarget("");
    setResendAt(0);
  }

  function closeDialog() {
    if (submitting) return;
    setDialog(null);
  }

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    if (submitting || secondsLeft > 0) return;
    setSubmitting(true);
    try {
      const result = await api<{ ok: boolean; maskedEmail: string; expiresInSeconds: number }>(
        "/api/auth/email/bind/request",
        { method: "POST", body: { email, password } }
      );
      setMaskedTarget(result.maskedEmail);
      setStep("confirm");
      setResendAt(Date.now() + 60_000);
      showToast("验证码已发送");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await api<{
        ok: boolean;
        email: NonNullable<EmailStatusResponse["email"]>;
      }>("/api/auth/email/bind/confirm", {
        method: "POST",
        body: { email, code }
      });
      setStatus((current) => ({
        configured: current?.configured ?? true,
        email: result.email
      }));
      setDialog(null);
      showToast(dialog === "change" ? "绑定邮箱已更换" : "邮箱绑定成功");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function unbind(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await api("/api/auth/email", { method: "DELETE", body: { password } });
      setStatus((current) => ({ configured: current?.configured ?? true, email: null }));
      setDialog(null);
      showToast("绑定邮箱已解绑");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const boundEmail = status?.email;

  return (
    <>
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-primary">
            <Mail size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-ink">绑定邮箱</p>
              {boundEmail && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                  <ShieldCheck size={13} />
                  已验证
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted">
              {loading
                ? "正在读取绑定状态……"
                : boundEmail?.masked ?? "用于找回密码和接收账号安全通知"}
            </p>
            <p className="mt-1 text-xs text-muted">邮箱不会公开展示，仅用于账号找回和安全通知。</p>
            {!loading && status && !status.configured && (
              <p className="mt-2 text-xs font-semibold text-danger">邮件服务尚未配置，请联系管理员</p>
            )}
          </div>
        </div>
        {!loading && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!status?.configured}
              onClick={() => openDialog(boundEmail ? "change" : "bind")}
            >
              {boundEmail ? "更换邮箱" : "绑定邮箱"}
            </button>
            {boundEmail && (
              <button type="button" className="btn btn-secondary" onClick={() => openDialog("unbind")}>
                <Unlink size={16} />
                解绑
              </button>
            )}
          </div>
        )}
      </div>

      {(dialog === "bind" || dialog === "change") && (
        <Modal onClose={closeDialog}>
          {step === "request" ? (
            <form className="space-y-4" onSubmit={requestCode}>
              <div>
                <h2 className="text-xl font-black text-ink">{dialog === "change" ? "更换绑定邮箱" : "绑定邮箱"}</h2>
                <p className="mt-1 text-sm text-muted">验证当前密码后，我们会向新邮箱发送验证码。</p>
              </div>
              <label className="block space-y-2">
                <span className="label">新邮箱</span>
                <input
                  className="field"
                  type="email"
                  autoComplete="email"
                  maxLength={255}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </label>
              <label className="block space-y-2">
                <span className="label">当前密码</span>
                <input
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  maxLength={72}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入当前登录密码"
                  required
                />
              </label>
              <button className="btn btn-primary w-full" disabled={submitting}>
                {submitting ? "发送中……" : "发送验证码"}
              </button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={confirmCode}>
              <div>
                <h2 className="text-xl font-black text-ink">验证新邮箱</h2>
                <p className="mt-1 text-sm text-muted">验证码已发送至 {maskedTarget}，10 分钟内有效。</p>
              </div>
              <label className="block space-y-2">
                <span className="label">6 位验证码</span>
                <input
                  className="field text-center text-xl tracking-[.35em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  required
                />
              </label>
              <button className="btn btn-primary w-full" disabled={submitting || code.length !== 6}>
                {submitting ? "验证中……" : "确认绑定"}
              </button>
              <button
                type="button"
                className="btn btn-secondary w-full"
                disabled={submitting || secondsLeft > 0}
                onClick={() => void requestCode()}
              >
                {secondsLeft > 0 ? `${secondsLeft} 秒后可重新发送` : "重新发送验证码"}
              </button>
              <button type="button" className="w-full text-sm font-bold text-primary" onClick={() => setStep("request")}>
                修改邮箱
              </button>
            </form>
          )}
        </Modal>
      )}

      {dialog === "unbind" && (
        <Modal onClose={closeDialog}>
          <form className="space-y-4" onSubmit={unbind}>
            <div>
              <h2 className="text-xl font-black text-ink">解绑邮箱</h2>
              <p className="mt-1 text-sm text-muted">
                解绑后将无法通过 {boundEmail?.masked} 找回密码。用户名和密码登录不受影响。
              </p>
            </div>
            <label className="block space-y-2">
              <span className="label">当前密码</span>
              <input
                className="field"
                type="password"
                autoComplete="current-password"
                maxLength={72}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入当前登录密码"
                required
              />
            </label>
            <button className="btn btn-danger w-full" disabled={submitting}>
              {submitting ? "解绑中……" : "确认解绑"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
