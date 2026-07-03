import { useEffect, useState, useRef, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ImagePlus, Pencil } from "lucide-react";
import { useApp } from "../context/AppContext";
import { PageTopBar } from "../components/PageTopBar";
import { api, StatsResponse, NicknameResponse, AvatarResponse, PasswordResponse } from "../api";

export default function MinePage() {
  const { user, loadingUser } = useApp();
  const navigate = useNavigate();

  const [stats, setStats] = useState({ soupCount: 0, favoriteCount: 0, evaluationCount: 0, likeCount: 0 });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [editNickname, setEditNickname] = useState(false);
  const [nicknameValue, setNicknameValue] = useState(user?.nickname ?? "");
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameError, setNicknameError] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const { showToast, openAuth } = useApp();

  useEffect(() => {
    if (user) {
      api<StatsResponse>("/api/me/stats").then(setStats).catch(() => {});
      setNicknameValue(user.nickname);
    }
  }, [user]);

  // 等待登录状态加载
  if (loadingUser) {
    return (
      <section className="space-y-3">
        <PageTopBar title="我的" />
        <div className="card flex items-center justify-center p-8">
          <p className="text-sm text-muted">正在喝汤中……</p>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="space-y-3">
        <PageTopBar title="我的" />
        <div className="card p-4 text-center">
          <p className="mt-2 text-sm text-muted">登录后可查看个人信息和发布记录。</p>
          <button className="btn btn-primary mt-4 w-full" onClick={openAuth}>登录</button>
        </div>
      </section>
    );
  }

  async function saveNickname() {
    const trimmed = nicknameValue.trim();
    if (!trimmed) { setNicknameError("昵称不能为空"); return; }
    if (trimmed.length > 8) { setNicknameError("昵称不超过 8 个字符"); return; }
    setNicknameSaving(true);
    setNicknameError("");
    try {
      const data = await api<NicknameResponse>("/api/me/nickname", { method: "PATCH", body: { nickname: trimmed } });
      // user updated in context via parent
      setEditNickname(false);
      showToast("昵称已更新，相关海龟汤和评价的作者名已同步修改");
    } catch (e) {
      setNicknameError(e instanceof Error ? e.message : "修改失败");
    } finally { setNicknameSaving(false); }
  }

  async function handleAvatarUpload(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type)) { showToast("头像仅支持 JPG 或 PNG"); return; }
    if (file.size > 1 * 1024 * 1024) { showToast("头像请控制在 1MB 以内"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setAvatarSaving(true);
      try {
        await api<AvatarResponse>("/api/me/avatar", { method: "PATCH", body: { avatar: String(reader.result) } });
        showToast("头像已更新");
        // Simple reload to propagate updated user
        window.location.reload();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "头像更新失败");
      } finally { setAvatarSaving(false); }
    };
    reader.readAsDataURL(file);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { showToast("两次输入的新密码不一致"); return; }
    try {
      await api<PasswordResponse>("/api/auth/password", { method: "POST", body: { newPassword: passwordForm.newPassword } });
      setPasswordForm({ newPassword: "", confirmPassword: "" });
      showToast("密码已更新");
    } catch (e) { showToast(e instanceof Error ? e.message : "修改密码失败"); }
  }

  return (
    <section className="space-y-3">
      <PageTopBar title="我的" />

      {/* Profile card */}
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <button className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 text-xl font-black text-primary" type="button" disabled={avatarSaving}
            onClick={() => avatarInputRef.current?.click()} title="点击更换头像">
            {user.avatar ? <img className="h-full w-full object-cover" src={user.avatar} alt="" /> : (user.nickname || user.username).slice(0, 1)}
            <div className="absolute inset-0 flex items-end justify-center rounded-full bg-black/25 pb-1 opacity-0 transition hover:opacity-100">
              <ImagePlus size={16} className="text-white" />
            </div>
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); }} />
          </button>
          <div className="min-w-0 flex-1">
            {editNickname ? (
              <div className="flex items-center gap-2">
                <input className="field h-9 w-28 text-sm" value={nicknameValue} maxLength={8}
                  onChange={(e) => setNicknameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveNickname(); }} autoFocus />
                <button className="btn btn-primary h-9 px-2 text-xs" onClick={saveNickname} disabled={nicknameSaving}>{nicknameSaving ? "..." : "保存"}</button>
                <button className="btn btn-secondary h-9 px-2 text-xs" onClick={() => { setEditNickname(false); setNicknameValue(user.nickname); setNicknameError(""); }}>取消</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-lg font-black text-ink">{user.nickname}</span>
                <button className="text-primary" onClick={() => setEditNickname(true)}><Pencil size={14} /></button>
              </div>
            )}
            {nicknameError && <p className="mt-1 text-xs font-semibold text-danger">{nicknameError}</p>}
            <p className="text-xs text-muted">@{user.username}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <button className="card flex flex-col items-center p-3 transition hover:bg-blue-50" onClick={() => navigate("/mine/soups")}>
          <span className="text-2xl font-black text-ink">{stats.soupCount}</span>
          <span className="mt-0.5 text-xs font-semibold text-muted">我发布的</span>
          <ChevronRight size={14} className="mt-1 text-muted/40" />
        </button>
        <button className="card flex flex-col items-center p-3 transition hover:bg-amber-50" onClick={() => navigate("/mine/favorites")}>
          <span className="text-2xl font-black text-ink">{stats.favoriteCount}</span>
          <span className="mt-0.5 text-xs font-semibold text-muted">我收藏的</span>
          <ChevronRight size={14} className="mt-1 text-muted/40" />
        </button>
        <button className="card flex flex-col items-center p-3 transition hover:bg-red-50" onClick={() => navigate("/mine/likes")}>
          <span className="text-2xl font-black text-ink">{stats.likeCount}</span>
          <span className="mt-0.5 text-xs font-semibold text-muted">我点赞的</span>
          <ChevronRight size={14} className="mt-1 text-muted/40" />
        </button>
        <button className="card flex flex-col items-center p-3 transition hover:bg-emerald-50" onClick={() => navigate("/mine/evaluations")}>
          <span className="text-2xl font-black text-ink">{stats.evaluationCount}</span>
          <span className="mt-0.5 text-xs font-semibold text-muted">我评价的</span>
          <ChevronRight size={14} className="mt-1 text-muted/40" />
        </button>
      </div>

      {/* Password */}
      <div className="card p-4">
        {!passwordOpen ? (
          <button className="flex min-h-11 w-full items-center justify-between text-left" onClick={() => setPasswordOpen(true)}>
            <span>
              <span className="block text-base font-semibold text-ink">修改密码</span>
              <span className="mt-1 block text-xs text-muted">进入后设置新密码</span>
            </span>
            <ChevronRight size={18} className="text-primary" />
          </button>
        ) : (
          <form className="space-y-3" onSubmit={changePassword}>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">修改密码</h2>
              <button className="text-sm font-semibold text-muted" type="button"
                onClick={() => { setPasswordForm({ newPassword: "", confirmPassword: "" }); setPasswordOpen(false); }}>返回</button>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted">新密码</span>
              <input className="field" type="password" minLength={6} value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} required />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted">再次输入新密码</span>
              <input className="field" type="password" minLength={6} value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} required />
            </label>
            <button className="btn btn-primary w-full">保存新密码</button>
          </form>
        )}
      </div>
    </section>
  );
}
