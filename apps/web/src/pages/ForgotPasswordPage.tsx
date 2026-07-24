import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { useApp } from "../context/AppContext";

const RESET_TOKEN_STORAGE_KEY = "hgt_password_reset_token";

function resetTokenFromLocation() {
  const queryToken = new URLSearchParams(window.location.search).get("token");
  const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  const incomingToken = fragmentToken ?? queryToken ?? "";
  if (incomingToken) return incomingToken;
  if (!window.location.pathname.endsWith("/reset-password")) return "";
  try {
    return window.sessionStorage.getItem(RESET_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function ForgotPasswordPage() {
  const { openAuth, showToast } = useApp();
  const navigate = useNavigate();
  const [token] = useState(resetTokenFromLocation);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState({ next: "", confirm: "" });
  const [submitted, setSubmitted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    try {
      window.sessionStorage.setItem(RESET_TOKEN_STORAGE_KEY, token);
    } catch {
      // 部分隐私模式会禁用会话存储；组件内状态仍可完成本次重置。
    }
    window.history.replaceState(window.history.state, "", "/reset-password");
  }, [token]);

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api("/api/auth/password/reset/request", {
        method: "POST",
        body: { email }
      });
      setSubmitted(true);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (password.next.length < 6) return showToast("新密码至少需要 6 位");
    if (password.next !== password.confirm) return showToast("两次输入的新密码不一致");
    setSaving(true);
    try {
      await api("/api/auth/password/reset/confirm", {
        method: "POST",
        body: { token, newPassword: password.next }
      });
      try {
        window.sessionStorage.removeItem(RESET_TOKEN_STORAGE_KEY);
      } catch {
        // 忽略不可用的会话存储。
      }
      setCompleted(true);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function goToLogin() {
    navigate("/", { replace: true });
    window.setTimeout(openAuth, 0);
  }

  return (
    <section className="space-y-4">
      <PageTopBar title="找回密码" />
      <MineBackButton to="/" />
      {!token ? (
        <div className="card p-4">
          {!submitted ? (
            <form className="space-y-4" onSubmit={requestReset}>
              <div>
                <h1 className="text-lg font-black text-ink">通过绑定邮箱找回</h1>
                <p className="mt-1 text-sm text-muted">输入已验证的绑定邮箱，我们会发送一次性重置链接。</p>
              </div>
              <label className="block space-y-2">
                <span className="label">绑定邮箱</span>
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
              <button className="btn btn-primary w-full" disabled={saving}>
                {saving ? "发送中……" : "发送重置邮件"}
              </button>
            </form>
          ) : (
            <div className="space-y-4 text-center">
              <div>
                <h1 className="text-lg font-black text-ink">请检查邮箱</h1>
                <p className="mt-2 text-sm text-muted">
                  如果该邮箱已绑定账号，我们会发送密码重置邮件。链接 20 分钟内有效。
                </p>
              </div>
              <button className="btn btn-secondary w-full" onClick={() => setSubmitted(false)}>重新输入邮箱</button>
              <button className="w-full text-sm font-bold text-primary" onClick={goToLogin}>返回登录</button>
            </div>
          )}
        </div>
      ) : (
        <div className="card p-4">
          {!completed ? (
            <form className="space-y-4" onSubmit={resetPassword}>
              <div>
                <h1 className="text-lg font-black text-ink">设置新密码</h1>
                <p className="mt-1 text-sm text-muted">重置成功后，其他设备上的旧登录状态将失效。</p>
              </div>
              <label className="block space-y-2">
                <span className="label">新密码</span>
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={72}
                  value={password.next}
                  onChange={(event) => setPassword((current) => ({ ...current, next: event.target.value }))}
                  required
                />
              </label>
              <label className="block space-y-2">
                <span className="label">再次输入新密码</span>
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={72}
                  value={password.confirm}
                  onChange={(event) => setPassword((current) => ({ ...current, confirm: event.target.value }))}
                  required
                />
              </label>
              <button className="btn btn-primary w-full" disabled={saving}>
                {saving ? "重置中……" : "确认重置密码"}
              </button>
            </form>
          ) : (
            <div className="space-y-4 text-center">
              <div>
                <h1 className="text-lg font-black text-ink">密码已重置</h1>
                <p className="mt-2 text-sm text-muted">请使用新密码重新登录。</p>
              </div>
              <button className="btn btn-primary w-full" onClick={goToLogin}>返回登录</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
