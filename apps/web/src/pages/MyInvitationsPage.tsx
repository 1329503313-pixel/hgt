import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Mail, MailX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { ListSkeleton } from "../components/Skeletons";
import { LevelBadge } from "../components/LevelBadge";
import { useApp } from "../context/AppContext";

type InvitationSummary = {
  inviteCode: string;
  invitedCount: number;
};

type InvitedUser = {
  id: string;
  nickname: string;
  avatar: string | null;
  level: number;
  emailBound: boolean;
  registeredAt: string;
};

type InvitedUsersResponse = {
  users: InvitedUser[];
  total: number;
};

export default function MyInvitationsPage() {
  const { user, loadingUser, openAuth, showToast } = useApp();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<InvitationSummary | null>(null);
  const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      api<InvitationSummary>("/api/me/invitation-summary", { bypassCache: true }),
      api<InvitedUsersResponse>("/api/me/invited-users?limit=50", { bypassCache: true })
    ])
      .then(([summaryData, usersData]) => {
        setSummary(summaryData);
        setInvitedUsers(usersData.users);
        setTotal(usersData.total);
      })
      .catch((error) => showToast((error as Error).message))
      .finally(() => setLoading(false));
  }, [loadingUser, user?.id]);

  async function copyInviteCode() {
    if (!summary?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(summary.inviteCode);
      setCopied(true);
      showToast("邀请码已复制");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast("复制失败，请长按邀请码复制");
    }
  }

  async function loadMore() {
    if (loadingMore || invitedUsers.length >= total) return;
    setLoadingMore(true);
    try {
      const data = await api<InvitedUsersResponse>(
        `/api/me/invited-users?limit=50&offset=${invitedUsers.length}`,
        { bypassCache: true }
      );
      setInvitedUsers((current) => [...current, ...data.users]);
      setTotal(data.total);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loadingUser) {
    return <section className="space-y-4"><PageTopBar title="我的邀请码" /><MineBackButton to="/mine/settings" /><ListSkeleton rows={5} /></section>;
  }
  if (!user) {
    return (
      <section className="space-y-4">
        <PageTopBar title="我的邀请码" />
        <MineBackButton to="/mine/settings" />
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">登录后查看邀请码和已绑定用户</p>
          <button className="btn btn-primary mt-4 w-full" onClick={openAuth}>登录</button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <PageTopBar title="我的邀请码" />
      <MineBackButton to="/mine/settings" />

      <div className="card overflow-hidden p-5">
        <p className="text-xs font-bold text-muted">永久邀请码</p>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl bg-blue-50 px-4 py-3 text-left"
          onClick={() => void copyInviteCode()}
          disabled={!summary}
        >
          <span className="font-mono text-2xl font-black tracking-[0.22em] text-primary">{summary?.inviteCode ?? "-----"}</span>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
            {copied ? "已复制" : "复制"}
          </span>
        </button>
        <p className="mt-3 text-xs leading-5 text-muted">邀请好友注册时填写此邀请码即可建立绑定。邀请码永久有效，注册后无法补填或更换。</p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-black text-ink">已绑定用户</h2>
          <span className="text-xs font-bold text-muted">{summary?.invitedCount ?? 0} 人</span>
        </div>
        {loading ? <ListSkeleton rows={5} /> : invitedUsers.length ? (
          <div className="divide-y divide-line">
            {invitedUsers.map((item) => (
              <button
                type="button"
                key={item.id}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100"
                onClick={() => navigate(`/users/${item.id}`)}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-primary">
                  {item.avatar ? <img className="h-full w-full object-cover" src={item.avatar} alt="" /> : item.nickname.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-black text-ink">{item.nickname}</span>
                    <LevelBadge level={item.level} />
                  </span>
                  <span className={`mt-1 inline-flex items-center gap-1 text-xs ${item.emailBound ? "font-bold text-emerald-600" : "text-muted"}`}>
                    {item.emailBound ? <Mail size={14} /> : <MailX size={14} />}
                    {item.emailBound ? "已绑定邮箱" : "未绑定邮箱"}
                  </span>
                </span>
              </button>
            ))}
            {invitedUsers.length < total && (
              <div className="p-4">
                <button className="btn btn-secondary w-full" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "加载中…" : `继续加载（${invitedUsers.length}/${total}）`}
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="px-4 py-16 text-center text-sm text-muted">还没有用户通过你的邀请码注册</p>
        )}
      </div>
    </section>
  );
}
