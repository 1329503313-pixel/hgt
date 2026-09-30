import { useState } from "react";
import { Crown, History } from "lucide-react";
import type { VipOverview } from "../shared/types";
import { formatVipBenefitValue, VIP_BENEFIT_SECTIONS } from "../shared/vipBenefits";
import { Modal } from "./Modal";
import { VipIcon } from "./VipVisuals";

function currentLevelLabel(overview: VipOverview) {
  if (overview.active) return `VIP${overview.level}`;
  if (overview.level >= 1 && overview.vipExpired) return `VIP${overview.level}（已失效）`;
  return overview.vipExpired ? "未开通（已失效）" : "未开通";
}

function formatEventDate(event: VipOverview["events"][number]) {
  const dateParts = event.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateParts) return `${dateParts[1]}/${Number(dateParts[2])}/${Number(dateParts[3])}`;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(new Date(event.createdAt));
}

function formatVipExpiryDate(expiresAt: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(expiresAt));
}

export function VipCard({ overview, onOpen, onOpenDetails }: { overview: VipOverview | null; onOpen: () => void; onOpenDetails?: () => void }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [benefitsOpen, setBenefitsOpen] = useState(false);
  if (!overview) return <div className="mine-vip-card min-h-48 animate-pulse" aria-label="VIP加载中" />;
  const progress = Math.max(0, Math.min(100, overview.progressPercent));
  const required = overview.nextThreshold == null ? "已达最高等级" : `升级还需 ${(overview.nextThreshold - overview.growthValue).toLocaleString()} 成长值`;

  return (
    <aside className="mine-vip-card flex min-w-0 flex-col rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-soft sm:p-5">
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-white"><Crown size={19} /></span><h2 className="text-xl font-bold text-ink">VIP</h2></div><button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-amber-200 bg-white px-3 text-xs font-bold text-amber-700 transition hover:bg-amber-100" onClick={() => { setDetailOpen(true); onOpenDetails?.(); }}><History size={15} />明细</button></div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">VIP等级</p>
          <p className={`mt-1 flex min-h-9 items-center gap-2 text-3xl font-black ${overview.active ? "text-amber-700" : "text-muted"}`}>
            {overview.active && <VipIcon level={overview.level} active className="h-7 w-7 shrink-0" />}
            <span>{currentLevelLabel(overview)}</span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-muted"><span>成长值 {overview.growthValue.toLocaleString()}</span><span>{required}</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100"><span className="block h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
      <div className="mt-1 min-h-4 text-right text-[11px] font-bold text-muted">
        {overview.active && (overview.vipExpiresAt ? `VIP到期时间 ${formatVipExpiryDate(overview.vipExpiresAt)}` : "VIP长期有效")}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-5"><button type="button" className="btn btn-primary mine-card-action" onClick={onOpen}>开通VIP</button><button type="button" className="btn btn-secondary mine-card-action" onClick={() => setBenefitsOpen(true)}>VIP权益</button></div>
      {detailOpen && <Modal hideCloseButton onClose={() => setDetailOpen(false)}><div className="space-y-3"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black text-ink">VIP等级明细</h2><p className="mt-1 text-sm text-muted">当前成长值 {overview.growthValue.toLocaleString()} · {currentLevelLabel(overview)}</p></div><button type="button" className="btn btn-secondary min-h-10 px-3" onClick={() => setDetailOpen(false)}>关闭</button></div><div className="max-h-[55vh] divide-y divide-line overflow-y-auto">{overview.events.length === 0 ? <p className="py-8 text-center text-sm text-muted">暂无成长值明细</p> : overview.events.map((event) => <div key={event.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{event.remark}</p><p className="mt-1 text-xs text-muted">{formatEventDate(event)}</p></div><strong className={`shrink-0 text-sm font-black ${event.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>{event.amount >= 0 ? "+" : ""}{event.amount}</strong></div>)}</div></div></Modal>}
      {benefitsOpen && <Modal hideCloseButton onClose={() => setBenefitsOpen(false)} contentClassName="sm:max-w-xl"><div className="space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black text-ink">VIP权益</h2><p className="mt-1 text-sm leading-6 text-muted">按当前 VIP 等级与后台实时配置计算</p></div><button type="button" className="btn btn-secondary min-h-11 shrink-0 px-4" onClick={() => setBenefitsOpen(false)}>关闭</button></div><div className="space-y-3">{VIP_BENEFIT_SECTIONS.map((section) => <section key={section.title} aria-labelledby={`vip-benefit-${section.title}`} className="overflow-hidden rounded-xl border border-line bg-slate-50"><h3 id={`vip-benefit-${section.title}`} className="border-b border-line bg-white px-3 py-2 text-xs font-black tracking-[0.12em] text-primary">{section.title}</h3><dl className="divide-y divide-line">{section.items.map((item) => <div key={item.key} className="flex items-start justify-between gap-4 px-3 py-3 text-sm"><dt className="min-w-0 text-muted"><span className="block">{item.label}</span>{item.detail && <span className="mt-0.5 block text-xs leading-5 text-muted/80">{item.detail}</span>}</dt><dd className="max-w-[48%] shrink-0 text-right font-black tabular-nums text-ink">{formatVipBenefitValue(overview.benefits, item)}</dd></div>)}</dl></section>)}</div><section aria-labelledby="vip-identity-benefits" className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/60"><h3 id="vip-identity-benefits" className="border-b border-amber-200 bg-white px-3 py-2 text-xs font-black tracking-[0.12em] text-amber-700">身份特权</h3><dl className="divide-y divide-amber-200/70"><div className="flex items-start justify-between gap-4 px-3 py-3 text-sm"><dt className="text-muted">配置作品 AI 主持</dt><dd className="shrink-0 text-right font-black text-ink">可用</dd></div><div className="flex items-start justify-between gap-4 px-3 py-3 text-sm"><dt className="text-muted">昵称视觉</dt><dd className="max-w-[58%] text-right font-black text-ink">VIP1–4 金色<br />VIP5–6 炫彩<br />VIP7–9 动态炫彩</dd></div><div className="flex items-start justify-between gap-4 px-3 py-3 text-sm"><dt className="text-muted">登录全平台播报</dt><dd className="shrink-0 text-right font-black text-ink">VIP7 及以上</dd></div></dl></section><p className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800">每日权益按北京时间自然日计算。VIP 不包含未公开汤底、主持人手册或受限汤面的直接查看权限，仍需按内容访问规则申请。</p></div></Modal>}
    </aside>
  );
}
