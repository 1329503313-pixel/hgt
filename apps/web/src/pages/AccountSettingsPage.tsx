import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronRight, KeyRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, AvatarResponse, NicknameResponse } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { useApp } from "../context/AppContext";
import { removeSessionCache } from "../shared/sessionCache";
import { CardSkeleton } from "../components/Skeletons";
import { ProfileBackgroundEditor } from "../components/ProfileBackgroundEditor";

export default function AccountSettingsPage() {
  const { user, loadingUser, openAuth, setUser, showToast } = useApp();
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);

  useEffect(() => { setNickname(user?.nickname ?? ""); }, [user?.nickname]);

  async function uploadAvatar(file?: File) {
    if (!file || !user) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) return showToast("头像仅支持 JPG 或 PNG");
    if (file.size > 1024 * 1024) return showToast("头像不能超过 1MB");
    const avatar = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setAvatarSaving(true);
    try {
      const data = await api<AvatarResponse>("/api/me/avatar", { method: "PATCH", body: { avatar } });
      setUser({ ...user, avatar: data.avatar });
      removeSessionCache(`hgt:mine:profile:${user.id}`);
      showToast("头像已更新");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setAvatarSaving(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function saveNickname(event: FormEvent) {
    event.preventDefault();
    if (!user || nicknameSaving) return;
    const value = nickname.trim();
    if (!value || value.length > 8) return showToast("昵称应为 1 至 8 个字符");
    setNicknameSaving(true);
    try {
      const data = await api<NicknameResponse>("/api/me/nickname", { method: "PATCH", body: { nickname: value } });
      setUser({ ...user, nickname: data.nickname });
      removeSessionCache(`hgt:mine:profile:${user.id}`);
      setNickname(data.nickname);
      showToast("昵称已更新");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setNicknameSaving(false);
    }
  }

  if (loadingUser) return <section className="space-y-4"><PageTopBar title="账号设置" /><MineBackButton /><CardSkeleton rows={4} /><CardSkeleton rows={2} /></section>;
  if (!user) return <section className="space-y-4"><PageTopBar title="账号设置" /><MineBackButton /><div className="card p-6 text-center"><p className="text-sm text-muted">登录后管理账号设置</p><button className="btn btn-primary mt-4 w-full" onClick={openAuth}>登录</button></div></section>;

  return (
    <section className="space-y-4">
      <PageTopBar title="账号设置" />
      <MineBackButton />
      <div className="space-y-4">
        <div className="card p-4">
          <p className="mb-3 text-sm font-black text-ink">头像</p>
          <div className="flex items-center gap-4">
            <button className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-blue-100" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving} aria-label="更换头像">
              {user.avatar ? <img className="h-full w-full object-cover" src={user.avatar} alt="当前头像" /> : <span className="grid h-full w-full place-items-center text-2xl font-black text-primary">{user.nickname.slice(0, 1)}</span>}
            </button>
            <div><button className="btn btn-secondary" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving}>{avatarSaving ? "上传中……" : "更换头像"}</button><p className="mt-2 text-xs text-muted">支持 JPG、PNG，最大 1MB</p></div>
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
          </div>
        </div>

        <form className="card p-4" onSubmit={saveNickname}>
          <label className="mb-2 block text-sm font-black text-ink" htmlFor="account-nickname">昵称</label>
          <div className="flex gap-2"><input id="account-nickname" className="field h-11" maxLength={8} value={nickname} onChange={(event) => setNickname(event.target.value)} /><button className="btn btn-primary h-11 shrink-0 px-4" disabled={nicknameSaving}>{nicknameSaving ? "保存中" : "保存"}</button></div>
          <p className="mt-2 text-xs text-muted">1 至 8 个字符</p>
        </form>

        <ProfileBackgroundEditor userId={user.id} />

        <button className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => navigate("/mine/settings/password")}>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-primary"><KeyRound size={20} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-black text-ink">重置密码</span><span className="mt-0.5 block text-xs text-muted">设置一个新的登录密码</span></span>
          <ChevronRight className="text-muted" size={19} />
        </button>
      </div>
    </section>
  );
}
