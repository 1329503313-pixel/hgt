import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, CalendarClock, Eye, Plus, RotateCcw, Search, ShieldPlus, Trash2, Users, X } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { BADGES, getBadgeKey, TIER_COLORS_EARNED, TIER_LABEL, type BadgeDef } from "../../pages/MyAchievementsPage";
import { ACTIVITY_CONDITION_LABELS, ActivityBadgeCondition, ActivityConditionKind, LegendaryBadge, LegendaryBadgeIcon, LegendaryBadgeTile, activityConditionText } from "../BadgeVisuals";
import { Modal } from "../Modal";
import { AdminPageSize, AdminPagination } from "./AdminPagination";
import { CardSkeleton, ListSkeleton } from "../Skeletons";

type BadgeAdminUser = {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  badgeCount: number;
  normalCount: number;
  rareCount: number;
  epicCount: number;
  legendCount: number;
};

type BasicUser = Pick<BadgeAdminUser, "id" | "username" | "nickname" | "avatar">;
type UserDetail = { user: BasicUser; badgeKeys: string[] };
type UserAction = "view" | "grant" | "revoke";

function UserIdentity({ user }: { user: BasicUser }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {user.avatar ? <img className="h-9 w-9 shrink-0 rounded-full object-cover" src={user.avatar} alt="" /> : (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-black text-primary">{(user.nickname || user.username).slice(0, 1)}</div>
      )}
      <div className="min-w-0 text-left">
        <div className="truncate font-bold text-ink">{user.nickname}</div>
        <div className="truncate text-xs text-muted">@{user.username}</div>
      </div>
    </div>
  );
}

function SystemBadgeTile({ badge }: { badge: BadgeDef }) {
  const colors = TIER_COLORS_EARNED[badge.tier];
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <div className={`grid h-16 w-16 place-items-center overflow-hidden rounded-2xl shadow-soft ring-1 ${colors.bg} ${colors.text} ${colors.ring}`}>{badge.icon}</div>
      <span className="text-xs font-semibold leading-tight text-ink">{badge.label}</span>
      <span className={`text-[11px] font-bold ${colors.label}`}>{TIER_LABEL[badge.tier]}</span>
    </div>
  );
}

export function BadgeManagement() {
  const { showToast } = useApp();
  const [subTab, setSubTab] = useState<"users" | "badges">("users");
  const [users, setUsers] = useState<BadgeAdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminPageSize>(10);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [legendaryBadges, setLegendaryBadges] = useState<LegendaryBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [userAction, setUserAction] = useState<UserAction | null>(null);
  const [ownersBadge, setOwnersBadge] = useState<LegendaryBadge | null>(null);
  const [owners, setOwners] = useState<BasicUser[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [conditionBadge, setConditionBadge] = useState<LegendaryBadge | null>(null);
  const [conditionDraft, setConditionDraft] = useState<ActivityBadgeCondition[]>([]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (submittedKeyword) params.set("keyword", submittedKeyword);
      const result = await api<{ users: BadgeAdminUser[]; total: number }>(`/api/admin/badges/users?${params}`);
      setUsers(result.users);
      setTotal(result.total);
    } finally { setLoading(false); }
  }, [page, pageSize, submittedKeyword]);

  const loadLegendaryBadges = useCallback(async () => {
    const result = await api<{ badges: LegendaryBadge[] }>("/api/admin/badges");
    setLegendaryBadges(result.badges);
  }, []);

  useEffect(() => { loadUsers().catch((error) => showToast(error instanceof Error ? error.message : "用户徽章加载失败")); }, [loadUsers]);
  useEffect(() => { loadLegendaryBadges().catch((error) => showToast(error instanceof Error ? error.message : "传说徽章加载失败")); }, [loadLegendaryBadges]);

  const ownedSystemBadges = useMemo(() => {
    if (!userDetail) return [];
    const owned = new Set(userDetail.badgeKeys);
    return BADGES.filter((badge) => owned.has(getBadgeKey(badge)));
  }, [userDetail]);
  const ownedLegendaryBadges = useMemo(() => {
    if (!userDetail) return [];
    const owned = new Set(userDetail.badgeKeys);
    return legendaryBadges.filter((badge) => owned.has(badge.key));
  }, [legendaryBadges, userDetail]);
  const grantableBadges = useMemo(() => {
    if (!userDetail) return [];
    const owned = new Set(userDetail.badgeKeys);
    return legendaryBadges.filter((badge) => !owned.has(badge.key));
  }, [legendaryBadges, userDetail]);
  const activityBadges = legendaryBadges.filter((badge) => badge.badgeType === "activity");
  const limitedBadges = legendaryBadges.filter((badge) => badge.badgeType === "limited");
  const grantableLimitedBadges = grantableBadges.filter((badge) => badge.badgeType === "limited");
  const ownedActivityBadges = ownedLegendaryBadges.filter((badge) => badge.badgeType === "activity");
  const ownedLimitedBadges = ownedLegendaryBadges.filter((badge) => badge.badgeType === "limited");
  const ownedAchievementSpecialBadges = ownedLegendaryBadges.filter((badge) => badge.badgeType === "achievement");

  async function openUserAction(user: BadgeAdminUser, action: UserAction) {
    setModalLoading(true);
    setUserAction(action);
    try {
      setUserDetail(await api<UserDetail>(`/api/admin/badges/users/${user.id}`));
    } catch (error) {
      setUserAction(null);
      showToast(error instanceof Error ? error.message : "用户徽章加载失败");
    } finally { setModalLoading(false); }
  }

  function closeUserModal() {
    if (modalLoading) return;
    setUserAction(null);
    setUserDetail(null);
  }

  async function grantBadge(badge: LegendaryBadge) {
    if (!userDetail) return;
    setModalLoading(true);
    try {
      await api(`/api/admin/badges/users/${userDetail.user.id}/legendary/${badge.id}`, { method: "POST" });
      setUserDetail((current) => current ? { ...current, badgeKeys: [...current.badgeKeys, badge.key] } : current);
      showToast(`已向 ${userDetail.user.nickname} 发放「${badge.name}」`);
      await Promise.all([loadUsers(), loadLegendaryBadges()]);
    } finally { setModalLoading(false); }
  }

  async function revokeBadge(user: BasicUser, badge: LegendaryBadge, fromOwners = false) {
    const activityWarning = badge.badgeType === "activity" ? "\n该活动徽章收回后不会再按活动规则重新发放。" : "";
    if (!confirm(`确定撤销 ${user.nickname} 的传说徽章「${badge.name}」吗？${activityWarning}`)) return;
    setModalLoading(true);
    try {
      await api(`/api/admin/badges/users/${user.id}/legendary/${badge.id}`, { method: "DELETE" });
      if (fromOwners) setOwners((current) => current.filter((item) => item.id !== user.id));
      setUserDetail((current) => current?.user.id === user.id ? { ...current, badgeKeys: current.badgeKeys.filter((key) => key !== badge.key) } : current);
      showToast(`已撤销 ${user.nickname} 的「${badge.name}」`);
      await Promise.all([loadUsers(), loadLegendaryBadges()]);
    } finally { setModalLoading(false); }
  }

  async function openOwners(badge: LegendaryBadge) {
    setOwnersBadge(badge);
    setModalLoading(true);
    try {
      const result = await api<{ users: BasicUser[] }>(`/api/admin/badges/${badge.id}/owners`);
      setOwners(result.users);
    } catch (error) {
      setOwnersBadge(null);
      showToast(error instanceof Error ? error.message : "拥有用户加载失败");
    } finally { setModalLoading(false); }
  }

  function openActivityConditions(badge: LegendaryBadge) {
    setConditionBadge(badge);
    setConditionDraft(badge.activityConditions.map((condition) => ({ ...condition })));
  }

  function addActivityCondition() {
    const today = new Date().toISOString().slice(0, 10);
    setConditionDraft((current) => [...current, { kind: "login", startDate: today, endDate: today, target: 1 }]);
  }

  function updateActivityCondition(index: number, patch: Partial<ActivityBadgeCondition>) {
    setConditionDraft((current) => current.map((condition, conditionIndex) => conditionIndex === index ? { ...condition, ...patch } : condition));
  }

  function updateActivityTimeMode(index: number, mode: "date" | "long_term") {
    const today = new Date().toISOString().slice(0, 10);
    setConditionDraft((current) => current.map((condition, conditionIndex) => {
      if (conditionIndex !== index) return condition;
      return mode === "long_term"
        ? { ...condition, startDate: "long_term", endDate: "long_term" }
        : { ...condition, startDate: today, endDate: today };
    }));
  }

  async function saveActivityConditions() {
    if (!conditionBadge) return;
    setModalLoading(true);
    try {
      await api(`/api/admin/badges/${conditionBadge.id}/activity-conditions`, { method: "PATCH", body: { conditions: conditionDraft } });
      showToast("活动徽章发放条件已保存");
      setConditionBadge(null);
      await loadLegendaryBadges();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "活动条件保存失败");
    } finally { setModalLoading(false); }
  }

  return (
    <div className="space-y-4">
      <section className="card flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-black text-ink">徽章管理</h2>
          <p className="mt-1 text-xs text-muted">活动徽章按活动规则发放，限定徽章由管理员直接发放</p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1">
          <button className={`rounded-lg px-4 py-2 text-sm font-bold ${subTab === "users" ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => setSubTab("users")}><Users size={15} className="mr-1 inline" />用户</button>
          <button className={`rounded-lg px-4 py-2 text-sm font-bold ${subTab === "badges" ? "bg-white text-primary shadow-sm" : "text-muted"}`} onClick={() => setSubTab("badges")}><Award size={15} className="mr-1 inline" />徽章</button>
        </div>
      </section>

      {subTab === "users" ? (
        <section className="card p-4">
          <div className="mb-4 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <input className="field h-10 pl-4 pr-24" placeholder="搜索昵称、账号..." value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setSubmittedKeyword(keyword.trim()); } }} />
              <button className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={() => { setPage(1); setSubmittedKeyword(keyword.trim()); }}><Search size={17} />搜索</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[1040px]">
              <div className="grid grid-cols-[minmax(190px,1fr)_90px_90px_90px_90px_90px_300px] gap-2 px-3 py-2 text-center text-xs font-bold text-muted"><span>用户</span><span>全部</span><span>普通</span><span>稀有</span><span>史诗</span><span>传说</span><span>操作</span></div>
              <div className="space-y-1">
                {users.map((user) => (
                  <div key={user.id} className="grid grid-cols-[minmax(190px,1fr)_90px_90px_90px_90px_90px_300px] items-center gap-2 rounded-lg border border-line px-3 py-2 text-center text-sm">
                    <UserIdentity user={user} />
                    <strong>{user.badgeCount}</strong><span>{user.normalCount}</span><span>{user.rareCount}</span><span>{user.epicCount}</span><span className="badge-legend-text font-black">{user.legendCount}</span>
                    <div className="flex justify-center gap-2">
                      <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => openUserAction(user, "view")}><Eye size={13} />查看徽章</button>
                      <button className="btn btn-secondary h-8 px-2 text-xs" onClick={() => openUserAction(user, "grant")}><ShieldPlus size={13} />发放徽章</button>
                      <button className="btn btn-danger h-8 px-2 text-xs" onClick={() => openUserAction(user, "revoke")}><RotateCcw size={13} />收回徽章</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {loading && <ListSkeleton rows={6} />}
          {!loading && users.length === 0 && <p className="py-8 text-center text-sm text-muted">暂无符合条件的用户</p>}
          <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} />
        </section>
      ) : (
        <section className="card p-4">
          <div className="mb-5"><h2 className="font-black text-ink">特殊徽章</h2><p className="mt-1 text-xs text-muted">活动徽章按后台设置的活动规则自动发放；限定徽章由管理员直接发放。</p></div>
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-sm font-black text-ink">活动徽章</h3>
              <div className="space-y-2">
                {activityBadges.map((badge) => (
                  <div key={badge.id} className="flex flex-col gap-4 rounded-xl border border-line p-4 sm:flex-row sm:items-center">
                    <LegendaryBadgeIcon badge={badge} className="h-20 w-20" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><h4 className="font-black text-ink">{badge.name}</h4><span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-black text-rose-600">活动</span></div>
                      <p className="mt-1 text-sm text-muted">{badge.description}</p>
                      {badge.requirement && <p className="mt-2 text-xs text-muted">获取条件说明：{badge.requirement}</p>}
                      {badge.activityConditions.length > 0 && <div className="mt-2 space-y-1 text-xs text-muted"><p className="font-bold text-ink">实际发放规则</p>{badge.activityConditions.map((condition, index) => <p key={`${condition.kind}-${index}`}>{activityConditionText(condition)}</p>)}</div>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button className="btn btn-secondary" onClick={() => openActivityConditions(badge)}><CalendarClock size={15} />设置条件</button>
                      <button className="btn btn-secondary" onClick={() => openOwners(badge)}><Users size={15} />拥有用户（{badge.ownerCount ?? 0}）</button>
                    </div>
                  </div>
                ))}
                {activityBadges.length === 0 && <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-muted">暂无活动徽章</p>}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-black text-ink">限定徽章</h3>
              <div className="space-y-2">
                {limitedBadges.map((badge) => (
                  <div key={badge.id} className="flex flex-col gap-4 rounded-xl border border-line p-4 sm:flex-row sm:items-center">
                    <LegendaryBadgeIcon badge={badge} className="h-20 w-20" />
                    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="font-black text-ink">{badge.name}</h4><span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-black text-violet-600">限定</span></div><p className="mt-1 text-sm text-muted">{badge.description}</p>{badge.requirement && <p className="mt-2 text-xs text-muted">获取条件：{badge.requirement}</p>}</div>
                    <button className="btn btn-secondary shrink-0" onClick={() => openOwners(badge)}><Users size={15} />拥有用户（{badge.ownerCount ?? 0}）</button>
                  </div>
                ))}
                {limitedBadges.length === 0 && <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-muted">暂无限定徽章</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      {userAction && (
        <Modal full onClose={closeUserModal}>
          <div className="flex items-center justify-between border-b border-line pb-3"><div><h2 className="text-lg font-black text-ink">{userAction === "view" ? "查看徽章" : userAction === "grant" ? "发放徽章" : "收回徽章"}</h2>{userDetail && <p className="mt-1 text-sm text-muted">{userDetail.user.nickname}（@{userDetail.user.username}）</p>}</div><button className="btn btn-secondary px-3" onClick={closeUserModal}><X size={17} /></button></div>
          {modalLoading && !userDetail ? <div className="py-5"><CardSkeleton rows={5} /></div> : userDetail && (
            <div className="py-5">
              {userAction === "view" && <div className="space-y-6">
                <div><h3 className="mb-3 text-sm font-black text-ink">成就徽章</h3><div className="grid grid-cols-3 gap-5 sm:grid-cols-5 md:grid-cols-6">{ownedSystemBadges.map((badge) => <SystemBadgeTile key={getBadgeKey(badge)} badge={badge} />)}{ownedAchievementSpecialBadges.map((badge) => <LegendaryBadgeTile key={badge.key} badge={badge} />)}</div></div>
                {ownedActivityBadges.length > 0 && <div><h3 className="mb-3 text-sm font-black text-ink">活动徽章</h3><div className="grid grid-cols-3 gap-5 sm:grid-cols-5 md:grid-cols-6">{ownedActivityBadges.map((badge) => <LegendaryBadgeTile key={badge.key} badge={badge} />)}</div></div>}
                {ownedLimitedBadges.length > 0 && <div><h3 className="mb-3 text-sm font-black text-ink">限定徽章</h3><div className="grid grid-cols-3 gap-5 sm:grid-cols-5 md:grid-cols-6">{ownedLimitedBadges.map((badge) => <LegendaryBadgeTile key={badge.key} badge={badge} />)}</div></div>}
              </div>}
              {userAction === "view" && ownedSystemBadges.length + ownedLegendaryBadges.length === 0 && <p className="py-10 text-center text-sm text-muted">该用户尚未拥有徽章</p>}
              {userAction === "grant" && <div className="space-y-6">
                {grantableLimitedBadges.length > 0 && <div><h3 className="mb-2 text-sm font-black text-ink">限定徽章</h3><div className="space-y-3">{grantableLimitedBadges.map((badge) => <div key={badge.id} className="flex items-center gap-3 rounded-xl border border-line p-3"><LegendaryBadgeIcon badge={badge} /><div className="min-w-0 flex-1"><strong className="text-ink">{badge.name}</strong><p className="text-sm text-muted">{badge.description}</p></div><button className="btn btn-primary shrink-0" disabled={modalLoading} onClick={() => grantBadge(badge)}>发放</button></div>)}</div></div>}
              </div>}
              {userAction === "grant" && grantableLimitedBadges.length === 0 && <p className="py-10 text-center text-sm text-muted">没有可直接发放的限定徽章</p>}
              {userAction === "revoke" && <div className="space-y-6">
                {ownedActivityBadges.length > 0 && <div><h3 className="mb-2 text-sm font-black text-ink">活动徽章</h3><div className="space-y-3">{ownedActivityBadges.map((badge) => <div key={badge.id} className="flex items-center gap-3 rounded-xl border border-line p-3"><LegendaryBadgeIcon badge={badge} /><div className="min-w-0 flex-1"><strong className="text-ink">{badge.name}</strong><p className="text-sm text-muted">{badge.description}</p></div><button className="btn btn-danger shrink-0" disabled={modalLoading} onClick={() => revokeBadge(userDetail.user, badge)}>收回</button></div>)}</div></div>}
                {ownedLimitedBadges.length > 0 && <div><h3 className="mb-2 text-sm font-black text-ink">限定徽章</h3><div className="space-y-3">{ownedLimitedBadges.map((badge) => <div key={badge.id} className="flex items-center gap-3 rounded-xl border border-line p-3"><LegendaryBadgeIcon badge={badge} /><div className="min-w-0 flex-1"><strong className="text-ink">{badge.name}</strong><p className="text-sm text-muted">{badge.description}</p></div><button className="btn btn-danger shrink-0" disabled={modalLoading} onClick={() => revokeBadge(userDetail.user, badge)}>收回</button></div>)}</div></div>}
              </div>}
              {userAction === "revoke" && ownedLegendaryBadges.length === 0 && <p className="py-10 text-center text-sm text-muted">该用户没有可收回的传说徽章</p>}
            </div>
          )}
        </Modal>
      )}

      {conditionBadge && (
        <Modal full onClose={() => { if (!modalLoading) setConditionBadge(null); }}>
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div><h2 className="text-lg font-black text-ink">设置活动发放条件</h2><p className="mt-1 text-sm text-muted">{conditionBadge.name} · 多个条件需同时满足；已获得用户不会被收回或重复发放</p></div>
            <button className="btn btn-secondary px-3" disabled={modalLoading} onClick={() => setConditionBadge(null)}><X size={17} /></button>
          </div>
          <div className="space-y-3 py-4">
            {conditionDraft.map((condition, index) => (
              <div key={index} className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-[1.2fr_1fr_1fr_110px_auto] md:items-end">
                <label className="text-xs font-bold text-muted">条件类型<select className="field mt-1" value={condition.kind} onChange={(event) => { const kind = event.target.value as ActivityConditionKind; updateActivityCondition(index, { kind, target: kind === "user_joined" ? undefined : kind === "login" ? 1 : (condition.target ?? 1) }); }}>{Object.entries(ACTIVITY_CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="text-xs font-bold text-muted">开始日期<select className="field mt-1" value={condition.startDate === "long_term" ? "long_term" : "date"} onChange={(event) => updateActivityTimeMode(index, event.target.value as "date" | "long_term")}><option value="date">指定日期</option><option value="long_term">长期有效</option></select>{condition.startDate !== "long_term" && <input className="field mt-1" type="date" value={condition.startDate} onChange={(event) => updateActivityCondition(index, { startDate: event.target.value })} />}</label>
                <label className="text-xs font-bold text-muted">结束日期<select className="field mt-1" value={condition.endDate === "long_term" ? "long_term" : "date"} onChange={(event) => updateActivityTimeMode(index, event.target.value as "date" | "long_term")}><option value="date">指定日期</option><option value="long_term">长期有效</option></select>{condition.endDate !== "long_term" && <input className="field mt-1" type="date" value={condition.endDate} onChange={(event) => updateActivityCondition(index, { endDate: event.target.value })} />}</label>
                {["login", "user_joined"].includes(condition.kind) ? <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs font-bold text-muted">无需设置次数</div> : <label className="text-xs font-bold text-muted">数量<input className="field mt-1" type="number" min={1} max={1000000} value={condition.target ?? 1} onChange={(event) => updateActivityCondition(index, { target: Math.max(1, Number(event.target.value) || 1) })} /></label>}
                <button className="btn btn-danger h-11 px-3" type="button" disabled={modalLoading} onClick={() => setConditionDraft((current) => current.filter((_, conditionIndex) => conditionIndex !== index))}><Trash2 size={15} /></button>
              </div>
            ))}
            {conditionDraft.length === 0 && <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-muted">未设置活动规则时不会自动发放</p>}
            <button className="btn btn-secondary" type="button" disabled={conditionDraft.length >= 8 || modalLoading} onClick={addActivityCondition}><Plus size={15} />添加条件</button>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-3"><button className="btn btn-secondary" disabled={modalLoading} onClick={() => setConditionBadge(null)}>取消</button><button className="btn btn-primary" disabled={modalLoading} onClick={saveActivityConditions}>{modalLoading ? "保存中…" : "保存条件"}</button></div>
        </Modal>
      )}

      {ownersBadge && (
        <Modal full onClose={() => setOwnersBadge(null)}>
          <div className="flex items-center justify-between border-b border-line pb-3"><div><h2 className="text-lg font-black text-ink">拥有「{ownersBadge.name}」的用户</h2><p className="mt-1 text-sm text-muted">共 {owners.length} 位</p></div><button className="btn btn-secondary px-3" onClick={() => setOwnersBadge(null)}><X size={17} /></button></div>
          <div className="space-y-2 py-4">{owners.map((user) => <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"><UserIdentity user={user} /><button className="btn btn-danger shrink-0" disabled={modalLoading} onClick={() => revokeBadge(user, ownersBadge, true)}>撤销徽章</button></div>)}</div>
          {owners.length === 0 && !modalLoading && <p className="py-10 text-center text-sm text-muted">暂时没有用户拥有该徽章</p>}
        </Modal>
      )}
    </div>
  );
}
