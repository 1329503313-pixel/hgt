import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, PasswordResponse } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { CardSkeleton } from "../components/Skeletons";
import { useApp } from "../context/AppContext";

export default function ResetPasswordPage() {
  const { user, loadingUser, openAuth, showToast } = useApp();
  const navigate = useNavigate();
  const [password, setPassword] = useState({ next: "", confirm: "" });
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (password.next.length < 6) return showToast("新密码至少需要 6 位");
    if (password.next !== password.confirm) return showToast("两次输入的新密码不一致");
    setSaving(true);
    try {
      await api<PasswordResponse>("/api/auth/password", { method: "POST", body: { newPassword: password.next } });
      showToast("密码已重置");
      navigate("/mine/settings", { replace: true });
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loadingUser) return <section className="space-y-4"><PageTopBar title="重置密码" /><MineBackButton onBack={() => navigate("/mine/settings")} /><CardSkeleton rows={5} /></section>;
  if (!user) return <section className="space-y-4"><PageTopBar title="重置密码" /><MineBackButton onBack={() => navigate("/mine/settings")} /><div className="card p-6 text-center"><p className="text-sm text-muted">登录后重置密码</p><button className="btn btn-primary mt-4 w-full" onClick={openAuth}>登录</button></div></section>;

  return (
    <section className="space-y-4">
      <PageTopBar title="重置密码" />
      <MineBackButton onBack={() => navigate("/mine/settings")} />
      <div>
        <form className="card space-y-4 p-4" onSubmit={submit}>
          <div><label className="label mb-2 block" htmlFor="new-password">新密码</label><input id="new-password" className="field" type="password" minLength={6} autoComplete="new-password" value={password.next} onChange={(event) => setPassword((current) => ({ ...current, next: event.target.value }))} placeholder="请输入新密码" required /></div>
          <div><label className="label mb-2 block" htmlFor="confirm-password">再次输入新密码</label><input id="confirm-password" className="field" type="password" minLength={6} autoComplete="new-password" value={password.confirm} onChange={(event) => setPassword((current) => ({ ...current, confirm: event.target.value }))} placeholder="请再次输入新密码" required /></div>
          <button className="btn btn-primary w-full" disabled={saving}>{saving ? "提交中……" : "确认重置"}</button>
        </form>
      </div>
    </section>
  );
}
