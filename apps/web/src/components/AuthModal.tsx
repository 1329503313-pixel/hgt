import { FormEvent } from "react";
import { X } from "lucide-react";
import { Modal } from "./Modal";
import { useApp } from "../context/AppContext";
import { api, MeResponse } from "../api";

export function AuthModal() {
  const { authMode, closeAuth, switchAuthMode, authError, setAuthError, setUser, showToast, triggerRefresh } = useApp();

  // authMode is already guaranteed not null by the parent calling this

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api<MeResponse>(path, { method: "POST", body: payload });
      setUser(data.user);
      setAuthError("");
      closeAuth();
      triggerRefresh();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败，请检查账号和密码");
    }
  }

  return (
    <Modal onClose={closeAuth}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <h2 className="text-xl font-black text-ink">{authMode === "login" ? "登录" : "注册"}</h2>
          <p className="mt-1 text-sm text-muted">登录状态将持久化 30 天。</p>
        </div>
        {authMode === "register" && <input className="field" name="nickname" placeholder="昵称（最多8字）" maxLength={8} required />}
        <input className="field" name="username" placeholder="账号" required />
        <input className="field" name="password" type="password" placeholder="密码" required />
        {authError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{authError}</div>}
        <button className="btn btn-primary w-full">{authMode === "login" ? "登录" : "注册并登录"}</button>
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
