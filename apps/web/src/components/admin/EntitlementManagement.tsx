import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Infinity as InfinityIcon, Save, ShieldCheck } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { CardSkeleton } from "../Skeletons";

type EntitlementPlan = {
  dailySoupPublishLimit: number | null;
  dailyEvaluationLimit: number | null;
  dailyAutoShellGrant: number;
  dailyAutoExperienceGrant: number;
  dailyLikeLimit: number | null;
  dailyFavoriteLimit: number | null;
  dailyDrawLimit: number | null;
  dailyAiQuestionLimit: number | null;
  dailyMysteryQuestionLimit: number | null;
  dailyGiftSendShellValueLimit: number | null;
  dailyCharmReceiveLimit: number | null;
  dailyAiHintLimit: number | null;
  dailyGiftReceiveShellLimit: number | null;
  dailyExtraFreeDraws: number | null;
};

type PlanKey = keyof EntitlementPlan;
type EntitlementPlans = { user: EntitlementPlan; vip: EntitlementPlan };
type EntitlementResponse = {
  current: EntitlementPlans;
  currentEffectiveDate: string | null;
  scheduled: EntitlementPlans | null;
  scheduledEffectiveDate: string;
  rules: { mysteryQuestionEnforced: boolean; autoGrantsSupportUnlimited: boolean };
};

const FIELDS: Array<{
  key: PlanKey;
  label: string;
  unit: string;
  description: string;
  finiteOnly?: boolean;
  vipOnly?: boolean;
}> = [
  { key: "dailySoupPublishLimit", label: "每日发布海龟汤数量", unit: "篇", description: "仅新建发布计数，编辑不计数。" },
  { key: "dailyEvaluationLimit", label: "每日发表评论数量", unit: "条", description: "首次评价计数，修改已有评价不重复计数。" },
  { key: "dailyAutoShellGrant", label: "每日自动赠送贝壳数量", unit: "贝壳", description: "北京时间 00:00 自动到账，与任务奖励独立。", finiteOnly: true },
  { key: "dailyAutoExperienceGrant", label: "每日自动赠送经验数量", unit: "经验", description: "北京时间 00:00 自动到账，与任务奖励独立。", finiteOnly: true },
  { key: "dailyLikeLimit", label: "每日限制点赞数量", unit: "次", description: "新增点赞计数，取消点赞不受限。" },
  { key: "dailyFavoriteLimit", label: "每日限制收藏数量", unit: "次", description: "新增收藏计数，取消收藏不受限。" },
  { key: "dailyDrawLimit", label: "每日限制抽卡次数", unit: "抽", description: "单抽计 1 次，十连抽计 10 次。" },
  { key: "dailyAiQuestionLimit", label: "每日 AI 主持提问次数", unit: "次", description: "仅 AI 主持下的正式提问计数。" },
  { key: "dailyAiHintLimit", label: "每日 AI 提示次数", unit: "次", description: "与正式提问独立计数。" },
  { key: "dailyMysteryQuestionLimit", label: "每日限制谜局提问次数", unit: "次", description: "仅谜局房主提交的正式行动计数；讨论消息与原行动失败重试不重复计数。" },
  { key: "dailyGiftSendShellValueLimit", label: "每日可送出礼物价值", unit: "贝壳", description: "按礼物单价 × 数量计数，库存礼物同样计入价值。" },
  { key: "dailyGiftReceiveShellLimit", label: "每日通过礼物获取贝壳上限", unit: "贝壳", description: "达到上限后礼物仍成功，超出部分不发放。" },
  { key: "dailyCharmReceiveLimit", label: "每日可获取魅力数量", unit: "魅力", description: "达到上限后礼物仍成功，超出部分魅力为 0。" },
  { key: "dailyExtraFreeDraws", label: "VIP 每日额外免费抽卡次数", unit: "次/卡包", description: "每个卡包分别享有；卡包自身免费次数用完后生效，只抵扣单抽费用。", vipOnly: true }
];

function formatDate(value: string | null) {
  if (!value) return "系统默认配置";
  return value;
}

function ValueEditor({
  tier,
  field,
  value,
  onChange
}: {
  tier: "user" | "vip";
  field: (typeof FIELDS)[number];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  if (field.vipOnly && tier === "user") {
    return <div className="field flex h-11 items-center bg-slate-50 text-sm font-bold text-muted">不适用</div>;
  }
  const unlimited = value == null;
  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-muted">{tier === "user" ? "普通用户" : "VIP / 后台管理员"}</label>
      <div className="flex gap-2">
        <input
          className="field h-11 min-w-0 flex-1"
          type="number"
          min={0}
          max={2_000_000_000}
          step={1}
          disabled={unlimited}
          value={unlimited ? "" : value}
          aria-label={`${field.label}-${tier === "user" ? "普通用户" : "VIP"}`}
          onChange={(event) => onChange(Math.max(0, Math.min(2_000_000_000, Math.floor(Number(event.target.value) || 0))))}
        />
        {!field.finiteOnly && (
          <label className={`inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-sm font-bold ${unlimited ? "border-primary bg-blue-50 text-primary" : "border-line bg-white text-muted"}`}>
            <input className="sr-only" type="checkbox" checked={unlimited} onChange={(event) => onChange(event.target.checked ? null : 0)} />
            <InfinityIcon size={16} />无限
          </label>
        )}
      </div>
      <p className="text-xs text-muted">单位：{field.unit}{field.finiteOnly ? "（资产赠送必须为有限整数）" : ""}</p>
    </div>
  );
}

export function EntitlementManagement() {
  const { showToast } = useApp();
  const [data, setData] = useState<EntitlementResponse | null>(null);
  const [form, setForm] = useState<EntitlementPlans | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api<EntitlementResponse>("/api/admin/entitlements", { bypassCache: true, dedupe: false });
      setData(next);
      setForm(structuredClone(next.scheduled ?? next.current));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "权益配置加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const baseline = useMemo(() => data ? JSON.stringify(data.scheduled ?? data.current) : "", [data]);
  const dirty = Boolean(form && JSON.stringify(form) !== baseline);

  function update(tier: "user" | "vip", key: PlanKey, value: number | null) {
    setForm((current) => current ? { ...current, [tier]: { ...current[tier], [key]: value } } : current);
  }

  async function save() {
    if (!form || !data) return;
    setSaving(true);
    setError("");
    try {
      await api("/api/admin/entitlements", { method: "PUT", body: form });
      showToast(`权益配置已保存，将于 ${data.scheduledEffectiveDate} 00:00 生效`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "权益配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CardSkeleton rows={8} />;
  if (!data || !form) return <div className="card p-5 text-sm font-bold text-red-600" role="alert">{error || "权益配置不可用"}</div>;

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck className="text-primary" size={22} /><h2 className="text-lg font-black text-ink">用户权益</h2></div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">后台管理员复用 VIP 权益；超级管理员不受每日限制，也不参与每日自动赠送。所有限额按北京时间自然日统计。</p>
          </div>
          <button type="button" className="btn btn-primary min-h-11 shrink-0 px-5" disabled={saving || !dirty} onClick={() => void save()}>
            <Save size={17} />{saving ? "保存中…" : "保存次日配置"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-slate-50 p-3"><p className="text-xs font-bold text-muted">当前配置生效日</p><p className="mt-1 font-black text-ink">{formatDate(data.currentEffectiveDate)}</p></div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="flex items-center gap-1 text-xs font-bold text-primary"><CalendarClock size={14} />下次生效时间</p><p className="mt-1 font-black text-ink">{data.scheduledEffectiveDate} 00:00</p><p className="mt-1 text-xs text-muted">保存后覆盖该日期待生效配置；当天已发生的数据不追扣。</p></div>
        </div>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">{error}</p>}
        {dirty && <p className="mt-3 text-sm font-bold text-amber-700">有尚未保存的修改。</p>}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {FIELDS.map((field) => (
          <section key={field.key} className="card p-4">
            <h3 className="font-black text-ink">{field.label}</h3>
            <p className="mt-1 min-h-10 text-sm leading-5 text-muted">{field.description}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ValueEditor tier="user" field={field} value={form.user[field.key]} onChange={(value) => update("user", field.key, field.vipOnly ? 0 : value)} />
              <ValueEditor tier="vip" field={field} value={form.vip[field.key]} onChange={(value) => update("vip", field.key, value)} />
            </div>
          </section>
        ))}
      </div>

      <section className="card p-4 sm:p-5">
        <h2 className="font-black text-ink">固定身份能力</h2>
        <p className="mt-1 text-sm text-muted">本期只读展示，不参与次日数值配置。</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-3"><p className="font-bold text-ink">查看受限汤内容</p><p className="mt-1 text-sm text-muted">普通用户：否 · VIP / 后台管理员：是</p></div>
          <div className="rounded-xl border border-line p-3"><p className="font-bold text-ink">配置 AI 主持</p><p className="mt-1 text-sm text-muted">普通用户：否 · VIP / 后台管理员：是</p></div>
        </div>
      </section>
    </div>
  );
}
