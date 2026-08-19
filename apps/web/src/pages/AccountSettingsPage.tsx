import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronRight, KeyRound, TicketCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, AvatarResponse, BioResponse, NicknameResponse } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { useApp } from "../context/AppContext";
import { removeSessionCache } from "../shared/sessionCache";
import { CardSkeleton } from "../components/Skeletons";
import { ProfileBackgroundEditor } from "../components/ProfileBackgroundEditor";
import { EmailBindingCard } from "../components/EmailBindingCard";
import { FeedbackCard } from "../components/FeedbackCard";
import { ACCOUNT_BIO_MAX_LENGTH, ACCOUNT_NICKNAME_MAX_LENGTH, accountBioError, accountNicknameError } from "../shared/accountRules";

type InvitationSummary = {
  inviteCode: string;
  invitedCount: number;
};

export default function AccountSettingsPage() {
  const { user, loadingUser, openAuth, setUser, showToast } = useApp();
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameError, setNicknameError] = useState("");
  const [bioSaving, setBioSaving] = useState(false);
  const [bioError, setBioError] = useState("");
  const [invitationSummary, setInvitationSummary] = useState<InvitationSummary | null>(null);

  useEffect(() => { setNickname(user?.nickname ?? ""); }, [user?.nickname]);
  useEffect(() => { setBio(user?.bio ?? ""); }, [user?.bio]);
  useEffect(() => {
    if (!user) {
      setInvitationSummary(null);
      return;
    }
    api<InvitationSummary>("/api/me/invitation-summary", { bypassCache: true })
      .then(setInvitationSummary)
      .catch(() => setInvitationSummary(null));
  }, [user?.id]);

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
    const validationError = accountNicknameError(value);
    if (validationError) {
      setNicknameError(validationError);
      return;
    }
    setNicknameSaving(true);
    setNicknameError("");
    try {
      const data = await api<NicknameResponse>("/api/me/nickname", { method: "PATCH", body: { nickname: value } });
      setUser({ ...user, nickname: data.nickname });
      removeSessionCache(`hgt:mine:profile:${user.id}`);
      setNickname(data.nickname);
      showToast("昵称已更新");
    } catch (error) {
      setNicknameError((error as Error).message);
    } finally {
      setNicknameSaving(false);
    }
  }

  async function saveBio(event: FormEvent) {
    event.preventDefault();
    if (!user || bioSaving) return;
    const value = bio.trim();
    const validationError = accountBioError(value);
    if (validationError) {
      setBioError(validationError);
      return;
    }
    setBioSaving(true);
    setBioError("");
    try {
      const data = await api<BioResponse>("/api/me/bio", { method: "PATCH", body: { bio: value } });
      setUser({ ...user, bio: data.bio });
      removeSessionCache(`hgt:mine:profile:${user.id}`);
      removeSessionCache(`hgt:user-profile:${user.id}:${user.id}`);
      setBio(data.bio);
      showToast(data.bio ? "简介已更新" : "简介已清空");
    } catch (error) {
      setBioError((error as Error).message);
    } finally {
      setBioSaving(false);
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

        <div className="card p-4">
          <form onSubmit={saveNickname}>
            <label className="mb-2 block text-sm font-black text-ink" htmlFor="account-nickname">昵称</label>
            <div className="flex gap-2"><input id="account-nickname" className="field h-11" maxLength={ACCOUNT_NICKNAME_MAX_LENGTH} value={nickname} aria-invalid={Boolean(nicknameError)} aria-describedby="account-nickname-help" onChange={(event) => { setNickname(event.target.value); setNicknameError(""); }} /><button className="btn btn-primary h-11 shrink-0 px-4" disabled={nicknameSaving}>{nicknameSaving ? "保存中" : "保存"}</button></div>
            <p id="account-nickname-help" className={`mt-2 text-xs ${nicknameError ? "font-semibold text-danger" : "text-muted"}`} role={nicknameError ? "alert" : undefined}>{nicknameError || "1 至 8 个字符，不可与其他用户重复"}</p>
          </form>

          <form className="mt-4 border-t border-line pt-4" onSubmit={saveBio}>
            <label className="mb-2 block text-sm font-black text-ink" htmlFor="account-bio">简介</label>
            <div className="flex items-start gap-2">
              <textarea id="account-bio" className="field min-h-[88px] resize-none py-2.5" maxLength={ACCOUNT_BIO_MAX_LENGTH} rows={3} value={bio} aria-invalid={Boolean(bioError)} aria-describedby="account-bio-help" onChange={(event) => { setBio(event.target.value); setBioError(""); }} />
              <button className="btn btn-primary h-11 shrink-0 px-4" disabled={bioSaving}>{bioSaving ? "保存中" : "保存"}</button>
            </div>
            <p id="account-bio-help" className={`mt-2 flex justify-between gap-3 text-xs ${bioError ? "font-semibold text-danger" : "text-muted"}`} role={bioError ? "alert" : undefined}>
              <span>{bioError || "最多 40 个字符，留空并保存可清空简介"}</span>
              <span className="shrink-0 tabular-nums">{bio.length}/{ACCOUNT_BIO_MAX_LENGTH}</span>
            </p>
          </form>
        </div>

        <ProfileBackgroundEditor userId={user.id} />

        <EmailBindingCard />

        <button className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => navigate("/mine/settings/password")}>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-primary"><KeyRound size={20} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-black text-ink">重置密码</span><span className="mt-0.5 block text-xs text-muted">设置一个新的登录密码</span></span>
          <ChevronRight className="text-muted" size={19} />
        </button>

        <FeedbackCard />

        <button className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => navigate("/mine/settings/invitations")}>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><TicketCheck size={20} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-ink">我的邀请码</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-base font-black tracking-[0.16em] text-primary">{invitationSummary?.inviteCode ?? "-----"}</span>
              <span className="text-xs text-muted">已绑定 {invitationSummary?.invitedCount ?? 0} 人</span>
            </span>
          </span>
          <ChevronRight className="text-muted" size={19} />
        </button>
      </div>
    </section>
  );
}
